// Command gct is the German Conjunctions Trainer command-line client.
//
// This file holds only the subcommand router; each command's implementation
// lives in internal/cli alongside its tests. The router covers `login`,
// `logout`, `whoami`, `topics`, and `exercises`.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"runtime/debug"
	"strings"
	"syscall"
	"time"

	"german-conjunctions-trainer/internal/cli"
)

// version and commit are overridden via -ldflags at build time (see the
// Makefile). With a plain `go build` they stay at "dev"/"" and we fall back
// to runtime/debug.ReadBuildInfo for the VCS revision so `gct version` still
// reports something useful when invoked from a `go install`'d binary.
var (
	version = "dev"
	commit  = ""
)

// printVersion renders the build info. It prefers ldflags-injected values
// and falls back to runtime/debug.ReadBuildInfo for the VCS revision when
// the binary was produced by `go install`/`go build` without ldflags.
func printVersion(w io.Writer) {
	v, c := version, commit
	if c == "" {
		if info, ok := debug.ReadBuildInfo(); ok {
			for _, s := range info.Settings {
				if s.Key == "vcs.revision" {
					c = s.Value
					break
				}
			}
		}
	}
	if c == "" {
		fmt.Fprintf(w, "gct %s (%s)\n", v, runtime.Version())
		return
	}
	fmt.Fprintf(w, "gct %s (commit %s, %s)\n", v, c, runtime.Version())
}

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
	os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}

// run is the testable entry point. It returns an exit code rather than
// calling os.Exit directly so command-level tests (added in later tasks)
// can drive the dispatcher with synthetic args and captured output. stdin
// is plumbed through for interactive prompts (currently only `topics
// delete` without --yes).
func run(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
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
		printVersion(stdout)
		return 0
	case "login":
		return runLogin(rest, stdout, stderr)
	case "logout":
		return runLogout(rest, stdout, stderr)
	case "whoami":
		return runWhoami(rest, stdout, stderr)
	case "topics":
		return runTopics(rest, stdin, stdout, stderr)
	case "exercises":
		return runExercises(rest, stdout, stderr)
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
		token      = fs.String("token", "", "Bearer token (overrides config and $GCT_TOKEN)")
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
	} else if env := os.Getenv(gctTokenEnvOverride); env != "" && cfg.Token == "" {
		cfg.Token = env
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

// gctTokenEnvOverride lets agents inject a bearer token from the environment
// instead of writing it to disk. The --token flag wins over both.
const gctTokenEnvOverride = "GCT_TOKEN"

// topicsUsage spells out the topics surface for `gct topics -h` and the
// "unknown subcommand" path.
const topicsUsage = `gct topics — manage topics

Usage:
  gct topics list   [--tree] [--json]
  gct topics get    <id> [--json]
  gct topics create --name X --prompt Y|--prompt-file F [--parent ID] [--sort N] [--json]
  gct topics update <id> [--name X] [--prompt Y|--prompt-file F] [--parent ID|--no-parent] [--sort N] [--json]
  gct topics delete <id> [--yes]
  gct topics move   <id> --parent ID [--position N] [--json]

Global flags (apply to every subcommand):
  --server URL    Server base URL (overrides config)
  --config PATH   Config file path (overrides $GCT_CONFIG)
  --token TOKEN   Bearer token (overrides config and $GCT_TOKEN)
  --json          Emit raw JSON instead of human-readable output
`

func runTopics(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(stderr, topicsUsage)
		return 2
	}
	sub, rest := args[0], args[1:]
	switch sub {
	case "-h", "--help", "help":
		fmt.Fprint(stdout, topicsUsage)
		return 0
	case "list":
		return runTopicsList(rest, stdout, stderr)
	case "get":
		return runTopicsGet(rest, stdout, stderr)
	case "create":
		return runTopicsCreate(rest, stdin, stdout, stderr)
	case "update":
		return runTopicsUpdate(rest, stdin, stdout, stderr)
	case "delete":
		return runTopicsDelete(rest, stdin, stdout, stderr)
	case "move":
		return runTopicsMove(rest, stdout, stderr)
	default:
		fmt.Fprintf(stderr, "gct topics: unknown subcommand %q\n\n", sub)
		fmt.Fprint(stderr, topicsUsage)
		return 2
	}
}

// commonFlags wires the shared --server/--config/--token/--json flags onto
// the supplied FlagSet. Returning pointers (rather than struct values) keeps
// the call sites mechanical: each subcommand declares the flags and reads
// the values after parsing.
type commonFlags struct {
	server     *string
	configPath *string
	token      *string
	jsonOut    *bool
}

