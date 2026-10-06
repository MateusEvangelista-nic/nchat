# #1047 — Ownership em invalidações externas

## Contrato e limites

Base oficial `upstream/develop`, commit `22decd466d202ad9e7772f69fa76be3c08028077`,
com a #1046 integrada. Branch `feature/chat-1047-ownership-invalidation`.

Os writers de suspensão global de auth e admin usam o coordinator compartilhado
em `conversationownership`. A seleção da #1046 foi extraída, preservando ADMIN
antes de MEMBER, `joined_at ASC`, UUID ASC e exclusão do participante afetado.
A consulta agrupa as conversas em lote; uma promoção é escrita por conversa que
precisa dela. Não existe consulta separada de candidatos para cada conversa.
Outro OWNER ativo dispensa promoção; nenhum participante restante permite a
invalidação; participantes restantes sem candidato elegível causam conflito.
Guests ativos continuam contando como participantes e owners, mas não são
candidatos automáticos.

A view `chat.active_ownership_participants` continua sendo a fonte de
elegibilidade. Conversas operacionais são grupos e canais privados ativos em
workspace ativo, com workspace membership ativa e usuário ativo sem `deleted_at`.
A invalidação não remove automaticamente a conversation membership ou sua role
histórica: ela deixa de participar da view de acesso. Reativação não restaura
sessões e segue os guards atuais.

## Eventos e authority

| Evento                                     | Authority e operação real                                                                  | Tratamento                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Usuário suspenso                           | auth.users; writers UpdateUserStatus de auth/admin                                         | Coordinator antes do UPDATE, na mesma transação                                                       |
| Workspace membership suspended/left/DELETE | chat.workspace_members; não há endpoint desses eventos em auth/admin                       | Guards SQL existentes, testes reais; API N/A                                                          |
| Desativação de usuário                     | Não existe estado disabled ou transição correspondente                                     | N/A; locked é representável em SQL, sem inventar equivalência                                         |
| Delete/anonymize                           | auth.users suporta deleted/deleted_at/DELETE; não foi encontrado fluxo completo de erasure | Guards SQL testados; anonymize/API N/A                                                                |
| Revogação administrativa                   | Suspensão administrativa em admin-service                                                  | Mesmo coordinator; revogar sessão ou papel administrativo isoladamente não altera elegibilidade local |
| Workspace disabled                         | chat.workspaces.status; não há endpoint de lifecycle encontrado                            | Conversas operacionalmente inativas, sem promoção; reativação órfã é bloqueada pelos guards           |

Evidências: migrations auth 000001, chat 000001 e 000060–000063;
`ValidateStatusTransition` em auth e `ValidUserStatusTransition` em admin permitem
somente active ↔ suspended. O hook de avatar `PurgeForAnonymization` não constitui
uma operação completa de delete/anonymize. Admin remove memberships de canal;
esse writer é uma remoção local, não uma revogação global de workspace.

O domínio global pertence a auth, admin mantém sua autorização administrativa,
e o chat mantém membership, roles e sucessão de conversa. Os serviços usam os
schemas auth/chat no mesmo PostgreSQL. Não há chamada HTTP entre serviços nem
job assíncrono novo para coordenar estes writers.

## Transação, locks e retry

Sequência dos writers globais:

1. BEGIN e SERIALIZABLE antes de qualquer leitura de negócio.
2. `chat.lock_user_ownership_conversations`, ordenando `(kind, conversation_id)`.
3. Lock de auth.users e validação da transição; admin mantém seu lock de principal
   administrativo após o lock do usuário.
4. Consulta única das conversas em que o usuário é OWNER elegível, cálculo de
   owners restantes e sucessores, seguido de `chat.assign_ownership`.
5. UPDATE do usuário, revogação de sessões/refresh tokens e consumo de códigos
   OIDC pendentes, seguidos de COMMIT.

Os locks de conversa precedem os locks do registro de lifecycle e das memberships
alteradas pela promoção. Leave/transfer usam o mesmo lock de conversa, de modo que
os writers globais não invertem essa ordem. O admin anchor mantém a posição
relativa existente; não foi criado lock de workspace ou account adicional.

