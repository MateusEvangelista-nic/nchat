# Ownership #1051 — merge e QA local

Merge realizado na `develop` local, sem conflitos, push, PR ou deploy.
Verificação dos componentes locais: **PASS**, com retomada da cobertura Go usando
os DSNs previstos no CI. Aceite da matriz integrada: **BLOCKED** pelas lacunas abaixo.

- Destino antes do merge: `19e93af9ad4d94269432959e6cd7e87d2282d2d4`, já com #1094/#1050.
- Origem: `feature/chat-1051-ownership-integration`, incluindo a conversão para Go
  e a exclusão da suíte live da configuração E2E padrão.
- Merge: `5e718b4e3825db5f62dbb1def358a117956ae343`.
- Worktree de destino: `nchat-1048`. Os demais worktrees foram preservados.
- Os ajustes posteriores alteram apenas testes, configuração QA e documentação;
  nenhum arquivo de produto foi modificado.

## Resultados executados

| Verificação                                  | Comando                                                                                                | Resultado | Evidência                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------- |
| Harness Go                                   | `go test -race -count=1 scripts/qa/ownership.go scripts/qa/ownership_test.go`                          | PASS      | 8 testes com subcasos; duração Go 1,023 s                                                                            |
| Go vet                                       | `go vet scripts/qa/ownership.go scripts/qa/ownership_test.go`                                          | PASS      | exit 0                                                                                                               |
| Matriz PostgreSQL real                       | `go run scripts/qa/ownership.go postgres --output /tmp/nchat-1051-postmerge-postgres.json`             | PASS      | 194 execuções chat + 1 auth + 1 admin, sem skips; [JSON sanitizado](evidence/ownership-1051/postmerge-postgres.json) |
| Ownership UI                                 | `pnpm --filter @nchat/web exec playwright test --config playwright.ownership-ui.config.ts`             | PASS      | 6 casos: Chromium, Firefox e Chromium 390px; 29,7 s                                                                  |
| Regressões do helper                         | `pnpm --filter @nchat/web exec playwright test --config /tmp/nchat-1051-helper-regressions.config.mjs` | PASS      | 22 casos Chromium de chamadas/mídia e clipboard; 42,3 s                                                              |
| Descoberta E2E padrão                        | `pnpm --filter @nchat/web exec playwright test --list --reporter=line`                                 | PASS      | 363 testes em 35 arquivos; suíte live excluída                                                                       |
| Typecheck e ESLint dos arquivos QA alterados | `tsc --noEmit` e `eslint` direcionados                                                                 | PASS      | exit 0; nenhum achado nos arquivos alterados                                                                         |
| Gate global inicial                          | `pnpm run ci`                                                                                          | FAIL      | Cobertura chat 86,3% sem DSNs das suítes PostgreSQL; ~542 s                                                          |
| Web/Admin no gate inicial                    | `pnpm test:coverage:web` e `pnpm test:coverage:admin-web`                                              | PASS      | 6.694 testes web e 536 admin, com thresholds; 118,14 s e 16,05 s                                                     |
| Builds restantes                             | `pnpm build`                                                                                           | PASS      | Web e admin-web concluídos, exit 0                                                                                   |

A matriz PostgreSQL foi executada em PostgreSQL 17 descartável, container
`nchat-1051-postgres`, porta loopback 55451 e banco `ownership_953_test`.
Os comandos não exportam tokens, DSNs ou payloads privados ao JSON versionado.

O primeiro `pnpm run ci` passou pelas verificações estáticas, infraestrutura,
release safety, testes Go e cobertura web/admin, mas parou no threshold Go.
Os DSNs necessários constam no job `tests-go-coverage` do CI: a cobertura das
suítes PostgreSQL é medida separadamente e mesclada aos testes unitários.
Para reproduzir esse fluxo, foi criada a segunda base descartável
`nchat_1051_coverage_test`, separada do banco ownership. As 100 migrations
oficiais foram aplicadas nela com `pnpm migrations:up`.

Não se declarou aprovado o comando interrompido. A etapa de cobertura Go foi
retomada com `LINK_SAFETY_TEST_DATABASE_URL` apontando para a segunda base e
`OWNERSHIP_COVERAGE_DATABASE_URL` para `ownership_953_test`; os builds foram
executados separadamente. O resultado da retomada está na evidência pós-merge.

A retomada de `pnpm test:coverage:go:check` passou em ~122 s, com chat-service
90,7% e todos os nove módulos acima do mínimo de 90%. Os builds restantes
passaram em ~21 s. A [evidência sanitizada](evidence/ownership-1051/postmerge-local.json)
registra os resultados e os hashes dos arquivos de testes ajustados após o merge.

## Ajustes e escopo do Playwright

