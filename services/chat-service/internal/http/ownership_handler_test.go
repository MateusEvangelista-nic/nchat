package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/nicrepository/nchat/services/chat-service/internal/domain"
	"github.com/nicrepository/nchat/services/chat-service/internal/storage"
)

type ownershipStub struct {
	err   error
	input storage.OwnershipMutation
	calls int
}

func (s *ownershipStub) PrivateEnabled(context.Context, storage.OwnershipScope) (bool, error) {
	return true, nil
}
func (s *ownershipStub) Details(context.Context, storage.OwnershipScope) (storage.OwnershipDetails, error) {
	return storage.OwnershipDetails{}, s.err
}
func (s *ownershipStub) Mutate(_ context.Context, input storage.OwnershipMutation) (storage.OwnershipMutationResult, error) {
	s.calls++
	s.input = input
	return storage.OwnershipMutationResult{}, s.err
}

func TestOwnershipHandlerStrictInputAndErrorContract(t *testing.T) {
	cases := []struct {
		name, method, operation, body, key string
		err                                error
		want                               int
		called                             bool
	}{
		{"promotion", http.MethodPatch, "", `{"role":"owner"}`, "", nil, 200, true},
		{"reject actor assignment", http.MethodPatch, "", `{"role":"owner","actor_user_id":"forged"}`, "", nil, 400, false},
		{"reject unknown role", http.MethodPatch, "", `{"role":"moderator"}`, "", nil, 400, false},
		{"transfer key required", http.MethodPost, "transfer", `{"new_owner_user_id":"95300000-0000-4000-8000-00000000000b","actor_new_role":"member"}`, "", nil, 400, false},
		{"transfer", http.MethodPost, "transfer", `{"new_owner_user_id":"95300000-0000-4000-8000-00000000000b","actor_new_role":"admin"}`, "request", nil, 200, true},
		{"unknown operation", http.MethodPost, "remove", `{}`, "request", nil, 404, false},
		{"owner conflict", http.MethodPatch, "", `{"role":"member"}`, "", domain.ErrOwnershipConflict, 409, true},
		{"private inaccessible", http.MethodPatch, "", `{"role":"owner"}`, "", domain.ErrNotFound, 404, true},
		{"member forbidden", http.MethodPatch, "", `{"role":"owner"}`, "", domain.ErrForbidden, 403, true},
	}
	scope := storage.OwnershipScope{WorkspaceID: "95300000-0000-4000-8000-000000000001", Kind: "dm", ConversationID: "95300000-0000-4000-8000-000000000002", ActorID: "95300000-0000-4000-8000-00000000000a"}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(tc.method, "/ownership", strings.NewReader(tc.body))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Idempotency-Key", tc.key)
			request.SetPathValue("operation", tc.operation)
			request.SetPathValue("userID", "95300000-0000-4000-8000-00000000000b")
			provider := &ownershipStub{err: tc.err}
			response := httptest.NewRecorder()
			handleOwnership(response, request, provider, scope, nil)
			if response.Code != tc.want {
				t.Fatalf("status %d body %s", response.Code, response.Body.String())
			}
			if (provider.calls > 0) != tc.called {
				t.Fatalf("store called %d", provider.calls)
			}
			if tc.called && provider.input.Scope != scope {
				t.Fatalf("actor/workspace replaced: %+v", provider.input.Scope)
			}
		})
	}
}
