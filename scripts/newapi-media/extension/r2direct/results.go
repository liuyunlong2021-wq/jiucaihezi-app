package r2direct

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sync"
	"time"
)

// ResultMaxFile bounds one relayed video; ResultFreeSpace stays free on disk after it.
const ResultMaxFile = 1 << 30
const ResultFreeSpace = 2 << 30

var resultTaskID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)
var resultClient = &http.Client{Timeout: 10 * time.Minute}

// ResultObjects is the R2 side of the relay; Signer implements it.
type ResultObjects interface {
	Exists(ctx context.Context, key string) (bool, error)
	Put(ctx context.Context, key string, body io.Reader, size int64) error
	ReadURL(ctx context.Context, key string) (string, error)
}

func (s *Signer) Exists(ctx context.Context, key string) (bool, error) {
	address, err := s.presign(ctx, http.MethodHead, s.endpoint+"/"+Bucket+"/"+key, "", 0, UploadURLTTL, time.Now().UTC())
	if err != nil {
		return false, err
	}
	r, _ := http.NewRequestWithContext(ctx, http.MethodHead, address, nil)
	response, err := resultClient.Do(r)
	if err != nil {
		return false, err
	}
	response.Body.Close()
	switch response.StatusCode {
	case 200:
		return true, nil
	case 404:
		return false, nil
	}
	return false, fmt.Errorf("R2 HEAD %d", response.StatusCode)
}

func (s *Signer) Put(ctx context.Context, key string, body io.Reader, size int64) error {
	address, err := s.presign(ctx, http.MethodPut, s.endpoint+"/"+Bucket+"/"+key, "video/mp4", size, UploadURLTTL, time.Now().UTC())
	if err != nil {
		return err
	}
	r, _ := http.NewRequestWithContext(ctx, http.MethodPut, address, body)
	r.ContentLength = size
	r.Header.Set("Content-Type", "video/mp4")
	response, err := resultClient.Do(r)
	if err != nil {
		return err
	}
	response.Body.Close()
	if response.StatusCode != 200 {
		return fmt.Errorf("R2 PUT %d", response.StatusCode)
	}
	return nil
}

func (s *Signer) ReadURL(ctx context.Context, key string) (string, error) {
	return s.presign(ctx, http.MethodGet, s.endpoint+"/"+Bucket+"/"+key, "", 0, ReadURLTTL, time.Now().UTC())
}

// VideoRelay copies a finished video from the NewAPI host into R2 once, then
// redirects every download to R2. The host decides ownership and fetches the
// upstream result, so vendor addresses never reach the client.
type VideoRelay struct {
	Origin   string // loopback NewAPI, e.g. http://127.0.0.1:3000
	Client   *http.Client
	Objects  ResultObjects
	TempDir  string
	MaxSize  int64
	HasSpace func(dir string, required int64) bool

	mu       sync.Mutex
	inflight map[string]*relayCall
}

type relayCall struct {
	done chan struct{}
	err  error
}

type relayError struct {
	status int
	code   string
}

func (e *relayError) Error() string { return e.code }

// Serve uses the owner established by NewAPI TokenAuth and forwards the caller's
// own Authorization to the host, never a credential of its own.
func (v *VideoRelay) Serve(w http.ResponseWriter, r *http.Request, owner int, task string) {
	w.Header().Set("Cache-Control", "no-store")
	fail := func(err error) {
		var known *relayError
		if !errors.As(err, &known) {
			known = &relayError{502, "r2_relay_failed"}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(known.status)
		_ = json.NewEncoder(w).Encode(map[string]string{"code": known.code})
	}
	if owner <= 0 {
		fail(&relayError{401, "unauthorized"})
		return
	}
	if !resultTaskID.MatchString(task) {
		fail(&relayError{400, "bad_request"})
		return
	}
	if v == nil || v.Objects == nil {
		fail(&relayError{503, "r2_relay_unavailable"})
		return
	}
	auth := r.Header.Get("Authorization")
	// A stored object is only served after the host confirms this caller owns the task.
	if err := v.fetch(r.Context(), "/v1/videos/"+url.PathEscape(task), auth, func(*http.Response) error { return nil }); err != nil {
		fail(err)
		return
	}
	key := fmt.Sprintf("video-results/%d/%s.mp4", owner, task)
	// The copy outlives a disconnecting first caller; waiters share its result.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 10*time.Minute)
	defer cancel()
	if err := v.once(key, func() error { return v.copy(ctx, key, task, auth) }); err != nil {
		fail(err)
		return
	}
	location, err := v.Objects.ReadURL(r.Context(), key)
	if err != nil {
		fail(err)
		return
	}
	w.Header().Set("Location", location)
	w.WriteHeader(http.StatusFound)
}

func (v *VideoRelay) once(key string, run func() error) error {
	v.mu.Lock()
	if call, ok := v.inflight[key]; ok {
		v.mu.Unlock()
		<-call.done
		return call.err
	}
	if v.inflight == nil {
		v.inflight = map[string]*relayCall{}
	}
	call := &relayCall{done: make(chan struct{})}
	v.inflight[key] = call
	v.mu.Unlock()
	call.err = run()
	v.mu.Lock()
	delete(v.inflight, key)
	v.mu.Unlock()
	close(call.done)
	return call.err
}

func (v *VideoRelay) copy(ctx context.Context, key, task, auth string) error {
	if exists, err := v.Objects.Exists(ctx, key); err != nil || exists {
		return err
	}
	if !v.HasSpace(v.TempDir, v.MaxSize+ResultFreeSpace) {
		return &relayError{503, "relay_storage_full"}
	}
	return v.fetch(ctx, "/v1/videos/"+url.PathEscape(task)+"/content", auth, func(response *http.Response) error {
		media, _, _ := mime.ParseMediaType(response.Header.Get("Content-Type"))
		if len(media) < 6 || media[:6] != "video/" {
			return &relayError{502, "result_not_video"}
		}
		file, err := os.CreateTemp(v.TempDir, "video-result-*.part")
		if err != nil {
			return err
		}
		defer os.Remove(file.Name())
		defer file.Close()
		size, err := io.Copy(file, io.LimitReader(response.Body, v.MaxSize+1))
		if err != nil {
			return err
		}
		if size == 0 || size > v.MaxSize {
			return &relayError{502, "result_size_invalid"}
		}
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			return err
		}
		return v.Objects.Put(ctx, key, file, size)
	})
}

// fetch calls the host as the caller; host 4xx (401/404/409…) pass through so the
// client keeps its existing re-query and retry behaviour.
func (v *VideoRelay) fetch(ctx context.Context, path, auth string, use func(*http.Response) error) error {
	r, err := http.NewRequestWithContext(ctx, http.MethodGet, v.Origin+path, nil)
	if err != nil {
		return err
	}
	r.Header.Set("Authorization", auth)
	response, err := v.Client.Do(r)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		if response.StatusCode >= 400 && response.StatusCode < 500 {
			return &relayError{response.StatusCode, "task_result_unavailable"}
		}
		return &relayError{502, "task_result_unavailable"}
	}
	return use(response)
}