func registerCommonFlags(fs *flag.FlagSet) commonFlags {
	return commonFlags{
		server:     fs.String("server", "", "Server base URL (overrides config)"),
		configPath: fs.String("config", "", "Config file path (overrides $GCT_CONFIG)"),
		token:      fs.String("token", "", "Bearer token (overrides config and $GCT_TOKEN)"),
		jsonOut:    fs.Bool("json", false, "Emit raw JSON instead of human-readable output"),
	}
}

// resolveClient builds a *cli.Client from the persisted config plus any
// per-invocation overrides. cmdName is used solely for the "not logged in"
// error message so it reads naturally ("gct topics list: ...").
func resolveClient(cmdName string, cf commonFlags, stderr io.Writer) (*cli.Client, int) {
	cfg, err := loadConfig(*cf.configPath)
	if err != nil {
		fmt.Fprintf(stderr, "%s: %v\n", cmdName, err)
		return nil, 1
	}
	if *cf.server != "" {
		cfg.ServerURL = *cf.server
	}
	if *cf.token != "" {
		cfg.Token = *cf.token
	} else if env := os.Getenv(gctTokenEnvOverride); env != "" && cfg.Token == "" {
		cfg.Token = env
	}
	if cfg.ServerURL == "" {
		fmt.Fprintf(stderr, "%s: server URL is not configured (run gct login --server URL or pass --server)\n", cmdName)
		return nil, 2
	}
	if cfg.Token == "" {
		fmt.Fprintf(stderr, "%s: not logged in (run gct login or pass --token)\n", cmdName)
		return nil, 1
	}
	return cli.NewClient(cfg.ServerURL, cfg.Token), 0
}

// printAPIError renders one of the typed errors from internal/cli into a
// human-friendly message. Returns the exit code callers should propagate.
// For *APIError, we surface the server's body (and status for non-2xx)
// rather than the full METHOD URL prefix that APIError.Error() emits —
// end users don't need the request line.
func printAPIError(cmdName string, err error, stderr io.Writer) int {
	if err == nil {
		return 0
	}
	switch {
	case errors.Is(err, cli.ErrUnauthorized):
		fmt.Fprintf(stderr, "%s: token rejected by server — run gct login first\n", cmdName)
		return 1
	case errors.Is(err, cli.ErrForbidden):
		fmt.Fprintf(stderr, "%s: admin permission required\n", cmdName)
		return 1
	}
	var apiErr *cli.APIError
	if errors.As(err, &apiErr) {
		if apiErr.Body != "" {
			fmt.Fprintf(stderr, "%s: %s: %s\n", cmdName, apiErr.Status, apiErr.Body)
		} else {
			fmt.Fprintf(stderr, "%s: %s\n", cmdName, apiErr.Status)
		}
		return 1
	}
	fmt.Fprintf(stderr, "%s: %v\n", cmdName, err)
	return 1
}

func runTopicsList(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("topics list", flag.ContinueOnError)
	fs.SetOutput(stderr)
	cf := registerCommonFlags(fs)
	tree := fs.Bool("tree", false, "Render an indented tree instead of a flat list")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	client, code := resolveClient("gct topics list", cf, stderr)
	if client == nil {
		return code
	}
	topics, err := client.ListTopics()
	if err != nil {
		return printAPIError("gct topics list", err, stderr)
	}
	if *cf.jsonOut {
		return writeJSON(stdout, topics)
	}
	if *tree {
		printTopicsTree(stdout, topics)
		return 0
	}
	for _, t := range topics {
		parent := ""
		if t.ParentID != nil {
			parent = *t.ParentID
		}
		fmt.Fprintf(stdout, "%s\t%s\tparent=%s\tsort=%d\n", t.ID, t.Name, parent, t.SortOrder)
	}
	return 0
}

// printTopicsTree walks the parent → children map and prints the topic
// names indented by depth. Cycles aren't a concern: the server's
// validateTopicTree rejects them at write time.
func printTopicsTree(out io.Writer, topics []*cli.Topic) {
	children := map[string][]*cli.Topic{}
	for _, t := range topics {
		key := ""
		if t.ParentID != nil {
			key = *t.ParentID
		}
		children[key] = append(children[key], t)
	}
	var walk func(parent string, depth int)
	walk = func(parent string, depth int) {
		for _, t := range children[parent] {
			fmt.Fprintf(out, "%s- %s [%s]\n", strings.Repeat("  ", depth), t.Name, t.ID)
			walk(t.ID, depth+1)
		}
	}
	walk("", 0)
}

