-- Run only after deployment inventory confirms retirement of incompatible
-- releases. Rollback target MUST be the compatibility release from #953.
-- psql -v ON_ERROR_STOP=1 -v legacy_retired=true -f scripts/db/ownership/activate.sql
\if :{?legacy_retired}
\if :legacy_retired
\else
\echo 'legacy_retired=true is required'
\quit 1
\endif
\else
\echo 'explicit legacy_retired=true acknowledgement is required'
\quit 1
\endif
BEGIN;
LOCK TABLE chat.dm_conversations, chat.channels, chat.dm_members,
    chat.channel_members, chat.workspace_members, auth.users IN ACCESS EXCLUSIVE MODE;
SELECT chat.backfill_conversation_ownership();
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM chat.orphaned_private_conversations) THEN
        RAISE EXCEPTION 'activation blocked: private conversations without an eligible owner';
    END IF;
END $$;
ALTER TABLE chat.dm_members DROP CONSTRAINT dm_members_role_check;
ALTER TABLE chat.dm_members ADD CONSTRAINT dm_members_role_check CHECK (role IN ('member','admin','owner'));
ALTER TABLE chat.channel_members DROP CONSTRAINT channel_members_role_check;
ALTER TABLE chat.channel_members ADD CONSTRAINT channel_members_role_check CHECK (role IN ('member','moderator','admin','owner'));
UPDATE chat.dm_members m SET role=m.ownership_role FROM chat.dm_conversations d
WHERE d.id=m.conversation_id AND d.type='group' AND m.ownership_role IS NOT NULL;
UPDATE chat.channel_members m SET role=m.ownership_role FROM chat.channels c
WHERE c.id=m.channel_id AND c.type='private' AND m.ownership_role IS NOT NULL;
UPDATE chat.ownership_rollout SET legacy_retired_at=now(),enabled=true WHERE singleton;
COMMIT;
