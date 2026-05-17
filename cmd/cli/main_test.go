package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// withConfig writes a minimal config.json to a temp dir, sets $GCT_CONFIG to
// point at it for the duration of the test, and returns the path. Tests that
// drive `run(...)` rely on this so the dispatcher's loadConfig finds a real
// (test-controlled) file rather than the user's actual one.
func withConfig(t *testing.T, cfg cliConfig) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	data, err := json.Marshal(cfg)
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	t.Setenv("GCT_CONFIG", path)
	// Make sure tests don't accidentally inherit a real $GCT_TOKEN from the
	// developer's shell.
	t.Setenv("GCT_TOKEN", "")
	return path
}

// cliConfig mirrors internal/cli.Config without importing the package — we
// just need to write a JSON file with the right keys.
type cliConfig struct {
	ServerURL string `json:"server_url"`
	Token     string `json:"token"`
	UserID    string `json:"user_id"`
}

// runTopicsCmd is a thin wrapper that invokes the dispatcher with the topics
// subcommand and captured stdout/stderr.
func runTopicsCmd(t *testing.T, stdin io.Reader, args ...string) (int, string, string) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	all := append([]string{"topics"}, args...)
	code := run(all, stdin, &stdout, &stderr)
	return code, stdout.String(), stderr.String()
}

// readSavedConfig parses the on-disk config file written by run(...) so tests
// can assert against the post-command state without re-implementing the
// XDG lookup logic.
func readSavedConfig(t *testing.T, path string) cliConfig {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	var got cliConfig
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("unmarshal config: %v", err)
	}
	return got
}

func TestAuthSetTokenPersistsToken(t *testing.T) {
	path := withConfig(t, cliConfig{ServerURL: "https://prev.example.com", Token: "old-token", UserID: "old-user"})
	var stdout, stderr bytes.Buffer
	code := run([]string{"auth", "set-token", "new-token-123"}, nil, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("exit code = %d, stderr=%s", code, stderr.String())
	}
	cfg := readSavedConfig(t, path)
	if cfg.Token != "new-token-123" {
		t.Errorf("Token = %q, want new-token-123", cfg.Token)
	}
	if cfg.ServerURL != "https://prev.example.com" {
		t.Errorf("ServerURL = %q, expected to be preserved", cfg.ServerURL)
	}
	if cfg.UserID != "" {
		t.Errorf("UserID = %q, want empty (cleared)", cfg.UserID)
	}
	if !strings.Contains(stdout.String(), "Token saved") {
		t.Errorf("stdout missing confirmation: %q", stdout.String())
	}
}

func TestAuthSetTokenWithServerFlag(t *testing.T) {
	path := withConfig(t, cliConfig{})
	var stdout, stderr bytes.Buffer
	code := run([]string{"auth", "set-token", "tok", "--server", "https://new.example.com"}, nil, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("exit code = %d, stderr=%s", code, stderr.String())
	}
	cfg := readSavedConfig(t, path)
	if cfg.ServerURL != "https://new.example.com" {
		t.Errorf("ServerURL = %q", cfg.ServerURL)
	}
	if cfg.Token != "tok" {
		t.Errorf("Token = %q", cfg.Token)
	}
}

func TestAuthSetTokenRequiresServer(t *testing.T) {
	withConfig(t, cliConfig{})
	var stdout, stderr bytes.Buffer
	code := run([]string{"auth", "set-token", "tok"}, nil, &stdout, &stderr)
	if code != 2 {
		t.Fatalf("exit code = %d, want 2; stderr=%s", code, stderr.String())
	}
	if !strings.Contains(stderr.String(), "server URL is required") {
		t.Errorf("stderr missing expected message: %q", stderr.String())
	}
}

func TestAuthSetTokenRequiresArg(t *testing.T) {
	withConfig(t, cliConfig{ServerURL: "https://x.example.com"})
	var stdout, stderr bytes.Buffer
	code := run([]string{"auth", "set-token"}, nil, &stdout, &stderr)
	if code != 2 {
		t.Fatalf("exit code = %d, want 2", code)
	}
	if !strings.Contains(stderr.String(), "token argument required") {
		t.Errorf("stderr missing expected message: %q", stderr.String())
	}
}

