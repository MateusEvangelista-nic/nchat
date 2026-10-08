import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";

export default class OwnershipReporter implements Reporter {
  private rows: object[] = [];
  private failed = false;
  private skipped = false;
  onTestEnd(test: TestCase, result: TestResult) {
    const status =
      result.status === "passed" ? "PASS" : result.status === "skipped" ? "BLOCKED" : "FAIL";
    this.failed ||= status !== "PASS";
    this.skipped ||= status === "BLOCKED";
    this.rows.push({
      scenario: test.title,
      browser: test.parent.project()?.name,
      duration_ms: result.duration,
      result: status,
    });
  }
  onEnd(result: FullResult) {
    const path = process.env.OWNERSHIP_QA_REPORT ?? "/tmp/nchat-1051-browser.json";
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify(
        {
          sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
          environment: process.env.OWNERSHIP_QA_ENVIRONMENT,
          finished_at: new Date().toISOString(),
          result:
            this.skipped || this.rows.length !== 42
              ? "BLOCKED"
              : this.failed || result.status !== "passed"
                ? "FAIL"
                : "PASS",
          tests: this.rows,
        },
        null,
        2,
      ) + "\n",
    );
  }
}
