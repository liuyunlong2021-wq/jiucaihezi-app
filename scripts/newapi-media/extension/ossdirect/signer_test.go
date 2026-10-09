package ossdirect

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"strings"
	"testing"
)

func testSigner(t *testing.T) *Signer {
	t.Helper()
	signer, err := New("https://oss-cn-shanghai.aliyuncs.com", "jc-fk-ref-test-20261009-4c82", "cn-shanghai", "test-ak", "test-secret")
	if err != nil {
		t.Fatal(err)
	}
	return signer
}

func TestSignUploadCreatesPrivateSingleObjectGrant(t *testing.T) {
	grant, err := testSigner(t).SignUpload(17, "image/png", 2048)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(grant.UploadURL, "https://jc-fk-ref-test-20261009-4c82.oss-cn-shanghai.aliyuncs.com/") {
		t.Fatalf("unexpected OSS upload endpoint: %s", grant.UploadURL)
	}
	key := grant.FormFields["key"]
	if !strings.HasPrefix(key, "creation-temp/17/") || !strings.HasSuffix(key, ".png") {
		t.Fatalf("object key is not scoped to the authenticated owner: %s", key)
	}
	if grant.FormFields["Content-Type"] != "image/png" || grant.FormFields["x-oss-signature"] == "" {
		t.Fatal("upload fields are missing the signed content type or signature")
	}
	if grant.FormFields["x-oss-signature"] != signPolicyV4("test-secret", grant.FormFields["x-oss-date"][:8], "cn-shanghai", grant.FormFields["policy"]) {
		t.Fatal("POST policy signature does not match the issued policy")
	}
	policyBytes, err := base64.StdEncoding.DecodeString(grant.FormFields["policy"])
	if err != nil {
		t.Fatal(err)
	}
	var policy struct {
		Conditions []any `json:"conditions"`
	}
	if err := json.Unmarshal(policyBytes, &policy); err != nil {
		t.Fatal(err)
	}
	encoded := string(policyBytes)
	for _, expected := range []string{"content-length-range", "20971520", key, "image/png"} {
		if !strings.Contains(encoded, expected) {
			t.Fatalf("policy is missing %q: %s", expected, encoded)
		}
	}
	readURL, err := url.Parse(grant.AssetURL)
	if err != nil || readURL.Query().Get("Signature") == "" || !strings.Contains(readURL.Path, key) {
		t.Fatalf("asset URL is not a signed private-object URL: %s", grant.AssetURL)
	}
}

func TestSignUploadRejectsInvalidInputs(t *testing.T) {
	signer := testSigner(t)
	for _, input := range []struct {
		owner int
		type_ string
		size  int64
	}{
		{owner: 0, type_: "image/png", size: 1},
		{owner: 1, type_: "text/html", size: 1},
		{owner: 1, type_: "image/png", size: 0},
		{owner: 1, type_: "image/png", size: MaxFile + 1},
	} {
		if _, err := signer.SignUpload(input.owner, input.type_, input.size); err == nil {
			t.Fatalf("expected invalid upload input to fail: %+v", input)
		}
	}
}
