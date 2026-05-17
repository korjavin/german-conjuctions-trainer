package storage

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newTestStorageForTokens(t *testing.T) *SQLiteStorage {
	t.Helper()
	// Open with foreign_keys=on so cascade-delete behavior is testable.
	dbPath := filepath.Join(t.TempDir(), "tokens.db?_foreign_keys=on")
	store, err := NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("failed to create sqlite storage: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	return store
}

func mustCreateUser(t *testing.T, store *SQLiteStorage, googleID string) *User {
	t.Helper()
	u, err := store.CreateUser(googleID)
	if err != nil {
		t.Fatalf("failed to create user: %v", err)
	}
	return u
}

func TestCreateCLIToken(t *testing.T) {
	store := newTestStorageForTokens(t)
	user := mustCreateUser(t, store, "google-1")

	tok, err := store.CreateCLIToken(user.ID, "hashA", "laptop")
	if err != nil {
		t.Fatalf("CreateCLIToken returned error: %v", err)
	}
	if tok.ID == "" {
		t.Errorf("expected non-empty ID")
	}
	if tok.UserID != user.ID {
		t.Errorf("UserID: got %q, want %q", tok.UserID, user.ID)
	}
	if tok.TokenHash != "hashA" {
		t.Errorf("TokenHash: got %q, want %q", tok.TokenHash, "hashA")
	}
	if tok.Label != "laptop" {
		t.Errorf("Label: got %q, want %q", tok.Label, "laptop")
	}
	if tok.CreatedAt.IsZero() {
		t.Errorf("CreatedAt should be set")
	}
	if tok.RevokedAt != nil {
		t.Errorf("RevokedAt should be nil on fresh token")
	}
	if tok.LastUsedAt != nil {
		t.Errorf("LastUsedAt should be nil on fresh token")
	}
}

func TestGetCLITokenByHash(t *testing.T) {
	store := newTestStorageForTokens(t)
	user := mustCreateUser(t, store, "google-1")

	created, err := store.CreateCLIToken(user.ID, "hashA", "agent")
	if err != nil {
		t.Fatalf("CreateCLIToken: %v", err)
	}

	got, err := store.GetCLITokenByHash("hashA")
	if err != nil {
		t.Fatalf("GetCLITokenByHash: %v", err)
	}
	if got == nil {
		t.Fatal("expected token, got nil")
	}
	if got.ID != created.ID {
		t.Errorf("ID: got %q, want %q", got.ID, created.ID)
	}
	if got.UserID != user.ID {
		t.Errorf("UserID: got %q, want %q", got.UserID, user.ID)
	}
}

func TestGetCLITokenByHash_Unknown(t *testing.T) {
	store := newTestStorageForTokens(t)
	got, err := store.GetCLITokenByHash("does-not-exist")
	if err != nil {
		t.Fatalf("expected nil error for unknown hash, got: %v", err)
	}
	if got != nil {
		t.Errorf("expected nil token for unknown hash, got: %+v", got)
	}
}

func TestGetCLITokenByHash_RevokedStillReturned(t *testing.T) {
	store := newTestStorageForTokens(t)
	user := mustCreateUser(t, store, "google-1")

	tok, err := store.CreateCLIToken(user.ID, "hashRev", "")
	if err != nil {
		t.Fatalf("CreateCLIToken: %v", err)
	}
	if err := store.RevokeCLIToken(tok.ID, user.ID); err != nil {
		t.Fatalf("RevokeCLIToken: %v", err)
	}

	got, err := store.GetCLITokenByHash("hashRev")
	if err != nil {
		t.Fatalf("GetCLITokenByHash: %v", err)
	}
	if got == nil {
		t.Fatal("expected revoked token to still be returned")
	}
	if got.RevokedAt == nil {
		t.Error("expected RevokedAt to be set on revoked token")
	}
}

func TestTouchCLIToken(t *testing.T) {
	store := newTestStorageForTokens(t)
	user := mustCreateUser(t, store, "google-1")

	tok, err := store.CreateCLIToken(user.ID, "hashTouch", "")
	if err != nil {
		t.Fatalf("CreateCLIToken: %v", err)
	}
	if tok.LastUsedAt != nil {
		t.Fatalf("expected LastUsedAt nil before touch, got %v", tok.LastUsedAt)
	}

	before := time.Now().UTC()
	if err := store.TouchCLIToken(tok.ID); err != nil {
		t.Fatalf("TouchCLIToken: %v", err)
	}
	after := time.Now().UTC()

	refetched, err := store.GetCLITokenByHash("hashTouch")
	if err != nil {
		t.Fatalf("GetCLITokenByHash: %v", err)
	}
	if refetched.LastUsedAt == nil {
		t.Fatal("expected LastUsedAt to be set after touch")
	}
	// allow a small clock skew tolerance
	if refetched.LastUsedAt.Before(before.Add(-time.Second)) || refetched.LastUsedAt.After(after.Add(time.Second)) {
		t.Errorf("LastUsedAt %v not within [%v, %v]", refetched.LastUsedAt, before, after)
	}
}

func TestRevokeCLIToken_AlreadyRevokedFails(t *testing.T) {
	store := newTestStorageForTokens(t)
	user := mustCreateUser(t, store, "google-1")

	tok, err := store.CreateCLIToken(user.ID, "hashRev2", "")
	if err != nil {
		t.Fatalf("CreateCLIToken: %v", err)
	}
	if err := store.RevokeCLIToken(tok.ID, user.ID); err != nil {
		t.Fatalf("RevokeCLIToken first call: %v", err)
	}
	if err := store.RevokeCLIToken(tok.ID, user.ID); err == nil {
		t.Error("expected error revoking an already-revoked token")
	}
}

func TestRevokeCLIToken_WrongUser(t *testing.T) {
	store := newTestStorageForTokens(t)
	owner := mustCreateUser(t, store, "google-owner")
	other := mustCreateUser(t, store, "google-other")

	tok, err := store.CreateCLIToken(owner.ID, "hashOwner", "")
	if err != nil {
		t.Fatalf("CreateCLIToken: %v", err)
	}

	if err := store.RevokeCLIToken(tok.ID, other.ID); err == nil {
		t.Error("expected error when wrong user attempts to revoke")
	}
}

func TestListCLITokensForUser_FiltersRevoked(t *testing.T) {
	store := newTestStorageForTokens(t)
	user := mustCreateUser(t, store, "google-1")

	active1, err := store.CreateCLIToken(user.ID, "hash1", "a")
	if err != nil {
		t.Fatalf("CreateCLIToken: %v", err)
	}
	active2, err := store.CreateCLIToken(user.ID, "hash2", "b")
	if err != nil {
		t.Fatalf("CreateCLIToken: %v", err)
	}
	revoked, err := store.CreateCLIToken(user.ID, "hash3", "c")
	if err != nil {
		t.Fatalf("CreateCLIToken: %v", err)
	}
	if err := store.RevokeCLIToken(revoked.ID, user.ID); err != nil {
		t.Fatalf("RevokeCLIToken: %v", err)
	}

	tokens, err := store.ListCLITokensForUser(user.ID)
	if err != nil {
		t.Fatalf("ListCLITokensForUser: %v", err)
	}
	if len(tokens) != 2 {
		t.Fatalf("expected 2 active tokens, got %d: %+v", len(tokens), tokens)
	}
	seen := map[string]bool{}
	for _, tok := range tokens {
		seen[tok.ID] = true
		if tok.RevokedAt != nil {
			t.Errorf("did not expect revoked token in list, got %+v", tok)
		}
	}
	if !seen[active1.ID] || !seen[active2.ID] {
		t.Errorf("expected list to contain active tokens %s and %s; got %+v", active1.ID, active2.ID, tokens)
	}
}

func TestCreateCLIToken_DuplicateHashFails(t *testing.T) {
	store := newTestStorageForTokens(t)
	user := mustCreateUser(t, store, "google-1")

	if _, err := store.CreateCLIToken(user.ID, "dup", ""); err != nil {
		t.Fatalf("first CreateCLIToken: %v", err)
	}
	_, err := store.CreateCLIToken(user.ID, "dup", "")
	if err == nil {
		t.Fatal("expected unique constraint error on duplicate hash")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "unique") {
		t.Errorf("expected unique-constraint error, got %v", err)
	}
}

func TestCreateCLIToken_UnknownUserFails(t *testing.T) {
	store := newTestStorageForTokens(t)
	_, err := store.CreateCLIToken("not-a-user-id", "hashX", "")
	if err == nil {
		t.Fatal("expected foreign-key violation for unknown user_id")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "foreign") &&
		!strings.Contains(strings.ToLower(err.Error()), "constraint") {
		t.Errorf("expected FK / constraint error, got %v", err)
	}
}

func TestCLIToken_CascadeDeleteWithUser(t *testing.T) {
	store := newTestStorageForTokens(t)
	user := mustCreateUser(t, store, "google-1")

	tok, err := store.CreateCLIToken(user.ID, "hashCascade", "")
	if err != nil {
		t.Fatalf("CreateCLIToken: %v", err)
	}

	// Delete the user directly via SQL (no Storage method exposed).
	if _, err := store.db.Exec(`DELETE FROM users WHERE id = ?`, user.ID); err != nil {
		t.Fatalf("delete user: %v", err)
	}

	got, err := store.GetCLITokenByHash("hashCascade")
	if err != nil {
		t.Fatalf("GetCLITokenByHash: %v", err)
	}
	if got != nil {
		t.Errorf("expected token to be cascade-deleted with user, but got %+v (id=%s)", got, tok.ID)
	}
}
