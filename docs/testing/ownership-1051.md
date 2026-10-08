# QA integrada de ownership — #1051

Veredito: **BLOCKED**. A matriz PostgreSQL executada passou. Não há evidência
de execução browser real em nchat-dev, duas réplicas com Valkey ou Blue/Green.
O gate global foi interrompido, e o novo commit local não tem required CI remoto.
Este relatório não encerra a [#1051](https://github.com/nicrepository/nchat/issues/1051).

## Referência e ambientes

- Data: 08/10/2026, UTC nos artefatos.
- Base confirmada por `git fetch upstream develop`:
  `73ca0361b8414658681975d5a7a8cac10eb3caf5`.
- Branch: `feature/chat-1051-ownership-integration`, worktree `nchat-1051`.
  Demais worktrees preservados. Sem push, PR, merge ou mudança de produto.
- PostgreSQL 17 descartável, container `nchat-1051-postgres`, label
  `nchat.qa=1051`, porta loopback 55451, banco exclusivo `ownership_953_test`.
  Os testes aplicam suas próprias migrations e resetam schemas sequencialmente.
  Não reutilizar esse banco para serviços compartilhados.
- Playwright 1.60.0; projetos Chromium, Firefox e Chromium com viewport 390×844.
  Descoberta/typecheck executados; browsers reais **BLOCKED** sem credenciais,
  URL e DSN de preflight externos. Não foram inventados usuários ou sessões.
- Estado operacional atual de nchat-dev, imagens implantadas, migrations,
  metadados de `ownership_rollout` e rollback target: **BLOCKED**, sem acesso
  fornecido nesta execução. O estado descrito pela #1091 é referência histórica,
  não uma nova medição do ambiente.

O histórico da base contém #1031 (domínio e mutations), #1070 (migrations),
#1073 (transfer), #1074 (sucessão), #1083 (invalidação), #1084 (outbox) e #1089
(UI integrada). A consulta das issues mostrou #1043–#1049 fechadas, enquanto
#1042 e #1050 continuam abertas. Código presente não significa aceite concluído.

## Evidência executada

Todos os comandos desta tabela usaram a base acima com as mudanças de QA locais.
O SHA nos artefatos identifica a base, não um commit publicado do harness.

| Bloco                       | Comando                                                                                                                                                                                                                                                                 | Ambiente/browser                  | Duração                                    | Resultado | Artefato/issue                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------ | --------- | ----------------------------------------------------------------------- |
| Suites PostgreSQL           | `python3 scripts/qa/ownership-postgres.py --output /tmp/nchat-1051-postgres.json`                                                                                                                                                                                       | PostgreSQL 17; browser N/A        | 61,025 s chat; 2,641 s auth; 2,072 s admin | PASS      | [postgres.json](evidence/ownership-1051/postgres.json); #1042–#1048     |
| Corridas novas após revisão | `go test -race -count=1 -parallel=1 -run '^TestOwnershipQAOrderedMutationsPostgreSQL$' ./internal/storage` no chat-service                                                                                                                                              | PostgreSQL exclusivo; browser N/A | 4,163 s (Go)                               | PASS      | 8 combinações; saída `ok`; #1044–#1046                                  |
| Parser de evidências        | `python3 -m unittest scripts/qa/test_ownership_postgres.py`                                                                                                                                                                                                             | local; browser N/A                | <1 s                                       | PASS      | 2 testes; recusa seleção vazia, skip, pacote incompleto e exit não zero |
| Typecheck do harness        | `pnpm --filter @nchat/web exec tsc --noEmit --target ES2023 --module ESNext --moduleResolution bundler --types node --skipLibCheck e2e/ownership-live/fixtures.ts e2e/ownership-live/matrix.spec.ts e2e/ownership-live/reporter.ts playwright.ownership-live.config.ts` | local; browser N/A                | N/A: sem cronômetro dedicado               | PASS      | exit 0                                                                  |
| Descoberta Playwright       | `playwright test --config playwright.ownership-live.config.ts --list` com env de loopback e caminho fictício, sem executar casos                                                                                                                                        | local; três projetos              | 1,127 s                                    | PASS      | 42 testes encontrados; não prova E2E                                    |
| Browser real                | `pnpm --filter @nchat/web exec playwright test --config playwright.ownership-live.config.ts`                                                                                                                                                                            | nchat-dev; Chromium/Firefox/390px | <2 s até bloqueio                          | BLOCKED   | configuração recusou URL/fixtures ausentes; #1051                       |
| Go lint final               | `golangci-lint run` no chat-service                                                                                                                                                                                                                                     | local; browser N/A                | N/A: sem cronômetro dedicado               | PASS      | `0 issues.`                                                             |
| Gate global, uma execução   | `pnpm run ci`                                                                                                                                                                                                                                                           | local; browser N/A                | ~99 s, timestamps do log                   | FAIL      | parou em G204 da nova chamada psql; ver abaixo                          |
| Required CI da base         | `gh api repos/nicrepository/nchat/commits/73ca0361b8414658681975d5a7a8cac10eb3caf5/check-runs --paginate`                                                                                                                                                               | GitHub; browser N/A               | <2 s                                       | PASS      | [checks.json](evidence/ownership-1051/checks.json)                      |
| Required CI do commit QA    | consulta do SHA local após commit                                                                                                                                                                                                                                       | GitHub; browser N/A               | N/A                                        | BLOCKED   | sem push autorizado; checks da base não aprovam o novo commit           |

O runner registrou 194 execuções de testes/subtestes no chat-service e uma em
cada writer real de auth/admin, sem skips. O JSON preserva nomes, resultados,
comandos e tempos; exclui diagnósticos Go/psql, DSNs, tokens e payloads privados.
As primeiras tentativas falharam no helper novo de QA: `PGDATABASE` não expandia
a URI. A invocação foi corrigida antes da execução PostgreSQL registrada.

O gate global detectou `G204` na invocação direta de psql. A correção reutiliza
`ownership1043PSQL`, helper oficial já existente. Lint e corridas foram
reexecutados e passaram. O gate inteiro não foi repetido, conforme o plano;
etapas posteriores à interrupção permanecem **NÃO EXECUTADO** nessa execução.
Não há falha de produto reproduzida para abrir issue adicional.

## Matriz e limites da evidência

| Cenário obrigatório                                                             | Grupo                                   | Canal privado                            | Evidência e lacuna                                                                             |
| ------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Múltiplos owners/admins, role manual                                            | PASS PostgreSQL / BLOCKED browser       | PASS PostgreSQL / BLOCKED browser        | Matrix/revalidation/authorization; E2E provisionado para sete fluxos                           |
| Transferência e role selecionado                                                | PASS PostgreSQL / BLOCKED browser       | PASS PostgreSQL / BLOCKED browser        | Matrix, rollback, idempotência; suíte live verifica promoção e demotion                        |
| Admin mais antigo/member mais antigo                                            | PASS PostgreSQL / BLOCKED browser       | PASS PostgreSQL / BLOCKED browser        | Selection/eligibility; live verifica leave_preview antes de sair                               |
| Último participante, remove e leave                                             | PASS PostgreSQL / BLOCKED browser       | PASS PostgreSQL / BLOCKED browser        | EmptyAndGuestRollback, mutations; last participant browser ainda NÃO EXECUTADO                 |
| Suspend/deactivate e perda de elegibilidade                                     | PASS PostgreSQL / BLOCKED browser       | PASS PostgreSQL / BLOCKED browser        | Invalidation/eligibility; writers reais de auth/admin cobrem grupo; browser pendente           |
| MEMBER e ADMIN contra OWNER                                                     | PASS PostgreSQL / BLOCKED browser       | PASS PostgreSQL / BLOCKED browser        | Revalidation/authorization; live inclui UI e PATCH forjado                                     |
| Cross-workspace, enumeração privada, capability obsoleta                        | PASS PostgreSQL / NÃO EXECUTADO browser | PASS PostgreSQL / NÃO EXECUTADO browser  | Revalidation/access; falta cenário live dedicado com identidade de outro workspace             |
| Dois owners saem                                                                | PASS PostgreSQL                         | PASS PostgreSQL                          | SuccessionOrderedConcurrency: ambas as ordens com barreira de lock                             |
| Transfer + remove; promote + leave                                              | PASS PostgreSQL                         | PASS PostgreSQL                          | QAOrderedMutations: duas ordens, autorização após serialização e zero órfãos                   |
| Transfer + suspend                                                              | PASS PostgreSQL                         | NÃO EXECUTADO para corrida de canal      | ConcurrentSuspensionAndTransfer/InvalidationOrderedConcurrency exercitam grupo; não extrapolar |
| Retry/timeouts, atomicidade e duplicação audit/outbox                           | PASS PostgreSQL                         | PASS PostgreSQL nos casos parametrizados | Transfer, operational activation, outbox crash/replay; não prova timeout browser               |
| Duas réplicas + Valkey                                                          | BLOCKED                                 | BLOCKED                                  | OutboxTwoReplicas usa dois stores/callbacks; não equivale a dois servidores com bus real       |
| Duplicate invalidation, bus failure/retry, reconnect                            | BLOCKED                                 | BLOCKED                                  | Outbox SQL passou; fault injection de infraestrutura e reconexão browser pendentes             |
| Removido perde acesso sem F5                                                    | BLOCKED                                 | BLOCKED                                  | Teste live observa terceiro contexto C; regressão conhecida #1092 ainda não revalidada         |
| Preflight oficial após bloco destrutivo                                         | PASS no bloco de corridas QA            | PASS no bloco de corridas QA             | Executado em cada uma das 8 combinações; outros testes usam assertions SQL próprias            |
| Zero órfãos no ambiente implantado                                              | BLOCKED                                 | BLOCKED                                  | Sem medição nova de nchat-dev; não inferir a partir da base descartável                        |
| Desktop/390px/teclado/foco/draft cancelado                                      | BLOCKED                                 | BLOCKED                                  | Implementado no harness live; precisa de execução browser                                      |
| Reply/attachment/scroll/WS após cancelamento ou erro; Blobatar/presença/filtros | NÃO EXECUTADO                           | NÃO EXECUTADO                            | Não há evidência integrada; testes mockados existentes não substituem a matriz                 |
| Voice finalized                                                                 | NÃO EXECUTADO                           | NÃO EXECUTADO                            | Nenhuma limitação demonstrada nesta execução; não conceder N/A antecipadamente                 |
| Mensagens de sistema de ownership                                               | BLOCKED                                 | BLOCKED                                  | Contrato da #1093 continua pendente                                                            |

## Blue/Green operacional

| Etapa                                            | Resultado | Motivo                                                                  |
| ------------------------------------------------ | --------- | ----------------------------------------------------------------------- |
| N/N+1 implantados lado a lado                    | BLOCKED   | Ambiente compatível autorizado não fornecido                            |
| Activate com retirement e rollback evidence      | BLOCKED   | Teste SQL isolado passou; não há prova operacional de retirement        |
| Cutover                                          | BLOCKED   | Não autorizado em produção; nenhum ambiente Blue/Green de QA disponível |
| Rollback para release compatível                 | BLOCKED   | Target histórico da #1091 não foi ensaiado nesta execução               |
| Contratos de clientes/servidores antigos e novos | BLOCKED   | Sem execução de releases reais N/N+1                                    |
| Preflight após cada etapa, zero órfãos           | BLOCKED   | Etapas operacionais não executadas                                      |

Nenhum cutover, rollback, suspensão de contas compartilhadas, falha de bus
compartilhado ou mutação de produção foi executado. Review de manifests e testes
SQL/scripts isolados não substituem estas etapas.

## Reprodução e fixtures externas

1. Criar PostgreSQL descartável com banco `ownership_953_test`; exportar
   `OWNERSHIP_TEST_DATABASE_URL`, `AUTH_TEST_DATABASE_URL` e
   `ADMIN_TEST_DATABASE_URL` apontando exclusivamente para esse banco.
   Executar o runner acima. Não paralelizar esses suites: eles resetam schemas.
2. Fornecer arquivo privado externo com `runId` (`qa-1051-...`), `environment`
   (`nchat-dev` ou `disposable`), `baseURL` e `users.A/B/C/D`, cada um com
   `id`, `name` e `token`. Os quatro nomes devem começar pelo runId e pertencer
   exclusivamente à QA. A OWNER, B ADMIN mais antigo, C/D MEMBER serão
   verificados na projeção real. Não inserir tokens em argumentos ou Git.
3. Exportar `OWNERSHIP_QA_FIXTURE_DSN` para a mesma base da API. Executar
   `python3 scripts/qa/ownership-browser-fixtures.py --credentials /tmp/qa-1051-credentials.json --output /tmp/qa-1051-fixtures.json`.
   O script cria 42 conversas pelas APIs reais, promove B pela API e define
   joined_at somente nos quatro membros de cada conversa recém-criada.
   Identificadores UUID são validados; nenhum status de conta é alterado.
   Cada seed termina com preflight oficial. O manifesto tem modo 0600,
   registra IDs criados mesmo em falhas parciais e só recebe `complete=true`
   depois de todas as verificações. Não reutilizar um manifesto consumido.
4. Exportar `OWNERSHIP_QA_ENVIRONMENT`, `OWNERSHIP_QA_BASE_URL`,
   `OWNERSHIP_QA_FIXTURES` e `OWNERSHIP_QA_PREFLIGHT_DSN`. Executar
   `pnpm --filter @nchat/web exec playwright test --config playwright.ownership-live.config.ts`.
   Não há mocks, webServer local implícito, retries, trace, HAR, vídeo ou
   screenshots automáticos. Dois contextos independentes usam autenticação real;
   o teste de remoção acrescenta a sessão removida. O reporter exporta somente
   cenário, projeto, duração, SHA e resultado em `/tmp/nchat-1051-browser.json`.
   Uma seleção parcial nunca recebe PASS no reporter. Isso não prova afinidade
   com réplicas distintas: é necessário montar e registrar esse ambiente.
5. Preservar manifestos privados até a limpeza explícita das conversas/usuários
   de QA e até a investigação de falhas. Não publicar esses arquivos. Registrar
   release/digests, migrations, rollout, rollback target e preflight de nchat-dev
   antes e depois da execução. Limpeza não foi executada nesta sessão porque
   nenhuma fixture browser foi criada.

Para encerrar #1051: fornecer credenciais/ambientes, executar os casos live,
completar os casos browser ainda sem harness dedicado e os ensaios multi-réplica
e Blue/Green, revalidar [#1091](https://github.com/nicrepository/nchat/issues/1091)
e [#1092](https://github.com/nicrepository/nchat/issues/1092), resolver o contrato
da [#1093](https://github.com/nicrepository/nchat/issues/1093) e obter required CI
do SHA final. Falhas novas devem ser reduzidas e encaminhadas à issue dona;
esta branch permanece restrita a QA.

Revisões separadas: [qualidade](../reviews/ownership-1051-quality.md) e
[segurança](../reviews/ownership-1051-security.md).
