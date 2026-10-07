import { useId, useState } from "react";
import type { OwnershipMember } from "./ownershipApi";
import { roleLabels } from "./ownershipPresentation";
import { ownershipCopy } from "./ownershipDialogState";
import { UserAvatar } from "./UserAvatar";

export function OwnershipPerson({
  member,
  workspaceId,
}: {
  member: OwnershipMember;
  workspaceId: string;
}) {
  return (
    <span className="ownership-picker__person">
      <UserAvatar
        workspaceId={workspaceId}
        userId={member.userId}
        displayName={member.displayName}
        avatarUrl={member.avatarUrl}
        size="sm"
      />
      <span>
        <strong>{member.displayName}</strong>
        <small>{roleLabels[member.role]}</small>
      </span>
    </span>
  );
}

export default function OwnershipTargetPicker({
  candidates,
  target,
  onChange,
  disabled,
  workspaceId,
}: {
  candidates: OwnershipMember[];
  target: string;
  onChange: (id: string) => void;
  disabled: boolean;
  workspaceId: string;
}) {
  const [search, setSearch] = useState("");
  const name = useId();
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  const matching = candidates.filter((member) =>
    normalize(member.displayName).includes(normalize(search.trim())),
  );
  return (
    <>
      <label>
        {ownershipCopy.search}
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          disabled={disabled}
        />
      </label>
      <fieldset className="ownership-picker" disabled={disabled}>
        <legend>{ownershipCopy.target}</legend>
        {matching.map((member) => (
          <label key={member.userId} className="ownership-picker__option">
            <input
              type="radio"
              name={name}
              value={member.userId}
              checked={target === member.userId}
              onChange={() => onChange(member.userId)}
              aria-label={`${member.displayName}, ${roleLabels[member.role]}`}
            />
            <OwnershipPerson member={member} workspaceId={workspaceId} />
          </label>
        ))}
        {matching.length === 0 && <p role="status">{ownershipCopy.noCandidates}</p>}
      </fieldset>
    </>
  );
}
