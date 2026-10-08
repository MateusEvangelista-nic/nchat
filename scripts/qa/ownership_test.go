package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestEvidenceRefusesFalsePass(t *testing.T) {
	for _, tc := range []struct {
		name   string
		events []testEvent
		exit   int
		want   string
	}{
		{"empty", nil, 0, "FAIL"},
		{"skip", []testEvent{{"run", "TestOwnership"}, {"skip", "TestOwnership"}, {"pass", ""}}, 0, "FAIL"},
		{"incomplete test", []testEvent{{"run", "TestOwnership"}, {"pass", ""}}, 0, "FAIL"},
		{"incomplete package", []testEvent{{"run", "TestOwnership"}, {"pass", "TestOwnership"}}, 0, "FAIL"},
		{"failed command", []testEvent{{"run", "TestOwnership"}, {"pass", "TestOwnership"}, {"pass", ""}}, 1, "FAIL"},
		{"failed child", []testEvent{{"run", "TestOwnership"}, {"fail", "TestOwnership/child"}, {"pass", "TestOwnership"}, {"pass", ""}}, 0, "FAIL"},
		{"complete", []testEvent{{"run", "TestOwnership"}, {"pass", "TestOwnership"}, {"pass", ""}}, 0, "PASS"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := validateEvents(tc.events, tc.exit); got.Result != tc.want {
				t.Fatalf("result=%s want=%s", got.Result, tc.want)
			}
		})
	}
}

func TestEvidenceDiscardsPrivateOutput(t *testing.T) {
	events := parseEvents([]byte("not JSON\n" + `{"Action":"run","Test":"TestOwnership","Output":"private-password"}` + "\n" + `{"Action":"pass","Test":"TestOwnership"}` + "\n" + `{"Action":"pass"}`))
	raw, err := json.Marshal(validateEvents(events, 0))
	if err != nil || strings.Contains(string(raw), "private-password") {
		t.Fatal("diagnostics leaked to evidence")
	}
}

func TestTestDSNRestriction(t *testing.T) {
	for _, dsn := range []string{"", "postgresql://qa@localhost/nchat", "postgresql://qa@localhost/another_test", "https://localhost/ownership_953_test", "host=localhost dbname=ownership_953_test", "postgresql://qa@localhost/ownership_953_test?dbname=nchat", "postgresql://qa@localhost/ownership_953_test?service=shared"} {
		if validTestDSN(dsn) {
			t.Fatal("accepted unsafe DSN")
		}
	}
	if !validTestDSN("postgresql://qa@localhost/ownership_953_test?sslmode=disable") {
		t.Fatal("refused isolated DSN")
	}
}

func TestAllWritersValidatedBeforeExecution(t *testing.T) {
	t.Setenv("OWNERSHIP_TEST_DATABASE_URL", "postgresql://qa@localhost/ownership_953_test")
	t.Setenv("AUTH_TEST_DATABASE_URL", "postgresql://qa:private-password@localhost/shared")
	t.Setenv("ADMIN_TEST_DATABASE_URL", "")
	output := filepath.Join(t.TempDir(), "report.json")
	if runPostgres(t.TempDir(), "test-sha", output) == nil {
		t.Fatal("unsafe writer accepted")
	}
	raw, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	var report postgresEvidence
	if json.Unmarshal(raw, &report) != nil || report.Result != "BLOCKED" || len(report.Suites) != 1 || report.Suites[0].Service != "auth-service" || report.Suites[0].Executed != 0 {
		t.Fatal("destructive suite started before validation")
	}
	if strings.Contains(string(raw), "private-password") {
		t.Fatal("DSN leaked")
	}
}

func testConfig() fixtureConfig {
	config := fixtureConfig{RunID: "qa-1051-test", Environment: "disposable", BaseURL: "http://127.0.0.1", Users: map[string]identity{}}
	for i, actor := range actors {
		config.Users[actor] = identity{ID: "00000000-0000-4000-8000-00000000000" + string(rune('a'+i)), Name: "qa-1051-test " + actor, Token: "private-token"}
	}
	return config
}