func TestAuthSetTokenRejectsEmptyToken(t *testing.T) {
	withConfig(t, cliConfig{ServerURL: "https://x.example.com"})
	var stdout, stderr bytes.Buffer
	code := run([]string{"auth", "set-token", "   "}, nil, &stdout, &stderr)
	if code != 2 {
		t.Fatalf("exit code = %d, want 2; stderr=%s", code, stderr.String())
	}
}

func TestAuthHelpListsSubcommands(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := run([]string{"auth", "--help"}, nil, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("exit code = %d, stderr=%s", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), "set-token") {
		t.Errorf("auth --help missing set-token: %q", stdout.String())
	}
}

func TestAuthUnknownSubcommand(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := run([]string{"auth", "wibble"}, nil, &stdout, &stderr)
	if code != 2 {
		t.Fatalf("exit code = %d, want 2", code)
	}
	if !strings.Contains(stderr.String(), `unknown subcommand "wibble"`) {
		t.Errorf("stderr missing message: %q", stderr.String())
	}
}

func TestTopicsListPrintsTabularByDefault(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/topics" || r.Method != http.MethodGet {
			t.Errorf("got %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer testtok" {
			t.Errorf("Authorization = %q", got)
		}
		_, _ = w.Write([]byte(`{"topics":[{"id":"t1","name":"Greetings","sort_order":0},{"id":"t2","name":"Numbers","sort_order":1,"parent_id":"t1"}]}`))
	}))
	defer srv.Close()

	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "testtok"})

	code, stdout, stderr := runTopicsCmd(t, nil, "list")
	if code != 0 {
		t.Fatalf("exit code = %d, stderr=%s", code, stderr)
	}
	if !strings.Contains(stdout, "t1\tGreetings") {
		t.Errorf("missing t1 row, stdout=%q", stdout)
	}
	if !strings.Contains(stdout, "parent=t1") {
		t.Errorf("missing parent column for t2, stdout=%q", stdout)
	}
}

func TestTopicsListWithJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"topics":[{"id":"t1","name":"A"}]}`))
	}))
	defer srv.Close()

	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "tok"})

	code, stdout, _ := runTopicsCmd(t, nil, "list", "--json")
	if code != 0 {
		t.Fatalf("exit code = %d", code)
	}
	var got []map[string]any
	if err := json.Unmarshal([]byte(stdout), &got); err != nil {
		t.Fatalf("--json output not valid JSON: %v\noutput=%s", err, stdout)
	}
	if len(got) != 1 || got[0]["id"] != "t1" {
		t.Errorf("unexpected JSON: %+v", got)
	}
}

func TestTopicsListWithTree(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"topics":[
			{"id":"root1","name":"Root1"},
			{"id":"child1","name":"Child1","parent_id":"root1"},
			{"id":"grand1","name":"Grand1","parent_id":"child1"}
		]}`))
	}))
	defer srv.Close()

	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "tok"})

	code, stdout, _ := runTopicsCmd(t, nil, "list", "--tree")
	if code != 0 {
		t.Fatalf("exit code = %d", code)
	}
	// Root has no indentation; Child1 indented once; Grand1 indented twice.
	if !strings.Contains(stdout, "- Root1") {
		t.Errorf("tree missing root, stdout=%q", stdout)
	}
	if !strings.Contains(stdout, "  - Child1") {
		t.Errorf("tree missing child indent, stdout=%q", stdout)
	}
	if !strings.Contains(stdout, "    - Grand1") {
		t.Errorf("tree missing grandchild indent, stdout=%q", stdout)
	}
}

func TestTopicsGetPrintsFields(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/topics/t1" {
			t.Errorf("path = %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"id":"t1","name":"Greetings","prompt":"hi","sort_order":4}`))
	}))
	defer srv.Close()
	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "tok"})

	code, stdout, stderr := runTopicsCmd(t, nil, "get", "t1")
	if code != 0 {
		t.Fatalf("code = %d, stderr=%s", code, stderr)
	}
	if !strings.Contains(stdout, "ID:        t1") {
		t.Errorf("missing ID field, stdout=%q", stdout)
	}
	if !strings.Contains(stdout, "Prompt:\nhi") {
		t.Errorf("missing prompt body, stdout=%q", stdout)
	}
}

