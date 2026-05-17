// Package cli implements the gct command-line client: persistent config
// storage, an HTTP client that talks to the server with a bearer token, and
// (in later tasks) the OAuth device flow plus topic/exercise subcommands.
package cli

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// Config is the on-disk state the CLI persists between invocations. The
// plaintext bearer token lives here — the file is written with mode 0600.
type Config struct {
	ServerURL string `json:"server_url,omitempty"`
	Token     string `json:"token,omitempty"`
	UserID    string `json:"user_id,omitempty"`
}

// configFileMode is the permission bits we set on the config file. The token
// is plaintext on disk so this must be readable only by the owning user.
const configFileMode fs.FileMode = 0o600

// configDirMode is the permission bits we use when creating the parent
// directory hierarchy ($XDG_CONFIG_HOME/gct).
const configDirMode fs.FileMode = 0o700

// gctEnvOverride lets users (and tests) point the CLI at an arbitrary config
// file path without going through the XDG dance.
const gctEnvOverride = "GCT_CONFIG"

// Path returns the absolute path where Load/Save read and write the config
// file. Resolution order:
//
//  1. $GCT_CONFIG, if set (intended for tests and the --config flag).
//  2. $XDG_CONFIG_HOME/gct/config.json, if $XDG_CONFIG_HOME is set.
//  3. $HOME/.config/gct/config.json otherwise.
//
// Returns an error only if every option above fails to produce a path —
// typically when both $HOME and $XDG_CONFIG_HOME are unset, which only
// happens in heavily sandboxed environments.
func Path() (string, error) {
	if p := os.Getenv(gctEnvOverride); p != "" {
		return p, nil
	}
	if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
		return filepath.Join(xdg, "gct", "config.json"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("locate home directory: %w", err)
	}
	return filepath.Join(home, ".config", "gct", "config.json"), nil
}

// Load reads the config from the default path (see Path). A missing file is
// not an error — Load returns a zero-value *Config so callers can treat
// "never logged in" the same as "blank config".
func Load() (*Config, error) {
	p, err := Path()
	if err != nil {
		return nil, err
	}
	return LoadFrom(p)
}

// LoadFrom reads a config file from an explicit path. Used by the --config
// flag override and by tests; production code typically calls Load.
func LoadFrom(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return &Config{}, nil
		}
		return nil, fmt.Errorf("read config %s: %w", path, err)
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config %s: %w", path, err)
	}
	return &cfg, nil
}

// Save writes cfg to the default path with mode 0600, creating parent
// directories as needed.
func Save(cfg *Config) error {
	p, err := Path()
	if err != nil {
		return err
	}
	return SaveTo(cfg, p)
}

// SaveTo writes cfg to an explicit path. The write is non-atomic — we
// truncate-and-write rather than write-temp-then-rename. Concurrent runs of
// gct against the same config could lose updates, but the expected usage
// (one human / one agent at a time) makes that an acceptable tradeoff.
func SaveTo(cfg *Config, path string) error {
	if err := os.MkdirAll(filepath.Dir(path), configDirMode); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("encode config: %w", err)
	}
	if err := os.WriteFile(path, data, configFileMode); err != nil {
		return fmt.Errorf("write config %s: %w", path, err)
	}
	return nil
}
