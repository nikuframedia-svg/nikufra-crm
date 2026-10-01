# Infraestrutura Nikufra CRM

Esta pasta descreve o deployment self-hosted. O `docker-compose.yml` é uma variante reduzida do snapshot oficial Supabase. O perfil de produção arranca apenas Postgres, Auth, PostgREST, Realtime, Edge Runtime e Kong; Meta e Studio ficam disponíveis para diagnóstico local, mas são omitidos no arranque normal. Não inclui Storage, imgproxy, analytics nem Supavisor. As imagens têm tags fixas e o Postgres permanece em 15 (`15.8.1.085`) por decisão de arquitetura.

## Perfil local no macOS

`docker-compose.local.yml` é um override exclusivamente local: publica a API apenas em `127.0.0.1:8000` e usa Mailpit em `127.0.0.1:8025` para capturar magic links. Não arranca Caddy nem publica a base de dados. O bootstrap de roles e schemas é o que vem assinado na imagem oficial `supabase/postgres`; o projeto aplica apenas o schema CRM depois de o stack estar saudável. `./local-up.sh` gera `infra/.env` e `.env.local` com modo `600`, inicia os serviços, aplica migrations uma única vez e configura o scheduler Gmail. `./local-down.sh` para os contentores sem eliminar volumes.

As credenciais Google são a única configuração partilhada entre local e servidor que não pode ser gerada automaticamente. No desenvolvimento, o callback é `http://localhost:8000/functions/v1/gmail-oauth-callback`; no servidor passa a ser `https://crm.nikufra.ai/functions/v1/gmail-oauth-callback`.

## Pré-requisitos

- Ubuntu LTS atualizado, 4 vCPU, 8 GB RAM e 80 GB SSD.
- DNS `crm.nikufra.ai` a apontar para o servidor.
- Docker Engine + Compose, `openssl`, `rclone`, `mailutils`, `ufw` e `fail2ban`.
- Uma conta Gmail de administrador já autorizada na app, para enviar os emails de autenticação pelo Gmail API. SMTP pode ficar configurado como fallback enquanto o hook está desligado.

### Chave SSH restrita do CI

O workflow de produção usa um único forced command. Antes de o ativar, instalar
`release-publish.sh` no checkout persistente e associar **a chave pública de
deploy**, nunca a privada, ao utilizador de serviço:

```bash
install -m 755 infra/release-publish.sh /home/luis/services/nikufra-crm/infra/release-publish.sh
install -d -m 700 ~/.ssh
printf '%s\n' 'restrict,command="/home/luis/services/nikufra-crm/infra/release-publish.sh" ssh-ed25519 <DEPLOY_PUBLIC_KEY>' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

`restrict` desliga PTY, forwarding, agent e `~/.ssh/rc`. O forced command só
aceita `publish-backend`, `verify-backend`, `publish-web` e
`rollback-release`, sempre com um release ID exato no formato do GitHub
Actions. O rollback só aceita diretórios canónicos criados por este publisher,
com capability e manifests backend/web válidos; não aceita paths, argumentos
extra nem releases antigas sem essa prova. Testar, antes de permitir pushes
para `main`, que um comando arbitrário é recusado e que a configuração
persistente existe:

```bash
ssh -i <DEPLOY_PRIVATE_KEY> <DEPLOY_USER>@<DEPLOY_HOST> id  # tem de ser recusado
ssh -i <DEPLOY_PRIVATE_KEY> <DEPLOY_USER>@<DEPLOY_HOST> \
  'rollback-release ../current'                             # tem de ser recusado
