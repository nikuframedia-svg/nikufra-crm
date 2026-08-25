# Infraestrutura Nikufra CRM

Esta pasta descreve o deployment self-hosted. O `docker-compose.yml` é uma variante reduzida do snapshot oficial Supabase: mantém Postgres, Auth, PostgREST, Realtime, Edge Runtime, Meta, Studio e Kong; não inclui Storage, imgproxy, analytics nem Supavisor. As imagens têm tags fixas e o Postgres permanece em 15 (`15.8.1.085`) por decisão de arquitetura.

## Perfil local no macOS

`docker-compose.local.yml` é um override exclusivamente local: publica a API apenas em `127.0.0.1:8000` e usa Mailpit em `127.0.0.1:8025` para capturar magic links. Não arranca Caddy nem publica a base de dados. O bootstrap de roles e schemas é o que vem assinado na imagem oficial `supabase/postgres`; o projeto aplica apenas o schema CRM depois de o stack estar saudável. `./local-up.sh` gera `infra/.env` e `.env.local` com modo `600`, inicia os serviços, aplica migrations uma única vez e configura o scheduler Gmail. `./local-down.sh` para os contentores sem eliminar volumes.

As credenciais Google são a única configuração partilhada entre local e servidor que não pode ser gerada automaticamente. No desenvolvimento, o callback é `http://localhost:8000/functions/v1/gmail-oauth-callback`; no servidor passa a ser `https://crm.nikufra.ai/functions/v1/gmail-oauth-callback`.

## Pré-requisitos

- Ubuntu LTS atualizado, 4 vCPU, 8 GB RAM e 80 GB SSD.
- DNS `crm.nikufra.ai` a apontar para o servidor.
- Docker Engine + Compose, `openssl`, `rclone`, `mailutils`, `ufw` e `fail2ban`.
- Relay SMTP Google Workspace ou Resend já testado.

## Instalação

1. Copiar `infra/` e `supabase/` para o servidor, mantendo a mesma relação entre pastas.
2. Executar `./generate-env.sh`, preencher SMTP, rclone e Google, e confirmar `stat -c '%a' .env` = `600`. No projeto Google Cloud, ativar Gmail API, People API e Google Calendar API e registar o callback `https://crm.nikufra.ai/functions/v1/gmail-oauth-callback`.
3. Validar configuração: `docker compose --env-file .env config --quiet`.
4. Arrancar: `docker compose --env-file .env up -d --wait`.
5. Aplicar migrations por ordem, depois do Auth estar saudável:

   ```bash
   for migration in ../supabase/migrations/*.sql; do
     docker compose --env-file .env exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "$migration"
   done
   ```

6. Não carregar seeds: `supabase/seed.sql` está intencionalmente vazio. A base real é importada na aplicação por um administrador e a importação elimina duplicados.
7. Confirmar `https://crm.nikufra.ai/auth/v1/health` e entrar no Studio com o basic auth definido no `.env`.

Para ativar o sync Gmail de 15 em 15 minutos, guardar os dois valores no Vault após aplicar as migrations:

```sql
select vault.create_secret('https://crm.nikufra.ai/functions/v1/gmail-sync', 'gmail_sync_url');
select vault.create_secret('<SERVICE_ROLE_KEY>', 'gmail_sync_service_key');
```

O refresh token de cada pessoa é cifrado com AES-GCM antes de chegar à tabela. A mesma autorização usa `gmail.readonly`, `gmail.compose`, `contacts.readonly`, `contacts.other.readonly` e `calendar.events.readonly`. O sync guarda apenas headers, assunto, um excerto curto, IDs e associação CRM — nunca o corpo completo. Gmail, Contacts/“Outros contactos” e o calendário principal mantêm tokens incrementais separados, para retomarem sem recomeçar. Eventos confirmados criam atividades de reunião e avançam no máximo para “Reunião marcada”; nunca são assumidos como realizados.

O `.env` real não entra no Git, em backups de código ou em mensagens. `SERVICE_ROLE_KEY`, segredo Google e chave de encriptação vivem apenas no servidor.

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

Configurar o remote rclone para B2/R2 e testar `rclone lsd`. Cron diário:

```cron
0 3 * * * /opt/nikufra-crm/infra/backup.sh >> /var/log/nikufra-crm-backup.log 2>&1
```

O script cria um dump custom-format, comprime, valida com `gzip -t`, copia para armazenamento externo e aplica retenção de 30 diários + 12 mensais. Um dump no disco do servidor não conta como backup.

Restauro mensal obrigatório numa base descartável:

```bash
gunzip -c nikufra-crm-AAAA-MM-DDTHHMMSSZ.dump.gz > /tmp/nikufra-restore.dump
createdb nikufra_restore_test
pg_restore --exit-on-error --clean --if-exists -d nikufra_restore_test /tmp/nikufra-restore.dump
psql -d nikufra_restore_test -c "select count(*) from public.estado_historico;"
dropdb nikufra_restore_test
```

Registar data, duração, contagens e resultado do teste. Não promover uma atualização de imagens sem dump verificado e plano de rollback.

## SMTP e magic links

O Auth não entrega magic links sem SMTP. Se for usado Google Workspace, limitar o relay ao IP do servidor e ao domínio Nikufra. A aplicação só aceita `@nikufra.ai`; o trigger de base de dados repete a restrição e cria novas contas inativas. Um admin tem de as aprovar.

## Atualizações

As versões foram alinhadas com o snapshot self-hosted oficial de agosto de 2026, mantendo o override Postgres 15 pedido. Atualizar o stack completo de forma deliberada; não trocar imagens individualmente sem validar a matriz oficial e ler o changelog. Primeiro testar num clone restaurado do último backup.
