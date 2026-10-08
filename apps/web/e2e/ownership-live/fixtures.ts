import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, type Browser, type Page, type TestInfo } from "@playwright/test";

export type Kind = "group" | "channel";
export type Actor = "A" | "B" | "C" | "D";
export interface Identity {
  id: string;
  name: string;
  token: string;
}
export interface LiveFixture {
  id: string;
  users: Record<Actor, Identity>;
  joinedAt: Record<Actor, string>;
}
interface Manifest {
  runId: string;
  complete: boolean;
  environment: "nchat-dev" | "disposable";
  fixtures: Record<string, LiveFixture>;
}

// A separately provisioned conversation for every project/kind/scenario.
// Never reuse a destructive fixture or fall back to a shared user's account.
export function fixture(info: TestInfo, kind: Kind, scenario: string): LiveFixture {
  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(process.env.OWNERSHIP_QA_FIXTURES!, "utf8")) as Manifest;
  } catch {
    throw new Error("BLOCKED: private fixture manifest missing or invalid");
  }
  expect(manifest.complete, "BLOCKED: provisioning incomplete").toBe(true);
  expect(manifest.runId).toMatch(/^qa-1051-[a-z0-9-]+$/);
  expect(manifest.environment).toBe(process.env.OWNERSHIP_QA_ENVIRONMENT);
  const entries = Object.values(manifest.fixtures);
  expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
  const entry = manifest.fixtures[`${info.project.name}/${kind}/${scenario}`];
  expect(entry, "BLOCKED: provision an isolated fixture for this scenario").toBeTruthy();
  expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(new Set(Object.values(entry.users).map((user) => user.id)).size).toBe(4);
  for (const user of Object.values(entry.users)) {
    expect(user.name.startsWith(manifest.runId)).toBe(true);
    expect(Boolean(user.token)).toBe(true);
  }
  for (const joined of Object.values(entry.joinedAt)) {
    expect(Number.isFinite(Date.parse(joined))).toBe(true);
  }
  expect(Date.parse(entry.joinedAt.B)).toBeLessThan(Date.parse(entry.joinedAt.C));
  expect(Date.parse(entry.joinedAt.B)).toBeLessThan(Date.parse(entry.joinedAt.D));
  return entry;
}

export function collection(kind: Kind) {
  return kind === "group" ? "dm" : "channels";
}
export function api(kind: Kind, id: string) {
  return `/api/chat/${collection(kind)}/${id}`;
}

export async function client(
  browser: Browser,
  kind: Kind,
  f: LiveFixture,
  actor: Actor,
  info: TestInfo,
) {
  const context = await browser.newContext({
    baseURL: process.env.OWNERSHIP_QA_BASE_URL,
    viewport: info.project.use.viewport,
  });
  await context.addInitScript(
    (token) => sessionStorage.setItem("nchat_at", token),
    f.users[actor].token,
  );
  const page = await context.newPage();
  await page.goto(`/chat/${collection(kind)}/${f.id}`);
  await page.getByTestId("chat-composer-input").fill("qa-1051 draft");
  await page
    .getByRole("button", {
      name: kind === "group" ? "Detalhes do grupo" : "Detalhes do canal",
      exact: true,
    })
    .click();
  await expect(page.locator(".ownership-roster")).toBeVisible();
  return { page, context };
}

export async function request(page: Page, path: string, method = "GET", body?: object) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(path, {
        method,
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem("nchat_at")}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json().catch(() => null);
      return { status: response.status, data };
    },
    { path, method, body },
  );
}

export async function role(page: Page, kind: Kind, f: LiveFixture, actor: Actor, expected: string) {
  await expect
    .poll(async () => {
      const result = await request(page, `${api(kind, f.id)}/details`);
      return result.data?.data?.ownership?.members?.find(
        (m: { user_id: string }) => m.user_id === f.users[actor].id,
      )?.role;
    })
    .toBe(expected);
  if (expected === "owner") {
    await expect(
      page
        .locator(".ownership-roster__row")
        .filter({ hasText: f.users[actor].name })
        .getByText("Proprietário", { exact: true }),
    ).toBeVisible();
  }
}

export async function action(page: Page, f: LiveFixture, actor: Actor, label: string) {
  await page.getByLabel(`Ações de ${f.users[actor].name}`, { exact: true }).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}

export async function confirm(page: Page, label = "Confirmar") {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: label, exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

export function preflight() {
  if (!process.env.OWNERSHIP_QA_PREFLIGHT_DSN)
    throw new Error("BLOCKED: official preflight DSN required");
  try {
    execFileSync(
      "psql",
      [
        "-X",
        "--no-password",
        "--dbname",
        process.env.OWNERSHIP_QA_PREFLIGHT_DSN,
        "-f",
        resolve("../../scripts/db/ownership/preflight.sql"),
      ],
      {
        env: process.env,
        stdio: "ignore",
        timeout: 30_000,
      },
    );
  } catch {
    throw new Error(
      "FAIL: official preflight failed or unavailable; inspect locally without publishing credentials",
    );
  }
}
