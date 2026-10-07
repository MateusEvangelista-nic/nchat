import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../lib/api";
import OwnershipRoster from "./OwnershipRoster";
import {
  assignConversationRole,
  parseOwnership,
  transferConversationOwnership,
  type OwnershipDetails,
  type OwnershipMember,
} from "./ownershipApi";

vi.mock("./ownershipApi", async (original) => ({
  ...(await original<typeof import("./ownershipApi")>()),
  assignConversationRole: vi.fn(),
  leaveOwnedConversation: vi.fn(),
  transferConversationOwnership: vi.fn(),
}));

const facts = (): OwnershipDetails => ({
  enabled: true,
  capabilities: { addMembers: true, manageRoles: true, editMetadata: true, leave: true },
  leavePreview: { lastOwner: true, blocked: false, successorUserId: "b" },
  members: [
    {
      userId: "a",
      displayName: "Alice",
      role: "owner",
      actions: { remove: false, assignRole: false, transfer: true },
    },
    {
      userId: "b",
      displayName: "Bruno",
      role: "admin",
      actions: { remove: true, assignRole: true, transfer: true },
    },
  ],
});
const renderRoster = (ownership = facts()) => {
  const reload = vi.fn();
  const onRemove = vi.fn();
  const view = render(
    <OwnershipRoster
      kind="group"
      id="group"
      workspaceId="workspace"
      currentUserId="a"
      presence={{ covered: true, entries: new Map() }}
      ownership={ownership}
      reload={reload}
      onAdd={vi.fn()}
      onRemove={onRemove}
    />,
  );
  return { reload, onRemove, ...view };
};

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() {
      this.removeAttribute("open");
    },
  });
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(assignConversationRole).mockResolvedValue(undefined);
  vi.mocked(transferConversationOwnership).mockResolvedValue(undefined);
});

async function openTransfer() {
  await userEvent.click(screen.getByLabelText("Ações de Alice"));
  await userEvent.click(screen.getByRole("menuitem", { name: "Transferir minha propriedade" }));
}

