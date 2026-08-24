# Nikufra CRM

Aplicação desktop interna para gerir pipeline, relações comerciais, atividade, métricas e faturação da Nikufra. A interface é integralmente em português europeu e foi desenhada para inserção rápida e uso diário denso.

## Incluído

- Dashboard operacional com pipeline, aging, receita e atividade.
- Kanban drag-and-drop com 7 etapas, estados terminais e motivo de perda obrigatório.
- Tabela editável de empresas/contactos, pesquisa, seleção, import e export CSV.
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

Sem `.env`, a app usa dados fictícios persistidos em `localStorage`. Com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`, ativa o Auth real e bloqueia o CRM até existir sessão por magic link. A build instalada regista `nikufra-crm://` para receber magic links e o retorno OAuth; no desenvolvimento web usa a origem local.

```bash
pnpm build
pnpm tauri dev
```

## Estrutura

- `src/`: aplicação React e protótipo interativo.
- `src-tauri/`: shell desktop, CSP, permissões mínimas e updater.
- `supabase/migrations/`: schema, triggers, RLS e métricas SQL.
- `supabase/tests/`: testes pgTAP das políticas críticas.
- `infra/`: deployment, TLS, SMTP, segredos e backups.
- `.github/workflows/release.yml`: builds universais macOS e MSI Windows assinados pelo updater Tauri.

## Portão de produção

Antes de dados reais: aplicar migrations num servidor de teste, executar testes RLS como anon/member/inativo/admin, validar SMTP, testar um restauro externo e rever o compose contra o snapshot Supabase oficial escolhido. A `SERVICE_ROLE_KEY` nunca entra no cliente.
