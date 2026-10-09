package ossdirect

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
)

const MaxFile = 20 << 20
const UploadURLTTL = 5 * time.Minute
const ReadURLTTL = 6 * time.Hour

type Signer struct {
	bucketName string
	region     string
	accessKey  string
	secret     string
	endpoint   *url.URL
}

type UploadGrant struct {
	UploadURL  string            `json:"upload_url"`
	FormFields map[string]string `json:"form_fields"`
	AssetURL   string            `json:"asset_url"`
}

func New(endpoint, bucketName, region, accessKey, secret string) (*Signer, error) {
	parsed, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.Path != "" || parsed.RawQuery != "" {
		return nil, errors.New("OSS_ENDPOINT 必须是无路径的 HTTPS 地域 endpoint")
	}
	if bucketName == "" || region == "" || accessKey == "" || secret == "" {
		return nil, errors.New("OSS bucket、地域和 RAM 凭据未配置")
	}
	return &Signer{bucketName: bucketName, region: region, accessKey: accessKey, secret: secret, endpoint: parsed}, nil
}

func (s *Signer) SignUpload(owner int, contentType string, size int64) (UploadGrant, error) {
	extension, ok := allowedTypes[strings.ToLower(strings.TrimSpace(contentType))]
	if owner <= 0 || !ok || size < 1 || size > MaxFile {
		return UploadGrant{}, errors.New("参考素材用户、类型或大小无效")
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return UploadGrant{}, errors.New("生成 OSS 对象名失败")
	}
	objectKey := fmt.Sprintf("creation-temp/%d/%s.%s", owner, hex.EncodeToString(nonce[:]), extension)
	now := time.Now().UTC()
	date := now.Format("20060102")
	dateTime := now.Format("20060102T150405Z")
	credential := fmt.Sprintf("%s/%s/%s/oss/aliyun_v4_request", s.accessKey, date, s.region)

	policyBytes, err := json.Marshal(map[string]any{
		"expiration": now.Add(UploadURLTTL).Format("2006-01-02T15:04:05.000Z"),
		"conditions": []any{
			map[string]string{"bucket": s.bucketName},
			map[string]string{"x-oss-signature-version": "OSS4-HMAC-SHA256"},
			map[string]string{"x-oss-credential": credential},
			map[string]string{"x-oss-date": dateTime},
			[]any{"content-length-range", 1, MaxFile},
			[]any{"eq", "$key", objectKey},
			[]any{"eq", "$Content-Type", contentType},
		},
	})
	if err != nil {
		return UploadGrant{}, errors.New("创建 OSS 上传策略失败")
	}
	policy := base64.StdEncoding.EncodeToString(policyBytes)
	signature := signPolicyV4(s.secret, date, s.region, policy)

	postURL := *s.endpoint
	postURL.Host = s.bucketName + "." + s.endpoint.Host
	postURL.Path = "/"
	readURL := s.signReadURL(objectKey, now.Add(ReadURLTTL))
	return UploadGrant{
		UploadURL: postURL.String(),
		FormFields: map[string]string{
			"key":                     objectKey,
			"Content-Type":            contentType,
			"policy":                  policy,
			"x-oss-signature-version": "OSS4-HMAC-SHA256",
			"x-oss-credential":        credential,
			"x-oss-date":              dateTime,
			"x-oss-signature":         signature,
		},
		AssetURL: readURL,
	}, nil
}

func (s *Signer) signReadURL(objectKey string, expires time.Time) string {
	expiresUnix := fmt.Sprintf("%d", expires.Unix())
	canonicalResource := "/" + s.bucketName + "/" + objectKey
	stringToSign := "GET\n\n\n" + expiresUnix + "\n" + canonicalResource
	mac := hmac.New(sha1.New, []byte(s.secret))
	_, _ = mac.Write([]byte(stringToSign))

	readURL := *s.endpoint
	readURL.Host = s.bucketName + "." + s.endpoint.Host
	readURL.Path = "/" + objectKey
	query := readURL.Query()
	query.Set("OSSAccessKeyId", s.accessKey)
	query.Set("Expires", expiresUnix)
	query.Set("Signature", base64.StdEncoding.EncodeToString(mac.Sum(nil)))
	readURL.RawQuery = query.Encode()
	return readURL.String()
}

func signPolicyV4(secret, date, region, policy string) string {
	hmac256 := func(key []byte, value string) []byte {
		mac := hmac.New(sha256.New, key)
		_, _ = mac.Write([]byte(value))
		return mac.Sum(nil)
	}
	dateKey := hmac256([]byte("aliyun_v4"+secret), date)
	regionKey := hmac256(dateKey, region)
	productKey := hmac256(regionKey, "oss")
	signingKey := hmac256(productKey, "aliyun_v4_request")
	return hex.EncodeToString(hmac256(signingKey, policy))
}

var allowedTypes = map[string]string{
	"application/octet-stream": "bin",
	"image/jpeg":               "jpg",
	"image/png":                "png",
	"image/webp":               "webp",
	"image/gif":                "gif",
	"video/mp4":                "mp4",
	"video/quicktime":          "mov",
	"audio/mpeg":               "mp3",
	"audio/mp4":                "m4a",
	"audio/wav":                "wav",
	"audio/x-wav":              "wav",
	"audio/aac":                "aac",
	"audio/ogg":                "ogg",
}