O coordinator aceita somente usuário e workspace interno confiável; não recebe
sucessor, roles forçadas, owner_count ou estado de lifecycle fornecido por cliente.
Descoberta, elegibilidade e promoção são rederivadas pelo banco. Scope vazio é
exclusivo da suspensão global interna; scope de workspace filtra toda a seleção.
Os adapters não fazem commit nem iniciam outra transação.

`conversationownership.Retry` mantém até três tentativas para 40001/40P01. Cada
uma reabre a transação, relê lifecycle e conversas e recalcula sucessores. A
função SQL de promoção revalida a participação; SERIALIZABLE e os guards impedem
commit com candidatura obsoleta. Nenhum resultado de seleção é reutilizado.

Sem candidato, erro de leitura/escrita, falha de promoção ou falha no commit
reverte roles, lifecycle e efeitos transacionais existentes. A consulta fecha
seu cursor antes de começar as promoções. Conflitos P0953 mantêm o contrato de
erro já existente dos serviços. HTTP e tipos públicos de produto não mudam.

## Compatibilidade e limitações

Antes da expansão do schema, a ausência do helper de lock preserva o fallback
preexistente de auth/admin. Com helper disponível, erros são propagados; não há
fallback para falhas de consulta ou de promoção. Rollout desligado não promove.
Não há migrations, backfill, novos endpoints, audit/outbox ou realtime.

Os eventos representáveis via SQL continuam protegidos pelos triggers atuais.
SQL administrativo deve adquirir locks de conversas em ordem antes de atualizar
account/workspace membership, usando SERIALIZABLE e retry da transação inteira.
SQL arbitrário que ignora esse protocolo pode adquirir locks na ordem inversa e
receber deadlock; não ganhou garantia de liveness. Os guards continuam sendo a
proteção de coerência desses writes. Este delta não altera migrations históricas.

Todos os writers de invalidação encontrados são bloqueáveis no banco compartilhado.
Compensação distribuída ou operação global irreversível: N/A. Não foi criado um
contrato de rollback para um fluxo de erasure ausente. Uma arquitetura futura com
bancos separados precisará definir sua própria coordenação antes de usar o helper.
Workspace disabled não necessita sucessão; se usuários perderem elegibilidade
nesse período, uma reativação que causaria orfandade é recusada pelo guard existente.

## Validação

Banco descartável PostgreSQL 16: `nchat-1047-postgres`, porta local 5547,
database `ownership_953_test`. Os harnesses recriam schemas e devem rodar
sequencialmente, nunca em banco de desenvolvimento ou produção.

- PASS: eventos SQL representáveis, ADMIN/MEMBER, outra role OWNER restante,
  múltiplas conversas, workspace isolado e ausência de sucessor.
- PASS: erro após promoção reverte roles, membership, audit e outbox existentes.
- PASS: writers reais de auth/admin promovem antes do UPDATE; falha deferred no
  commit restaura account, sessão, OIDC e roles.
- PASS: concorrência com barreiras, nas duas ordens: leave+suspend,
  transfer+remoção da workspace membership do actor ou target, e suspensão do
  candidato durante invalidação. As operações que perdem acesso são recusadas;
  não aparecem órfãos ou transferência parcial.
- PASS: retry 40001/40P01 do writer auth relê lista de conversas e escolhe outro
  candidato; testes inferiores de retry e seleção da #1046 reutilizados.
- PASS: pacotes storage afetados; PostgreSQL dirigido de auth/admin/chat com race
  detector. Outras famílias PostgreSQL sem suas variáveis são puladas e não
  constituem evidência de integração.
- N/A: UI, E2E/Playwright e compensação distribuída.

Comandos de reprodução, com DATABASE_URL apontando exclusivamente ao banco
local descartável:

```sh
AUTH_TEST_DATABASE_URL="$DATABASE_URL" go test -race ./services/auth-service/internal/storage -run 'TestOwnershipAccountInvalidationPostgreSQL|TestPGXUserStore_OwnershipInvalidationRetry' -count=1
ADMIN_TEST_DATABASE_URL="$DATABASE_URL" go test -race ./services/admin-service/internal/storage -run TestOwnershipAccountInvalidationPostgreSQL -count=1
OWNERSHIP_TEST_DATABASE_URL="$DATABASE_URL" go test -race ./services/chat-service/internal/storage -run 'TestOwnership(Invalidation|Succession)' -count=1
make ci
```

