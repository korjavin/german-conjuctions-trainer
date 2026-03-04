package app

import (
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

func getFilePath(filename string) string {
	if _, err := os.Stat("static/" + filename); err == nil {
		return "static/" + filename
	}
	return filename
}

func getJSDir() string {
	if _, err := os.Stat("static/js"); err == nil {
		return "static/js"
	}
	return "js"
}

func (a *App) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	filePath := getFilePath("index.html")
	content, err := os.ReadFile(filePath)
	if err != nil {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	htmlContent := string(content)
	htmlContent = strings.ReplaceAll(htmlContent, "app.js?v=20250821001", fmt.Sprintf("app.js?v=%s", timestamp))

	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")

	w.Write([]byte(htmlContent))
}

func (a *App) handleJS(w http.ResponseWriter, r *http.Request) {
	filePath := getFilePath("app.js")
	content, err := os.ReadFile(filePath)
	if err != nil {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/javascript")
	w.Header().Set("Cache-Control", "public, max-age=31536000")

	w.Write(content)
}

func (a *App) handleCSS(w http.ResponseWriter, r *http.Request) {
	filePath := getFilePath("style.css")
	content, err := os.ReadFile(filePath)
	if err != nil {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "text/css")
	w.Header().Set("Cache-Control", "public, max-age=31536000")

	w.Write(content)
}

func (a *App) handlePrivacy(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, getFilePath("privacy.html"))
}

func (a *App) handleFavicon(w http.ResponseWriter, r *http.Request) {
	filePath := getFilePath("favicon.svg")
	content, err := os.ReadFile(filePath)
	if err != nil {
		http.Error(w, "Favicon not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "image/svg+xml")
	w.Header().Set("Cache-Control", "public, max-age=31536000")

	w.Write(content)
}

func (a *App) handleFavicon32(w http.ResponseWriter, r *http.Request) {
	filePath := getFilePath("favicon-32x32.svg")
	content, err := os.ReadFile(filePath)
	if err != nil {
		http.Error(w, "Favicon not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "image/svg+xml")
	w.Header().Set("Cache-Control", "public, max-age=31536000")

	w.Write(content)
}

func (a *App) handleFaviconICO(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "/favicon.svg", http.StatusMovedPermanently)
}