func TestFixtureConfigRestrictions(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*fixtureConfig)
	}{
		{"shared name", func(c *fixtureConfig) { u := c.Users["A"]; u.Name = "Shared User"; c.Users["A"] = u }},
		{"duplicate user", func(c *fixtureConfig) { c.Users["B"] = c.Users["A"] }},
		{"missing actor", func(c *fixtureConfig) { delete(c.Users, "D") }},
		{"missing token", func(c *fixtureConfig) { u := c.Users["A"]; u.Token = ""; c.Users["A"] = u }},
		{"production", func(c *fixtureConfig) { c.Environment = "nchat-prod" }},
		{"nonloopback", func(c *fixtureConfig) { c.BaseURL = "https://example.test" }},
		{"URL credentials", func(c *fixtureConfig) { c.BaseURL = "http://qa:secret@127.0.0.1" }},
		{"URL query", func(c *fixtureConfig) { c.BaseURL = "http://127.0.0.1?token=secret" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			config := testConfig()
			tc.change(&config)
			if validateConfig(config, "external-dsn") == nil {
				t.Fatal("invalid fixture config accepted")
			}
		})
	}
	if validateConfig(testConfig(), "external-dsn") != nil {
		t.Fatal("valid config refused")
	}
	if validateConfig(testConfig(), "") == nil {
		t.Fatal("absent DSN accepted")
	}
}

func TestHTTPRedirectAndErrorsArePrivate(t *testing.T) {
	var forwarded atomic.Bool
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { forwarded.Store(true) }))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, http.StatusFound) }))
	defer server.Close()
	config := testConfig()
	config.BaseURL = server.URL
	if err := api(qaHTTPClient(), config, "/private", "GET", nil, nil); err == nil || strings.Contains(err.Error(), "private-token") {
		t.Fatal("redirect accepted or secret exposed")
	}
	if forwarded.Load() {
		t.Fatal("request followed redirect")
	}
	failure := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte("private-token"))
	}))
	defer failure.Close()
	config.BaseURL = failure.URL
	if err := api(qaHTTPClient(), config, "/private", "GET", nil, nil); err == nil || strings.Contains(err.Error(), "private-token") {
		t.Fatal("HTTP body exposed")
	}
}

func TestPrivateManifest(t *testing.T) {
	root := t.TempDir()
	if f, err := privateManifest(root, filepath.Join(root, "unsafe.json")); err == nil {
		f.Close()
		t.Fatal("private manifest inside repository")
	}
	output := filepath.Join(t.TempDir(), "private.json")
	f, err := privateManifest(root, output)
	if err != nil {
		t.Fatal(err)
	}
	manifest := fixtureManifest{RunID: "qa-1051-test", Fixtures: map[string]liveFixture{"chromium/group/transfer": {ID: "test-id", Users: testConfig().Users}}}
	if saveManifest(f, manifest) != nil {
		t.Fatal("partial manifest not persisted")
	}
	if err = f.Close(); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(output)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("private file permissions incorrect")
	}
	raw, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	var got fixtureManifest
	if json.Unmarshal(raw, &got) != nil || got.Complete || len(got.Fixtures) != 1 {
		t.Fatal("partial manifest falsely complete")
	}
	if f, err := privateManifest(root, output); err == nil {
		f.Close()
		t.Fatal("existing private manifest overwritten")
	}
	link := filepath.Join(t.TempDir(), "repo-link")
	if err = os.Symlink(root, link); err != nil {
		t.Fatal(err)
	}
	if f, err := privateManifest(root, filepath.Join(link, "unsafe.json")); err == nil {
		f.Close()
		t.Fatal("symlink bypass accepted")
	}
}

func TestFixtureMembershipAndSQLBoundaries(t *testing.T) {
	config := testConfig()
	var members []member
	joined := map[string]string{}
	for _, actor := range actors {
		user := config.Users[actor]
		members = append(members, member{user.ID, user.Name})
		joined[actor] = "2020-01-01T00:00:00Z"
	}
	if validateMembers(config.Users, members) != nil {
		t.Fatal("valid membership refused")
	}
	members[3] = members[0]
	if validateMembers(config.Users, members) == nil {
		t.Fatal("duplicate membership accepted")
	}
	id := config.Users["A"].ID
	if _, err := seedSQL("group", id, config.Users, joined); err != nil {
		t.Fatal(err)
	}
	if _, err := seedSQL("private'; DROP SCHEMA chat;", id, config.Users, joined); err == nil {
		t.Fatal("identifier injection accepted")
	}
	if _, err := seedSQL("channel", id+"'", config.Users, joined); err == nil {
		t.Fatal("ID injection accepted")
	}
	joined["A"] = "2020-01-01'; DROP SCHEMA chat;"
	if _, err := seedSQL("channel", id, config.Users, joined); err == nil {
		t.Fatal("date injection accepted")
	}
}
