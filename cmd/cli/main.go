// Command gct is the German Conjunctions Trainer command-line client.
//
// This file holds only the subcommand router; each command's implementation
// lives in internal/cli alongside its tests. Tasks 5–7 of the CLI plan fill
// in the login/topics/exercises commands — for now most subcommands are
// stubs that report "not implemented" so the binary builds and `gct
// --help` lists the eventual surface.
package main

import (
	"fmt"
	"io"
	"os"
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
	case "login", "logout", "whoami", "topics", "exercises":
		// Implementations land in Tasks 5–7. Until then we want a binary
		// that builds and a clear message for users who try the command
		// before that work merges.
		_ = rest
		fmt.Fprintf(stderr, "gct %s: not implemented yet (pending Tasks 5–7 of the CLI plan)\n", cmd)
		return 1
	default:
		fmt.Fprintf(stderr, "gct: unknown command %q\n\n", cmd)
		fmt.Fprint(stderr, usage)
		return 2
	}
}

