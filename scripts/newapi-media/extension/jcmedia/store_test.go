package jcmedia

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func upload(t *testing.T, s *Store, data string, owner int) (*httptest.ResponseRecorder, string) {
	t.Helper()
	var b bytes.Buffer
	mw := multipart.NewWriter(&b)
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", `form-data; name="file"; filename="reference.png"`)
	h.Set("Content-Type", "image/png")
	p, _ := mw.CreatePart(h)
	_, _ = io.WriteString(p, data)
	_ = mw.Close()
	r := httptest.NewRequest("POST", "/api/creations/uploads", &b)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	w := httptest.NewRecorder()
	s.Upload(w, r, owner)
	var v struct {
		URL string `json:"url"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &v)
	return w, strings.TrimPrefix(v.URL, "https://api.jiucaihezi.studio/media/creation/")
}
func TestUploadReadRangeExpiry(t *testing.T) {
	s, e := New(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	w, token := upload(t, s, "0123456789", 1)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Range", "bytes=2-5")
	w = httptest.NewRecorder()
	s.Read(w, r, token)
	if w.Code != 206 || w.Body.String() != "2345" {
		t.Fatal(w.Code, w.Body.String())
	}
	p := filepath.Join(s.Root, token) + ".json"
	raw, _ := os.ReadFile(p)
	var m metadata
	_ = json.Unmarshal(raw, &m)
	m.Expires = time.Now().Add(-time.Second).Unix()
	raw, _ = json.Marshal(m)
	_ = os.WriteFile(p, raw, 0600)
	w = httptest.NewRecorder()
	s.Read(w, httptest.NewRequest("GET", "/", nil), token)
	if w.Code != 404 {
		t.Fatal(w.Code)
	}
	if e = s.Cleanup(); e != nil {
		t.Fatal(e)
	}
	if _, e = os.Stat(filepath.Join(s.Root, token)); !os.IsNotExist(e) {
		t.Fatal(e)
	}
}
func TestOwnerQuotaAndEmpty(t *testing.T) {
	s, _ := New(t.TempDir())
	w, _ := upload(t, s, "image", 0)
	if w.Code != 401 {
		t.Fatal(w.Code)
	}
	w, _ = upload(t, s, "", 1)
	if w.Code != 400 {
		t.Fatal(w.Code)
	}
	s.Limit = 1
	w, _ = upload(t, s, "image", 1)
	if w.Code != 507 {
		t.Fatal(w.Code)
	}
	entries, _ := os.ReadDir(s.Root)
	if len(entries) != 0 {
		t.Fatal(entries)
	}
}
func TestOversizeAndTraversal(t *testing.T) {
	s, _ := New(t.TempDir())
	w, _ := upload(t, s, strings.Repeat("a", MaxFile+1), 1)
	if w.Code != 413 {
		t.Fatal(w.Code)
	}
	w = httptest.NewRecorder()
	s.Read(w, httptest.NewRequest("GET", "/", nil), "../secret")
	if w.Code != 404 {
		t.Fatal(w.Code)
	}
	entries, _ := os.ReadDir(s.Root)
	if len(entries) != 0 {
		t.Fatal(entries)
	}
}
func TestRestartRetainsMedia(t *testing.T) {
	root := t.TempDir()
	s, _ := New(root)
	w, token := upload(t, s, "image", 1)
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	next, _ := New(root)
	w = httptest.NewRecorder()
	next.Read(w, httptest.NewRequest("GET", "/", nil), token)
	if w.Code != 200 || w.Body.String() != "image" {
		t.Fatal(w.Code)
	}
}
