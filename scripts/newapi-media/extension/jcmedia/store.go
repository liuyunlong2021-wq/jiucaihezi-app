// Package jcmedia is the local temporary-media extension for NewAPI rc.40.
package jcmedia

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const MaxFile = 20 << 20
const Budget = 10 << 30
const TTL = 7 * 24 * time.Hour

var tokenPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)

type Store struct {
	Root  string
	Limit int64
	mu    sync.Mutex
}
type metadata struct {
	Type    string
	Owner   int
	Expires int64
}

func New(root string) (*Store, error) {
	if err := os.MkdirAll(root, 0700); err != nil {
		return nil, err
	}
	info, err := os.Lstat(root)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("unsafe media directory")
	}
	return &Store{Root: root, Limit: Budget}, nil
}
func fail(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"success": false, "status": status, "code": code, "message": message})
}
func (s *Store) sweep(now time.Time) (int64, error) {
	entries, err := os.ReadDir(s.Root)
	if err != nil {
		return 0, err
	}
	// Delete expired media only. Incomplete publishes age out after one hour.
	for _, e := range entries {
		name := e.Name()
		path := filepath.Join(s.Root, name)
		info, err := e.Info()
		if err != nil {
			return 0, err
		}
		if strings.HasSuffix(name, ".json") && tokenPattern.MatchString(strings.TrimSuffix(name, ".json")) {
			raw, err := os.ReadFile(path)
			if err != nil {
				return 0, err
			}
			var m metadata
			if json.Unmarshal(raw, &m) == nil && m.Expires <= now.Unix() {
				if err := os.Remove(filepath.Join(s.Root, strings.TrimSuffix(name, ".json"))); err != nil && !os.IsNotExist(err) {
					return 0, err
				}
				if err := os.Remove(path); err != nil {
					return 0, err
				}
			}
		} else if strings.HasPrefix(name, ".upload-") && now.Sub(info.ModTime()) > time.Hour {
			if err := os.Remove(path); err != nil {
				return 0, err
			}
		} else if tokenPattern.MatchString(name) {
			if _, err := os.Stat(path + ".json"); os.IsNotExist(err) && now.Sub(info.ModTime()) > time.Hour {
				if err := os.Remove(path); err != nil {
					return 0, err
				}
			}
		}
	}
	entries, err = os.ReadDir(s.Root)
	if err != nil {
		return 0, err
	}
	var total int64
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			return 0, err
		}
		total += info.Size()
	}
	return total, nil
}
func (s *Store) Cleanup() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.sweep(time.Now())
	return err
}