func TestTopicsGetRequiresID(t *testing.T) {
	withConfig(t, cliConfig{ServerURL: "http://example", Token: "tok"})
	code, _, stderr := runTopicsCmd(t, nil, "get")
	if code != 2 {
		t.Errorf("code = %d, want 2", code)
	}
	if !strings.Contains(stderr, "topic id required") {
		t.Errorf("stderr = %q", stderr)
	}
}

// TestTopicsUpdateRejectsExtraPositionals guards against silent
// mis-targeting when the user mixes positionals with flags
// ("gct topics update t1 --name X t2" used to operate on t2 because
// reorderArgs lifted t1 to the end of the slice).
func TestTopicsUpdateRejectsExtraPositionals(t *testing.T) {
	withConfig(t, cliConfig{ServerURL: "http://example", Token: "tok"})
	code, _, stderr := runTopicsCmd(t, nil, "update", "t1", "--name", "X", "t2")
	if code != 2 {
		t.Errorf("code = %d, want 2", code)
	}
	if !strings.Contains(stderr, "expected exactly one topic id") {
		t.Errorf("stderr = %q", stderr)
	}
}

func TestTopicsCreateSendsBody(t *testing.T) {
	var captured map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/topics" {
			t.Errorf("got %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewDecoder(r.Body).Decode(&captured)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"new","name":"NewTopic"}`))
	}))
	defer srv.Close()
	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "tok"})

	code, stdout, stderr := runTopicsCmd(t, nil,
		"create",
		"--name", "NewTopic",
		"--prompt", "a long enough prompt body",
		"--parent", "p1",
		"--sort", "3",
	)
	if code != 0 {
		t.Fatalf("code = %d, stderr=%s", code, stderr)
	}
	if captured["name"] != "NewTopic" {
		t.Errorf("body.name = %v", captured["name"])
	}
	if captured["prompt"] != "a long enough prompt body" {
		t.Errorf("body.prompt = %v", captured["prompt"])
	}
	if captured["parent_id"] != "p1" {
		t.Errorf("body.parent_id = %v", captured["parent_id"])
	}
	if captured["sort_order"] != float64(3) {
		t.Errorf("body.sort_order = %v", captured["sort_order"])
	}
	if !strings.Contains(stdout, "Created topic new") {
		t.Errorf("stdout = %q", stdout)
	}
}

func TestTopicsCreatePromptFile(t *testing.T) {
	var captured map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&captured)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"new"}`))
	}))
	defer srv.Close()
	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "tok"})

	dir := t.TempDir()
	pf := filepath.Join(dir, "prompt.txt")
	if err := os.WriteFile(pf, []byte("body from file with enough length"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	code, _, stderr := runTopicsCmd(t, nil,
		"create",
		"--name", "Foo",
		"--prompt-file", pf,
	)
	if code != 0 {
		t.Fatalf("code = %d, stderr=%s", code, stderr)
	}
	if captured["prompt"] != "body from file with enough length" {
		t.Errorf("body.prompt = %v", captured["prompt"])
	}
}

func TestTopicsCreatePromptFromStdin(t *testing.T) {
	var captured map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&captured)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"new"}`))
	}))
	defer srv.Close()
	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "tok"})

	in := strings.NewReader("stdin prompt body here")
	code, _, stderr := runTopicsCmd(t, in,
		"create",
		"--name", "Foo",
		"--prompt-file", "-",
	)
	if code != 0 {
		t.Fatalf("code = %d, stderr=%s", code, stderr)
	}
	if captured["prompt"] != "stdin prompt body here" {
		t.Errorf("body.prompt = %v", captured["prompt"])
	}
}

func TestTopicsCreateRequiresNameAndPrompt(t *testing.T) {
	withConfig(t, cliConfig{ServerURL: "http://example", Token: "tok"})

	code, _, stderr := runTopicsCmd(t, nil, "create")
	if code != 2 {
		t.Errorf("code = %d, want 2", code)
	}
	if !strings.Contains(stderr, "--name") {
		t.Errorf("stderr = %q", stderr)
	}

	code, _, stderr = runTopicsCmd(t, nil, "create", "--name", "X")
	if code != 2 {
		t.Errorf("code without prompt = %d, want 2", code)
	}
	if !strings.Contains(stderr, "--prompt") {
		t.Errorf("stderr = %q", stderr)
	}
}

