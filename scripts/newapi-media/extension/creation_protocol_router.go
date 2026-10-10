package router

// The execution layer is private. Authentication, user groups, token model limits
// and model billing configuration stay authoritative in the NewAPI host.
import (
	"encoding/json"
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-gonic/gin"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"
)

func SetCreationProtocolRouter(router *gin.Engine) {
	address := os.Getenv("JC_CREATION_EXECUTOR_URL")
	secret := os.Getenv("JC_CREATION_EXECUTOR_SECRET")
	if address == "" || len(secret) < 32 {
		return
	}
	target, err := url.Parse(address)
	// Admin config only; no request may choose a forwarding destination.
	if err != nil || (target.Scheme != "http" && target.Scheme != "https") || target.Host == "" || target.RawQuery != "" || target.User != nil {
		panic("invalid creation executor URL")
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(503)
		_ = json.NewEncoder(w).Encode(gin.H{"code": "creation_executor_unavailable", "message": "统一影音执行服务暂不可用"})
	}
	router.Any("/v1/creation/*path", func(c *gin.Context) {
		// Result retrieval must remain possible when generation exhausts quota.
		// TokenAuthReadOnly still rejects disabled keys and banned users.
		readTask := (c.Request.Method == "GET" || c.Request.Method == "HEAD") && strings.HasPrefix(c.Request.URL.Path, "/v1/creation/tasks/")
		if readTask {
			middleware.TokenAuthReadOnly()(c)
		} else {
			middleware.TokenAuth()(c)
		}
	}, func(c *gin.Context) {
		// Reuse the exact official Key-filtered model listing; never use the
		// administrator's global model table as user permission.
		capture := httptest.NewRecorder()
		catalogContext, _ := gin.CreateTestContext(capture)
		catalogContext.Request = c.Request.Clone(c.Request.Context())
		catalogContext.Keys = c.Copy().Keys
		if (c.Request.Method == "GET" || c.Request.Method == "HEAD") && strings.HasPrefix(c.Request.URL.Path, "/v1/creation/tasks/") {
			catalogContext.JSON(200, gin.H{"success": true, "data": []any{}})
		} else {
			controller.ListModels(catalogContext, 0)
		}
		var catalog struct {
			Success bool `json:"success"`
			Data    []struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		if capture.Code != 200 || json.Unmarshal(capture.Body.Bytes(), &catalog) != nil || !catalog.Success {
			c.JSON(503, gin.H{"code": "creation_permission_unavailable", "message": "无法核实影音模型权限"})
			return
		}
		names := make([]string, 0, len(catalog.Data))
		for _, item := range catalog.Data {
			names = append(names, item.ID)
		}
		encoded, _ := json.Marshal(names)
		r := c.Request.Clone(c.Request.Context())
		r.Header = c.Request.Header.Clone()
		// Overwrite client-supplied claims, never append.
		r.Header.Set("X-JC-Creation-Secret", secret)
		r.Header.Set("X-JC-Creation-Identity", strconv.Itoa(c.GetInt("id"))+":"+strconv.Itoa(c.GetInt("token_id")))
		r.Header.Set("X-JC-Creation-Models", string(encoded))
		r.Header.Set("X-JC-Creation-Client-IP", c.ClientIP())
		proxy.ServeHTTP(c.Writer, r)
	})
}
