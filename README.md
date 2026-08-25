# Nikufra CRM

Aplicação desktop interna para gerir pipeline, relações comerciais, atividade, métricas e faturação da Nikufra. A interface é integralmente em português europeu e foi desenhada para inserção rápida e uso diário denso.

## Incluído

- Dashboard operacional com pipeline, aging, receita e atividade.
- Kanban drag-and-drop com 7 etapas, estados terminais e motivo de perda obrigatório.
- Tabela editável de empresas/contactos, ficha completa por empresa, pesquisa, seleção e import CSV com reconhecimento automático de colunas.
- Email com histórico, templates, opt-out e criação de rascunhos — sem permissão de envio.
- Métricas com coortes, conversão, no-show, ciclo, tempo por estado e amostras `n` visíveis.
- Faturação vs. contratualizado vs. recebido, objetivos e lançamentos editáveis.
- Performance de equipa, atribuições, settings, roles e segurança.
- Tauri v2, React 18/Vite/TypeScript, Supabase self-hosted, RLS e releases macOS/Windows.

## Desenvolvimento

```bash
pnpm install
pnpm dev
```

### Instalação local completa no Mac

Com Docker Desktop aberto, o perfil local cria segredos fortes, liga o frontend à API, arranca o Supabase e aplica apenas as migrations ainda em falta:

```bash
pnpm local:up
pnpm dev
```

Os magic links locais ficam em `http://127.0.0.1:8025`; nenhum email de teste sai do Mac. A primeira conta `@nikufra.ai` autenticada torna-se o administrador inicial. Depois disso, só um convite de administrador pode criar uma conta, incluindo endereços Google Workspace e `@gmail.com`. Para parar os serviços sem apagar dados, usar `pnpm local:down`. Para gerar a aplicação nativa, usar `pnpm desktop:build`.

No desenvolvimento sem `.env`, a app pode abrir uma cópia local da base fornecida, gerada por `scripts/generate-real-data.mjs`. Esse ficheiro e a cópia do CSV estão no `.gitignore`: nunca entram no Git nem nos assets públicos. Não existem utilizadores, leads ou métricas fictícias. Com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`, ativa o Auth real e bloqueia o CRM até existir sessão por magic link. A build instalada regista `nikufra-crm://` para receber magic links e o retorno OAuth; no desenvolvimento web usa a origem local.

No servidor, abre “Leads → Importar CSV” e seleciona o ficheiro fornecido. A operação autenticada é idempotente: associa contactos por email, consolida empresas, cria uma única oportunidade base por empresa e reconhece esta base para importar também os movimentos financeiros comunicados, sem duplicar IDs. Para qualquer outro CSV, a pré-visualização mostra o mapeamento inferido e permite corrigir cada coluna.

Cada utilizador tem de consentir individualmente a integração Google. Após o primeiro login, a app abre automaticamente o consentimento OAuth para a mesma conta usada no CRM, valida que os endereços coincidem e regressa por deep link. Antes de escrever dados, mostra uma pré-análise com mensagens Gmail, contactos encontrados, duplicados e novos; o backfill e o cron ficam bloqueados até o utilizador confirmar “Importar”. A autorização pede apenas Gmail em leitura/criação de rascunhos, Google Contacts/“Outros contactos” em leitura e eventos do Calendar em leitura. O backfill percorre as mensagens disponíveis em páginas, ignora newsletters/no-reply, importa contactos externos, regista reuniões confirmadas pelo calendário principal e passa depois à sincronização incremental de 15 em 15 minutos. Emails, recursos Google e eventos são deduplicados por identificadores estáveis. Contactos apagados por um administrador ficam numa lista de supressão para não reaparecerem através do Google.

Para ligar a conta, o servidor precisa de `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` e `SUPABASE_PUBLIC_URL`; o frontend precisa de `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. No projeto Google Cloud devem estar ativas Gmail API, People API e Google Calendar API, com o callback `https://<domínio-supabase>/functions/v1/gmail-oauth-callback`. Sem estes valores, a cópia local continua segura e funcional para consulta, mas o botão mostra que a API está indisponível em vez de simular uma ligação.

```bash
pnpm build
pnpm tauri dev
```

## Estrutura

- `src/`: aplicação React e dataset real gerado a partir do CSV fornecido.
- `src-tauri/`: shell desktop, CSP, permissões mínimas e updater.
- `supabase/migrations/`: schema, triggers, RLS e métricas SQL.
- `supabase/tests/`: testes pgTAP das políticas críticas.
- `infra/`: deployment, TLS, SMTP, segredos e backups.
- `.github/workflows/release.yml`: builds universais macOS e NSIS Windows com assinatura nativa, notarização e assinatura independente do updater Tauri.
- `docs/RELEASES.md`: configuração única e procedimento curto para publicar atualizações da equipa.

## Portão de produção

Antes de dados reais: aplicar migrations num servidor de teste, executar testes RLS como anon/member/inativo/admin, validar SMTP, testar um restauro externo e rever o compose contra o snapshot Supabase oficial escolhido. A `SERVICE_ROLE_KEY` nunca entra no cliente.
