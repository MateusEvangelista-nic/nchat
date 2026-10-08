#!/usr/bin/env python3
"""Run ownership suites sequentially. Never equate an empty/skipped suite with PASS.

Only test names, elapsed times and outcomes are exported: Go/psql diagnostics
can contain DSNs or SQL data and are deliberately excluded from the artifact.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
SUITES = (
    ("chat-service", "OWNERSHIP_TEST_DATABASE_URL", "^TestOwnership.*PostgreSQL$"),
    ("auth-service", "AUTH_TEST_DATABASE_URL", "^TestOwnershipAccountInvalidationPostgreSQL$"),
    ("admin-service", "ADMIN_TEST_DATABASE_URL", "^TestOwnershipAccountInvalidationPostgreSQL$"),
)


def validate_events(events, returncode):
    tests = [e for e in events if e.get("Test") and e.get("Action") == "run"]
    passed = {e["Test"] for e in events if e.get("Test") and e.get("Action") == "pass"}
    skipped = [e["Test"] for e in events if e.get("Test") and e.get("Action") == "skip"]
    failed = [e["Test"] for e in events if e.get("Test") and e.get("Action") == "fail"]
    package_pass = any(e.get("Action") == "pass" and not e.get("Test") for e in events)
    ok = bool(tests) and not skipped and not failed and returncode == 0 and package_pass
    ok = ok and all(e["Test"] in passed for e in tests)
    return {"result": "PASS" if ok else "FAIL", "executed": len(tests),
            "skipped": skipped, "failed": failed,
            "tests": [{"name": e["Test"], "result": "PASS" if e["Test"] in passed else "FAIL"}
                      for e in tests]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = {"sha": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "environment": "disposable PostgreSQL", "browser": "N/A", "suites": []}
    for service, variable, pattern in SUITES:
        dsn = os.environ.get(variable, "")
        parsed = urlparse(dsn)
        # All three suites reset schemas. Explicitly restrict every writer to the
        # same isolated database; no fallback to runtime/development credentials.
        if parsed.scheme not in ("postgres", "postgresql") or parsed.path != "/ownership_953_test":
            report["suites"].append({"service": service, "result": "BLOCKED",
                                     "reason": f"{variable} must select ownership_953_test"})
            break
        command = ["go", "test", "-json", "-count=1", "-parallel=1", "-timeout=10m",
                   "-run", pattern, "./internal/storage"]
        started = time.monotonic()
        try:
            proc = subprocess.run(command, cwd=ROOT / "services" / service,
                                  capture_output=True, text=True, timeout=660, check=False)
            events = []
            for line in proc.stdout.splitlines():
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
            item = validate_events(events, proc.returncode)
        except (subprocess.TimeoutExpired, OSError):
            item = {"result": "BLOCKED", "reason": "tool unavailable or timeout"}
        item.update(service=service, command=command, duration_seconds=round(time.monotonic() - started, 3))
        report["suites"].append(item)
        if item["result"] != "PASS":
            break
    report["result"] = "PASS" if len(report["suites"]) == len(SUITES) and all(
        s["result"] == "PASS" for s in report["suites"]) else (
        "BLOCKED" if any(s["result"] == "BLOCKED" for s in report["suites"]) else "FAIL")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"result": report["result"], "artifact": str(args.output)}))
    return 0 if report["result"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
