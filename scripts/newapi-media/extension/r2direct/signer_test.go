package r2direct

import (
	"context"
	"net/url"
	"strings"
	"testing"
)

func fixture(t *testing.T) *Signer {
	t.Helper()
	s, err := New("0123456789abcdef0123456789abcdef", "jiucaihezi-media-test", "fixture-id", "fixture-secret")
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestPrivateGrantBindsObjectSizeTypeAndExpiry(t *testing.T) {
	s := fixture(t)
	g, err := s.SignUpload(context.Background(), 17, "灵动-sd2.5-满血-301010-2", "image/png", 2048)
	if err != nil {
		t.Fatal(err)
	}
	put, _ := url.Parse(g.UploadURL)
	get, _ := url.Parse(g.AssetURL)
	head, _ := url.Parse(g.HeadURL)
	if g.Method != "PUT" || g.Headers["Content-Type"] != "image/png" || put.Host != "0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com" {
		t.Fatal("unexpected upload destination or method")
	}
	if !strings.HasPrefix(put.Path, "/jiucaihezi-media-test/lingdong-temp/17/") || !strings.HasSuffix(put.Path, ".png") || get.Path != put.Path || head.Path != put.Path {
		t.Fatal("object is not scoped to authenticated owner")
	}
	if put.Query().Get("X-Amz-Expires") != "300" || get.Query().Get("X-Amz-Expires") != "21600" || head.Query().Get("X-Amz-Expires") != "21600" {
		t.Fatal("approved expiry changed")
	}
	if put.Query().Get("X-Amz-SignedHeaders") != "content-length;content-type;host" || get.Query().Get("X-Amz-SignedHeaders") != "host" {
		t.Fatal("PUT must bind exact byte length and MIME type")
	}
	if get.Query().Get("X-Amz-Signature") == head.Query().Get("X-Amz-Signature") || strings.Contains(g.UploadURL+g.AssetURL, "fixture-secret") {
		t.Fatal("method signatures must differ and never expose secret")
	}
	g2, err := s.SignUpload(context.Background(), 17, "灵动-sd2.5-满血-301010-2", "image/png", 2048)
	if err != nil || g2.UploadURL == g.UploadURL {
		t.Fatal("object names must be unique")
	}
}

func TestFourPublicLingdongModelsOnly(t *testing.T) {
	s := fixture(t)
	for _, model := range []string{"灵动-sd2.5-满血-301010", "灵动-sd2.5-满血-301010-2", "灵动-gpt-image-2.5-flare", "灵动-gpt-image-2.5-sunburst"} {
		if _, err := s.SignUpload(context.Background(), 17, model, "image/png", 1); err != nil {
			t.Fatalf("new public model rejected: %s: %v", model, err)
		}
	}
	for _, model := range []string{"SD-2.5-特价-2", "sd2.5-301010", "sd2.5-满血-301010", "gpt-image-2.5-flare", "fk-MiniMaxh3"} {
		if _, err := s.SignUpload(context.Background(), 17, model, "image/png", 1); err == nil {
			t.Fatalf("unexpected model accepted: %s", model)
		}
	}
}

func TestRejectsInvalidInputAndOtherChannels(t *testing.T) {
	s := fixture(t)
	for _, input := range []struct {
		owner       int
		model, mime string
		size        int64
	}{
		{0, "灵动-sd2.5-满血-301010-2", "image/png", 1},
		{1, "fk-MiniMaxh3", "image/png", 1},
		{1, "sd2.5-a", "image/png", 1},
		{1, "灵动-sd2.5-满血-301010-2", "text/html", 1},
		{1, "灵动-sd2.5-满血-301010-2", "application/octet-stream", 1},
		{1, "灵动-sd2.5-满血-301010-2", "image/png", 0},
		{1, "灵动-sd2.5-满血-301010-2", "image/png", 20<<20 + 1},
	} {
		if _, err := s.SignUpload(context.Background(), input.owner, input.model, input.mime, input.size); err == nil {
			t.Fatal("accepted invalid grant request")
		}
	}
	for _, account := range []string{"", "https://evil.invalid", "0123456789abcdef0123456789abcdef/evil"} {
		if _, err := New(account, "jiucaihezi-media-test", "id", "secret"); err == nil {
			t.Fatal("accepted invalid account")
		}
	}
	if _, err := New("0123456789abcdef0123456789abcdef", "another-bucket", "id", "secret"); err == nil {
		t.Fatal("accepted non-experiment bucket")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := s.SignUpload(ctx, 1, "灵动-sd2.5-满血-301010-2", "image/png", 1); err == nil {
		t.Fatal("accepted cancelled signing")
	}
}
