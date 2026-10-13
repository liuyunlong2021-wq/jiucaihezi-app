package jsplugin

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	pluginruntime "github.com/QuantumNous/new-api/pkg/jsplugin"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// Real rc.40 adaptor + production plugin. Synthetic payloads never call a provider.
func TestYihongLargeImageResponse(t *testing.T) {
	gin.SetMode(gin.TestMode)
	source, err := os.ReadFile(filepath.Join("jc-test-plugins", "yihong.plugin.js"))
	require.NoError(t, err)
	for _, model := range []string{"gpt-image-2-1K-4K", "gemini-nano-banana-2.1"} {
		for _, key := range []string{"yihong", "other-image-limit"} {
			for _, path := range []string{"/v1/images/generations", "/v1/images/edits", "/v1/videos"} {
				t.Run(model+"/"+key+path, func(t *testing.T) {
					pluginSource := strings.Replace(string(source), "key: 'yihong'", "key: '"+key+"'", 1)
					plugin, err := pluginruntime.NewRegistry().Register(pluginSource, pluginruntime.Options{})
					require.NoError(t, err)
					b64 := strings.Repeat("A", 2<<20)
					payload := map[string]any{"data": []any{map[string]any{"b64_json": b64}}}
					if model == "gemini-nano-banana-2.1" {
						payload = map[string]any{"candidates": []any{map[string]any{"content": map[string]any{"parts": []any{map[string]any{"inlineData": map[string]any{"mimeType": "image/png", "data": b64}}}}}}}
					}
					body, err := json.Marshal(payload)
					require.NoError(t, err)
					info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: "https://example.test", ApiKey: "local-only"}, OriginModelName: model, TaskRelayInfo: &relaycommon.TaskRelayInfo{}}
					info.UpstreamModelName = model
					info.PublicTaskID = "local-large-image"
					info.Action = "text_to_image"
					adaptor := New(plugin)
					adaptor.Init(info)
					c, _ := gin.CreateTestContext(httptest.NewRecorder())
					c.Request = httptest.NewRequest(http.MethodPost, path, nil)
					c.Set("task_request", map[string]any{"model": model, "prompt": "local regression"})
					response := &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(bytes.NewReader(body))}
					result, taskErr := adaptor.ParseResponse(c, response, info)
					if key != "yihong" || path == "/v1/videos" {
						require.NotNil(t, taskErr, "unrelated requests must retain the 1 MiB limit")
						return
					}
					require.Nil(t, taskErr)
					require.NotNil(t, result.Immediate)
					require.Greater(t, len(result.TaskData), 1<<20)
				})
			}
		}
	}
}
