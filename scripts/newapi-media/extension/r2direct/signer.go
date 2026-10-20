package r2direct

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/aws/signer/v4"
)

const MaxFile = 20 << 20
const Bucket = "jiucaihezi-media-test"
const UploadURLTTL = 5 * time.Minute
const ReadURLTTL = 6 * time.Hour

// Match Lingdong plugin 0.4.0 public aliases; raw vendor IDs are not channel names.
var models = map[string]bool{
	"灵动-sd2.5-满血-301010": true, "灵动-sd2.5-满血-301010-2": true,
	"灵动-gpt-image-2.5-flare": true, "灵动-gpt-image-2.5-sunburst": true,
}
var yihongModels = map[string]bool{
	"yh-seedance2.5 Ultra": true, "yh-seedance2.5 super": true, "yh-seedance-2.5-Muse": true,
	"yh-kling-omni-4.0": true, "yh-seedance2.0 mini Love": true, "yh-wan3.0-video": true,
}
var mediaTypes = map[string]string{
	"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
	"video/mp4": "mp4", "video/quicktime": "mov",
	"audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/wav": "wav", "audio/x-wav": "wav",
	"audio/aac": "aac", "audio/ogg": "ogg",
}

type Signer struct {
	endpoint    string
	credentials aws.Credentials
	signer      *v4.Signer
}
type UploadGrant struct {
	Method    string            `json:"method"`
	UploadURL string            `json:"upload_url"`
	Headers   map[string]string `json:"headers"`
	AssetURL  string            `json:"asset_url"`
	HeadURL   string            `json:"head_url"`
}

func New(account, bucket, accessKey, secret string) (*Signer, error) {
	if !regexp.MustCompile(`^[a-f0-9]{32}$`).MatchString(account) || bucket != Bucket || accessKey == "" || secret == "" {
		return nil, errors.New("R2 测试桶或凭据未正确配置")
	}
	return &Signer{endpoint: "https://" + account + ".r2.cloudflarestorage.com", credentials: aws.Credentials{AccessKeyID: accessKey, SecretAccessKey: secret}, signer: v4.NewSigner()}, nil
}

func (s *Signer) SignUpload(ctx context.Context, owner int, model, contentType string, size int64) (UploadGrant, error) {
	return s.signUpload(ctx, owner, model, contentType, size, models, "lingdong-temp")
}

func (s *Signer) SignYihongUpload(ctx context.Context, owner int, model, contentType string, size int64) (UploadGrant, error) {
	return s.signUpload(ctx, owner, model, contentType, size, yihongModels, "yihong-temp")
}

func (s *Signer) signUpload(ctx context.Context, owner int, model, contentType string, size int64, allowed map[string]bool, prefix string) (UploadGrant, error) {
	if err := ctx.Err(); err != nil {
		return UploadGrant{}, err
	}
	extension, ok := mediaTypes[contentType]
	if owner <= 0 || !allowed[model] || !ok || size < 1 || size > MaxFile {
		return UploadGrant{}, errors.New("参考素材用户、型号、类型或大小无效")
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return UploadGrant{}, errors.New("生成 R2 对象名失败")
	}
	objectURL := fmt.Sprintf("%s/%s/%s/%d/%s.%s", s.endpoint, Bucket, prefix, owner, hex.EncodeToString(nonce[:]), extension)
	now := time.Now().UTC()
	put, err := s.presign(ctx, http.MethodPut, objectURL, contentType, size, UploadURLTTL, now)
	if err != nil {
		return UploadGrant{}, err
	}
	get, err := s.presign(ctx, http.MethodGet, objectURL, "", 0, ReadURLTTL, now)
	if err != nil {
		return UploadGrant{}, err
	}
	head, err := s.presign(ctx, http.MethodHead, objectURL, "", 0, ReadURLTTL, now)
	if err != nil {
		return UploadGrant{}, err
	}
	return UploadGrant{Method: http.MethodPut, UploadURL: put, Headers: map[string]string{"Content-Type": contentType}, AssetURL: get, HeadURL: head}, nil
}

func (s *Signer) presign(ctx context.Context, method, address, contentType string, size int64, ttl time.Duration, now time.Time) (string, error) {
	r, err := http.NewRequestWithContext(ctx, method, address, nil)
	if err != nil {
		return "", err
	}
	r.ContentLength = size // Browser supplies this automatically for the exact Blob; do not return it as a JS-set header.
	if contentType != "" {
		r.Header.Set("Content-Type", contentType)
	}
	r.URL.RawQuery = url.Values{"X-Amz-Expires": {strconv.Itoa(int(ttl.Seconds()))}}.Encode()
	address, _, err = s.signer.PresignHTTP(ctx, s.credentials, r, "UNSIGNED-PAYLOAD", "s3", "auto", now, func(o *v4.SignerOptions) {
		o.DisableURIPathEscaping = true
		o.DisableHeaderHoisting = true
	})
	return address, err
}