func TestTopicsUpdateSendsOnlyProvidedFields(t *testing.T) {
	var captured map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut || r.URL.Path != "/api/topics/t1" {
			t.Errorf("got %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewDecoder(r.Body).Decode(&captured)
		_, _ = w.Write([]byte(`{"id":"t1","name":"Renamed"}`))
	}))
	defer srv.Close()
	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "tok"})

	code, stdout, stderr := runTopicsCmd(t, nil, "update", "t1", "--name", "Renamed")
	if code != 0 {
		t.Fatalf("code = %d, stderr=%s", code, stderr)
	}
	if captured["name"] != "Renamed" {
		t.Errorf("body.name = %v", captured["name"])
	}
	if _, ok := captured["prompt"]; ok {
		t.Errorf("prompt should not be in body: %v", captured["prompt"])
	}
	if _, ok := captured["parent_id"]; ok {
		t.Errorf("parent_id should not be in body: %v", captured["parent_id"])
	}
	if !strings.Contains(stdout, "Updated topic t1") {
		t.Errorf("stdout = %q", stdout)
	}
}

func TestTopicsUpdateNoParentSendsNull(t *testing.T) {
	var captured map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&captured)
		_, _ = w.Write([]byte(`{"id":"t1"}`))
	}))
	defer srv.Close()
	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "tok"})

	code, _, stderr := runTopicsCmd(t, nil, "update", "t1", "--no-parent")
	if code != 0 {
		t.Fatalf("code = %d, stderr=%s", code, stderr)
	}
	val, present := captured["parent_id"]
	if !present {
		t.Fatalf("parent_id missing from body: %+v", captured)
	}
	if val != nil {
		t.Errorf("parent_id = %v, want null", val)
	}
}

func TestTopicsUpdateParentAndNoParentConflict(t *testing.T) {
	withConfig(t, cliConfig{ServerURL: "http://example", Token: "tok"})
	code, _, stderr := runTopicsCmd(t, nil, "update", "t1", "--parent", "p", "--no-parent")
	if code != 2 {
		t.Errorf("code = %d, want 2", code)
	}
	if !strings.Contains(stderr, "mutually exclusive") {
		t.Errorf("stderr = %q", stderr)
	}
}

func TestTopicsUpdateRejectsBlankParent(t *testing.T) {
	// Guards against scripted callers passing `--parent "$VAR"` where $VAR is
	// unset, which would otherwise silently send parent_id:"" and reparent
	// the topic to root.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("server should not be called, got %s %s", r.Method, r.URL.Path)
	}))
	defer srv.Close()
	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "tok"})

	code, _, stderr := runTopicsCmd(t, nil, "update", "t1", "--parent", "")
	if code != 2 {
		t.Fatalf("code = %d, want 2", code)
	}
	if !strings.Contains(stderr, "--parent requires a topic ID") {
		t.Errorf("stderr = %q, want it to reject blank --parent", stderr)
	}
}

func TestTopicsDeleteWithYes(t *testing.T) {
	var sawDelete bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete && r.URL.Path == "/api/topics/t1" {
			sawDelete = true
			w.WriteHeader(http.StatusNoContent)
			return
		}
		t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
	}))
	defer srv.Close()
	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "tok"})

	code, stdout, stderr := runTopicsCmd(t, nil, "delete", "t1", "--yes")
	if code != 0 {
		t.Fatalf("code = %d, stderr=%s", code, stderr)
	}
	if !sawDelete {
		t.Error("server didn't receive DELETE")
	}
	if !strings.Contains(stdout, "Deleted topic t1") {
		t.Errorf("stdout = %q", stdout)
	}
}

func TestTopicsDeleteConfirmsViaStdin(t *testing.T) {
	var sawDelete bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			sawDelete = true
			w.WriteHeader(http.StatusNoContent)
		}
	}))
	defer srv.Close()
	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "tok"})

	code, _, _ := runTopicsCmd(t, strings.NewReader("yes\n"), "delete", "t1")
	if code != 0 {
		t.Fatalf("code = %d", code)
	}
	if !sawDelete {
		t.Error("expected DELETE after confirmation")
	}
}

