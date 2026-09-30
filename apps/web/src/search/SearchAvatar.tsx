import { useOutletContext } from "react-router";

import type { ChatOutletContext } from "../chat/ChatShell";
import { avatarColorFor, initialsFrom } from "../chat/messageDisplay";
import { UserAvatar } from "../chat/UserAvatar";

/** A canonical person avatar, or the preserved initials emblem for a group. */
export default function SearchAvatar({
  seed,
  name,
  url,
  kind = "person",
}: {
  seed: string;
  name: string;
  url?: string | null;
  kind?: "person" | "group";
}) {
  const outlet = useOutletContext<ChatOutletContext | null>();
  const workspaceId = outlet?.workspaceId ?? "";

  return (
    <span
      className={`global-search__avatar global-search__avatar--${avatarColorFor(seed)}`}
      aria-hidden="true"
    >
      {kind === "person" ? (
        <UserAvatar userId={seed} workspaceId={workspaceId} displayName={name} avatarUrl={url} />
      ) : (
        initialsFrom(name)
      )}
    </span>
  );
}
