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
