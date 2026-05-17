// Command gct is the German Conjunctions Trainer command-line client.
//
// This file holds only the subcommand router; each command's implementation
// lives in internal/cli alongside its tests. Tasks 6–7 of the CLI plan add
// `topics` and `exercises`; this file currently wires up `login`, `logout`,
// `whoami` and a few stubs.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"german-conjunctions-trainer/internal/cli"
)

// version is overridden via -ldflags at build time (Task 8). The zero value
// ("dev") is what you get from `go run` or a plain `go build`.
var version = "dev"

// usage prints the top-level help. Subcommand-specific help is delegated to
// each subcommand's *flag.FlagSet (-h / --help on `gct topics`, etc.).
const usage = `gct — German Conjunctions Trainer CLI

Usage:
  gct <command> [flags]

Commands:
  login      Authenticate via Google OAuth (device flow) and save a bearer token
  logout     Clear the locally-stored token
  whoami     Show the currently-configured user and server
  topics     Manage topics (list, get, create, update, delete, move)
  exercises  Trigger exercise generation for a topic
  version    Print version and exit

Global flags (apply to most subcommands):
  --server URL    Server base URL (overrides config)
  --config PATH   Config file path (overrides $GCT_CONFIG / XDG default)
  --token TOKEN   Bearer token (overrides config)
  --json          Emit raw JSON instead of human-readable output
`

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// run is the testable entry point. It returns an exit code rather than
// calling os.Exit directly so command-level tests (added in later tasks)
// can drive the dispatcher with synthetic args and captured output.
func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(stderr, usage)
		return 2
	}

	cmd, rest := args[0], args[1:]
	switch cmd {
	case "-h", "--help", "help":
		fmt.Fprint(stdout, usage)
		return 0
	case "version", "--version", "-v":
		fmt.Fprintln(stdout, version)
		return 0
	case "login":
		return runLogin(rest, stdout, stderr)
	case "logout":
		return runLogout(rest, stdout, stderr)
	case "whoami":
		return runWhoami(rest, stdout, stderr)
	case "topics", "exercises":
		// Tasks 6–7. Stub for now so the binary builds and `gct --help`
		// still lists the eventual surface.
		_ = rest
		fmt.Fprintf(stderr, "gct %s: not implemented yet (pending Tasks 6–7 of the CLI plan)\n", cmd)
		return 1
	default:
		fmt.Fprintf(stderr, "gct: unknown command %q\n\n", cmd)
		fmt.Fprint(stderr, usage)
		return 2
	}
}

// signalCtx returns a context that cancels on SIGINT/SIGTERM. The CLI's
// long-running operation is the device-flow poll inside Login; we want
// Ctrl-C to abort it cleanly rather than leaving the process stuck.
func signalCtx() (context.Context, context.CancelFunc) {
	return signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
}

func runLogin(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("login", flag.ContinueOnError)
	fs.SetOutput(stderr)
	var (
		server     = fs.String("server", "", "Server base URL (defaults to config value)")
		label      = fs.String("label", "cli", "Human label stored with the token (multiple tokens can co-exist per user)")
		configPath = fs.String("config", "", "Config file path (overrides $GCT_CONFIG)")
	)
	if err := fs.Parse(args); err != nil {
		return 2
	}

	cfg, err := loadConfig(*configPath)
	if err != nil {
		fmt.Fprintf(stderr, "gct login: %v\n", err)
		return 1
	}
	if *server != "" {
		cfg.ServerURL = *server
	}
	if cfg.ServerURL == "" {
		fmt.Fprintln(stderr, "gct login: server URL is required (use --server URL or set it in config)")
		return 2
	}

	ctx, cancel := signalCtx()
	defer cancel()

	res, err := cli.Login(ctx, cfg.ServerURL, *label, stdout)
	if err != nil {
		fmt.Fprintf(stderr, "gct login: %v\n", err)
		return 1
	}

	cfg.Token = res.Token
	cfg.UserID = res.UserID
	if err := saveConfig(cfg, *configPath); err != nil {
		fmt.Fprintf(stderr, "gct login: save config: %v\n", err)
		return 1
	}
	fmt.Fprintf(stdout, "Logged in as %s (label: %s)\n", res.UserID, res.Label)
	return 0
}

func runLogout(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("logout", flag.ContinueOnError)
	fs.SetOutput(stderr)
	configPath := fs.String("config", "", "Config file path (overrides $GCT_CONFIG)")
	if err := fs.Parse(args); err != nil {
		return 2
	}

	cfg, err := loadConfig(*configPath)
	if err != nil {
		fmt.Fprintf(stderr, "gct logout: %v\n", err)
		return 1
	}
	if cfg.Token == "" {
		fmt.Fprintln(stdout, "Already logged out.")
		return 0
	}
	cfg.Token = ""
	cfg.UserID = ""
	if err := saveConfig(cfg, *configPath); err != nil {
		fmt.Fprintf(stderr, "gct logout: save config: %v\n", err)
		return 1
	}
	fmt.Fprintln(stdout, "Logged out. (Server-side revocation is not yet implemented; the token may still be valid on the server until revoked manually.)")
	return 0
}

func runWhoami(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("whoami", flag.ContinueOnError)
	fs.SetOutput(stderr)
	var (
		server     = fs.String("server", "", "Server base URL (defaults to config value)")
		token      = fs.String("token", "", "Bearer token (overrides config)")
		configPath = fs.String("config", "", "Config file path (overrides $GCT_CONFIG)")
	)
	if err := fs.Parse(args); err != nil {
		return 2
	}

	cfg, err := loadConfig(*configPath)
	if err != nil {
		fmt.Fprintf(stderr, "gct whoami: %v\n", err)
		return 1
	}
	if *server != "" {
		cfg.ServerURL = *server
	}
	if *token != "" {
		cfg.Token = *token
	}
	if cfg.ServerURL == "" {
		fmt.Fprintln(stderr, "gct whoami: server URL is not configured (run gct login --server URL)")
		return 2
	}
	if cfg.Token == "" {
		fmt.Fprintln(stderr, "gct whoami: not logged in (run gct login)")
		return 1
	}

	client := cli.NewClient(cfg.ServerURL, cfg.Token)
	var resp struct {
		LoggedIn bool   `json:"logged_in"`
		UserID   string `json:"user_id"`
	}
	if err := client.Do(http.MethodGet, "/api/auth/status", nil, &resp); err != nil {
		if errors.Is(err, cli.ErrUnauthorized) {
			fmt.Fprintln(stderr, "gct whoami: token rejected by server — run gct login")
			return 1
		}
		fmt.Fprintf(stderr, "gct whoami: %v\n", err)
		return 1
	}
	if !resp.LoggedIn {
		fmt.Fprintln(stderr, "gct whoami: server reports not logged in — run gct login")
		return 1
	}
	fmt.Fprintf(stdout, "User: %s\nServer: %s\n", resp.UserID, cfg.ServerURL)
	return 0
}

// loadConfig honours an explicit --config path, falling back to the default
// resolution in internal/cli.Path.
func loadConfig(explicit string) (*cli.Config, error) {
	if explicit != "" {
		return cli.LoadFrom(explicit)
	}
	return cli.Load()
}

func saveConfig(cfg *cli.Config, explicit string) error {
	if explicit != "" {
		return cli.SaveTo(cfg, explicit)
	}
	return cli.Save(cfg)
}
