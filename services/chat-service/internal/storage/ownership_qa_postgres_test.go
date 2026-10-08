package storage_test

import (
	"context"
	"testing"
	"time"

	"github.com/nicrepository/nchat/services/chat-service/internal/domain"
	"github.com/nicrepository/nchat/services/chat-service/internal/storage"
)

// Exercise both lock orderings explicitly, rather than relying on scheduler luck.
func TestOwnershipQAOrderedMutationsPostgreSQL(t *testing.T) {
	for _, kind := range []string{"dm", "channel"} {
		for _, scenario := range []string{"transfer-remove", "promote-leave"} {
			for _, reverse := range []bool{false, true} {
				t.Run(kind+"/"+scenario+"/"+map[bool]string{false: "first", true: "reverse"}[reverse], func(t *testing.T) {
					pool := ownershipPool(t)
					enableOwnership(t, pool)
					successionMembers(t, pool, kind, `UPDATE MEMBERS SET ownership_role='member'; UPDATE MEMBERS SET ownership_role='owner' WHERE user_id='`+ownershipA+`'; UPDATE MEMBERS SET ownership_role='admin' WHERE user_id='`+ownershipB+`'`)
					first, second := successionInput(kind, ownershipA), successionInput(kind, ownershipA)
					first.TargetUserID = ownershipB
					if scenario == "transfer-remove" {
						first.Operation, first.Role, first.IdempotencyKey = "transfer", domain.ConversationMember, "1051-ordered-transfer"
						second.Operation, second.TargetUserID = "remove", ownershipB
					} else {
						first.Operation, first.Role = "role", domain.ConversationOwner
					}
					if reverse {
						first, second = second, first
					}
					ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
					defer cancel()
					locked, attempted, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
					firstPool := &successionBarrierPool{Pool: pool, reached: locked, release: release, after: true}
					secondPool := &successionBarrierPool{Pool: pool, reached: attempted}
					results := make(chan error, 2)
					go func() { _, err := storage.NewPGXOwnershipStore(firstPool).Mutate(ctx, first); results <- err }()
					awaitSuccessionBarrier(t, ctx, locked)
					go func() { _, err := storage.NewPGXOwnershipStore(secondPool).Mutate(ctx, second); results <- err }()
					awaitSuccessionBarrier(t, ctx, attempted)
					close(release)
					denied := collectSuccessionOutcomes(t, ctx, results)
					wantDenied := 1
					if scenario == "promote-leave" && !reverse {
						wantDenied = 0
					}
					if denied != wantDenied {
						t.Fatalf("denied=%d want=%d", denied, wantDenied)
					}
					owner := ownershipB
					if scenario == "transfer-remove" && reverse {
						owner = ownershipA
					}
					assertOwnershipRole(t, pool, kind, first.Scope.ConversationID, owner, "owner")
					assertNoOrphans(t, pool)
					// The same official preflight used by operators, on the post-race DB.
					if err := ownership1043PSQL(t, "preflight.sql"); err != nil {
						t.Fatal("official ownership preflight failed")
					}
				})
			}
		}
	}
}
