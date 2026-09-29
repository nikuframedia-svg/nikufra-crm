# Nikufra CRM

Aplicação web interna para gerir pipeline, relações comerciais, atividade, métricas e faturação da Nikufra. A interface é integralmente em português europeu e corre no browser em `https://crm.nikufra.ai`.

## Incluído

- Dashboard operacional com pipeline, aging, receita e atividade.
- Kanban pesquisável com etapas editáveis, “Recusado” e valor de proposta.
- Tabela editável de empresas e contactos, ficha completa, seleção e importação CSV com reconhecimento automático de colunas.
- Sugestões de follow-up por antiguidade e frequência, com intervalo temporal e opção de rejeitar.
- Gmail com histórico, templates, opt-out e criação de rascunhos — nunca envia automaticamente.
- Google Calendar da equipa em modo de leitura.
- Chat de equipa em tempo real com canais, conversas privadas, membros e agentes Claude com ferramentas MCP remotas.
- Métricas, faturação, objetivos, eliminação auditada de lançamentos, performance de equipa, atribuições, roles e segurança.
- React/Vite/TypeScript, Supabase self-hosted, PostgreSQL com RLS e publicação web atómica.

## Desenvolvimento

```bash
pnpm install
pnpm dev
```

Com Docker Desktop aberto, o perfil local cria os segredos, liga o frontend à API, arranca o Supabase e aplica apenas as migrations em falta:

```bash
pnpm local:up
pnpm dev
```

Os magic links locais ficam no Mailpit em `http://127.0.0.1:8025`; nenhum email de teste sai do Mac. A aplicação abre em `http://localhost:1420`. A primeira conta `@nikufra.ai` autenticada torna-se o administrador inicial. Depois disso, qualquer conta Google tem de ser convidada por um administrador. Para parar os serviços sem apagar dados, usar `pnpm local:down`.

No desenvolvimento sem `.env`, a app pode abrir uma cópia local dos dados fornecidos, gerada por `scripts/generate-real-data.mjs`. Esse ficheiro e a cópia do CSV estão no `.gitignore`: nunca entram no Git nem nos assets públicos. Não existem utilizadores, leads ou métricas fictícias. Com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`, o Auth real fica ativo e bloqueia o CRM até existir uma sessão por magic link.

## Google e dados

Cada utilizador consente individualmente a integração Google. Após o primeiro login, a app abre o consentimento OAuth no mesmo separador, valida que o endereço Google coincide com o email autenticado e regressa a `https://crm.nikufra.ai`. Antes de escrever dados, mostra uma pré-análise com mensagens Gmail, contactos encontrados, duplicados e novos; o backfill e o cron ficam bloqueados até o utilizador confirmar “Importar”.

A autorização pede apenas Gmail em leitura/criação de rascunhos, Google Contacts/“Outros contactos” em leitura e eventos do Calendar em leitura. O backfill percorre as mensagens disponíveis, ignora newsletters/no-reply, importa contactos externos, regista reuniões confirmadas e passa depois à sincronização incremental de 15 em 15 minutos. Os registos são deduplicados por identificadores estáveis. Contactos apagados por um administrador ficam suprimidos para não reaparecerem através do Google.

No servidor são necessários `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` e `SUPABASE_PUBLIC_URL`; no build web, `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. No Google Cloud devem estar ativas Gmail API, People API e Google Calendar API, com o callback `https://crm.nikufra.ai/functions/v1/gmail-oauth-callback`.

Para importar leads, abrir “Empresas e leads → Importar CSV”. A operação autenticada é idempotente: associa contactos por email, consolida empresas e evita duplicados. A pré-visualização mostra o mapeamento inferido e permite corrigir cada coluna.

## Chat e agentes

O Chat guarda canais, conversas privadas, membros, mensagens e leituras no PostgreSQL. Todas as tabelas têm RLS: uma conversa só é visível para os seus membros e apenas o responsável pelo canal ou um administrador pode adicionar pessoas e agentes.

Um administrador pode configurar um agente Anthropic e, opcionalmente, um ou mais servidores MCP remotos HTTPS. A chave da Anthropic e os tokens MCP são cifrados no servidor com `TOKEN_ENCRYPTION_KEY`; nunca são guardados no browser, devolvidos pela API ou expostos nas tabelas públicas. O agente só recebe as 20 mensagens recentes da conversa onde foi mencionado e só pode usar os MCP ligados à sua própria configuração.

## Validação

```bash
pnpm security:audit
pnpm test
pnpm build
```

## Estrutura

- `src/`: aplicação React.
- `supabase/migrations/`: schema, triggers, RLS e métricas SQL.
- `supabase/tests/`: testes das políticas críticas.
- `infra/`: deployment web, proxy, TLS, autenticação, sync e backups.
- `.github/workflows/ci.yml`: validação contínua.
- `.github/workflows/deploy.yml`: build e publicação web atómica em produção.

## Segurança e produção

O browser recebe apenas a chave pública `anon`. A `SERVICE_ROLE_KEY`, os segredos Google e a chave de encriptação vivem apenas no servidor. Cada utilizador tem sessão persistente no browser e tokens Google cifrados e isolados por titular; os dados CRM partilhados são controlados por RLS e roles.

Antes de uma alteração de infraestrutura: executar os testes, confirmar um backup recente, validar o restauro e verificar `infra/production-readiness.sh`. A aplicação web mantém uma versão anterior no servidor para rollback atómico.
