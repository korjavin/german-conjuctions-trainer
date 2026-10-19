// Command seed prepares the throwaway SQLite database the Playwright suite
// (e2e/) runs the real server against. It is never part of the server image.
//
//	seed init <db>                 default topics + a cached exercise pool per topic (fresh db)
//	seed user <db> <google-id>     create a user, print its session cookie value
//
// The pool is large enough that a fresh user never triggers LLM generation, so
// the suite needs no API keys. Cookies are encoded with COOKIE_HASH_KEY and
// COOKIE_BLOCK_KEY, which the server under test must share.
package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"

	"german-conjunctions-trainer/pkg/storage"

	"github.com/gorilla/securecookie"
)

// Must match cookieName in internal/app/middleware.go.
const sessionCookieName = "user-session"

// Sentences to seed, poolSize per topic in turn so every topic has its own
// (tests tell exercises apart by their English hint). e2e/tests read the same
// file to solve them.
//
//go:embed sentences.json
var sentencesJSON []byte

// Above the 10 eligible exercises below which the server calls the LLM.
const poolSize = 12

type sentence struct {
	DE string `json:"de"`
	EN string `json:"en"`
}

func main() {
	if len(os.Args) < 3 {
		log.Fatal("usage: seed init <db> | seed user <db> <google-id>")
	}
	db, err := storage.NewSQLiteStorage(os.Args[2])
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer db.Close()

	var sentences []sentence
	if err := json.Unmarshal(sentencesJSON, &sentences); err != nil {
		log.Fatalf("sentences.json: %v", err)
	}

	switch os.Args[1] {
	case "init":
		seedExercises(db, sentences)
	case "user":
		if len(os.Args) < 4 {
			log.Fatal("usage: seed user <db> <google-id>")
		}
		fmt.Print(createUser(db, os.Args[3]))
	default:
		log.Fatalf("unknown command %q", os.Args[1])
	}
}

func seedExercises(db *storage.SQLiteStorage, sentences []sentence) {
	db.InitializeDefaultTopics()
	topics, err := db.GetAllTopics()
	if err != nil {
		log.Fatalf("list topics: %v", err)
	}
	next := 0
	for _, t := range topics {
		if t.IsArchive || t.Prompt == "" {
			continue
		}
		pool := make([]sentence, poolSize)
		for i := range pool {
			pool[i] = sentences[next%len(sentences)]
			next++
		}
		hash := storage.GetPromptHash(t.Prompt)
		for _, s := range pool {
			ex, _ := json.Marshal(map[string]any{
				"correct_german_sentence": s.DE,
				"conjunction_topic":       t.Name,
				"english_hint":            s.EN,
				"scrambled_words":         strings.Fields(s.DE),
			})
			if _, err := db.CreateExercise(t.ID, hash, string(ex), ""); err != nil {
				log.Fatalf("create exercise: %v", err)
			}
		}
	}
}

func createUser(db *storage.SQLiteStorage, googleID string) string {
	user, err := db.GetUserByGoogleID(googleID)
	if err == nil && user == nil {
		user, err = db.CreateUser(googleID)
	}
	if err != nil {
		log.Fatalf("user %s: %v", googleID, err)
	}
	hashKey, blockKey := os.Getenv("COOKIE_HASH_KEY"), os.Getenv("COOKIE_BLOCK_KEY")
	if hashKey == "" || blockKey == "" {
		log.Fatal("COOKIE_HASH_KEY and COOKIE_BLOCK_KEY must be set (same as the server)")
	}
	value, err := securecookie.New([]byte(hashKey), []byte(blockKey)).Encode(sessionCookieName, user.ID)
	if err != nil {
		log.Fatalf("encode cookie: %v", err)
	}
	return value
}
