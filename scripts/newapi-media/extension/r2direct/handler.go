package r2direct

import (
	"encoding/json"
	"io"
	"net/http"
)

// ServeCreationUpload uses the owner established by NewAPI TokenAuth, never a body field.
func ServeCreationUpload(w http.ResponseWriter, r *http.Request, signer *Signer, owner int) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	reject := func(status int, code string) {
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(map[string]string{"code": code})
	}
	if owner <= 0 {
		reject(401, "unauthorized")
		return
	}
	if signer == nil {
		reject(503, "r2_upload_unavailable")
		return
	}
	var input struct {
		ContentType string `json:"content_type"`
		Size        int64  `json:"size"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		reject(400, "bad_request")
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		reject(400, "bad_request")
		return
	}
	grant, err := signer.SignCreationUpload(r.Context(), owner, input.ContentType, input.Size)
	if err != nil {
		reject(400, "bad_request")
		return
	}
	_ = json.NewEncoder(w).Encode(grant)
}