describe("ownership roster", () => {
  it("shares badges, self, alphabetical ownership ordering and the central avatar", async () => {
    const ownership = facts();
    ownership.capabilities = {
      addMembers: false,
      manageRoles: false,
      editMetadata: false,
      leave: false,
    };
    const identities: Array<Pick<OwnershipMember, "userId" | "displayName" | "role">> = [
      { userId: "owner-z", displayName: "Owner Z", role: "owner" },
      { userId: "member-b", displayName: "Member B", role: "member" },
      { userId: "a", displayName: "Current", role: "member" },
      { userId: "admin", displayName: "Admin C", role: "admin" },
      { userId: "owner-a", displayName: "Owner Á", role: "owner" },
      { userId: "member-a", displayName: "Member A", role: "member" },
    ];
    ownership.members = identities.map((member) => ({
      ...member,
      actions: { remove: false, assignRole: false, transfer: false },
    }));
    const original = ownership.members.map((member) => member.userId);
    const { container, rerender } = renderRoster(ownership);
    const names = () =>
      screen
        .getAllByRole("listitem")
        .map((row) => row.querySelector(".ownership-roster__name")?.textContent?.trim());
    expect(names()).toEqual(["Current [Você]", "Owner Á", "Owner Z", "Admin C", "Member A"]);
    expect(screen.getAllByText("Proprietário")).toHaveLength(2);
    expect(screen.getByText("Administrador")).toBeVisible();
    expect(screen.queryByText("Membro", { exact: true })).not.toBeInTheDocument();
    expect(container.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(container.querySelector(".presence-dot")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Ações/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ver todos" }));
    expect(names()).toEqual([
      "Current [Você]",
      "Owner Á",
      "Owner Z",
      "Admin C",
      "Member A",
      "Member B",
    ]);
    expect(ownership.members.map((member) => member.userId)).toEqual(original);
    for (const id of ["owner-z", "admin"]) {
      rerender(
        <OwnershipRoster
          kind="group"
          id="group"
          workspaceId="workspace"
          currentUserId={id}
          ownership={ownership}
          reload={vi.fn()}
          onAdd={vi.fn()}
          onRemove={vi.fn()}
        />,
      );
      expect(within(screen.getAllByRole("listitem")[0]).getByText("[Você]")).toBeVisible();
      expect(
        within(screen.getAllByRole("listitem")[0]).getByText(
          id === "admin" ? "Administrador" : "Proprietário",
        ),
      ).toBeVisible();
    }
  });

  it("combines localized role filters and trimmed search, including small rosters", async () => {
    const ownership = facts();
    ownership.members.push({
      userId: "member",
      displayName: "Dai Member",
      role: "member",
      actions: { remove: false, assignRole: false, transfer: false },
    });
    ownership.members[1].displayName = "Dai Admin";
    renderRoster(ownership);
    await userEvent.click(screen.getByRole("button", { name: "Ver todos" }));
    const filter = screen.getByLabelText("Papel");
    for (const [value, expected] of [
      ["owner", ["Alice"]],
      ["admin", ["Dai Admin"]],
      ["member", ["Dai Member"]],
      ["", ["Alice", "Dai Admin", "Dai Member"]],
    ] as const) {
      await userEvent.selectOptions(filter, value);
      expect(
        screen
          .getAllByRole("listitem")
          .map((row) => row.querySelector(".ownership-roster__name")?.textContent?.trim()),
      ).toEqual(expected.map((name) => (name === "Alice" ? "Alice [Você]" : name)));
    }
    expect(
      within(filter)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Todos", "Proprietários", "Administradores", "Membros"]);
    await userEvent.type(screen.getByLabelText("Buscar participante"), "  DAI  ");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    await userEvent.selectOptions(filter, "admin");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Dai Admin")).toBeVisible();
    await userEvent.selectOptions(filter, "owner");
    expect(screen.getByText("Nenhum participante encontrado.")).toBeVisible();
  });

  it("offers only strict target capabilities, ordered role actions and no direct owner removal", async () => {
    const cases: Array<{
      role: string;
      actor?: string;
      actions: Record<string, unknown>;
      expected: string[];
    }> = [
      {
        role: "member",
        actions: { assign_role: true, remove: true },
        expected: ["Tornar administrador", "Tornar proprietário", "Remover"],
      },
      {
        role: "admin",
        actions: { assign_role: true, remove: true },
        expected: ["Tornar proprietário", "Tornar membro", "Remover"],
      },
      {
        role: "owner",
        actions: { assign_role: true, remove: true },
        expected: ["Tornar administrador", "Tornar membro"],
      },
      { role: "member", actor: "admin", actions: { remove: true }, expected: ["Remover"] },
      { role: "member", actor: "member", actions: {}, expected: [] },
      { role: "owner", actions: { remove: true }, expected: [] },
      { role: "member", actions: { transfer: true }, expected: [] },
      ...[false, undefined, null, "true", 1, {}, []].map((value) => ({
        role: "member",
        actions: { assign_role: value, remove: value, transfer: value },
        expected: [],
      })),
    ];
    for (const scenario of cases) {
      const ownership = parseOwnership({
        enabled: true,
        members: [
          {
            user_id: "a",
            display_name: "Actor",
            role: scenario.actor ?? "owner",
            actions: {},
          },
          { user_id: "b", display_name: "Target", role: scenario.role, actions: scenario.actions },
        ],
      })!;
      const view = renderRoster(ownership);
      const trigger = screen.queryByLabelText("Ações de Target");
      if (scenario.expected.length) {
        expect(trigger).toBeVisible();
        await userEvent.click(trigger!);
        expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(
          scenario.expected,
        );
        if (scenario.expected.includes("Remover")) {
          await userEvent.click(screen.getByRole("menuitem", { name: "Remover" }));
          expect(view.onRemove).toHaveBeenCalledWith(ownership.members[1], trigger);
        }
      } else expect(trigger).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it("opens by keyboard, navigates actions and restores focus without closing the parent panel", async () => {
    renderRoster();
    const user = userEvent.setup();
    const trigger = screen.getByLabelText("Ações de Bruno");
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("menu", { name: "Ações de Bruno" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Tornar proprietário" })).toHaveFocus();
    fireEvent.scroll(window);
    fireEvent.resize(window);
    expect(screen.getByRole("menuitem", { name: "Tornar proprietário" })).toHaveFocus();
    await user.keyboard("{ArrowDown}{End}");
    expect(screen.getByRole("menuitem", { name: "Remover" })).toHaveFocus();
    await user.keyboard("{Home}{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Remover" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await user.keyboard(" ");
    await user.click(screen.getByRole("menuitem", { name: "Tornar proprietário" }));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Tornar proprietário");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(trigger).toHaveFocus();
  });

  it.each([403, 409])(
    "keeps a denied role mutation (%s) recoverable without projecting success",
    async (status) => {
      vi.mocked(assignConversationRole).mockRejectedValueOnce(
        new ApiRequestError(status, "denied", "denied"),
      );
      const { reload } = renderRoster();
      await userEvent.click(screen.getByLabelText("Ações de Bruno"));
      await userEvent.click(screen.getByRole("menuitem", { name: "Tornar proprietário" }));
      await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
      expect(await screen.findByRole("alert")).toBeVisible();
      expect(reload).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Confirmar" })).toBeEnabled();
      await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
      expect(assignConversationRole).toHaveBeenLastCalledWith("group", "group", "b", "owner");
      expect(reload).toHaveBeenCalledOnce();
    },
  );

  it("requires a transfer target and sends the chosen role and atomic leave flag", async () => {
    const { reload } = renderRoster();
    await openTransfer();
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Transferir minha propriedade");
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Novo proprietário"), "b");
    await userEvent.selectOptions(screen.getByLabelText("Meu papel"), "admin");
    await userEvent.click(screen.getByLabelText("Sair após transferir"));
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(transferConversationOwnership).toHaveBeenCalledWith(
      "group",
      "group",
      "b",
      "admin",
      true,
      expect.any(String),
    );
    expect(reload).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps a failed transfer recoverable and preserves the idempotency key", async () => {
    vi.mocked(transferConversationOwnership).mockRejectedValueOnce(
      new ApiRequestError(409, "ownership_conflict", "changed"),
    );
    renderRoster();
    await openTransfer();
    await userEvent.selectOptions(screen.getByLabelText("Novo proprietário"), "b");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A propriedade mudou");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    const calls = vi.mocked(transferConversationOwnership).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][5]).toBe(calls[0][5]);
  });

  it("blocks a last-owner departure without an automatic successor", async () => {
    const ownership = facts();
    ownership.leavePreview = { lastOwner: true, blocked: true, successorUserId: undefined };
    renderRoster(ownership);
    await userEvent.click(screen.getByRole("button", { name: "Sair da conversa" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Não há sucessor automático elegível");
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeDisabled();
  });

  it("describes the predicted successor and restores focus on cancellation", async () => {
    renderRoster();
    const trigger = screen.getByRole("button", { name: "Sair da conversa" });
    await userEvent.click(trigger);
    expect(screen.getByRole("dialog")).toHaveTextContent("Bruno assumirá");
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(trigger).toHaveFocus();
  });

  it("does not apply a completed mutation to a panel that was closed", async () => {
    let finish!: () => void;
    vi.mocked(assignConversationRole).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { reload, unmount } = renderRoster();
    await userEvent.click(screen.getByLabelText("Ações de Bruno"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Tornar proprietário" }));
    await userEvent.dblClick(screen.getByRole("button", { name: "Confirmar" }));
    expect(screen.getByRole("button", { name: "Confirmando…" })).toBeDisabled();
    await waitFor(() => expect(assignConversationRole).toHaveBeenCalledOnce());
    unmount();
    await act(async () => finish());
    expect(reload).not.toHaveBeenCalled();
  });
});