test "$(stat -c '%a' /home/luis/services/nikufra-crm/infra/.env)" = 600
```

O CI envia e valida primeiro o backend. `deploy-production.sh` pára API e
worker, força `disabled:false`, aplica migrations com checksum e conclui o
sentinel read-only em dark mode. Só depois o forced command aceita a publicação
web para o mesmo release ID. `infra/.env`, chaves e `backups/` nunca fazem parte
do bundle recebido. Cada publicação conserva dentro da release o bundle web e
os checksums do backend/web para permitir rollback verificável.

Antes da primeira release gerida, ainda não existe um predecessor aceite por
`rollback-release`. O publisher executa por isso, uma única vez,
`capture-pre-unification-recovery.sh`: guarda em
`backups/pre-unification/` o source, web root, Caddyfile e IDs das imagens da
versão anterior, com checksums e instruções de recuperação. O deploy é recusado
se este recovery não puder ser criado e relido. Após a primeira release
backend+web completa, os rollbacks seguintes usam exclusivamente os artefactos
imutáveis do publisher.

### Rollback de release

No GitHub Actions, executar manualmente o workflow **Publicar backend e
aplicação web** e preencher `rollback_release_id` com o identificador completo
da release anterior (`<git-sha>-<run-id>-<attempt>`). O job usa a mesma chave
restrita e só envia:

```text
rollback-release <release-id>
```

O forced command atualiza a release alvo com os segredos correntes, mas força
`OUTREACH_SEND_ENABLED=false` e `OUTREACH_SHADOW_MODE=true`; o código e o bundle web permanecem imutáveis e
verificados pelos manifests. Antes da troca, confirma que todas as migrations
da release alvo já existem no ledger com os checksums publicados, pára API e
worker e força a base a `disabled:false`. Depois arranca a API/worker anteriores,
confirma que o ledger inteiro não mudou, executa sentinel/readiness em dark,
troca o apontador `current` e só então republica o bundle web anterior. O
checksum e o marcador de release confirmam a publicação web exata, e um segundo
sentinel/readiness é obrigatório antes de declarar sucesso.

O rollback **não** elimina nem reverte migrations. Releases sem a capability de
rollback ou sem o bundle web preservado são recusadas; nesse caso usar um novo
deploy corretivo. Se a publicação web falhar, o publisher restaura o document
root anterior e o backend fica dark, sem reativar outbound.

## Instalação

1. Copiar o repositório para o servidor sem substituir `infra/.env`, backups ou chaves.
2. Executar `./generate-env.sh` apenas numa instalação nova; preencher SMTP de fallback, rclone e Google e confirmar `stat -c '%a' .env` = `600`. No projeto Google Cloud, ativar Gmail API, People API e Google Calendar API e registar `https://crm.nikufra.ai/functions/v1/gmail-oauth-callback` e `https://crm.nikufra.ai/api/outreach/v1/oauth/callback/google`.
3. Configurar um remote offsite no rclone e definir `RCLONE_REMOTE`; a chave indicada por `BACKUP_ENCRYPTION_KEY_FILE` fica num cofre separado do remote.
4. Executar `./deploy-production.sh`. O script valida Compose, exige disco abaixo de 80% e outbound desligado, cria e testa um backup offsite antes das migrations, aplica apenas migrations pendentes e, se ainda não existir prova PITR válida recente, cria um base backup físico offsite e executa o drill PITR antes de aceitar readiness. Depois publica API/worker em dark mode e instala de forma transacional a rota `/api/outreach/*` no Caddy externo. O Caddyfile anterior é preservado e restaurado automaticamente se a validação, reload ou probe público falhar.
5. Confirmar `./production-healthcheck.sh`, `./outreach-readiness.sh --dark`, `https://crm.nikufra.ai/auth/v1/health` e `https://crm.nikufra.ai/api/outreach/v1/healthz`. Este último tem de devolver JSON do `outreach-api`, nunca `index.html`.

Não carregar seeds: `supabase/seed.sql` está intencionalmente vazio. O perfil de produção não publica Postgres, Studio ou qualquer ferramenta administrativa.

Para ativar o sync Gmail de 15 em 15 minutos, guardar os dois valores no Vault após aplicar as migrations:

```sql
select vault.create_secret('https://crm.nikufra.ai/functions/v1/gmail-sync', 'gmail_sync_url');
select vault.create_secret('<SERVICE_ROLE_KEY>', 'gmail_sync_service_key');
```

O refresh token de cada pessoa é cifrado com AES-GCM antes de chegar à tabela. A mesma autorização usa `gmail.readonly`, `gmail.compose`, `contacts.readonly`, `contacts.other.readonly` e `calendar.events.readonly`. O sync guarda apenas headers, assunto, um excerto curto, IDs e associação CRM — nunca o corpo completo. Gmail, Contacts/“Outros contactos” e o calendário principal mantêm tokens incrementais separados, para retomarem sem recomeçar. Eventos confirmados criam atividades de reunião e avançam no máximo para “Reunião marcada”; nunca são assumidos como realizados.

O OAuth é individual e a conta Google devolvida pelo Gmail tem de coincidir com o email autenticado no CRM. Um estado OAuth de uso único e expiração curta protege o callback. Uma conta nova fica em modo de pré-visualização: o cron ignora tokens sem `import_confirmed_at`, e só a confirmação explícita desbloqueia o backfill. Os utilizadores partilham empresas, contactos e atividade comercial através das políticas RLS; cada token Google continua isolado ao respetivo titular. A eliminação de contactos é uma função administrativa, preserva a história sem a ligação pessoal, regista `RGPD_DELETE` e impede reimportação.

