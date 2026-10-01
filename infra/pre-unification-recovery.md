# Recovery manual da versão pré-Outreach

Este diretório é a rede de segurança exclusiva do primeiro deploy unificado.
As releases seguintes usam `rollback-release <release-id>`. A base de dados não
é revertida: as migrations Outreach são aditivas e o CRM antigo ignora-as.

Usar apenas após confirmar uma falha da primeira release e manter
`OUTREACH_SEND_ENABLED=false`.

1. Parar `outreach-api`, `outreach-worker` e `wal-archive` no Compose da release
   atual. Confirmar que não existe qualquer processo de envio ativo.
2. Criar um diretório novo, extrair `source.tar.gz` e copiar para
   `infra/.env` o ficheiro privado que continua em
   `/home/luis/services/nikufra-crm/infra/.env` (modo 0600).
3. Confirmar os image IDs esperados em `container-images.txt` e executar o
   Compose antigo com `--project-name nikufra-crm`. Não eliminar volumes.
4. Extrair `web.tar.gz` para um diretório temporário no mesmo filesystem de
   `/home/luis/stacks/caddy/portal`, validar `index.html` e trocar o diretório
   `crm-app` atomicamente, preservando a cópia atual.
5. Restaurar `Caddyfile` apenas se a configuração pública estiver danificada;
   validar primeiro com `caddy validate`, copiar sobre o mesmo inode do
   bind-mount e fazer reload.
6. Confirmar CRM, Auth e PostgREST. Um restauro integral da base só é permitido
   em desastre real, pois apagaria alterações legítimas posteriores.

Antes de qualquer passo, executar `sha256sum --check SHA256SUMS`. Este
procedimento é manual por intenção: evita que uma falha de smoke test destrua
automaticamente uma versão funcional ou dados criados entretanto.
