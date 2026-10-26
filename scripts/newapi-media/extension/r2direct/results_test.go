package r2direct

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

type memoryObjects struct {
	mu      sync.Mutex
	objects map[string][]byte
}

func (m *memoryObjects) Exists(_ context.Context, key string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.objects[key]
	return ok, nil
}

func (m *memoryObjects) Put(_ context.Context, key string, body io.Reader, size int64) error {
	data, err := io.ReadAll(body)
	if err != nil || int64(len(data)) != size {
		return io.ErrUnexpectedEOF
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.objects[key] = data
	return nil
}

func (m *memoryObjects) ReadURL(_ context.Context, key string) (string, error) {
	return "https://r2.example/" + key + "?X-Amz-Signature=fixture", nil
}

type relayFixture struct {
	relay    *VideoRelay
	objects  *memoryObjects
	contents atomic.Int32
	temp     string
}

// origin imitates the NewAPI host: the task belongs to the bearer "Bearer owner".
func newRelayFixture(t *testing.T, content func(w http.ResponseWriter)) *relayFixture {
	t.Helper()
	f := &relayFixture{objects: &memoryObjects{objects: map[string][]byte{}}, temp: t.TempDir()}
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer owner" {
			w.WriteHeader(404)
			return
		}
		switch r.URL.Path {
		case "/v1/videos/task_a":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"task_a","status":"completed"}`))
		case "/v1/videos/task_a/content":
			f.contents.Add(1)
			content(w)
		default:
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(origin.Close)
	f.relay = &VideoRelay{Origin: origin.URL, Client: origin.Client(), Objects: f.objects, TempDir: f.temp, MaxSize: 16,
		HasSpace: func(string, int64) bool { return true }}
	return f
}

func video(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "video/mp4")
	_, _ = w.Write([]byte("mp4-bytes"))
}

func (f *relayFixture) get(owner int, task, auth string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("GET", "/api/creations/videos/"+task+"/content", nil)
	r.Header.Set("Authorization", auth)
	rec := httptest.NewRecorder()
	f.relay.Serve(rec, r, owner, task)
	return rec
}

func assertNoTempFiles(t *testing.T, dir string) {
	t.Helper()
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Fatalf("temporary files left behind: %d", len(entries))
	}
}

func TestVideoRelayCopiesOnceThenRedirectsToR2(t *testing.T) {
	f := newRelayFixture(t, video)
	for range 2 {
		rec := f.get(17, "task_a", "Bearer owner")
		if rec.Code != 302 || rec.Header().Get("Location") != "https://r2.example/video-results/17/task_a.mp4?X-Amz-Signature=fixture" {
			t.Fatalf("got %d %q", rec.Code, rec.Header().Get("Location"))
		}
		if rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("signed redirect must not be cached")
		}
	}
	if f.contents.Load() != 1 || !bytes.Equal(f.objects.objects["video-results/17/task_a.mp4"], []byte("mp4-bytes")) {
		t.Fatalf("content fetched %d times", f.contents.Load())
	}
	assertNoTempFiles(t, f.temp)
}

func TestVideoRelayChecksOwnershipBeforeServingStoredObject(t *testing.T) {
	f := newRelayFixture(t, video)
	f.objects.objects["video-results/17/task_a.mp4"] = []byte("mp4-bytes")
	if rec := f.get(17, "task_a", "Bearer stranger"); rec.Code != 404 || rec.Header().Get("Location") != "" {
		t.Fatalf("stranger got %d", rec.Code)
	}
	for _, tc := range []struct {
		owner  int
		task   string
		status int
	}{{0, "task_a", 401}, {17, "../task_a", 400}, {17, "", 400}} {
		if rec := f.get(tc.owner, tc.task, "Bearer owner"); rec.Code != tc.status {
			t.Fatalf("%d %q: got %d want %d", tc.owner, tc.task, rec.Code, tc.status)
		}
	}
	if f.contents.Load() != 0 {
		t.Fatal("rejected requests must not fetch content")
	}
}

func TestVideoRelayConcurrentRequestsCopyOnce(t *testing.T) {
	release := make(chan struct{})
	f := newRelayFixture(t, func(w http.ResponseWriter) { <-release; video(w) })
	var wg sync.WaitGroup
	codes := make(chan int, 5)
	for range 5 {
		wg.Add(1)
		go func() { defer wg.Done(); codes <- f.get(17, "task_a", "Bearer owner").Code }()
	}
	for f.contents.Load() == 0 {
		// wait until the single copy is in flight
	}
	close(release)
	wg.Wait()
	close(codes)
	for code := range codes {
		if code != 302 {
			t.Fatalf("got %d", code)
		}
	}
	if f.contents.Load() != 1 {
		t.Fatalf("content fetched %d times", f.contents.Load())
	}
}

func TestVideoRelayRejectsUnusableContentWithoutStoring(t *testing.T) {
	for _, tc := range []struct {
		name    string
		content func(http.ResponseWriter)
		status  int
	}{
		{"not ready passes through", func(w http.ResponseWriter) { w.WriteHeader(409) }, 409},
		{"error page", func(w http.ResponseWriter) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"error":"x"}`))
		}, 502},
		{"too large", func(w http.ResponseWriter) {
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte(strings.Repeat("v", 17)))
		}, 502},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newRelayFixture(t, tc.content)
			if rec := f.get(17, "task_a", "Bearer owner"); rec.Code != tc.status {
				t.Fatalf("got %d want %d", rec.Code, tc.status)
			}
			if len(f.objects.objects) != 0 {
				t.Fatal("unusable content stored")
			}
			assertNoTempFiles(t, f.temp)
		})
	}
}

func TestVideoRelayRefusesWhenDiskIsLow(t *testing.T) {
	f := newRelayFixture(t, video)
	f.relay.HasSpace = func(string, int64) bool { return false }
	if rec := f.get(17, "task_a", "Bearer owner"); rec.Code != 503 {
		t.Fatalf("got %d", rec.Code)
	}
	if f.contents.Load() != 0 {
		t.Fatal("must not download without disk headroom")
	}
}

func TestResultReadURLIsScopedToResultPrefix(t *testing.T) {
	address, err := fixture(t).ReadURL(context.Background(), "video-results/17/task_a.mp4")
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(address)
	if u.Path != "/jiucaihezi-media-test/video-results/17/task_a.mp4" || u.Query().Get("X-Amz-Expires") != "21600" || strings.Contains(address, "fixture-secret") {
		t.Fatalf("unexpected read URL %s", address)
	}
}
