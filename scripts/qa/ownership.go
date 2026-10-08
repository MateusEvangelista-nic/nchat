// ownership is a standalone QA command, using only Go's standard library.
// Run from a repository checkout: go run scripts/qa/ownership.go <postgres|fixtures>.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type testEvent struct{ Action, Test string }
type testEvidence struct {
	Name   string `json:"name"`
	Result string `json:"result"`
}
type suiteEvidence struct {
	Result   string         `json:"result"`
	Service  string         `json:"service"`
	Reason   string         `json:"reason,omitempty"`
	Executed int            `json:"executed"`
	Skipped  []string       `json:"skipped"`
	Failed   []string       `json:"failed"`
	Tests    []testEvidence `json:"tests"`
	Command  []string       `json:"command,omitempty"`
	Duration float64        `json:"duration_seconds"`
}
type postgresEvidence struct {
	SHA         string          `json:"sha"`
	StartedAt   string          `json:"started_at"`
	Environment string          `json:"environment"`
	Browser     string          `json:"browser"`
	Suites      []suiteEvidence `json:"suites"`
	Result      string          `json:"result"`
}

func validateEvents(events []testEvent, exitCode int) suiteEvidence {
	result := suiteEvidence{Result: "FAIL", Skipped: []string{}, Failed: []string{}, Tests: []testEvidence{}}
	passed := make(map[string]bool)
	var ran []string
	packagePassed := false
	for _, event := range events {
		if event.Test == "" {
			if event.Action == "pass" {
				packagePassed = true
			}
			continue
		}
		switch event.Action {
		case "run":
			ran = append(ran, event.Test)
		case "pass":
			passed[event.Test] = true
		case "skip":
			result.Skipped = append(result.Skipped, event.Test)
		case "fail":
			result.Failed = append(result.Failed, event.Test)
		}
	}
	ok := len(ran) > 0 && len(result.Skipped) == 0 && len(result.Failed) == 0 && exitCode == 0 && packagePassed
	for _, name := range ran {
		status := "FAIL"
		if passed[name] {
			status = "PASS"
		} else {
			ok = false
		}
		result.Tests = append(result.Tests, testEvidence{name, status})
	}
	result.Executed = len(ran)
	if ok {
		result.Result = "PASS"
	}
	return result
}

func parseEvents(output []byte) []testEvent {
	var events []testEvent
	// Unmarshal into a small struct: SQL, DSNs and diagnostic Output are discarded.
	for _, line := range bytes.Split(output, []byte("\n")) {
		var event testEvent
		if json.Unmarshal(line, &event) == nil {
			events = append(events, event)
		}
	}
	return events
}

func validTestDSN(dsn string) bool {
	u, err := url.Parse(dsn)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Path != "/ownership_953_test" {
		return false
	}
	query, err := url.ParseQuery(u.RawQuery)
	if err != nil || query.Get("service") != "" {
		return false
	}
	// URI query parameters must not override the isolated database name.
	for _, database := range query["dbname"] {
		if database != "ownership_953_test" {
			return false
		}
	}
	return true
}

func command(ctx context.Context, dir string, name string, args []string, input string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	cmd.Stdin = strings.NewReader(input)
	// stderr may contain connection parameters: never forward it to the artifact.
	return cmd.Output()
}

func writeJSON(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0600)
}