O `.env` real não entra no Git, em backups de código ou em mensagens. `SERVICE_ROLE_KEY`, segredo Google e chave de encriptação vivem apenas no servidor.

## Claude via MCP

O endpoint remoto `https://crm.nikufra.ai/functions/v1/mcp` expõe apenas ferramentas de leitura para empresas, fichas, pipeline e sugestões de follow-up. O Auth funciona como servidor OAuth 2.1 com PKCE e registo dinâmico: cada pessoa entra com a conta Nikufra existente, vê o ecrã de consentimento e recebe apenas os acessos permitidos pelas políticas RLS. O token fica no cliente MCP e pode ser revogado no Claude.

Este conector permite perguntar no Claude sobre o CRM. Não permite usar uma subscrição Claude como motor das menções no chat interno; as respostas dentro do CRM continuam a usar a API Anthropic configurada no servidor.

## Rede e sistema operativo

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo systemctl enable --now fail2ban
```

Em `/etc/ssh/sshd_config`: `PasswordAuthentication no`, `PermitRootLogin no`, `PubkeyAuthentication yes`. Validar uma segunda sessão por chave antes de reiniciar SSH. Nenhum serviço de dados publica portas; apenas Caddy publica 80/443.

## Backups e restauro

`configure-backups.sh` cria a chave fora da árvore de backups e
`install-backup-schedule.sh` instala a agenda gerida: WAL offsite a cada 10
minutos, dump lógico diário, base backup físico semanal e ensaio de restauro
integral mensal. Todos os artefactos que deixam o host são cifrados com AES-256
e acompanhados por checksum; um ficheiro apenas no servidor não conta como
backup.

Comandos operacionais:

```bash
./backup-production.sh
./basebackup-production.sh
./wal-offsite-sync.sh
./restore-drill.sh
./pitr-restore-drill.sh
```

O deploy não avança sem conseguir descarregar, autenticar e restaurar o backup
offsite mais recente num PostgreSQL descartável, sem rede, onde as roles são
recriadas a partir do artefacto `globals` antes do dump com ACLs. A chave de cifra nunca deve ser
guardada no mesmo remote dos arquivos. O runbook completo de PITR, rollout e
rollback está em `../docs/outreach-operations.md`.

Mesmo em dark mode, readiness exige um base backup físico e checksum offsite
com menos de oito dias, um relatório PITR válido nos últimos 35 dias e WAL
local/offsite autenticado dentro do RPO de 15 minutos. Assim, o primeiro deploy
não fica dependente da primeira execução semanal/mensal do cron.

O slot físico `nikufra_offsite` é limitado por
`POSTGRES_MAX_SLOT_WAL_KEEP_SIZE` e observado tanto no healthcheck de produção
como no readiness de Outreach. Um slot perdido exige um novo base backup e um
novo drill PITR; recriar o slot, por si só, não recupera a continuidade WAL.

## Convites e magic links

Em produção, o Send Email Hook assinado substitui o SMTP do Auth e envia convites e magic links através do Gmail API da conta de administrador já autorizada. O Auth chama o Edge Runtime diretamente pela rede Docker privada (`host.docker.internal` é apenas um alias interno), sem expor o segredo nem depender de uma ida externa pelo proxy. O endpoint rejeita payloads sem assinatura Standard Webhooks e usa um registo idempotente para não repetir mensagens. A chave do hook é criada por `generate-env.sh` e nunca entra no Git. Manter `AUTH_EMAIL_HOOK_ENABLED=false` até o domínio público responder por HTTPS, porque os links recebidos apontam para esse domínio; depois alterar para `true`, recriar `auth` e testar um magic link real. Se o hook estiver desligado, o SMTP configurado continua a ser o fallback.

Numa instalação já existente, `./configure-auth-email-hook.sh prepare` acrescenta o segredo sem o revelar e mantém o hook desligado. Depois de DNS/TLS responderem, `./configure-auth-email-hook.sh enable` valida o endpoint HTTPS antes de o ativar; `disable` faz rollback imediato para SMTP.

A primeira conta tem de ser `@nikufra.ai`; as seguintes podem ser Google Workspace ou `@gmail.com`, mas têm de corresponder a um convite ainda não usado, criado por um administrador. O trigger da base de dados repete esta verificação para que não possa ser contornada pelo cliente.

## Atualizações

As versões foram alinhadas com o snapshot self-hosted oficial de agosto de 2026, mantendo o override Postgres 15 pedido. Atualizar o stack completo de forma deliberada; não trocar imagens individualmente sem validar a matriz oficial e ler o changelog. Primeiro testar num clone restaurado do último backup.