func runTopicsGet(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("topics get", flag.ContinueOnError)
	fs.SetOutput(stderr)
	cf := registerCommonFlags(fs)
	if err := fs.Parse(reorderArgs(args)); err != nil {
		return 2
	}
	if fs.NArg() < 1 {
		fmt.Fprintln(stderr, "gct topics get: topic id required")
		return 2
	}
	if fs.NArg() > 1 {
		fmt.Fprintf(stderr, "gct topics get: expected exactly one topic id, got %d: %v\n", fs.NArg(), fs.Args())
		return 2
	}
	id := fs.Arg(0)
	client, code := resolveClient("gct topics get", cf, stderr)
	if client == nil {
		return code
	}
	topic, err := client.GetTopic(id)
	if err != nil {
		return printAPIError("gct topics get", err, stderr)
	}
	if *cf.jsonOut {
		return writeJSON(stdout, topic)
	}
	fmt.Fprintf(stdout, "ID:        %s\n", topic.ID)
	fmt.Fprintf(stdout, "Name:      %s\n", topic.Name)
	if topic.ParentID != nil {
		fmt.Fprintf(stdout, "Parent:    %s\n", *topic.ParentID)
	}
	fmt.Fprintf(stdout, "SortOrder: %d\n", topic.SortOrder)
	fmt.Fprintf(stdout, "Prompt:\n%s\n", topic.Prompt)
	return 0
}

// readPromptValue returns the prompt to use. Priority: --prompt-file (with
// "-" meaning stdin), then --prompt. Returns empty string + nil error when
// neither was provided so callers can decide whether that's allowed.
func readPromptValue(promptFlag, promptFileFlag string, stdin io.Reader) (string, error) {
	if promptFileFlag != "" {
		if promptFileFlag == "-" {
			data, err := io.ReadAll(stdin)
			if err != nil {
				return "", fmt.Errorf("read prompt from stdin: %w", err)
			}
			return string(data), nil
		}
		data, err := os.ReadFile(promptFileFlag)
		if err != nil {
			return "", fmt.Errorf("read prompt file: %w", err)
		}
		return string(data), nil
	}
	return promptFlag, nil
}

func runTopicsCreate(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("topics create", flag.ContinueOnError)
	fs.SetOutput(stderr)
	cf := registerCommonFlags(fs)
	name := fs.String("name", "", "Topic name")
	prompt := fs.String("prompt", "", "Prompt body (use --prompt-file for long prompts)")
	promptFile := fs.String("prompt-file", "", "Read prompt from a file (use - for stdin)")
	parent := fs.String("parent", "", "Parent topic ID (empty = root)")
	sortOrder := fs.Int("sort", 0, "Sort order (non-negative integer)")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if *name == "" {
		fmt.Fprintln(stderr, "gct topics create: --name is required")
		return 2
	}
	if *prompt == "" && *promptFile == "" {
		fmt.Fprintln(stderr, "gct topics create: either --prompt or --prompt-file is required")
		return 2
	}
	promptValue, err := readPromptValue(*prompt, *promptFile, stdin)
	if err != nil {
		fmt.Fprintf(stderr, "gct topics create: %v\n", err)
		return 1
	}
	client, code := resolveClient("gct topics create", cf, stderr)
	if client == nil {
		return code
	}
	var parentPtr *string
	if *parent != "" {
		parentPtr = parent
	}
	topic, err := client.CreateTopic(*name, promptValue, parentPtr, *sortOrder)
	if err != nil {
		return printAPIError("gct topics create", err, stderr)
	}
	if *cf.jsonOut {
		return writeJSON(stdout, topic)
	}
	fmt.Fprintf(stdout, "Created topic %s (%s)\n", topic.ID, topic.Name)
	return 0
}

