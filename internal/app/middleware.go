package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

type contextKey string

const userContextKey = contextKey("userID")
const cookieName = "user-session"
const bearerPrefix = "Bearer "

type rateclient struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// limiterIdleTime is how long an unused per-client bucket is kept.
const limiterIdleTime = 2 * time.Hour

// keyedLimiters is a map of per-client token buckets with idle eviction.
// The zero value is ready to use. Keys are namespaced by the caller
// ("tts:"+limitKey(r), "explain:"+limitKey(r), ...), so one instance can
// serve every endpoint; the rate and burst passed on a key's first get win.
type keyedLimiters struct {
	mu      sync.Mutex
	clients map[string]*rateclient
}

// get returns the bucket for key, creating it with rate r and burst on first
// use. Idle entries are evicted on each call.
// ponytail: O(n) eviction scan per call, fine for a few thousand clients;
// move eviction to a ticker if the map grows large.
func (k *keyedLimiters) get(key string, r rate.Limit, burst int) *rate.Limiter {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.clients == nil {
		k.clients = make(map[string]*rateclient)
	}
	now := time.Now()
	for id, c := range k.clients {
		if now.Sub(c.lastSeen) > limiterIdleTime {
			delete(k.clients, id)
		}
	}
	c, ok := k.clients[key]
	if !ok {
		c = &rateclient{limiter: rate.NewLimiter(r, burst)}
		k.clients[key] = c
	}
	c.lastSeen = now
	return c.limiter
}

var reserveMu sync.Mutex

// reserveAll spends one token from every bucket, or none: if any bucket would
// make the caller wait, every reservation is cancelled and the longest wait
// is returned. The whole reserve/check/cancel runs under reserveMu: CancelAt
// only restores a token when no later reservation exists, so overlapping
// rejections would otherwise leave token debt on shared buckets.
// ponytail: one global lock around cheap in-memory work; per-bucket locks if it shows up in profiles.
func reserveAll(limiters ...*rate.Limiter) time.Duration {
	reserveMu.Lock()
	defer reserveMu.Unlock()
	now := time.Now()
	var wait time.Duration
	reservations := make([]*rate.Reservation, 0, len(limiters))
	for _, l := range limiters {
		res := l.ReserveN(now, 1)
		reservations = append(reservations, res)
		if d := res.DelayFrom(now); d > wait {
			wait = d
		}
	}
	if wait > 0 {
		for _, res := range reservations {
			res.CancelAt(now)
		}
	}
	return wait
}

// clientIP identifies a client by address. Behind the reverse proxy the last
// X-Forwarded-For hop is the address the proxy saw; earlier hops are
// client-supplied and would let a guest mint fresh buckets at will.
// ponytail: single Traefik hop; with Cloudflare/multiple proxies, walk only
// explicitly trusted proxies from the right.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		hops := strings.Split(xff, ",")
		if ip := strings.TrimSpace(hops[len(hops)-1]); net.ParseIP(ip) != nil {
			return ip
		}
	}
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return ip
}

// limitKey is the rate-limit identity of a request: the user when signed in
// (so it must run inside withAuth/withOptionalAuth), else the client IP.
func limitKey(r *http.Request) string {
	if userID := getUserIDFromRequest(r); userID != "" {
		return "user:" + userID
	}
	return "ip:" + clientIP(r)
}

func getUserIDFromRequest(r *http.Request) string {
	if userID, ok := r.Context().Value(userContextKey).(string); ok {
		return userID
	}
	return ""
}

// bearerAuthResult captures the outcome of inspecting the Authorization
// header. The header takes precedence over the session cookie, so we need
// to distinguish "no bearer presented" (fall back to cookie) from
// "bearer presented but invalid" (reject — do not silently fall back, as
// the caller has unambiguously chosen a credential type).
type bearerAuthResult int

const (
	bearerAbsent bearerAuthResult = iota
	bearerValid
	bearerInvalid
)

// resolveBearer parses the Authorization header. When a bearer token is
// present it is looked up via its SHA-256 hash in the cli_tokens table; a
// valid, non-revoked token yields the bound user ID. The token's
// last_used_at column is refreshed asynchronously so request latency is
// unaffected.
func (a *App) resolveBearer(r *http.Request) (string, bearerAuthResult) {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, bearerPrefix) {
		return "", bearerAbsent
	}
	token := strings.TrimSpace(header[len(bearerPrefix):])
	if token == "" {
		return "", bearerInvalid
	}
	sum := sha256.Sum256([]byte(token))
	hash := hex.EncodeToString(sum[:])

	tok, err := a.DB.GetCLITokenByHash(hash)
	if err != nil {
		log.Printf("[AUTH] CLI token lookup failed: %v", err)
		return "", bearerInvalid
	}
	if tok == nil || tok.RevokedAt != nil {
		return "", bearerInvalid
	}
	a.bgWG.Add(1)
	go func(id string) {
		defer a.bgWG.Done()
		if err := a.DB.TouchCLIToken(id); err != nil {
			log.Printf("[AUTH] TouchCLIToken(%s) failed: %v", id, err)
		}
	}(tok.ID)
	return tok.UserID, bearerValid
}

func (a *App) withOptionalAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch userID, result := a.resolveBearer(r); result {
		case bearerValid:
			log.Printf("[AUTH] Valid bearer token for user %s", userID)
			ctx := context.WithValue(r.Context(), userContextKey, userID)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		case bearerInvalid:
			// The caller explicitly presented a bearer credential and it
			// failed validation (unknown, malformed, or revoked). Reject
			// rather than silently downgrade to guest: a revoked CLI
			// token would otherwise let "gct exercises generate"
			// succeed with guest behaviour and never prompt the user to
			// re-run `gct login`. Only the absence of credentials means
			// "guest".
			log.Printf("[AUTH] Invalid/revoked bearer token on optional-auth route, rejecting")
			http.Error(w, "Unauthorized: Invalid or revoked bearer token.", http.StatusUnauthorized)
			return
		}

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
		switch userID, result := a.resolveBearer(r); result {
		case bearerValid:
			ctx := context.WithValue(r.Context(), userContextKey, userID)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		case bearerInvalid:
			http.Error(w, "Unauthorized: Invalid or revoked bearer token.", http.StatusUnauthorized)
			return
		}

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
