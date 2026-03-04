package app

import (
	"context"
	"log"
	"net"
	"net/http"
	"time"

	"golang.org/x/time/rate"
)

type contextKey string

const userContextKey = contextKey("userID")
const cookieName = "user-session"

type rateclient struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

func getClientIP(r *http.Request) string {
	ip := r.Header.Get("X-Forwarded-For")
	if ip != "" {
		return ip
	}
	ip, _, _ = net.SplitHostPort(r.RemoteAddr)
	return ip
}

func getUserIDFromRequest(r *http.Request) string {
	if userID, ok := r.Context().Value(userContextKey).(string); ok {
		return userID
	}
	return ""
}

func (a *App) withOptionalAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(cookieName)
		if err != nil {
			log.Printf("[AUTH] No session cookie found, proceeding as guest")
			next.ServeHTTP(w, r)
			return
		}

		var userID string
		if err = a.SC.Decode(cookieName, cookie.Value, &userID); err != nil {
			log.Printf("[AUTH] Invalid cookie received: %v, proceeding as guest", err)
			next.ServeHTTP(w, r)
			return
		}

		log.Printf("[AUTH] Valid session found for user %s", userID)
		ctx := context.WithValue(r.Context(), userContextKey, userID)
		next.ServeHTTP(w, r.WithContext(ctx))
	}
}

func (a *App) withAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(cookieName)
		if err != nil {
			http.Error(w, "Unauthorized: No session cookie provided.", http.StatusUnauthorized)
			return
		}

		var userID string
		if err = a.SC.Decode(cookieName, cookie.Value, &userID); err != nil {
			log.Printf("Invalid cookie received: %v", err)
			http.Error(w, "Unauthorized: Invalid session cookie.", http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), userContextKey, userID)
		next.ServeHTTP(w, r.WithContext(ctx))
	}
}

func (a *App) adminOnly(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if a.AdminGoogleID == "" {
			http.Error(w, "Admin features are not configured", http.StatusForbidden)
			return
		}

		userID := getUserIDFromRequest(r)
		if userID == "" {
			http.Error(w, "You must be logged in to perform this action", http.StatusUnauthorized)
			return
		}

		user, err := a.DB.GetUserByID(userID)
		if err != nil || user == nil {
			log.Printf("Error getting user for admin check (userID: %s): %v", userID, err)
			http.Error(w, "Could not verify user credentials", http.StatusInternalServerError)
			return
		}

		if user.GoogleID != a.AdminGoogleID {
			log.Printf("Admin access denied for user (googleID: %s)", user.GoogleID)
			http.Error(w, "You do not have permission to perform this action", http.StatusForbidden)
			return
		}

		h.ServeHTTP(w, r)
	}
}
