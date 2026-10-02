package app

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/gorilla/securecookie"
	"golang.org/x/oauth2"
)

func oauthStateTestApp(t *testing.T) *App {
	t.Helper()
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("token exchange must not be called on a rejected callback")
		http.Error(w, "no", http.StatusBadRequest)
	}))
	t.Cleanup(tokenSrv.Close)
	return &App{
		SC: securecookie.New(securecookie.GenerateRandomKey(64), securecookie.GenerateRandomKey(32)),
		OAuthConfig: &oauth2.Config{
			ClientID:    "cid",
			RedirectURL: "https://gct.example.com/auth/google/callback",
			Endpoint:    oauth2.Endpoint{AuthURL: "https://accounts.example.com/auth", TokenURL: tokenSrv.URL},
		},
	}
}

func findCookie(res *http.Response, name string) *http.Cookie {
	for _, c := range res.Cookies() {
		if c.Name == name {
			return c
		}
	}
	return nil
}

func TestGoogleLoginSetsSignedStateCookie(t *testing.T) {
	a := oauthStateTestApp(t)
	rec := httptest.NewRecorder()
	a.handleGoogleLogin(rec, httptest.NewRequest(http.MethodGet, "/auth/google/login", nil))
	res := rec.Result()
	if res.StatusCode != http.StatusTemporaryRedirect {
		t.Fatalf("status %d", res.StatusCode)
	}
	loc, err := url.Parse(res.Header.Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	state := loc.Query().Get("state")
	if state == "" {
		t.Fatalf("no state in %s", loc)
	}
	c := findCookie(res, oauthStateCookie)
	if c == nil {
		t.Fatal("no oauth-state cookie")
	}
	if !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteLaxMode || c.Path != oauthStatePath || c.MaxAge != 600 {
		t.Errorf("cookie attributes %+v", c)
	}
	var env oauthStateEnvelope
	if err := a.SC.Decode(oauthStateCookie, c.Value, &env); err != nil {
		t.Fatal(err)
	}
	if env.State != state || env.Exp <= time.Now().Unix() {
		t.Errorf("envelope %+v, state %q", env, state)
	}

	// A second login gets a different state.
	rec2 := httptest.NewRecorder()
	a.handleGoogleLogin(rec2, httptest.NewRequest(http.MethodGet, "/auth/google/login", nil))
	loc2, _ := url.Parse(rec2.Result().Header.Get("Location"))
	if loc2.Query().Get("state") == state {
		t.Error("state reused across logins")
	}
}

func TestGoogleCallbackRejectsBadState(t *testing.T) {
	a := oauthStateTestApp(t)
	enc := func(state string, exp time.Time) string {
		v, err := a.SC.Encode(oauthStateCookie, oauthStateEnvelope{State: state, Exp: exp.Unix()})
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	future := time.Now().Add(5 * time.Minute)
	other := securecookie.New(securecookie.GenerateRandomKey(64), securecookie.GenerateRandomKey(32))
	forged, _ := other.Encode(oauthStateCookie, oauthStateEnvelope{State: "X", Exp: future.Unix()})

	ok := httptest.NewRequest(http.MethodGet, "/auth/google/callback?state=X", nil)
	ok.AddCookie(&http.Cookie{Name: oauthStateCookie, Value: enc("X", future)})
	if !a.validLoginState(ok) {
		t.Error("matching unexpired state rejected")
	}

	for _, tc := range []struct {
		name, param, cookie string
	}{
		{"no cookie", "X", ""},
		{"different state", "X", enc("Y", future)},
		{"expired", "X", enc("X", time.Now().Add(-time.Second))},
		{"empty param", "", enc("", future)},
		{"forged key", "X", forged},
		{"plain value", "X", "X"},
	} {
		req := httptest.NewRequest(http.MethodGet, "/auth/google/callback?code=c&state="+url.QueryEscape(tc.param), nil)
		if tc.cookie != "" {
			req.AddCookie(&http.Cookie{Name: oauthStateCookie, Value: tc.cookie})
		}
		rec := httptest.NewRecorder()
		a.handleGoogleCallback(rec, req)
		res := rec.Result()
		if res.StatusCode != http.StatusTemporaryRedirect || res.Header.Get("Location") != "/" {
			t.Errorf("%s: status %d location %q", tc.name, res.StatusCode, res.Header.Get("Location"))
		}
		c := findCookie(res, oauthStateCookie)
		if c == nil || c.MaxAge >= 0 || c.Path != oauthStatePath || !c.Secure || c.SameSite != http.SameSiteLaxMode {
			t.Errorf("%s: oauth-state cookie not cleared: %+v", tc.name, c)
		}
		if findCookie(res, cookieName) != nil {
			t.Errorf("%s: session cookie issued", tc.name)
		}
	}
}
