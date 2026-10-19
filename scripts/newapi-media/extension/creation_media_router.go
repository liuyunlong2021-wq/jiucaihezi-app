package router

import (
	"encoding/json"
	"github.com/QuantumNous/new-api/jcmedia"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/ossdirect"
	"github.com/QuantumNous/new-api/r2direct"
	"github.com/gin-gonic/gin"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

func SetCreationMediaRouter(router *gin.Engine) {
	r2Signer, r2Err := r2direct.New(os.Getenv("R2_ACCOUNT_ID"), os.Getenv("R2_BUCKET"), os.Getenv("R2_ACCESS_KEY_ID"), os.Getenv("R2_SECRET_ACCESS_KEY"))
	if r2Err != nil {
		log.Printf("[Creation media] Lingdong R2 experiment is not configured")
	}
	// Separate route: old clients and every other channel keep the existing OSS contract.
	router.POST("/api/creations/lingdong/upload-url", middleware.TokenAuth(), func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		if r2Signer == nil {
			c.JSON(503, gin.H{"code": "r2_upload_unavailable", "message": "灵动 R2 直传暂未配置"})
			return
		}
		var input struct {
			Model       string `json:"model"`
			ContentType string `json:"content_type"`
			Size        int64  `json:"size"`
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
		decoder := json.NewDecoder(c.Request.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&input); err != nil {
			c.JSON(400, gin.H{"code": "bad_request", "message": "上传参数无效"})
			return
		}
		grant, err := r2Signer.SignUpload(c.Request.Context(), c.GetInt("id"), input.Model, input.ContentType, input.Size)
		if err != nil {
			c.JSON(400, gin.H{"code": "bad_request", "message": "灵动参考素材型号、类型或大小不受支持"})
			return
		}
		c.JSON(200, grant)
	})
	ossSigner, ossErr := ossdirect.New(
		os.Getenv("OSS_ENDPOINT"),
		os.Getenv("OSS_BUCKET"),
		os.Getenv("OSS_REGION"),
		os.Getenv("OSS_ACCESS_KEY_ID"),
		os.Getenv("OSS_ACCESS_KEY_SECRET"),
	)
	if ossErr != nil {
		log.Printf("[Creation media] OSS direct upload is not configured")
	}
	router.POST("/api/creations/upload-url", middleware.TokenAuth(), func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		if ossSigner == nil {
			c.JSON(503, gin.H{"code": "oss_upload_unavailable", "message": "OSS 直传暂未配置", "status": 503})
			return
		}
		var input struct {
			ContentType string `json:"content_type"`
			Size        int64  `json:"size"`
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
		if err := json.NewDecoder(c.Request.Body).Decode(&input); err != nil {
			c.JSON(400, gin.H{"code": "bad_request", "message": "上传参数无效", "status": 400})
			return
		}
		grant, err := ossSigner.SignUpload(c.GetInt("id"), strings.TrimSpace(input.ContentType), input.Size)
		if err != nil {
			c.JSON(400, gin.H{"code": "bad_request", "message": "参考素材类型或大小不受支持", "status": 400})
			return
		}
		c.JSON(200, grant)
	})

	store, err := jcmedia.New("/data/creation-media")
	if err != nil {
		log.Printf("[Creation media] initialization failed")
	} else {
		if err := store.Cleanup(); err != nil {
			log.Printf("[Creation media] initial cleanup failed")
		}
		go func() {
			ticker := time.NewTicker(time.Hour)
			defer ticker.Stop()
			for range ticker.C {
				if err := store.Cleanup(); err != nil {
					log.Printf("[Creation media] cleanup failed")
				}
			}
		}()
	}
	unavailable := func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.JSON(503, gin.H{"code": "media_storage_unavailable", "message": "素材存储暂时不可用", "status": 503})
	}
	router.POST("/api/creations/uploads", middleware.TokenAuth(), func(c *gin.Context) {
		if store == nil {
			unavailable(c)
			return
		}
		store.Upload(c.Writer, c.Request, c.GetInt("id"))
	})
	read := func(c *gin.Context) {
		if store == nil {
			unavailable(c)
			return
		}
		store.Read(c.Writer, c.Request, c.Param("token"))
	}
	router.GET("/media/creation/:token", read)
	router.HEAD("/media/creation/:token", read)
}
