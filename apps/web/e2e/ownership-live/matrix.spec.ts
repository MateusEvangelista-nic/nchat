import { expect, test } from "@playwright/test";
import {
  action,
  api,
  client,
  confirm,
  fixture,
  preflight,
  request,
  role,
  type Kind,
} from "./fixtures";

// Baseline: A owner, B admin oldest, C/D members. Fixtures must be independently
// provisioned for each project and test; ages are checked against leave_preview.
for (const kind of ["group", "channel"] as Kind[]) {
  for (const scenario of [
    "multiple-owners",
    "oldest-admin",
    "oldest-member",
    "transfer",
    "admin-remove",
    "admin-denied",
    "member-denied",
  ]) {
    test(`${kind}/${scenario}`, async ({ browser }, info) => {
      const f = fixture(info, kind, scenario);
      const actor = scenario.startsWith("admin-") ? "B" : scenario === "member-denied" ? "C" : "A";
      const primary = await client(browser, kind, f, actor, info);
      const observer = await client(browser, kind, f, "D", info);
      const removed =
        scenario === "admin-remove" ? await client(browser, kind, f, "C", info) : undefined;
      try {
        const snapshot = await request(primary.page, `${api(kind, f.id)}/details`);
        expect(snapshot.status).toBe(200);
        expect(snapshot.data.data.ownership.enabled).toBe(true);
        const roles = snapshot.data.data.ownership.members;
        for (const [user, expected] of Object.entries({
          A: "owner",
          B: "admin",
          C: "member",
          D: "member",
        })) {
          expect(
            roles.find(
              (m: { user_id: string }) => m.user_id === f.users[user as keyof typeof f.users].id,
            )?.role,
          ).toBe(expected);
        }
        // Mobile and desktop use the same real UI. Capture composer preservation
        // across a cancelled transfer; no outbound request is mocked or aborted.
        const composer = primary.page.getByTestId("chat-composer-input");
        await expect(composer).toContainText("qa-1051 draft");
        if (scenario === "transfer") {
          await action(primary.page, f, "C", "Transferir minha propriedade");
          const dialog = primary.page.getByRole("dialog", { name: "Transferir minha propriedade" });
          await expect(dialog.getByRole("button", { name: "Cancelar", exact: true })).toBeFocused();
          await primary.page.keyboard.press("Escape");
          await expect(dialog).not.toBeVisible();
          await expect(composer).toContainText("qa-1051 draft");
          await action(primary.page, f, "C", "Transferir minha propriedade");
          await dialog.getByLabel("Meu papel", { exact: true }).selectOption("admin");
          await confirm(primary.page);
          await role(observer.page, kind, f, "C", "owner");
          await role(primary.page, kind, f, "A", "admin");
          await expect(composer).toContainText("qa-1051 draft");
        } else if (scenario === "admin-denied" || scenario === "member-denied") {
          const target = scenario === "admin-denied" ? "A" : "B";
          expect(
            await primary.page
              .getByLabel(`Ações de ${f.users[target].name}`, { exact: true })
              .count(),
          ).toBe(0);
          const forged = await request(
            primary.page,
            `${api(kind, f.id)}/members/${f.users[target].id}/role`,
            "PATCH",
            { role: "member" },
          );
          expect(forged.status).toBe(403);
          const after = await request(primary.page, `${api(kind, f.id)}/details`);
          expect(after.data.data.ownership.members).toEqual(roles);
        } else if (scenario === "admin-remove") {
          await action(primary.page, f, "C", "Remover");
          await primary.page
            .getByRole("dialog")
            .getByRole("button", { name: "Remover", exact: true })
            .click();
          await expect
            .poll(async () =>
              (
                await request(observer.page, `${api(kind, f.id)}/details`)
              ).data.data.ownership.members.some(
                (m: { user_id: string }) => m.user_id === f.users.C.id,
              ),
            )
            .toBe(false);
          await expect(
            observer.page.locator(".ownership-roster__row").filter({ hasText: f.users.C.name }),
          ).toHaveCount(0);
          expect((await request(removed!.page, `${api(kind, f.id)}/details`)).status).toBe(404);
          // #1092: the removed session must converge without F5 or a details refresh.
          await expect(removed!.page.getByTestId("chat-composer-input")).toHaveCount(0);
          await expect(removed!.page.getByText(/Você não faz mais parte/)).toBeVisible();
        } else {
          if (scenario === "multiple-owners") {
            await action(primary.page, f, "B", "Tornar proprietário");
            await confirm(primary.page);
            await role(observer.page, kind, f, "B", "owner");
          } else {
            if (scenario === "oldest-member") {
              await action(primary.page, f, "B", "Tornar membro");
              await confirm(primary.page);
            }
            const details = await request(primary.page, `${api(kind, f.id)}/details`);
            expect(details.data.data.ownership.leave_preview.successor_user_id).toBe(f.users.B.id);
          }
          await primary.page
            .getByRole("button", {
              name: kind === "group" ? "Sair do grupo" : "Sair do canal",
              exact: true,
            })
            .click();
          await confirm(primary.page);
          await role(observer.page, kind, f, "B", "owner");
          const denied = await request(primary.page, `${api(kind, f.id)}/details`);
          expect(denied.status).toBe(404);
        }
      } finally {
        await removed?.context.close();
        await primary.context.close();
        await observer.context.close();
        preflight();
      }
    });
  }
}