func runTopicsUpdate(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("topics update", flag.ContinueOnError)
	fs.SetOutput(stderr)
	cf := registerCommonFlags(fs)
	name := fs.String("name", "", "New topic name")
	prompt := fs.String("prompt", "", "New prompt body")
	promptFile := fs.String("prompt-file", "", "Read prompt from file (use - for stdin)")
	parent := fs.String("parent", "", "New parent topic ID")
	noParent := fs.Bool("no-parent", false, "Move topic to the root level (mutually exclusive with --parent)")
	sortOrder := fs.Int("sort", -1, "New sort order; negative values mean 'leave unchanged'")
	if err := fs.Parse(reorderArgs(args)); err != nil {
		return 2
	}
	if fs.NArg() < 1 {
		fmt.Fprintln(stderr, "gct topics update: topic id required")
		return 2
	}
	if fs.NArg() > 1 {
		fmt.Fprintf(stderr, "gct topics update: expected exactly one topic id, got %d: %v\n", fs.NArg(), fs.Args())
		return 2
	}
	id := fs.Arg(0)

	update := cli.TopicUpdate{}
	if isFlagSet(fs, "name") {
		update.Name = name
	}
	if *promptFile != "" || isFlagSet(fs, "prompt") {
		promptValue, err := readPromptValue(*prompt, *promptFile, stdin)
		if err != nil {
			fmt.Fprintf(stderr, "gct topics update: %v\n", err)
			return 1
		}
		update.Prompt = &promptValue
	}
	if *noParent && isFlagSet(fs, "parent") {
		fmt.Fprintln(stderr, "gct topics update: --parent and --no-parent are mutually exclusive")
		return 2
	}
	if *noParent {
		update.ClearParent = true
	} else if isFlagSet(fs, "parent") {
		update.Parent = parent
	}
	if isFlagSet(fs, "sort") {
		if *sortOrder < 0 {
			fmt.Fprintln(stderr, "gct topics update: --sort must be a non-negative integer")
			return 2
		}
		update.SortOrder = sortOrder
	}

	client, code := resolveClient("gct topics update", cf, stderr)
	if client == nil {
		return code
	}
	topic, err := client.UpdateTopic(id, update)
	if err != nil {
		return printAPIError("gct topics update", err, stderr)
	}
	if *cf.jsonOut {
		return writeJSON(stdout, topic)
	}
	fmt.Fprintf(stdout, "Updated topic %s (%s)\n", topic.ID, topic.Name)
	return 0
}

func runTopicsDelete(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("topics delete", flag.ContinueOnError)
	fs.SetOutput(stderr)
	cf := registerCommonFlags(fs)
	yes := fs.Bool("yes", false, "Skip the confirmation prompt")
	if err := fs.Parse(reorderArgs(args)); err != nil {
		return 2
	}
	if fs.NArg() < 1 {
		fmt.Fprintln(stderr, "gct topics delete: topic id required")
		return 2
	}
	if fs.NArg() > 1 {
		fmt.Fprintf(stderr, "gct topics delete: expected exactly one topic id, got %d: %v\n", fs.NArg(), fs.Args())
		return 2
	}
	id := fs.Arg(0)

	if !*yes {
		fmt.Fprintf(stdout, "Delete topic %s? Type 'yes' to confirm: ", id)
		if !readYesNo(stdin) {
			fmt.Fprintln(stdout, "Aborted.")
			return 1
		}
	}

	client, code := resolveClient("gct topics delete", cf, stderr)
	if client == nil {
		return code
	}
	if err := client.DeleteTopic(id); err != nil {
		return printAPIError("gct topics delete", err, stderr)
	}
	fmt.Fprintf(stdout, "Deleted topic %s\n", id)
	return 0
}

// readYesNo returns true only when stdin's first line trims to "yes" (case-
// insensitive). EOF or any other answer counts as a "no".
func readYesNo(stdin io.Reader) bool {
	if stdin == nil {
		return false
	}
	scanner := bufio.NewScanner(stdin)
	if !scanner.Scan() {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(scanner.Text()), "yes")
}

func runTopicsMove(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("topics move", flag.ContinueOnError)
	fs.SetOutput(stderr)
	cf := registerCommonFlags(fs)
	parent := fs.String("parent", "", "Destination parent topic ID (empty = root)")
	position := fs.Int("position", -1, "Position within the destination parent (default: append)")
	if err := fs.Parse(reorderArgs(args)); err != nil {
		return 2
	}
	if fs.NArg() < 1 {
		fmt.Fprintln(stderr, "gct topics move: topic id required")
		return 2
	}
	if fs.NArg() > 1 {
		fmt.Fprintf(stderr, "gct topics move: expected exactly one topic id, got %d: %v\n", fs.NArg(), fs.Args())
		return 2
	}
	id := fs.Arg(0)

	var positionPtr *int
	if isFlagSet(fs, "position") {
		if *position < 0 {
			fmt.Fprintln(stderr, "gct topics move: --position must be a non-negative integer")
			return 2
		}
		positionPtr = position
	}

	client, code := resolveClient("gct topics move", cf, stderr)
	if client == nil {
		return code
	}
	topic, err := client.MoveTopic(id, *parent, positionPtr)
	if err != nil {
		return printAPIError("gct topics move", err, stderr)
	}
	if *cf.jsonOut {
		return writeJSON(stdout, topic)
	}
	parentName := "root"
	if topic.ParentID != nil {
		parentName = *topic.ParentID
	}
	fmt.Fprintf(stdout, "Moved topic %s under %s (sort=%d)\n", topic.ID, parentName, topic.SortOrder)
	return 0
}

