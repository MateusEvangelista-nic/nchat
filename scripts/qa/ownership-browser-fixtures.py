#!/usr/bin/env python3
"""Provision exclusive conversations through real APIs; seed only their seniority.

Input (private JSON): runId, environment, baseURL, users {A/B/C/D: {id,name,token}}.
Output contains credentials and MUST stay outside Git, with permissions 0600.
Requires OWNERSHIP_QA_FIXTURE_DSN for joined_at updates on just-created QA rows.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.request import Request, HTTPRedirectHandler, build_opener
from urllib.parse import urlparse
from uuid import UUID

ROOT = Path(__file__).resolve().parents[2]
SCENARIOS = ("multiple-owners", "oldest-admin", "oldest-member", "transfer",
             "admin-remove", "admin-denied", "member-denied")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("refusing to forward QA credentials through a redirect")


def provision(source, output):
    config = json.loads(source.read_text())
    run = config["runId"]
    if not re.fullmatch(r"qa-1051-[a-z0-9-]{1,32}", run):
        raise ValueError("invalid run ID")
    url = urlparse(config["baseURL"])
    if (url.scheme not in ("http", "https") or url.username or url.password or url.query
            or url.fragment or url.path not in ("", "/")):
        raise ValueError("invalid QA URL")
    if config["environment"] != "nchat-dev" and not (
            config["environment"] == "disposable" and url.hostname == "127.0.0.1"):
        raise ValueError("select nchat-dev or disposable loopback")
    dsn = os.environ.get("OWNERSHIP_QA_FIXTURE_DSN")
    if not dsn or output.resolve().is_relative_to(ROOT):
        raise ValueError("fixture DSN required; private output must be outside repository")
    if output.exists():
        raise ValueError("refusing to overwrite/reuse a fixture manifest")
    users = config["users"]
    if set(users) != {"A", "B", "C", "D"} or len({u["id"] for u in users.values()}) != 4:
        raise ValueError("four distinct QA users required")
    for user in users.values():
        UUID(user["id"])
        if not user["name"].startswith(run) or not user["token"]:
            raise ValueError("users must belong to this QA run")

    def api(path, method="GET", body=None):
        headers = {"Authorization": "Bearer " + users["A"]["token"],
                   "Content-Type": "application/json"}
        request = Request(config["baseURL"].rstrip("/") + path, method=method,
                          headers=headers, data=json.dumps(body).encode() if body else None)
        with build_opener(NoRedirect()).open(request, timeout=30) as response:
            return json.load(response) if response.status != 204 else None

    result = {"runId": run, "environment": config["environment"], "fixtures": {}, "complete": False}
    output.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation and restrictive permissions before any credential write.
    with output.open("x", opener=lambda path, flags: os.open(path, flags, 0o600)) as manifest:
        for project in ("chromium", "firefox", "chromium-390"):
            for kind in ("group", "channel"):
                for scenario in SCENARIOS:
                    key = f"{project}/{kind}/{scenario}"
                    name = f"{run}-{len(result['fixtures'])}"
                    invitees = [users[actor]["id"] for actor in ("B", "C", "D")]
                    if kind == "group":
                        created = api("/api/chat/dms/group", "POST", {"participant_user_ids": invitees, "title": name})
                        conversation = str(UUID(created["data"]["conversation_id"]))
                        collection, table, column = "dm", "dm_members", "conversation_id"
                    else:
                        created = api("/api/chat/channels", "POST", {"slug": name, "display_name": name,
                                      "type": "private", "initial_member_ids": invitees})
                        conversation = str(UUID(created["data"]["id"]))
                        collection, table, column = "channels", "channel_members", "channel_id"
                    result["fixtures"][key] = {"id": conversation, "users": users, "joinedAt": {}}
                    manifest.seek(0)
                    json.dump(result, manifest, indent=2)
                    manifest.truncate()
                    manifest.flush()
                    path = f"/api/chat/{collection}/{conversation}"
                    details = api(path + "/details")["data"]
                    actual = details["ownership"]["members"]
                    if not details["ownership"]["enabled"] or {m["user_id"] for m in actual} != {u["id"] for u in users.values()}:
                        raise ValueError("unexpected membership or disabled ownership")
                    for member in actual:
                        expected = next(u["name"] for u in users.values() if u["id"] == member["user_id"])
                        if member["display_name"] != expected:
                            raise ValueError("identity mismatch: refusing QA seed")
                    api(path + "/members/" + users["B"]["id"] + "/role", "PATCH", {"role": "admin"})
                    joined = {"A": "2020-01-04T00:00:00Z", "B": "2020-01-01T00:00:00Z",
                              "C": "2020-01-02T00:00:00Z", "D": "2020-01-03T00:00:00Z"}
                    # Identifiers are constants; all SQL values are validated UUIDs
                    # or fixed dates. No SQL or account-wide mutation is accepted.
                    sql = "BEGIN;\n"
                    for actor, date in joined.items():
                        uid = str(UUID(users[actor]["id"]))
                        sql += (f"DO $$ BEGIN UPDATE chat.{table} SET joined_at='{date}' WHERE {column}='{conversation}' "
                                f"AND user_id='{uid}'; IF NOT FOUND THEN RAISE EXCEPTION 'QA fixture missing'; END IF; END $$;\n")
                    sql += "COMMIT;\n"
                    subprocess.run(["psql", "-X", "--no-password", "--dbname", dsn,
                                    "--set", "ON_ERROR_STOP=on"], input=sql, text=True,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=30)
                    result["fixtures"][key] = {"id": conversation, "users": users, "joinedAt": joined}
                    manifest.seek(0)
                    json.dump(result, manifest, indent=2)
                    manifest.truncate()
                    manifest.flush()
                    subprocess.run(["psql", "-X", "--no-password", "--dbname", dsn, "-f",
                                    str(ROOT / "scripts/db/ownership/preflight.sql")],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=30)
        result["complete"] = True
        manifest.seek(0)
        json.dump(result, manifest, indent=2)
        manifest.truncate()
    print(json.dumps({"result": "PASS", "fixtures": len(result["fixtures"])}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--credentials", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        provision(args.credentials, args.output)
    except (KeyError, ValueError, OSError, subprocess.SubprocessError):
        # Never print HTTP bodies, connection parameters, tokens or SQL here.
        print("BLOCKED: fixture provisioning failed; private partial manifest retained", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
