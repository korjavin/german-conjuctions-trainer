package app

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"german-conjunctions-trainer/pkg/storage"
)

// Private per-user podcast RSS feed. Podcast apps send no cookie, so the feed
// is addressed by a random per-user token in the URL. The token only grants
// reading the user's own episode list (the episodes themselves are already
// readable by anyone holding their unguessable id), so it is stored in
// plaintext and Settings can show the URL at any time.

// PublicOrigin returns scheme://host of a URL, or "" if it has none.
func PublicOrigin(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

// recordPodcastEpisode remembers a logged-in user's episode for their feed.
// A failure only costs the feed entry, not the episode.
func (a *App) recordPodcastEpisode(ep *storage.PodcastEpisode) {
	if ep.UserID == "" {
		return
	}
	if err := a.DB.CreatePodcastEpisode(ep); err != nil {
		log.Printf("[PODCAST] Failed to record episode %s for feed: %v", ep.ID, err)
	}
}

func (a *App) podcastFeedURL(token string) string {
	return a.PublicBaseURL + "/podcast/feed/" + token + ".xml"
}

func (a *App) writePodcastFeedURL(w http.ResponseWriter, token string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(map[string]string{"feed_url": a.podcastFeedURL(token)})
}

// handlePodcastFeedURL returns the user's feed URL, creating the token on
// first use: GET /api/podcast/feed.
func (a *App) handlePodcastFeedURL(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed", "", false)
		return
	}
	if a.PublicBaseURL == "" {
		writeJSONError(w, http.StatusServiceUnavailable, "PODCAST_FEED_UNAVAILABLE", "The podcast feed is not configured on this server (PUBLIC_BASE_URL).", "", false)
		return
	}
	token, err := a.DB.EnsurePodcastFeedToken(getUserIDFromRequest(r), newPodcastID())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "PODCAST_FEED_FAILED", "Failed to get the podcast feed.", err.Error(), true)
		return
	}
	a.writePodcastFeedURL(w, token)
}

// handlePodcastFeedRegenerate replaces the user's token, so the old feed URL
// stops working: POST /api/podcast/feed/regenerate.
func (a *App) handlePodcastFeedRegenerate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed", "", false)
		return
	}
	// A cross-site form cannot send a JSON content type without a CORS
	// preflight, which the server never grants with credentials: CSRF guard.
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		writeJSONError(w, http.StatusUnsupportedMediaType, "INVALID_CONTENT_TYPE", "Content-Type must be application/json", "", false)
		return
	}
	if a.PublicBaseURL == "" {
		writeJSONError(w, http.StatusServiceUnavailable, "PODCAST_FEED_UNAVAILABLE", "The podcast feed is not configured on this server (PUBLIC_BASE_URL).", "", false)
		return
	}
	token := newPodcastID()
	if err := a.DB.ReplacePodcastFeedToken(getUserIDFromRequest(r), token); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "PODCAST_FEED_FAILED", "Failed to regenerate the podcast feed.", err.Error(), true)
		return
	}
	a.writePodcastFeedURL(w, token)
}

type rssFeed struct {
	XMLName xml.Name   `xml:"rss"`
	Version string     `xml:"version,attr"`
	Itunes  string     `xml:"xmlns:itunes,attr"`
	Channel rssChannel `xml:"channel"`
}

type rssChannel struct {
	Title       string    `xml:"title"`
	Link        string    `xml:"link"`
	Description string    `xml:"description"`
	Language    string    `xml:"language"`
	Author      string    `xml:"itunes:author"`
	Explicit    string    `xml:"itunes:explicit"`
	Items       []rssItem `xml:"item"`
}

type rssItem struct {
	Title       string       `xml:"title"`
	GUID        rssGUID      `xml:"guid"`
	PubDate     string       `xml:"pubDate"`
	Enclosure   rssEnclosure `xml:"enclosure"`
	Duration    int          `xml:"itunes:duration"`
	Description string       `xml:"description"`
}

type rssGUID struct {
	IsPermaLink bool   `xml:"isPermaLink,attr"`
	Value       string `xml:",chardata"`
}

type rssEnclosure struct {
	URL    string `xml:"url,attr"`
	Length int64  `xml:"length,attr"`
	Type   string `xml:"type,attr"`
}

// handlePodcastFeed serves a user's episodes as RSS 2.0: GET /podcast/feed/<token>.xml.
// No session: the token is the credential. Lists only episodes still within
// retention whose file is on disk.
func (a *App) handlePodcastFeed(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	token := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/podcast/feed/"), ".xml")
	if !podcastIDPattern.MatchString(token) || a.PublicBaseURL == "" {
		http.NotFound(w, r)
		return
	}
	userID, err := a.DB.GetUserIDByPodcastFeedToken(token)
	if err != nil {
		http.Error(w, "Failed to load feed", http.StatusInternalServerError)
		return
	}
	if userID == "" {
		http.NotFound(w, r)
		return
	}
	episodes, err := a.DB.ListPodcastEpisodes(userID, time.Now().Add(-podcastMaxAge))
	if err != nil {
		http.Error(w, "Failed to load feed", http.StatusInternalServerError)
		return
	}

	feed := rssFeed{
		Version: "2.0",
		Itunes:  "http://www.itunes.com/dtds/podcast-1.0.dtd",
		Channel: rssChannel{
			Title:       "German Trainer - My Podcast",
			Link:        a.PublicBaseURL + "/",
			Description: "Listening episodes you built in German Trainer. Each episode stays available for 7 days.",
			Language:    "de",
			Author:      "German Trainer",
			Explicit:    "false",
		},
	}
	for _, ep := range episodes {
		if _, err := os.Stat(filepath.Join(podcastDir, ep.ID+".mp3")); err != nil {
			continue
		}
		title := ep.Title + " - " + ep.CreatedAt.UTC().Format("2006-01-02")
		if ep.FavoritesOnly {
			title += " (favorites)"
		}
		feed.Channel.Items = append(feed.Channel.Items, rssItem{
			Title:   title,
			GUID:    rssGUID{Value: ep.ID},
			PubDate: ep.CreatedAt.UTC().Format(time.RFC1123Z),
			Enclosure: rssEnclosure{
				URL:    a.PublicBaseURL + "/api/podcast/" + ep.ID + ".mp3",
				Length: ep.SizeBytes,
				Type:   "audio/mpeg",
			},
			Duration:    ep.DurationSeconds,
			Description: fmt.Sprintf("%d phrases", ep.PhraseCount),
		})
	}

	w.Header().Set("Content-Type", "application/rss+xml; charset=utf-8")
	w.Header().Set("Cache-Control", "private, no-cache")
	w.Write([]byte(xml.Header))
	enc := xml.NewEncoder(w)
	enc.Indent("", "  ")
	if err := enc.Encode(feed); err != nil {
		log.Printf("[PODCAST] Failed to write feed: %v", err)
	}
}