A suíte `playwright.ownership-ui.config.ts` é reproduzível e usa API/WS mockados.
Verifica transferência, convergência visual, badges de owner, filtros,
draft/reply/attachment preservados, teclado/foco, desktop/390px, scroll e
estabilidade dos sockets mockados após cancelamento e conflito. Não há retries.

O primeiro ensaio detectou três problemas de preparação, corrigidos na QA:

- Firefox ausente: instalado o build Firefox 150.0.2 do Playwright 1.60.0.
- Permissões Chromium solicitadas pelo helper em Firefox: grants de clipboard,
  câmera e microfone ficaram restritos a Chromium. Os 22 casos de chamadas e
  clipboard passaram depois dessa alteração.
- Preparação de reply no histórico longo dependia do viewport desktop: essa
  preparação ficou explícita. O teste continua verificando ambas as larguras,
  e o cenário de transferência também passa com viewport inicial de 390px.

Os seletores do harness live também foram alinhados à UI da #1050: radios de
papel, `Transferir propriedade`, `Sair da conversa` e `Sair e transferir`.
Foi feito typecheck; a execução live continua **BLOCKED** sem credenciais/DSN
externos. Nenhuma asserção de produto foi relaxada e não houve correção de produto.

## Limites

A validação local não encerra a [#1051](https://github.com/nicrepository/nchat/issues/1051).
Browser live em nchat-dev, duas réplicas reais com Valkey, falhas/reconnect,
Blue/Green operacional, revalidação de #1091/#1092 e contrato da #1093 continuam
**BLOCKED** conforme a [matriz integrada](ownership-1051.md).
Os checks remotos do novo SHA também não existem enquanto o trabalho permanecer local.

Os logs completos ficam em `/tmp/nchat-1051-postmerge-*.log` e
`/tmp/nchat-1051-helper-regressions.log`. O JSON de resultados versionado contém
apenas evidência sanitizada. A evidência PostgreSQL identifica o SHA do merge;
os ajustes de testes que vieram depois foram verificados por Playwright,
typecheck, ESLint e revisão do diff.

## Continuidade da integração real — 08/10/2026

HEAD conferido: `0af4aaa9b2bb26f96935a9e0dc7b41d0984e19de`, branch
`develop`, árvore inicialmente CLEAN e `git diff --check` PASS. As suítes locais
anteriores não foram repetidas. Somente este relatório e a
[evidência sanitizada do preflight](evidence/ownership-1051/real-integration-preflight.json)
foram alterados nessa etapa de preflight; nela não houve commit, push, PR ou merge.

### Verificações atuais

| Comando / consulta                                                                                                                                             | Ambiente / SHA / browser                                                 | Duração aproximada | Resultado | Evidência / impacto                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `git status --short`, `git branch --show-current`, `git log -1 --oneline`, `git diff --check`                                                                  | local / `0af4aaa` / N/A                                                  | <1 s               | PASS      | Estado inicial corresponde ao exigido                                                                                    |
| `kubectl config current-context`                                                                                                                               | notebook / release desconhecido / N/A                                    | <1 s               | BLOCKED   | `current-context is not set`; nenhum cluster consultado                                                                  |
| `ssh -o BatchMode=yes -o ConnectTimeout=10 srv-apps-01 'hostname; kubectl config current-context; kubectl -n nchat-dev get deployments,pods,services -o wide'` | alvo nchat-dev / release desconhecido / N/A                              | 3,42 s             | BLOCKED   | Host não resolve; nenhum comando remoto executado                                                                        |
| Presença dos inputs privados, sem ler ou imprimir seus conteúdos                                                                                               | local / `0af4aaa` / N/A                                                  | <1 s               | BLOCKED   | Nenhuma variável OWNERSHIP_QA/NCHAT_DEV/KUBECONFIG; credenciais, fixtures e topology nos caminhos convencionais ausentes |
| `gh issue view 1091/1092/1093 --repo nicrepository/nchat --json number,state,title,url` (uma consulta por issue)                                               | GitHub / N/A / N/A                                                       | <3 s em conjunto   | PASS      | As três issues estão OPEN; consulta de estado não equivale a revalidação funcional                                       |
| `gh api repos/nicrepository/nchat/rules/branches/develop`                                                                                                      | GitHub / N/A / N/A                                                       | <1 s               | PASS      | Required check confirmado: `CI / Required`, política strict                                                              |
| `gh api repos/nicrepository/nchat/commits/0af4aaa/check-runs`                                                                                                  | GitHub / `0af4aaa` / N/A                                                 | <1 s               | BLOCKED   | HTTP 422: SHA local não existe remotamente                                                                               |
| Consulta à branch e às variables de nchat-dev                                                                                                                  | GitHub / remote develop `19e93af9ad4d94269432959e6cd7e87d2282d2d4` / N/A | <2 s               | BLOCKED   | Branch consultável, mas environment variables retornaram HTTP 403; URL operacional não obtida                            |

As primeiras consultas GitHub falharam na rede do sandbox; foram repetidas fora
dele e os estados acima refletem as respostas efetivas. O SSH inicialmente
encontrou erro de permissões na configuração de sistema dentro do sandbox;
fora dele, `ssh -G` funcionou, mas a conexão falhou na resolução do hostname.
Nenhum desses erros prova indisponibilidade da aplicação.

Não há evidência atual de deployed SHA, migrations, ownership ativo, serviços
Ready, quantidade de réplicas ou conectividade Valkey. A #1091 registra ativação
histórica em 08/10/2026; ela não foi usada para declarar o ambiente atual PASS.
Foi solicitado o caminho privado dos acessos aprovados e do ambiente descartável
para falhas/Blue-Green. Sem esses inputs, nenhuma sessão autenticada foi aberta.

O runbook Blue/Green existente e seus scripts são de `nchat-prod`. Eles não foram
executados: falta um ambiente operacional compatível autorizado, e produção
permanece fora do escopo. Revisar scripts não comprova N/N+1, activate, cutover
ou rollback. Compatibilidade old/new permanece BLOCKED, sem inventar N/A.

### Resultado por bloco

```text
ISSUE
#1051

HEAD
0af4aaa

WORKTREE
DIRTY — apenas documentação/evidência desta continuidade

LOCAL VALIDATION
Playwright mocked: PASS — 28 testes, evidência anterior
PostgreSQL: PASS — 196 tests, 0 skips, evidência anterior
Coverage >=90%: PASS — evidência anterior
Web build: PASS — evidência anterior
Admin build: PASS — evidência anterior

REAL INTEGRATION
Environment: nchat-dev (alvo; acesso não comprovado)
Ownership active: BLOCKED
Group real browser: BLOCKED
Private channel real browser: BLOCKED
Two clients realtime: BLOCKED
Reconnect: BLOCKED
Removed-client access: BLOCKED — #1092 não revalidada

MULTI-REPLICA
Replicas >=2: BLOCKED
Valkey: BLOCKED
Cross-replica realtime: BLOCKED
Duplicate invalidation: BLOCKED
Bus failure: BLOCKED
Retry: BLOCKED
Outbox backlog: BLOCKED

BLUE/GREEN
N/N+1: BLOCKED
Activate: BLOCKED
Cutover: BLOCKED
Rollback: BLOCKED
Old client → new server: BLOCKED
New client → old compatible server: BLOCKED

NO ORPHAN
Groups: BLOCKED — contagem atual não consultada
Private channels: BLOCKED — contagem atual não consultada

UX REAL
Desktop: BLOCKED
390px: BLOCKED
Keyboard: BLOCKED
Draft: BLOCKED
Reply: BLOCKED
Attachment: BLOCKED
Blobatar: BLOCKED
Roles/presence: BLOCKED

BROWSERS
Chromium: BLOCKED — integração real não executada
Firefox: BLOCKED — integração real não executada

CI
Required checks: BLOCKED — CI / Required sem execução no SHA local

FAILURES FOUND
Nenhum novo bug funcional reproduzido; acesso operacional bloqueado.

ISSUES OPENED / REOPENED
Nenhuma — as issues donas existentes permanecem abertas.

#1091
OPEN
Impact: reconciliação de ativação pendente; estado atual não consultado.

#1092
OPEN
Impact: perda de acesso após remoção exige revalidação real.

#1093
OPEN
Impact: contrato de mensagens de sistema continua pendente.

GIT
HEAD: 0af4aaa
git diff --check: PASS
Worktree: DIRTY — somente relatório e JSON sanitizado
Push: NÃO REALIZADO

FINAL VERDICT
BLOCKED

REASON
Faltam URL/acesso operacional, inputs privados de QA e ambiente compatível
autorizado para falhas/Blue-Green; required CI não existe para o SHA local.
```

O preflight oficial a executar quando o acesso estiver disponível é
`psql "$OWNERSHIP_QA_PREFLIGHT_DSN" -X -v ON_ERROR_STOP=1 -f scripts/db/ownership/preflight.sql`.
Ele consulta `chat.orphaned_private_conversations` em transação read-only e falha
se houver participante ativo sem owner elegível. Nesta continuidade a query foi
**NÃO EXECUTADO**; nenhum zero foi presumido a partir da evidência descartável.

## Publicação para revisão

Após o preflight acima, o usuário autorizou push e abertura de PR. O trabalho foi
preparado na branch `feature/chat-1051-ownership-qa-evidence`, com destino
`develop`, incluindo o harness Go, os testes e as evidências locais anteriores.
O relatório e o JSON de preflight preservam o estado observado antes da
publicação; suas referências a ausência de push/checks são históricas.

A publicação não comprova os blocos operacionais nem encerra a #1051. O PR
referencia a issue sem instrução de fechamento, e os checks remotos devem ser
avaliados no SHA publicado. O veredito da matriz integrada permanece **BLOCKED**.