Logs: `/tmp/nchat-1047-auth-pg.log`, `/tmp/nchat-1047-admin-pg.log`,
`/tmp/nchat-1047-chat-pg-race.log`, `/tmp/nchat-1047-packages.log`,
`/tmp/nchat-1047-lint.log`, `/tmp/nchat-1047-vet.log` e
`/tmp/nchat-1047-build.log`. As falhas iniciais de fixtures foram corrigidas;
somente a rodada final serve como evidência de aceite.

## Code Quality Review

Revisão separada: extração localizada da seleção da #1046, um coordinator para
os writers globais, adapters pequenos e ausência de dependência do driver no
pacote compartilhado. SRP preservado; nenhuma seleção Go duplicada ou novos
smells confirmados. A seleção em lote é independente por workspace/conversa;
seu resultado inteiro é validado antes de qualquer promoção.

Complexidade medida com gocyclo 0.6.0 e gocognit 1.2.1: writers globais com
ciclomática 10; cognitiva auth 10, admin 9. `selectSuccessions`: 7/9;
`succeed`: 4/4. Helpers e testes alterados ficam em até 10. Funções preexistentes
fora do delta acima desse limite não foram alteradas. Nenhuma medição SonarQube
foi feita. Formatter, lint dos quatro módulos, vet e builds afetados: PASS.

## Security Review

Revisão separada: endpoints conservam autorização e contexto de identidade.
Nenhum payload externo escolhe sucessor ou role. Todas as entradas SQL são
parametrizadas, e a seleção está limitada ao workspace interno ou ao usuário
global explicitamente invalidado. SERIALIZABLE, locks de conversa e retry completo
protegem contra TOCTOU; erros não liberam a invalidação. Os testes comprovam
isolamento, rollback e revalidação de actor/target. Sem novas dependências ou
logs de credenciais. Gosec via golangci-lint: PASS. Zero achados novos confirmados.
A revisão não constitui pentest da aplicação inteira.

## Entrega

- PASS: `git diff --check`, formatter, lint, vet e builds dos serviços afetados.
- PASS: EXPLAIN (ANALYZE, BUFFERS, VERBOSE) da consulta extraída de produção:
  três conversas no workspace, quatro no escopo global. Execução de 0,887 ms e
  0,398 ms nas fixtures pequenas; índices existentes utilizados. Sem N+1 de
  descoberta/seleção introduzido e sem evidência para adicionar índice. Isso não
  equivale a teste de carga. Log `/tmp/nchat-1047-explain.log`.
- FAIL: gate global oficial `make ci`, executado uma vez, no threshold de
  cobertura do chat-service: 86,2%, exigência 90%. Checks estáticos, infraestrutura,
  release, testes Go e cobertura web/admin passaram antes dele. Web: 239 arquivos,
  6.530 testes; admin-web: 43 arquivos, 536 testes. Os builds globais posteriores
  à cobertura são NÃO EXECUTADOS; os builds direcionados dos serviços afetados
  passaram separadamente. Log `/tmp/nchat-1047-ci.log`.
- PASS: comparação com a base oficial, medida com os mesmos pacotes não-cmd e
  covermode atomic do checker. A worktree #1046 usada para medição tem conteúdo
  idêntico ao upstream/develop em chat-service e libs/go/platform, confirmado
  por git diff antes da medição. Base: 11.562/13.409 statements, 86,226%.
  #1047: 11.560/13.407, 86,224%. Ambos arredondam a 86,2%; diferença de
  −0,002 ponto percentual após a extração de código para o pacote compartilhado.
  Perfis: `/tmp/nchat-1047-base-chat.cover` e
  `coverage/go/services_chat-service.threshold.out`. A falha de threshold existe
  na base; não foi reduzido o gate nem ampliada a matriz para elevar cobertura.
- PASS: coverage gates de platform (92,6%), admin (91,0%) e auth (90,8%).
- Commit local: `feat(chat): preserve ownership on eligibility invalidation`.
- Push: AGUARDANDO APROVAÇÃO. PR e merge não realizados.

O container descartável foi parado e preservado para reprodução. Pendência de
entrega: gate global permanece FAIL pelo threshold descrito acima. A validação
funcional e concorrente da #1047 passou, sem estado órfão observado. Os checks de
famílias PostgreSQL não selecionadas não são evidência de integração desta task.
