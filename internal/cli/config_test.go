package cli

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// withEnv sets env vars for the duration of a test and restores them on
// cleanup. Tests touching $HOME, $XDG_CONFIG_HOME or $GCT_CONFIG all need
// this so they don't bleed into each other when -parallel is used at the
// package level.
func withEnv(t *testing.T, kv map[string]string) {
	t.Helper()
	for k, v := range kv {
		prev, had := os.LookupEnv(k)
		if v == "" {
			os.Unsetenv(k)
		} else {
			os.Setenv(k, v)
		}
		k, prev, had := k, prev, had
		t.Cleanup(func() {
			if had {
				os.Setenv(k, prev)
			} else {
				os.Unsetenv(k)
			}
		})
	}
}

func TestPathUsesGCTConfigOverride(t *testing.T) {
	withEnv(t, map[string]string{
		"GCT_CONFIG":      "/tmp/override/cfg.json",
		"XDG_CONFIG_HOME": "/should/not/be/used",
		"HOME":            "/should/not/be/used",
	})
	got, err := Path()
	if err != nil {
		t.Fatalf("Path() error: %v", err)
	}
	if got != "/tmp/override/cfg.json" {
		t.Errorf("Path()=%q, want /tmp/override/cfg.json", got)
	}
}

func TestPathUsesXDGConfigHome(t *testing.T) {
	withEnv(t, map[string]string{
		"GCT_CONFIG":      "",
		"XDG_CONFIG_HOME": "/xdg/conf",
		"HOME":            "/home/user",
	})
	got, err := Path()
	if err != nil {
		t.Fatalf("Path() error: %v", err)
	}
	want := filepath.Join("/xdg/conf", "gct", "config.json")
	if got != want {
		t.Errorf("Path()=%q, want %q", got, want)
	}
}

func TestPathFallsBackToHome(t *testing.T) {
	withEnv(t, map[string]string{
		"GCT_CONFIG":      "",
		"XDG_CONFIG_HOME": "",
		"HOME":            "/home/user",
	})
	got, err := Path()
	if err != nil {
		t.Fatalf("Path() error: %v", err)
	}
	want := filepath.Join("/home/user", ".config", "gct", "config.json")
	if got != want {
		t.Errorf("Path()=%q, want %q", got, want)
	}
}

func TestLoadMissingFileReturnsZeroConfig(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "does-not-exist.json")
	cfg, err := LoadFrom(path)
	if err != nil {
		t.Fatalf("LoadFrom missing file: unexpected error %v", err)
	}
	if cfg == nil {
		t.Fatal("LoadFrom missing file: got nil config")
	}
	if cfg.Token != "" || cfg.ServerURL != "" || cfg.UserID != "" {
		t.Errorf("LoadFrom missing file: expected zero config, got %+v", cfg)
	}
}

func TestSaveLoadRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nested", "gct", "config.json")

	want := &Config{
		ServerURL: "https://example.com",
		Token:     "gct_secret",
		UserID:    "user-123",
	}
	if err := SaveTo(want, path); err != nil {
		t.Fatalf("SaveTo: %v", err)
	}

	got, err := LoadFrom(path)
	if err != nil {
		t.Fatalf("LoadFrom: %v", err)
	}
	if *got != *want {
		t.Errorf("round-trip mismatch: got %+v want %+v", got, want)
	}
}

func TestSaveCreatesParentDir(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "deeply", "nested", "config.json")
	if err := SaveTo(&Config{Token: "x"}, path); err != nil {
		t.Fatalf("SaveTo: %v", err)
	}
	info, err := os.Stat(filepath.Dir(path))
	if err != nil {
		t.Fatalf("stat parent: %v", err)
	}
	if !info.IsDir() {
		t.Fatalf("expected parent to be a directory")
	}
}

func TestSaveWritesMode0600(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX file mode bits don't translate on Windows")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	if err := SaveTo(&Config{Token: "secret"}, path); err != nil {
		t.Fatalf("SaveTo: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Errorf("config file mode = %#o, want 0600", mode)
	}
}

func TestSaveRepairsModeOnExistingFile(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX file mode bits don't translate on Windows")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	// Pre-create the file with permissive mode — this is the scenario the
	// fix needs to handle: a user-created or copied-in config that's
	// world-readable. os.WriteFile on its own would keep the 0644 mode.
	if err := os.WriteFile(path, []byte(`{"token":"old"}`), 0o644); err != nil {
		t.Fatalf("seed file: %v", err)
	}
	if err := SaveTo(&Config{Token: "new"}, path); err != nil {
		t.Fatalf("SaveTo: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Errorf("config file mode = %#o, want 0600 (Save did not repair permissions on existing file)", mode)
	}
	cfg, err := LoadFrom(path)
	if err != nil {
		t.Fatalf("LoadFrom: %v", err)
	}
	if cfg.Token != "new" {
		t.Errorf("token after save = %q, want %q", cfg.Token, "new")
	}
}

func TestLoadCorruptFileReturnsError(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	if err := os.WriteFile(path, []byte("{not valid json"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	_, err := LoadFrom(path)
	if err == nil {
		t.Fatal("LoadFrom on corrupt file: expected error, got nil")
	}
}

func TestLoadAndSaveUseEnvOverride(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "from-env.json")
	withEnv(t, map[string]string{"GCT_CONFIG": path})

	if err := Save(&Config{Token: "from-env"}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Token != "from-env" {
		t.Errorf("Load via env override: Token=%q, want from-env", cfg.Token)
	}
}