func runPostgres(root, sha, output string) error {
	report := postgresEvidence{SHA: sha, StartedAt: time.Now().UTC().Format(time.RFC3339Nano), Environment: "disposable PostgreSQL", Browser: "N/A", Suites: []suiteEvidence{}, Result: "PASS"}
	suites := []struct{ service, variable, pattern string }{
		{"chat-service", "OWNERSHIP_TEST_DATABASE_URL", "^TestOwnership.*PostgreSQL$"},
		{"auth-service", "AUTH_TEST_DATABASE_URL", "^TestOwnershipAccountInvalidationPostgreSQL$"},
		{"admin-service", "ADMIN_TEST_DATABASE_URL", "^TestOwnershipAccountInvalidationPostgreSQL$"},
	}
	// Validate every destructive writer before running any suite.
	for _, suite := range suites {
		if !validTestDSN(os.Getenv(suite.variable)) {
			report.Suites = append(report.Suites, suiteEvidence{Service: suite.service, Result: "BLOCKED", Reason: suite.variable + " must select ownership_953_test"})
			report.Result = "BLOCKED"
			if err := writeJSON(output, report); err != nil {
				return errors.New("cannot write sanitized PostgreSQL report")
			}
			return errors.New("BLOCKED: all three DSNs must select ownership_953_test")
		}
	}
	for _, suite := range suites {
		args := []string{"test", "-json", "-count=1", "-parallel=1", "-timeout=10m", "-run", suite.pattern, "./internal/storage"}
		started := time.Now()
		ctx, cancel := context.WithTimeout(context.Background(), 660*time.Second)
		stdout, err := command(ctx, filepath.Join(root, "services", suite.service), "go", args, "")
		exitCode := 0
		var exitErr *exec.ExitError
		if err != nil {
			exitCode = 1
		}
		item := validateEvents(parseEvents(stdout), exitCode)
		if ctx.Err() != nil || (err != nil && !errors.As(err, &exitErr)) {
			item.Result, item.Reason = "BLOCKED", "tool unavailable or timeout"
		}
		cancel()
		item.Service, item.Command, item.Duration = suite.service, append([]string{"go"}, args...), time.Since(started).Seconds()
		report.Suites = append(report.Suites, item)
		if item.Result != "PASS" {
			report.Result = item.Result
			break
		}
	}
	if err := writeJSON(output, report); err != nil {
		return errors.New("cannot write sanitized PostgreSQL report")
	}
	if report.Result != "PASS" {
		return fmt.Errorf("%s: inspect sanitized PostgreSQL report", report.Result)
	}
	fmt.Println(`{"result":"PASS"}`)
	return nil
}

type identity struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Token string `json:"token"`
}
type fixtureConfig struct {
	RunID       string              `json:"runId"`
	Environment string              `json:"environment"`
	BaseURL     string              `json:"baseURL"`
	Users       map[string]identity `json:"users"`
}
type liveFixture struct {
	ID       string              `json:"id"`
	Users    map[string]identity `json:"users"`
	JoinedAt map[string]string   `json:"joinedAt"`
}
type fixtureManifest struct {
	RunID       string                 `json:"runId"`
	Environment string                 `json:"environment"`
	Fixtures    map[string]liveFixture `json:"fixtures"`
	Complete    bool                   `json:"complete"`
}

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
var runPattern = regexp.MustCompile(`^qa-1051-[a-z0-9-]{1,32}$`)
var actors = []string{"A", "B", "C", "D"}
var scenarios = []string{"multiple-owners", "oldest-admin", "oldest-member", "transfer", "admin-remove", "admin-denied", "member-denied"}

func validateConfig(config fixtureConfig, dsn string) error {
	u, err := url.Parse(config.BaseURL)
	if err != nil || !runPattern.MatchString(config.RunID) || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return errors.New("invalid run ID or QA URL")
	}
	if config.Environment != "nchat-dev" && !(config.Environment == "disposable" && u.Hostname() == "127.0.0.1") {
		return errors.New("select nchat-dev or disposable loopback")
	}
	if dsn == "" {
		return errors.New("fixture DSN required")
	}
	if len(config.Users) != 4 {
		return errors.New("four distinct QA users required")
	}
	seen := make(map[string]bool)
	for _, actor := range actors {
		user := config.Users[actor]
		id := strings.ToLower(user.ID)
		if !uuidPattern.MatchString(id) || seen[id] || !strings.HasPrefix(user.Name, config.RunID) || user.Token == "" {
			return errors.New("four distinct identities belonging to the QA run required")
		}
		seen[id] = true
	}
	return nil
}

func qaHTTPClient() *http.Client {
	return &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return errors.New("refusing to forward QA credentials through a redirect")
	}}
}

