package router

import (
	"github.com/QuantumNous/new-api/jcmedia"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-gonic/gin"
	"log"
	"time"
)

func SetCreationMediaRouter(router *gin.Engine) {
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
