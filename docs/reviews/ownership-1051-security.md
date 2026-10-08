# Security Review — #1051

Resultado: PASS para o escopo QA estático revisado. Zero vulnerabilidades
confirmadas remanescentes no diff. A matriz de autorização browser continua
BLOCKED; esta revisão não valida isolamento de produto em nchat-dev.

Fronteiras revisadas: credenciais externas → API real; JSON privado → manifesto;
UUIDs → seed SQL; DSN → subprocess psql; output Go/Playwright → evidências públicas.

- O runner recusa DSNs ausentes ou com banco diferente de `ownership_953_test`.
  Todos os três DSNs são verificados antes do primeiro teste. Query parameters
  não podem substituir o banco por outro nome ou serviço de conexão.
  Não exporta SQL, stdout/stderr, DSN ou tokens ao JSON de evidência.
- Provisionamento exige quatro identidades exclusivas, compara nomes/membros
  com a projeção da conversa recém-criada e usa apenas UUIDs normalizados e
  datas fixas no SQL. Não altera status de contas ou roles via SQL. Atualização
  sem linha correspondente falha. Preflight é o script oficial read-only.
- O cliente HTTP recusa redirects para não encaminhar bearer a outro destino.
  O manifesto privado é criado exclusivamente com modo 0600 fora do repositório,
  e fica incompleto em caso de falha. JSON inválido no helper produz mensagem
  genérica, sem fragmentos de tokens.
- Trace/HAR/screenshot/vídeo estão desativados. O reporter sanitizado grava
  identificadores de cenários, browser, SHA, tempo e resultado; omite erros e
  payloads. As chamadas negativas exercitam o backend real, sem route mocks.
- psql usa argv sem shell ou interpolation de SQL livre. As corridas reutilizam
  o helper oficial existente; o provisionador Go usa parâmetros UUID/data validados.
  Credenciais no DSN são parâmetros privados de conexão, não artefatos públicos.

Validação atual: oito testes Go com subcasos e `-race`, `go vet` e runner Go
executando as 196 verificações PostgreSQL. Os testes cobrem falso PASS, DSNs
incorretos, redirects HTTP, redaction de diagnósticos, modo 0600, manifests
parciais, bypass por symlink e limites do SQL. Typecheck TypeScript, Go lint
e corridas PostgreSQL com `-race` foram verificados no ensaio original.
Nenhuma dependência nova; o comando Go usa apenas a biblioteca padrão.
Limites: credenciais e targets externos são configuração do operador; o rótulo
`nchat-dev` não comprova sozinho namespace, DSN correto ou imagens implantadas.
Verificar esses vínculos antes da execução. A prova de autorização cross-workspace,
fan-out/Valkey e revogação sem F5 continua pendente no relatório. Produção não
foi acessada ou alterada.