func (s *Store) Upload(w http.ResponseWriter, r *http.Request, owner int) {
	if owner <= 0 {
		fail(w, 401, "unauthorized", "请先登录")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	r.Body = http.MaxBytesReader(w, r.Body, MaxFile+(1<<20))
	reader, err := r.MultipartReader()
	if err != nil {
		fail(w, 400, "bad_request", "需要 multipart 文件")
		return
	}
	// Serial uploads reserve the worst-case file size before accepting any bytes.
	// Reads remain concurrent; the backend intentionally has one writer per volume.
	s.mu.Lock()
	defer s.mu.Unlock()
	used, err := s.sweep(time.Now())
	if err != nil {
		fail(w, 503, "media_storage_unavailable", "素材存储暂时不可用")
		return
	}
	if used+MaxFile+4096 > s.Limit || !hasDiskSpace(s.Root, MaxFile+(1<<30)) {
		fail(w, 507, "media_storage_full", "素材空间不足，请联系管理员")
		return
	}
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			fail(w, 400, "bad_request", "缺少媒体文件")
			return
		}
		if err != nil {
			fail(w, 413, "media_too_large", "请求过大或不完整")
			return
		}
		if part.FormName() != "file" {
			_ = part.Close()
			continue
		}
		typ := strings.ToLower(strings.TrimSpace(strings.Split(part.Header.Get("Content-Type"), ";")[0]))
		if !(strings.HasPrefix(typ, "image/") || strings.HasPrefix(typ, "audio/") || strings.HasPrefix(typ, "video/")) || typ == "image/svg+xml" {
			fail(w, 400, "bad_request", "仅支持图片、视频或音频文件，SVG 不支持")
			return
		}
		f, err := os.CreateTemp(s.Root, ".upload-")
		if err != nil {
			fail(w, 503, "media_storage_unavailable", "素材存储暂时不可用")
			return
		}
		tmp := f.Name()
		defer os.Remove(tmp)
		n, copyErr := io.Copy(f, io.LimitReader(part, MaxFile+1))
		if copyErr == nil {
			copyErr = f.Sync()
		}
		closeErr := f.Close()
		if n > MaxFile {
			fail(w, 413, "media_too_large", "媒体文件不能超过 20 MB")
			return
		}
		if copyErr != nil || closeErr != nil || r.Context().Err() != nil {
			fail(w, 503, "media_storage_unavailable", "素材写入失败，请重试")
			return
		}
		if n == 0 {
			fail(w, 400, "bad_request", "文件为空")
			return
		}
		// A successful response must mean the complete multipart request was accepted.
		for {
			extra, e := reader.NextPart()
			if e == io.EOF {
				break
			}
			if e != nil {
				fail(w, 413, "media_too_large", "请求过大或不完整")
				return
			}
			if extra.FormName() == "file" {
				fail(w, 400, "bad_request", "每次只能上传一个文件")
				return
			}
			_, e = io.Copy(io.Discard, extra)
			if e != nil {
				fail(w, 413, "media_too_large", "请求过大或不完整")
				return
			}
		}
		random := make([]byte, 16)
		if _, err = rand.Read(random); err != nil {
			fail(w, 503, "media_storage_unavailable", "素材存储暂时不可用")
			return
		}
		token := hex.EncodeToString(random)
		dest := filepath.Join(s.Root, token)
		m := metadata{Type: typ, Owner: owner, Expires: time.Now().Add(TTL).Unix()}
		mf, err := os.CreateTemp(s.Root, ".upload-")
		if err != nil {
			fail(w, 503, "media_storage_unavailable", "素材存储暂时不可用")
			return
		}
		metaTmp := mf.Name()
		defer os.Remove(metaTmp)
		err = json.NewEncoder(mf).Encode(m)
		if err == nil {
			err = mf.Sync()
		}
		ce := mf.Close()
		if err != nil || ce != nil {
			fail(w, 503, "media_storage_unavailable", "素材存储暂时不可用")
			return
		}
		if err = os.Rename(tmp, dest); err != nil {
			fail(w, 503, "media_storage_unavailable", "素材存储暂时不可用")
			return
		}
		if err = os.Rename(metaTmp, dest+".json"); err != nil {
			_ = os.Remove(dest)
			fail(w, 503, "media_storage_unavailable", "素材存储暂时不可用")
			return
		}
		// Fixed public origin: never trust a caller-controlled Host header.
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"url": "https://api.jiucaihezi.studio/media/creation/" + token, "expires_at": m.Expires})
		return
	}
}
func (s *Store) Read(w http.ResponseWriter, r *http.Request, token string) {
	if !tokenPattern.MatchString(token) {
		http.NotFound(w, r)
		return
	}
	raw, err := os.ReadFile(filepath.Join(s.Root, token) + ".json")
	var m metadata
	if err != nil || json.Unmarshal(raw, &m) != nil || m.Expires <= time.Now().Unix() {
		http.NotFound(w, r)
		return
	}
	path := filepath.Join(s.Root, token)
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", m.Type)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	remaining := m.Expires - time.Now().Unix()
	if remaining > 3600 {
		remaining = 3600
	}
	w.Header().Set("Cache-Control", "public, max-age="+formatSeconds(remaining))
	http.ServeContent(w, r, token, info.ModTime(), f)
}