func TestTopicsDeleteAbortsOnNo(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("server should not have been called")
	}))
	defer srv.Close()
	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "tok"})

	code, stdout, _ := runTopicsCmd(t, strings.NewReader("no\n"), "delete", "t1")
	if code != 1 {
		t.Errorf("code = %d, want 1 (aborted)", code)
	}
	if !strings.Contains(stdout, "Aborted") {
		t.Errorf("stdout = %q", stdout)
	}
}

func TestTopicsMoveSendsBody(t *testing.T) {
	var captured map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut || r.URL.Path != "/api/topics/t1/move" {
			t.Errorf("got %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewDecoder(r.Body).Decode(&captured)
		_, _ = w.Write([]byte(`{"id":"t1","parent_id":"p","sort_order":2}`))
	}))
	defer srv.Close()
	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "tok"})

	code, stdout, stderr := runTopicsCmd(t, nil, "move", "t1", "--parent", "p", "--position", "2")
	if code != 0 {
		t.Fatalf("code = %d, stderr=%s", code, stderr)
	}
	if captured["parent_id"] != "p" {
		t.Errorf("body.parent_id = %v", captured["parent_id"])
	}
	if captured["position"] != float64(2) {
		t.Errorf("body.position = %v", captured["position"])
	}
	if !strings.Contains(stdout, "Moved topic t1") {
		t.Errorf("stdout = %q", stdout)
	}
}

func TestTopicsMoveDefaultsToAppend(t *testing.T) {
	var captured map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&captured)
		_, _ = w.Write([]byte(`{"id":"t1"}`))
	}))
	defer srv.Close()
	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "tok"})

	code, _, _ := runTopicsCmd(t, nil, "move", "t1", "--parent", "p")
	if code != 0 {
		t.Fatalf("code = %d", code)
	}
	if _, present := captured["position"]; present {
		t.Errorf("position should be omitted, got %v", captured["position"])
	}
}

func TestTopicsMoveRequiresParentOrNoParent(t *testing.T) {
	// Server should never be hit when the CLI rejects the args; failing the
	// test if it is guards against regressions where a missing --parent
	// silently reparents the topic to root.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("server should not be called, got %s %s", r.Method, r.URL.Path)
	}))
	defer srv.Close()
	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "tok"})

	code, _, stderr := runTopicsCmd(t, nil, "move", "t1", "--position", "0")
	if code != 2 {
		t.Fatalf("code = %d, want 2", code)
	}
	if !strings.Contains(stderr, "--parent ID or --no-parent is required") {
		t.Errorf("stderr = %q, want it to mention the missing flag", stderr)
	}
}

func TestTopicsMoveRejectsBothParentAndNoParent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("server should not be called, got %s %s", r.Method, r.URL.Path)
	}))
	defer srv.Close()
	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "tok"})

	code, _, stderr := runTopicsCmd(t, nil, "move", "t1", "--parent", "p", "--no-parent")
	if code != 2 {
		t.Fatalf("code = %d, want 2", code)
	}
	if !strings.Contains(stderr, "mutually exclusive") {
		t.Errorf("stderr = %q, want it to mention mutual exclusion", stderr)
	}
}

func TestTopicsMoveRejectsBlankParent(t *testing.T) {
	// Guards against scripted callers passing `--parent "$VAR"` where $VAR is
	// unset, which would otherwise silently send parent_id:"" and reparent
	// the topic to root despite the explicit-destination requirement.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("server should not be called, got %s %s", r.Method, r.URL.Path)
	}))
	defer srv.Close()
	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "tok"})

	code, _, stderr := runTopicsCmd(t, nil, "move", "t1", "--parent", "")
	if code != 2 {
		t.Fatalf("code = %d, want 2", code)
	}
	if !strings.Contains(stderr, "--parent requires a topic ID") {
		t.Errorf("stderr = %q, want it to reject blank --parent", stderr)
	}
}

func TestTopicsMoveNoParentSendsEmptyParent(t *testing.T) {
	var captured map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&captured)
		_, _ = w.Write([]byte(`{"id":"t1"}`))
	}))
	defer srv.Close()
	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "tok"})

	code, _, stderr := runTopicsCmd(t, nil, "move", "t1", "--no-parent")
	if code != 0 {
		t.Fatalf("code = %d, stderr=%s", code, stderr)
	}
	if v, ok := captured["parent_id"]; !ok || v != "" {
		t.Errorf("body.parent_id = %v (present=%v), want empty string", v, ok)
	}
}

