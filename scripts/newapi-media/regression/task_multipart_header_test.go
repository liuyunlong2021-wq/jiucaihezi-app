package jsplugin

// Copied into the pinned NewAPI jsplugin package by the repair script.
// Exercise the real product plugins and actual outbound HTTP, not just parts[].
import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"testing"

	pluginruntime "github.com/QuantumNous/new-api/pkg/jsplugin"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestProductImageUpstreamRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	service.InitHttpClient()
	image, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=")
	require.NoError(t, err)
	for _, provider := range []struct{ key, model, upstream string }{
		{"fk", "ft-image-v1-211f28f47b0355abb1798f72eb65f22d", "ft-image-v1-211f28f47b0355abb1798f72eb65f22d"},
		{"xiaoyi-image", "gpt-image-2.5-1k", "gpt-image-2.5"},
	} {
		for _, count := range []int{0, 1, 2, -1} {
			if count < 0 && provider.key != "fk" {
				continue
			}
			t.Run(fmt.Sprintf("%s/images=%d", provider.key, count), func(t *testing.T) {
				source, err := os.ReadFile(filepath.Join("jc-test-plugins", provider.key+".plugin.js"))
				require.NoError(t, err)
				plugin, err := pluginruntime.NewRegistry().Register(string(source), pluginruntime.Options{})
				require.NoError(t, err)
				type captured struct {
					contentType, model, prompt string
					images                     [][]byte
					imageURLs                  []any
					parseErr                   error
				}
				seen := make(chan captured, 1)
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					got := captured{contentType: r.Header.Get("Content-Type")}
					if count <= 0 {
						var body map[string]any
						got.parseErr = json.NewDecoder(r.Body).Decode(&body)
						got.model, _ = body["model"].(string)
						got.prompt, _ = body["prompt"].(string)
						got.imageURLs, _ = body["imageUrls"].([]any)
					} else {
						got.parseErr = r.ParseMultipartForm(1 << 20)
						if got.parseErr == nil {
							defer r.MultipartForm.RemoveAll()
							got.model, got.prompt = r.FormValue("model"), r.FormValue("prompt")
							field := "images"
							if provider.key == "xiaoyi-image" {
								field = "image"
								if count > 1 {
									field = "image[]"
								}
							}
							for _, header := range r.MultipartForm.File[field] {
								file, openErr := header.Open()
								if openErr != nil {
									got.parseErr = openErr
									break
								}
								data, readErr := io.ReadAll(file)
								file.Close()
								if readErr != nil {
									got.parseErr = readErr
									break
								}
								got.images = append(got.images, data)
							}
						}
					}
					seen <- got
					w.Header().Set("Content-Type", "application/json")
					_, _ = w.Write([]byte(`{"task_id":"local-only"}`))
				}))
				defer server.Close()
				var input bytes.Buffer
				writer := multipart.NewWriter(&input)
				refs := make([]map[string]any, 0, max(count, 0))
				for i := 0; i < count; i++ {
					header := textproto.MIMEHeader{}
					header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="image"; filename="ref%d.png"`, i))
					header.Set("Content-Type", "image/png")
					part, err := writer.CreatePart(header)
					require.NoError(t, err)
					_, err = part.Write(image)
					require.NoError(t, err)
					refs = append(refs, map[string]any{"ref": pluginruntime.FileReference("image", i), "filename": fmt.Sprintf("ref%d.png", i)})
				}
				require.NoError(t, writer.Close())
				operation := "generate"
				body := map[string]any{"kind": "json", "value": map[string]any{"prompt": "local regression"}}
				const signedURL = "https://bucket.example/creation-temp/ref.png?x-oss-signature=local-test&x-oss-date=20261009T080000Z"
				if count < 0 {
					operation = "edit"
					body["value"] = map[string]any{"prompt": "local regression", "imageUrls": []string{signedURL}}
				}
				if count > 0 {
					operation = "edit"
					body = map[string]any{"kind": "multipart", "fields": map[string]any{"prompt": []string{"local regression"}}, "files": refs}
				}
				intent, err := plugin.Engine.CallPath(context.Background(), "protocols", []string{"openai_image", "decodeRequest"}, map[string]any{"model": provider.model, "operation": operation, "body": body})
				require.NoError(t, err)
				decoded := intent.(map[string]any)
				info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: server.URL, ApiKey: "local-only"}, OriginModelName: provider.model, TaskRelayInfo: &relaycommon.TaskRelayInfo{}}
				info.UpstreamModelName = provider.upstream
				info.Action = decoded["action"].(string)
				adaptor := New(plugin)
				adaptor.Init(info)
				c, _ := gin.CreateTestContext(httptest.NewRecorder())
				c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/edits", bytes.NewReader(input.Bytes()))
				c.Request.Header.Set("Content-Type", writer.FormDataContentType())
				c.Set("task_request", decoded["requestBody"])
				requestBody, err := adaptor.BuildRequestBody(c, info)
				require.NoError(t, err)
				response, err := adaptor.DoRequest(c, info, requestBody)
				require.NoError(t, err)
				response.Body.Close()
				got := <-seen
				t.Logf("outbound Content-Type=%q parsed_model=%q", got.contentType, got.model)
				require.NoError(t, got.parseErr)
				require.Equal(t, provider.upstream, got.model)
				require.Equal(t, "local regression", got.prompt)
				require.Len(t, got.images, max(count, 0))
				if count < 0 {
					require.Equal(t, []any{signedURL}, got.imageURLs)
				}
				for _, data := range got.images {
					require.Equal(t, image, data)
				}
			})
		}
	}
}