// reorderArgs lifts any leading positional arguments to the back of the
// slice so flag.FlagSet.Parse (which stops at the first non-flag token) can
// still find the flags. This lets us accept "gct topics get t1 --json" in
// addition to "gct topics get --json t1" — the former feels more natural
// for verb-noun commands.
func reorderArgs(args []string) []string {
	for i, a := range args {
		if strings.HasPrefix(a, "-") {
			if i == 0 {
				return args
			}
			out := make([]string, 0, len(args))
			out = append(out, args[i:]...)
			out = append(out, args[:i]...)
			return out
		}
	}
	return args
}

// isFlagSet reports whether the named flag was supplied on the command line
// (as opposed to taking its declared default). flag.FlagSet.Visit only walks
// the flags that were actually set, which is what we want for distinguishing
// "user passed --foo bar" from "user omitted --foo".
func isFlagSet(fs *flag.FlagSet, name string) bool {
	var seen bool
	fs.Visit(func(f *flag.Flag) {
		if f.Name == name {
			seen = true
		}
	})
	return seen
}

// exercisesUsage spells out the exercises surface for `gct exercises -h`.
const exercisesUsage = `gct exercises — trigger exercise generation

Usage:
  gct exercises generate <topic-id> [--watch] [--json]

Flags:
  --watch         Poll up to 5 times (5s apart) until the server returns
                  at least 10 exercises. Useful when the LLM cache is cold
                  and generation needs a moment to land.

Global flags (apply to every subcommand):
  --server URL    Server base URL (overrides config)
  --config PATH   Config file path (overrides $GCT_CONFIG)
  --token TOKEN   Bearer token (overrides config and $GCT_TOKEN)
  --json          Emit raw JSON instead of a human-readable summary
`

// watchInterval / watchAttempts gate how aggressively --watch retries. Vars
// (not consts) so tests can shrink them — otherwise a unit test would block
// for 25 seconds to exercise the polling path.
var (
	watchInterval     = 5 * time.Second
	watchMaxAttempts  = 5
	watchThreshold    = 10
)

func runExercises(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(stderr, exercisesUsage)
		return 2
	}
	sub, rest := args[0], args[1:]
	switch sub {
	case "-h", "--help", "help":
		fmt.Fprint(stdout, exercisesUsage)
		return 0
	case "generate":
		return runExercisesGenerate(rest, stdout, stderr)
	default:
		fmt.Fprintf(stderr, "gct exercises: unknown subcommand %q\n\n", sub)
		fmt.Fprint(stderr, exercisesUsage)
		return 2
	}
}

func runExercisesGenerate(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("exercises generate", flag.ContinueOnError)
	fs.SetOutput(stderr)
	cf := registerCommonFlags(fs)
	watch := fs.Bool("watch", false, "Poll until at least 10 exercises are returned")
	if err := fs.Parse(reorderArgs(args)); err != nil {
		return 2
	}
	if fs.NArg() < 1 {
		fmt.Fprintln(stderr, "gct exercises generate: topic id required")
		return 2
	}
	if fs.NArg() > 1 {
		fmt.Fprintf(stderr, "gct exercises generate: expected exactly one topic id, got %d: %v\n", fs.NArg(), fs.Args())
		return 2
	}
	topicID := fs.Arg(0)

	client, code := resolveClient("gct exercises generate", cf, stderr)
	if client == nil {
		return code
	}

	exercises, err := client.GenerateExercises(topicID)
	if err != nil {
		return printAPIError("gct exercises generate", err, stderr)
	}

	if *watch {
		for attempt := 1; attempt < watchMaxAttempts && len(exercises) < watchThreshold; attempt++ {
			fmt.Fprintf(stderr, "gct exercises generate: only %d exercises so far, retrying (%d/%d) in %s…\n",
				len(exercises), attempt, watchMaxAttempts-1, watchInterval)
			time.Sleep(watchInterval)
			next, err := client.GenerateExercises(topicID)
			if err != nil {
				return printAPIError("gct exercises generate", err, stderr)
			}
			exercises = next
		}
	}

	if *cf.jsonOut {
		return writeJSON(stdout, exercises)
	}
	fmt.Fprintf(stdout, "Generated %d exercises for topic %s\n", len(exercises), topicID)
	return 0
}

// writeJSON emits v as indented JSON terminated by a newline. Returns 0 on
// success, 1 on encoding failure (which should be impossible for the types
// we pass in).
func writeJSON(out io.Writer, v any) int {
	enc := json.NewEncoder(out)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		fmt.Fprintf(out, "encode JSON: %v\n", err)
		return 1
	}
	return 0
}