func api(client *http.Client, config fixtureConfig, path, method string, body any, target any) error {
	var input io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return errors.New("invalid QA API request")
		}
		input = bytes.NewReader(data)
	}
	request, err := http.NewRequest(method, strings.TrimRight(config.BaseURL, "/")+path, input)
	if err != nil {
		return errors.New("invalid QA API request")
	}
	request.Header.Set("Authorization", "Bearer "+config.Users["A"].Token)
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return errors.New("QA API request failed")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return errors.New("QA API refused request")
	}
	if target == nil {
		return nil
	}
	var envelope struct {
		Data json.RawMessage `json:"data"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&envelope) != nil || json.Unmarshal(envelope.Data, target) != nil {
		return errors.New("invalid QA API response")
	}
	return nil
}

type member struct {
	ID   string `json:"user_id"`
	Name string `json:"display_name"`
}

func validateMembers(users map[string]identity, members []member) error {
	if len(members) != 4 {
		return errors.New("unexpected QA membership")
	}
	expected := make(map[string]string)
	for _, user := range users {
		expected[strings.ToLower(user.ID)] = user.Name
	}
	for _, m := range members {
		name, found := expected[strings.ToLower(m.ID)]
		if !found || m.Name != name {
			return errors.New("QA identity mismatch")
		}
		delete(expected, strings.ToLower(m.ID))
	}
	if len(expected) > 0 {
		return errors.New("unexpected QA membership")
	}
	return nil
}

func privateManifest(root, output string) (*os.File, error) {
	absolute, err := filepath.Abs(output)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(filepath.Dir(absolute), 0700); err != nil {
		return nil, err
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(absolute))
	if err != nil {
		return nil, err
	}
	relative, err := filepath.Rel(root, filepath.Join(parent, filepath.Base(absolute)))
	if err != nil || (relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))) {
		return nil, errors.New("private output must be outside repository")
	}
	return os.OpenFile(absolute, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
}

func saveManifest(file *os.File, manifest fixtureManifest) error {
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	if _, err = file.Seek(0, 0); err != nil {
		return err
	}
	if _, err = file.Write(append(data, '\n')); err != nil {
		return err
	}
	if err = file.Truncate(int64(len(data) + 1)); err != nil {
		return err
	}
	return file.Sync()
}

func psql(root, dsn, input string, preflight bool) error {
	args := []string{"-X", "--no-password", "--dbname", dsn, "--set", "ON_ERROR_STOP=on"}
	if preflight {
		args = append(args, "-f", filepath.Join(root, "scripts/db/ownership/preflight.sql"))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := command(ctx, root, "psql", args, input); err != nil {
		return errors.New("QA seed or official preflight failed")
	}
	return nil
}

func seedSQL(kind, id string, users map[string]identity, joined map[string]string) (string, error) {
	table, column := "dm_members", "conversation_id"
	if kind == "channel" {
		table, column = "channel_members", "channel_id"
	} else if kind != "group" {
		return "", errors.New("invalid fixture kind")
	}
	if !uuidPattern.MatchString(id) {
		return "", errors.New("invalid fixture ID")
	}
	var sql strings.Builder
	sql.WriteString("BEGIN;\n")
	for _, actor := range actors {
		uid := users[actor].ID
		if !uuidPattern.MatchString(uid) {
			return "", errors.New("invalid QA identity")
		}
		date, err := time.Parse(time.RFC3339, joined[actor])
		if err != nil {
			return "", errors.New("invalid fixture seniority")
		}
		fmt.Fprintf(&sql, "DO $$ BEGIN UPDATE chat.%s SET joined_at='%s' WHERE %s='%s' AND user_id='%s'; IF NOT FOUND THEN RAISE EXCEPTION 'QA fixture missing'; END IF; END $$;\n", table, date.UTC().Format(time.RFC3339), column, id, uid)
	}
	sql.WriteString("COMMIT;\n")
	return sql.String(), nil
}

func provision(root, source, output, dsn string) error {
	raw, err := os.ReadFile(source)
	if err != nil {
		return errors.New("private credentials unavailable")
	}
	var config fixtureConfig
	if json.Unmarshal(raw, &config) != nil {
		return errors.New("invalid private credentials")
	}
	if err = validateConfig(config, dsn); err != nil {
		return err
	}
	file, err := privateManifest(root, output)
	if err != nil {
		return errors.New("private output must be new and outside repository")
	}
	defer file.Close()
	manifest := fixtureManifest{RunID: config.RunID, Environment: config.Environment, Fixtures: map[string]liveFixture{}}
	if err = saveManifest(file, manifest); err != nil {
		return errors.New("cannot save private manifest")
	}
	client := qaHTTPClient()
	for _, project := range []string{"chromium", "firefox", "chromium-390"} {
		for _, kind := range []string{"group", "channel"} {
			for _, scenario := range scenarios {
				key := project + "/" + kind + "/" + scenario
				name := fmt.Sprintf("%s-%d", config.RunID, len(manifest.Fixtures))
				invitees := []string{config.Users["B"].ID, config.Users["C"].ID, config.Users["D"].ID}
				var created struct {
					ID             string `json:"id"`
					ConversationID string `json:"conversation_id"`
				}
				collection, id := "dm", ""
				if kind == "group" {
					err = api(client, config, "/api/chat/dms/group", "POST", map[string]any{"participant_user_ids": invitees, "title": name}, &created)
					id = created.ConversationID
				} else {
					collection = "channels"
					err = api(client, config, "/api/chat/channels", "POST", map[string]any{"slug": name, "display_name": name, "type": "private", "initial_member_ids": invitees}, &created)
					id = created.ID
				}
				if err != nil {
					return err
				}
				if !uuidPattern.MatchString(id) {
					return errors.New("invalid created conversation ID")
				}
				f := liveFixture{ID: id, Users: config.Users, JoinedAt: map[string]string{}}
				manifest.Fixtures[key] = f
				if saveManifest(file, manifest) != nil {
					return errors.New("cannot save private manifest")
				}
				path := "/api/chat/" + collection + "/" + id
				var details struct {
					Ownership struct {
						Enabled bool     `json:"enabled"`
						Members []member `json:"members"`
					} `json:"ownership"`
				}
				if err = api(client, config, path+"/details", "GET", nil, &details); err != nil {
					return err
				}
				if !details.Ownership.Enabled {
					return errors.New("ownership disabled")
				}
				if err = validateMembers(config.Users, details.Ownership.Members); err != nil {
					return err
				}
				if err = api(client, config, path+"/members/"+config.Users["B"].ID+"/role", "PATCH", map[string]string{"role": "admin"}, nil); err != nil {
					return err
				}
				joined := map[string]string{"A": "2020-01-04T00:00:00Z", "B": "2020-01-01T00:00:00Z", "C": "2020-01-02T00:00:00Z", "D": "2020-01-03T00:00:00Z"}
				sql, err := seedSQL(kind, id, config.Users, joined)
				if err != nil {
					return err
				}
				if err = psql(root, dsn, sql, false); err != nil {
					return err
				}
				f.JoinedAt = joined
				manifest.Fixtures[key] = f
				if saveManifest(file, manifest) != nil {
					return errors.New("cannot save private manifest")
				}
				if err = psql(root, dsn, "", true); err != nil {
					return err
				}
			}
		}
	}
	manifest.Complete = true
	if saveManifest(file, manifest) != nil {
		return errors.New("cannot save private manifest")
	}
	fmt.Printf("{\"result\":\"PASS\",\"fixtures\":%d}\n", len(manifest.Fixtures))
	return nil
}

func run(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: ownership <postgres|fixtures> --output PATH")
	}
	flags := flag.NewFlagSet("ownership", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	output := flags.String("output", "", "report or private manifest path")
	credentials := flags.String("credentials", "", "external private QA credentials")
	if flags.Parse(args[1:]) != nil || *output == "" || flags.NArg() != 0 {
		return errors.New("invalid flags: --output PATH required")
	}
	if args[0] != "postgres" && args[0] != "fixtures" {
		return errors.New("select postgres or fixtures")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	rootBytes, err := command(ctx, "", "git", []string{"rev-parse", "--show-toplevel"}, "")
	if err != nil {
		return errors.New("run from a repository checkout")
	}
	root := strings.TrimSpace(string(rootBytes))
	if args[0] == "fixtures" {
		if *credentials == "" {
			return errors.New("--credentials PATH required")
		}
		return provision(root, *credentials, *output, os.Getenv("OWNERSHIP_QA_FIXTURE_DSN"))
	}
	sha, err := command(ctx, root, "git", []string{"rev-parse", "HEAD"}, "")
	if err != nil {
		return errors.New("cannot identify checkout SHA")
	}
	return runPostgres(root, strings.TrimSpace(string(sha)), *output)
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		// All errors reaching this boundary are fixed diagnostics, without HTTP bodies,
		// process output, SQL, tokens, DSNs or private credential fragments.
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
