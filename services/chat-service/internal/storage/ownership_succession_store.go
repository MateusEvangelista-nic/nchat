package storage

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/nicrepository/nchat/services/chat-service/internal/domain"
)

// succeedOwnership runs under the conversation lock, before removing membership.
// Eligibility and UUID ordering stay in PostgreSQL, shared with the guards.
func succeedOwnership(ctx context.Context, tx pgx.Tx, scope OwnershipScope, departing string) error {
	var members, owners int
	var candidate string
	err := tx.QueryRow(ctx, `WITH remaining AS (
 SELECT user_id,role,joined_at,guest FROM chat.active_ownership_participants
 WHERE workspace_id=$1::uuid AND kind=$2 AND conversation_id=$3::uuid
 AND user_id<>$4::uuid
)
 SELECT count(*),count(*) FILTER (WHERE role='owner'),
 COALESCE((SELECT p.user_id::text FROM remaining p WHERE NOT p.guest AND p.role IN ('admin','member')
 ORDER BY CASE p.role WHEN 'admin' THEN 0 ELSE 1 END,p.joined_at ASC,p.user_id ASC LIMIT 1),'')
 FROM remaining`, scope.WorkspaceID, scope.Kind, scope.ConversationID, departing).Scan(&members, &owners, &candidate)
	if err != nil {
		return err
	}
	if owners > 0 || members == 0 {
		return nil
	}
	if candidate == "" {
		return domain.ErrOwnershipConflict
	}
	return assignOwnership(ctx, tx, scope, candidate, domain.ConversationOwner, "succession")
}

func prepareOwnershipDeparture(ctx context.Context, tx pgx.Tx, input OwnershipMutation) error {
	switch input.Operation {
	case "leave":
		return succeedOwnership(ctx, tx, input.Scope, input.Scope.ActorID)
	case "remove":
		return succeedOwnership(ctx, tx, input.Scope, input.TargetUserID)
	default:
		return nil
	}
}