func TestTopicsServerErrorsRenderedHumanFriendly(t *testing.T) {
	cases := []struct {
		name       string
		status     int
		respBody   string
		wantInErr  string
		wantInArgs []string
	}{
		{"unauthorized", http.StatusUnauthorized, `bad token`, "run gct login", []string{"list"}},
		{"forbidden", http.StatusForbidden, `admin only`, "admin permission required", []string{"create", "--name", "x", "--prompt", "this is long enough"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				http.Error(w, tc.respBody, tc.status)
			}))
			defer srv.Close()
			withConfig(t, cliConfig{ServerURL: srv.URL, Token: "tok"})

			code, _, stderr := runTopicsCmd(t, nil, tc.wantInArgs...)
			if code == 0 {
				t.Fatalf("expected non-zero exit, stderr=%s", stderr)
			}
			if !strings.Contains(stderr, tc.wantInErr) {
				t.Errorf("stderr = %q, want it to contain %q", stderr, tc.wantInErr)
			}
		})
	}
}

func TestTopicsServerFlagOverridesConfig(t *testing.T) {
	called := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		_, _ = w.Write([]byte(`{"topics":[]}`))
	}))
	defer srv.Close()
	// Config points at a bad URL — --server should win.
	withConfig(t, cliConfig{ServerURL: "http://127.0.0.1:1", Token: "tok"})

	code, _, stderr := runTopicsCmd(t, nil, "list", "--server", srv.URL)
	if code != 0 {
		t.Fatalf("code = %d, stderr=%s", code, stderr)
	}
	if !called {
		t.Error("--server override didn't reach the test server")
	}
}

func TestTopicsTokenFlagOverridesConfig(t *testing.T) {
	var seenAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenAuth = r.Header.Get("Authorization")
		_, _ = w.Write([]byte(`{"topics":[]}`))
	}))
	defer srv.Close()
	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "old"})

	code, _, stderr := runTopicsCmd(t, nil, "list", "--token", "new-token")
	if code != 0 {
		t.Fatalf("code = %d, stderr=%s", code, stderr)
	}
	if seenAuth != "Bearer new-token" {
		t.Errorf("auth = %q, want Bearer new-token", seenAuth)
	}
}

func TestTopicsNotLoggedIn(t *testing.T) {
	withConfig(t, cliConfig{ServerURL: "http://example", Token: ""})
	code, _, stderr := runTopicsCmd(t, nil, "list")
	if code != 1 {
		t.Errorf("code = %d, want 1", code)
	}
	if !strings.Contains(stderr, "not logged in") {
		t.Errorf("stderr = %q", stderr)
	}
}

func TestTopicsUnknownSubcommand(t *testing.T) {
	withConfig(t, cliConfig{ServerURL: "http://example", Token: "tok"})
	code, _, stderr := runTopicsCmd(t, nil, "frobnicate")
	if code != 2 {
		t.Errorf("code = %d, want 2", code)
	}
	if !strings.Contains(stderr, "unknown subcommand") {
		t.Errorf("stderr = %q", stderr)
	}
}

func TestTopicsHelp(t *testing.T) {
	withConfig(t, cliConfig{ServerURL: "http://example", Token: "tok"})
	code, stdout, _ := runTopicsCmd(t, nil, "--help")
	if code != 0 {
		t.Errorf("code = %d, want 0", code)
	}
	if !strings.Contains(stdout, "gct topics") {
		t.Errorf("help body = %q", stdout)
	}
}

// runExercisesCmd is the exercises-subcommand counterpart to runTopicsCmd.
func runExercisesCmd(t *testing.T, args ...string) (int, string, string) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	all := append([]string{"exercises"}, args...)
	code := run(all, nil, &stdout, &stderr)
	return code, stdout.String(), stderr.String()
}

