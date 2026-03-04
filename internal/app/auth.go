package app

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"golang.org/x/oauth2"
	oauth2v2 "google.golang.org/api/oauth2/v2"
)

func (a *App) handleGoogleLogin(w http.ResponseWriter, r *http.Request) {
	if a.OAuthConfig == nil {
		http.Error(w, "Google login is not configured", http.StatusInternalServerError)
		return
	}
	url := a.OAuthConfig.AuthCodeURL(a.OAuthState)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

func (a *App) handleGoogleCallback(w http.ResponseWriter, r *http.Request) {
	if a.OAuthConfig == nil {
		http.Error(w, "Google login is not configured", http.StatusInternalServerError)
		return
	}

	state := r.FormValue("state")
	if state != a.OAuthState {
		log.Printf("Invalid oauth state, expected '%s', got '%s'\n", a.OAuthState, state)
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}

	code := r.FormValue("code")
	token, err := a.OAuthConfig.Exchange(context.Background(), code)
	if err != nil {
		log.Printf("oauthConf.Exchange() failed with '%s'\n", err)
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}

	oauth2Client := oauth2.NewClient(context.Background(), oauth2.StaticTokenSource(token))
	oauth2Service, err := oauth2v2.New(oauth2Client)
	if err != nil {
		log.Printf("Unable to create oauth2 service: %v", err)
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}

	userinfo, err := oauth2Service.Userinfo.Get().Do()
	if err != nil {
		log.Printf("Unable to get user info: %v", err)
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}

	user, err := a.DB.GetUserByGoogleID(userinfo.Id)
	if err != nil {
		log.Printf("Unable to get user by google ID: %v", err)
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}
	if user == nil {
		user, err = a.DB.CreateUser(userinfo.Id)
		if err != nil {
			log.Printf("Unable to create user: %v", err)
			http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
			return
		}
	}

	encoded, err := a.SC.Encode(cookieName, user.ID)
	if err != nil {
		log.Printf("Failed to encode cookie: %v", err)
		http.Error(w, "Failed to set session cookie", http.StatusInternalServerError)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    encoded,
		HttpOnly: true,
		Secure:   r.URL.Scheme == "https",
		Path:     "/",
		Expires:  time.Now().Add(30 * 24 * time.Hour),
	})

	http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
}

func (a *App) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(cookieName)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]any{"logged_in": false})
		return
	}

	var userID string
	if err = a.SC.Decode(cookieName, cookie.Value, &userID); err != nil {
		json.NewEncoder(w).Encode(map[string]any{"logged_in": false})
		return
	}

	json.NewEncoder(w).Encode(map[string]any{"logged_in": true, "user_id": userID})
}

func (a *App) handleLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    "",
		HttpOnly: true,
		Path:     "/",
		Expires:  time.Unix(0, 0),
	})
	http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
}

func (a *App) handleIsAdmin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	isAdmin := false
	if a.AdminGoogleID != "" {
		userID := getUserIDFromRequest(r)
		if userID != "" {
			user, err := a.DB.GetUserByID(userID)
			if err == nil && user != nil && user.GoogleID == a.AdminGoogleID {
				isAdmin = true
			}
		}
	}

	json.NewEncoder(w).Encode(map[string]bool{"is_admin": isAdmin})
}
