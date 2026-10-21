package r2direct

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCreationUploadHTTPContract(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		owner      int
		configured bool
		status     int
	}{
		{"valid", `{"content_type":"image/png","size":3}`, 17, true, 200},
		{"unauthenticated", `{}`, 0, true, 401},
		{"unconfigured", `{}`, 17, false, 503},
		{"owner spoof", `{"content_type":"image/png","size":3,"owner":42}`, 17, true, 400},
		{"bucket spoof", `{"content_type":"image/png","size":3,"bucket":"other"}`, 17, true, 400},
		{"trailing JSON", `{"content_type":"image/png","size":3}{}`, 17, true, 400},
		{"empty", `{"content_type":"image/png","size":0}`, 17, true, 400},
		{"huge body", strings.Repeat("x", 4097), 17, true, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var signer *Signer
			if tc.configured {
				signer = fixture(t)
			}
			rec := httptest.NewRecorder()
			ServeCreationUpload(rec, httptest.NewRequest("POST", "/api/creations/r2/upload-url", strings.NewReader(tc.body)), signer, tc.owner)
			if rec.Code != tc.status {
				t.Fatalf("got %d want %d", rec.Code, tc.status)
			}
			if rec.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("grant must not be cached")
			}
			if tc.status == 200 {
				var grant UploadGrant
				if err := json.Unmarshal(rec.Body.Bytes(), &grant); err != nil {
					t.Fatal(err)
				}
				if !strings.Contains(grant.UploadURL, "/creation-temp/17/") {
					t.Fatal("owner not taken from authentication")
				}
			}
		})
	}
}