func TestExercisesGenerateSendsPostAndSummary(t *testing.T) {
	var captured map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/exercises" {
			t.Errorf("got %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer tok" {
			t.Errorf("Authorization = %q", got)
		}
		_ = json.NewDecoder(r.Body).Decode(&captured)
		_, _ = w.Write([]byte(`{"exercises":[
			{"id":"e1","topic_id":"t1","exercise_json":{"english_hint":"hi","correct_german_sentence":"Hallo"}},
			{"id":"e2","topic_id":"t1","exercise_json":{"english_hint":"bye","correct_german_sentence":"Tschüss"}}
		]}`))
	}))
	defer srv.Close()
	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "tok"})

	code, stdout, stderr := runExercisesCmd(t, "generate", "t1")
	if code != 0 {
		t.Fatalf("code = %d, stderr=%s", code, stderr)
	}
	if captured["topic_id"] != "t1" {
		t.Errorf("body.topic_id = %v", captured["topic_id"])
	}
	if !strings.Contains(stdout, "Generated 2 exercises for topic t1") {
		t.Errorf("stdout = %q", stdout)
	}
}

func TestExercisesGenerateJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"exercises":[{"id":"e1","topic_id":"t1","exercise_json":{"english_hint":"hi"}}]}`))
	}))
	defer srv.Close()
	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "tok"})

	code, stdout, stderr := runExercisesCmd(t, "generate", "t1", "--json")
	if code != 0 {
		t.Fatalf("code = %d, stderr=%s", code, stderr)
	}
	var got []map[string]any
	if err := json.Unmarshal([]byte(stdout), &got); err != nil {
		t.Fatalf("output not valid JSON: %v\noutput=%s", err, stdout)
	}
	if len(got) != 1 || got[0]["id"] != "e1" {
		t.Errorf("unexpected JSON: %+v", got)
	}
}

func TestExercisesGenerateRequiresTopicID(t *testing.T) {
	withConfig(t, cliConfig{ServerURL: "http://example", Token: "tok"})
	code, _, stderr := runExercisesCmd(t, "generate")
	if code != 2 {
		t.Errorf("code = %d, want 2", code)
	}
	if !strings.Contains(stderr, "topic id required") {
		t.Errorf("stderr = %q", stderr)
	}
}

func TestExercisesGenerateSurfaces404(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "TOPIC_NOT_FOUND", http.StatusNotFound)
	}))
	defer srv.Close()
	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "tok"})

	code, _, stderr := runExercisesCmd(t, "generate", "missing")
	if code == 0 {
		t.Fatalf("expected non-zero exit, stderr=%s", stderr)
	}
	if !strings.Contains(stderr, "TOPIC_NOT_FOUND") {
		t.Errorf("stderr = %q, want TOPIC_NOT_FOUND mention", stderr)
	}
}

func TestExercisesGenerateSurfaces500BodyText(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "upstream exploded", http.StatusInternalServerError)
	}))
	defer srv.Close()
	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "tok"})

	code, _, stderr := runExercisesCmd(t, "generate", "t1")
	if code == 0 {
		t.Fatalf("expected non-zero exit")
	}
	if !strings.Contains(stderr, "upstream exploded") {
		t.Errorf("stderr = %q, want body text 'upstream exploded'", stderr)
	}
}

func TestExercisesGenerateUnauthorized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "token revoked", http.StatusUnauthorized)
	}))
	defer srv.Close()
	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "tok"})

	code, _, stderr := runExercisesCmd(t, "generate", "t1")
	if code != 1 {
		t.Errorf("code = %d, want 1", code)
	}
	if !strings.Contains(stderr, "run gct login") {
		t.Errorf("stderr = %q, want login hint", stderr)
	}
}

func TestExercisesGenerateWatchPollsUntilThreshold(t *testing.T) {
	// Shrink the polling cadence so this test runs in milliseconds rather
	// than the production 25-second worst case. Restore after the test so
	// later cases still see real values.
	origInterval, origAttempts, origThresh := watchInterval, watchMaxAttempts, watchThreshold
	watchInterval = 1 * time.Millisecond
	watchMaxAttempts = 5
	watchThreshold = 3
	t.Cleanup(func() {
		watchInterval = origInterval
		watchMaxAttempts = origAttempts
		watchThreshold = origThresh
	})

	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		// First two responses return below threshold; third hits it.
		if n < 3 {
			_, _ = w.Write([]byte(`{"exercises":[{"id":"e1","topic_id":"t1"}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"exercises":[
			{"id":"e1","topic_id":"t1"},
			{"id":"e2","topic_id":"t1"},
			{"id":"e3","topic_id":"t1"}
		]}`))
	}))
	defer srv.Close()
	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "tok"})

	code, stdout, stderr := runExercisesCmd(t, "generate", "t1", "--watch")
	if code != 0 {
		t.Fatalf("code = %d, stderr=%s", code, stderr)
	}
	if got := calls.Load(); got != 3 {
		t.Errorf("server calls = %d, want 3", got)
	}
	if !strings.Contains(stdout, "Generated 3 exercises") {
		t.Errorf("stdout = %q", stdout)
	}
	if !strings.Contains(stderr, "retrying") {
		t.Errorf("expected retry hint on stderr, got %q", stderr)
	}
}

func TestExercisesGenerateWatchGivesUpAfterMaxAttempts(t *testing.T) {
	origInterval, origAttempts, origThresh := watchInterval, watchMaxAttempts, watchThreshold
	watchInterval = 1 * time.Millisecond
	watchMaxAttempts = 3
	watchThreshold = 10
	t.Cleanup(func() {
		watchInterval = origInterval
		watchMaxAttempts = origAttempts
		watchThreshold = origThresh
	})

	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_, _ = w.Write([]byte(`{"exercises":[{"id":"e1","topic_id":"t1"}]}`))
	}))
	defer srv.Close()
	withConfig(t, cliConfig{ServerURL: srv.URL, Token: "tok"})

	code, stdout, stderr := runExercisesCmd(t, "generate", "t1", "--watch")
	if code != 0 {
		t.Fatalf("code = %d, stderr=%s", code, stderr)
	}
	if got := calls.Load(); got != int32(watchMaxAttempts) {
		t.Errorf("server calls = %d, want %d", got, watchMaxAttempts)
	}
	// Final summary still printed even though threshold was never hit.
	if !strings.Contains(stdout, "Generated 1 exercises") {
		t.Errorf("stdout = %q", stdout)
	}
}

func TestExercisesGenerateNotLoggedIn(t *testing.T) {
	withConfig(t, cliConfig{ServerURL: "http://example", Token: ""})
	code, _, stderr := runExercisesCmd(t, "generate", "t1")
	if code != 1 {
		t.Errorf("code = %d, want 1", code)
	}
	if !strings.Contains(stderr, "not logged in") {
		t.Errorf("stderr = %q", stderr)
	}
}

func TestExercisesUnknownSubcommand(t *testing.T) {
	withConfig(t, cliConfig{ServerURL: "http://example", Token: "tok"})
	code, _, stderr := runExercisesCmd(t, "frobnicate")
	if code != 2 {
		t.Errorf("code = %d, want 2", code)
	}
	if !strings.Contains(stderr, "unknown subcommand") {
		t.Errorf("stderr = %q", stderr)
	}
}

func TestExercisesHelp(t *testing.T) {
	code, stdout, _ := runExercisesCmd(t, "--help")
	if code != 0 {
		t.Errorf("code = %d", code)
	}
	if !strings.Contains(stdout, "gct exercises") {
		t.Errorf("help body = %q", stdout)
	}
}

func TestVersionCmd(t *testing.T) {
	for _, arg := range []string{"version", "--version", "-v"} {
		t.Run(arg, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			code := run([]string{arg}, nil, &stdout, &stderr)
			if code != 0 {
				t.Errorf("code = %d, stderr=%s", code, stderr.String())
			}
			out := stdout.String()
			if !strings.HasPrefix(out, "gct ") {
				t.Errorf("expected version line to start with 'gct ', got %q", out)
			}
			if !strings.Contains(out, version) {
				t.Errorf("expected version %q in output, got %q", version, out)
			}
			if !strings.Contains(out, runtime.Version()) {
				t.Errorf("expected Go runtime version in output, got %q", out)
			}
		})
	}
}

func TestPrintVersionWithCommit(t *testing.T) {
	orig := commit
	commit = "abcdef1"
	t.Cleanup(func() { commit = orig })

	var buf bytes.Buffer
	printVersion(&buf)
	if !strings.Contains(buf.String(), "commit abcdef1") {
		t.Errorf("expected commit in output, got %q", buf.String())
	}
}

