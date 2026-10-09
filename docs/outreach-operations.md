# Nikufra Outreach — operação e rollout

O Outreach é um módulo do Nikufra CRM. Não tem login, utilizadores, contactos,
tema, domínio ou base de dados próprios. O CRM é a fonte canónica de perfis,
empresas e contactos; os registos `outreach_*` guardam apenas a operação de
campanhas e referenciam essas entidades.

## Topologia

- Frontend: `https://crm.nikufra.ai/outreach/*`, dentro do shell e sessão CRM.
- API: `/api/outreach/v1`, publicada pelo Caddy e autenticada com o JWT CRM.
- Worker: serviço privado, sem porta pública.
- PostgreSQL: instância privada do CRM; o serviço usa a role limitada
  `outreach_service`.
- Público sem sessão: apenas callbacks OAuth, webhooks assinados e unsubscribe
  com token autenticado. Os handlers continuam sujeitos a state, HMAC e replay
  protection.
- Gmail pessoal do CRM e mailboxes Outreach usam credenciais e fluxos separados.
  A deduplicação comum é `(mailbox, provider_message_id, contacto)`.

## Permissões

| Perfil | Capacidades |
|---|---|
| `viewer` | Ver campanhas, audiências e métricas |
| `sales_rep` | O anterior e tratar respostas que lhe estão atribuídas |
| `campaign_manager` | O anterior e criar/editar/lançar/pausar campanhas |
| Administrador CRM | Controlo total, mailboxes, roles, suppressions e aprovação `live` |

O módulo começa com `OUTREACH_ADMIN_ONLY=true`. Todos os utilizadores ativos
existentes recebem `viewer`; isto não lhes dá acesso enquanto o gate de dark
deploy estiver ativo.

## Gates de envio

O envio exige simultaneamente:

1. `OUTREACH_SEND_ENABLED=true` no processo;
2. estado da base `canary` ou `live` com `send_enabled=true`;
3. campanha `running`, dentro do período, dia e janela configurados;
4. mailbox Google ativa, com envio ligado, quota disponível e DNS recente a
   passar SPF, DKIM, DMARC e MX;
5. contacto ainda existente, email igual ao snapshot, base legal válida e
   verificação de email não expirada;
6. ausência de suppression por email, domínio ou empresa;
7. ausência de resposta anterior, incluindo `stop-company-on-reply`;
8. destinatário na allowlist quando o modo é `canary`;
9. lease válido e ledger idempotente antes do dispatch.

Qualquer falha bloqueia o envio. Complaint, hard bounce, unsubscribe e eliminação
RGPD cancelam jobs futuros. A eliminação retém apenas HMAC de bloqueio e métricas
agregadas.

## Preparação de produção

Executar no host, a partir de `infra/`, antes da primeira migration:

```bash
./configure-outreach.sh
./configure-backups.sh
./configure-pgsodium.sh
./backup-production.sh
./restore-drill.sh
df -h /
```

Por defeito, o disco tem de estar abaixo de 80% e manter pelo menos 20 GiB
livres. Uma exceção explícita em `NIKUFRA_DISK_USAGE_MAX_PERCENT` pode elevar
o teto até 90% (90% já bloqueia); `NIKUFRA_DISK_MIN_FREE_BYTES` só pode elevar,
nunca reduzir, a reserva absoluta. A chave indicada por
`BACKUP_ENCRYPTION_KEY_FILE` deve ser copiada para um cofre separado; nunca para
o mesmo remote dos arquivos. `RCLONE_REMOTE` tem de apontar para storage offsite.
`configure-pgsodium.sh` adota a chave do DB já em execução na primeira
transição e depois mantém-na num ficheiro externo ao overlay Docker, montado
apenas no PostgreSQL e em read-only. Uma divergência entre a cópia persistida e
o container aborta o deploy; nunca substituir ou rodar esta chave isoladamente.

Depois do deploy:

```bash
./deploy-production.sh
./outreach-readiness.sh --dark
./outreach-control.sh status
```

O deploy instala esta agenda do utilizador do serviço:

- WAL cifrado offsite a cada 10 minutos;
- dump lógico cifrado diário;
- base backup físico cifrado semanal;
- companion pgsodium cifrado e com checksum para cada dump/base backup;
- restauro lógico integral mensal, com ACL/RLS e duração;
- ensaio PITR físico mensal, que arranca um PostgreSQL isolado, reproduz WAL e
  prova RPO máximo de 15 minutos, RTO máximo de 4 horas e desencriptação real
  do Vault com o companion correspondente.

O slot físico permanente `nikufra_offsite` tem retenção máxima configurada por
`POSTGRES_MAX_SLOT_WAL_KEEP_SIZE` (4 GiB por omissão). Os healthchecks falham se
o receiver deixar de estar ativo, se `wal_status` sair de `reserved/extended`,
se restarem menos de `WAL_SLOT_MIN_SAFE_BYTES` antes do limite ou se o volume da
base atingir o teto configurado ou ficar com menos de 20 GiB livres. Consultar
o estado sem modificar a base:

```bash
docker compose --env-file .env -f docker-compose.yml \
  -f docker-compose.production.yml exec -T db psql -U postgres -d postgres -x -c \
  "select slot_name,active,wal_status,restart_lsn,safe_wal_size from pg_replication_slots where slot_name='nikufra_offsite'"
```

Se `wal_status=lost` (ou se os segmentos pedidos já não existirem), a cadeia do
base backup anterior deixou de ser contínua. Parar `wal-archive`, preservar os
artefactos e logs do incidente, eliminar o slot perdido apenas depois de
confirmar que não há receiver ativo, e voltar a arrancar `wal-archive` para criar
um slot novo. Em seguida é obrigatório gerar e carregar um **novo** base backup,
forçar `wal-offsite-sync.sh` e concluir `pitr-restore-drill.sh` com sucesso antes
de voltar a declarar o RPO protegido. Recriar só o slot não torna o base backup
antigo recuperável. Em pressão crítica de disco, manter outbound desligado e
tratar a remoção do slot como uma decisão de incidente que exige este reseed
completo.

## Migração legada

O arquivo preservado e respetivos checksums estão descritos em
`docs/outreach-migration-inventory.md`. A importação é sempre executada primeiro
em dry-run e depois em apply sobre o mesmo snapshot. A idempotência é garantida
pelo checksum do snapshot e pelos identificadores legados:

```bash
docker compose --env-file .env -f docker-compose.yml \
  -f docker-compose.production.yml run --rm \
  -v /caminho/absoluto/imports:/imports:ro outreach-api \
  node dist/migrate.js --input /imports/snapshot.json --dry-run

# Só depois de validar contagens, hashes e ambiguidades:
docker compose --env-file .env -f docker-compose.yml \
  -f docker-compose.production.yml run --rm \
  -v /caminho/absoluto/imports:/imports:ro outreach-api \
  node dist/migrate.js --input /imports/snapshot.json --apply
```

O migrador não aceita credenciais, OAuth states, webhooks, unsubscribe tokens ou
chaves antigas. Campanhas antigas ativas entram pausadas, jobs ambíguos entram em
reconciliação e DNS/verificações são apenas histórico.

## Canary

Reautorizar Mia e Marta em produção, mantendo `send_enabled=false`. Maria só é
ligada depois de retirar Super Admin ou documentar formalmente a exceção e manter
2FA/passkey. Repetir DNS e verificação real.

Quando todos os testes do canary estiverem preparados:

```bash
./outreach-control.sh canary --approve-canary <profile-uuid-admin>
```

A allowlist inicial contém apenas `joao@nikufra.ai` e
`joaomilhazes71@gmail.com`. A rampa é 1, 3, 5 e 10 mensagens/dia por mailbox,
com pelo menos 48 horas sem incidentes entre níveis; ordem Mia, Marta e Maria.
Cada mailbox tem de produzir pelo menos um envio confirmado (job `sent` com a
mensagem correspondente do provider) em cada nível. Para `live`, todas as
mailboxes com envio ligado têm de estar em 10 há pelo menos 48 horas, ter DNS
SPF/DKIM/DMARC verificado nas últimas 24 horas e conservar no audit log a
sequência 1→3→5→10 do canary atual. Um canary sem tráfego nunca é prova de
readiness. Open/click tracking permanece desligado.

### Listas, sequência e teste de mensagem

Ao criar um rascunho, é possível escolher uma audiência do CRM e escrever
várias mensagens com intervalos. No detalhe, a lista pode ser associada e a
sequência pode ser editada apenas antes do primeiro lançamento. O backend
substitui os passos e variantes numa única transação e reavalia os contactos
do rascunho. A lista de destinatários mostra também os que ficaram bloqueados.

O botão **Testar envio** de uma mensagem cria uma campanha de teste individual
com uma cópia da variante guardada, a lead e a mailbox selecionadas. Exige
permissão de lançamento, confirmação explícita, mailbox selecionada e pronta,
e os gates normais do worker. No canary, só este teste individual de um único
destinatário da campanha pode enviar fora da allowlist; as campanhas normais
continuam limitadas à allowlist. Opt-out, supressão, quota diária e rampa da
mailbox continuam ativos. O histórico de testes aparece na campanha original; `sent` prova
que o Gmail aceitou o envio, mas a colocação na caixa de entrada deve ser
confirmada no destinatário. O teste não altera destinatários, jobs ou métricas
da campanha original.

A promoção final requer UUID de um administrador CRM ativo:

```bash
./outreach-control.sh live --approve-live <profile-uuid>
```

### Primeiro teste e recuperação da reputação

O primeiro teste é um único envio da Mia para `joaomilhazes71@gmail.com`,
através de uma campanha em rascunho com limite de 1 mensagem/dia. Antes do
lançamento, confirmar o controlo da caixa de destino e registar a base legal e
a evidência de verificação do endereço. Rever SPF, DKIM, DMARC e MX no CRM nas
24 horas anteriores. Um registo DMARC válido com `p=none` satisfaz o requisito
de autenticação do Gmail; o resultado da verificação deve conservar a política
e indicar separadamente que não há enforcement. Depois do envio, comparar o
job `sent` com a mensagem no Gmail Sent e verificar na caixa de destino a
localização, os cabeçalhos `Authentication-Results` e eventuais erros ou
respostas. Um único email não mede reputação nem prova entregabilidade futura.

O indicador percentual de “saúde” atualmente mostrado no CRM é um índice de
configuração (ligação, DNS e hard bounces). **Não representa a reputação que o
Gmail atribui ao domínio ou ao IP.** Para decisões de expansão ou recuperação,
consultar também os sinais de entrega e os [Google Postmaster Tools](https://support.google.com/mail/answer/14668346?hl=en).
Em volume muito baixo, o Postmaster pode não apresentar dados; a ausência de
um valor não deve ser tratada como reputação boa.

Quando surgirem reclamações, hard bounces, falhas de autenticação, erros de
rate limit ou deterioração da reputação, seguir esta rotina:

1. **Parar e preservar evidência.** Em canary, uma reclamação ou hard bounce já
   desliga automaticamente o envio. Para outros sinais, usar `outreach-control.sh
   disable`; isto pausa campanhas, reconcilia jobs potencialmente enviados e
   repõe a rampa em 1. Em produção, manter também o limiar automático existente
   de reclamações (0,1%) e de hard bounces (5% em 30 dias). Com poucos envios,
   investigar o evento individual antes de interpretar percentagens.
2. **Diagnosticar.** Verificar logs e códigos de erro, consentimento, qualidade
   da lista, supressões, conteúdo, SPF/DKIM/DMARC e cabeçalhos reais. Comparar
   spam rate, reputação do domínio e erros de entrega no Postmaster. Uma falha
   temporária/rate limit exige pausa e retry com espera exponencial, não uma
   sequência de tentativas rápidas. Reclamações e endereços inválidos devem
   sair da audiência, sem reenvio automático.
3. **Recomeçar com controlo humano.** Depois de corrigida a causa, voltar a
   `canary` apenas com destinatários reais que esperam a mensagem. Usar a rampa
   existente 1→3→5→10 mensagens/dia por mailbox; cada avanço requer pelo menos
   48 horas sem incidente e um envio confirmado no patamar atual. Rever sinais
   de entrega e Postmaster antes de avançar; se os dados do Postmaster ainda
   não existirem, não inferir recuperação a partir do silêncio do dashboard.
   Se ocorrer novo incidente, parar e repetir o diagnóstico desde o início.

Os patamares 1→3→5→10 e a espera de 48 horas são regras internas conservadoras,
não números prescritos pelo Gmail. O Google recomenda volume crescente e
constante, envio a pessoas que querem recebê-lo, spam reportado abaixo de
0,1% e prevenção de 0,3% ou mais; a recuperação da reputação pode levar dias.
Consultar as [diretrizes do Gmail](https://support.google.com/mail/answer/81126?hl=en),
o [FAQ de spam rate](https://support.google.com/mail/answer/14229414?hl=en)
e a [orientação para erros temporários](https://support.google.com/mail/answer/14668346?hl=en).
Não usar trocas artificiais de mensagens ou redes de seed como substituto de
destinatários interessados.

## Verificação de leads existentes

Em **Outreach → Audiências**, a coluna **Verificar** permite escolher até 25
contactos de cada vez, mesmo quando ainda não são elegíveis para campanha.
**Verificar leads** usa a verificação interna do CRM: sintaxe, domínio,
registos MX e, na ausência de MX, registos A/AAAA. Só o domínio entra na
consulta DNS; o endereço completo não é enviado a um fornecedor de
verificação. Null MX ou domínio sem rota de entrega é inválido; domínios
descartáveis e caixas funcionais são assinalados como arriscados. Um domínio
com correio configurado fica **inconclusivo** quanto à existência da caixa
específica e não se torna elegível para campanha por esse motivo. A regra
de A/AAAA como MX implícito segue a [RFC 5321](https://www.rfc-editor.org/rfc/rfc5321.html);
o null MX segue a [RFC 7505](https://www.rfc-editor.org/rfc/rfc7505.html).
Na importação CSV de **Empresas e leads**, um administrador pode assinalar
**Verificar leads após importar** para um lote de até 25 endereços. A importação
termina primeiro; se a verificação falhar, os contactos permanecem no CRM.
Não há chave, créditos nem pedidos a fornecedores externos.

Uma resposta de email ligada ao endereço atual ou outra prova documentada
pode ser registada por um administrador no fluxo de evidência existente. Uma
nova consulta DNS inconclusiva preserva uma prova anterior ainda válida; uma
consulta que identifica endereço inválido ou arriscado bloqueia o envio.
Verificação técnica não substitui base legal nem ignora supressões. O estado
de elegibilidade usa o resultado decisivo mais recente do endereço atual.

## Kill switch e rollback

```bash
./outreach-control.sh disable
```

Isto corta outbound nas duas camadas e recria API/worker. Inbound, unsubscribe e
reconciliação continuam ativos. Antes de parar o worker, pausar campanhas e
leases; reconciliar Gmail Sent antes de qualquer retry. O frontend/API pode
voltar à imagem anterior, mas migrations aditivas não são revertidas. Um restauro
completo da base é reservado a desastre para não apagar alterações CRM válidas.

Para voltar a uma release completa, executar manualmente o workflow de produção
com `rollback_release_id=<git-sha>-<run-id>-<attempt>`. Só releases que já
publicaram backend e web com capability/manifests de rollback são elegíveis. A
operação pára API e worker, força `OUTREACH_SEND_ENABLED=false` e
`disabled:false`, prova que as migrations alvo já estão no ledger, reativa a
imagem API/worker e o bundle web exatos e corre o sentinel imediatamente antes
e depois do web.
O fingerprint do ledger tem de permanecer igual: rollback de aplicação nunca é
rollback de schema. A promoção posterior para canary/live continua a exigir o
fluxo e aprovações normais.

## Rotação de chaves

Adicionar a nova versão a `OUTREACH_ENCRYPTION_KEYS`, definir
`OUTREACH_ENCRYPTION_CURRENT_VERSION`, recriar API/worker e executar o comando de
recifra. Só retirar a chave anterior depois de a auditoria confirmar zero
segredos nessa versão.

```bash
docker compose --env-file .env -f docker-compose.yml \
  -f docker-compose.production.yml run --rm outreach-api \
  node dist/rotate-keys.js --apply

# Depois da recifra, executar novamente em modo de verificação (sem --apply).
# Só é seguro retirar a chave antiga quando este comando devolver
# retirementReady=true, pending=0 e safeToRetireAfter=null.
docker compose --env-file .env -f docker-compose.yml \
  -f docker-compose.production.yml run --rm outreach-api \
  node dist/rotate-keys.js
```

Se `safeToRetireAfter` tiver uma data, os OAuth states antigos foram
invalidados mas ainda estão dentro da janela de expiração. Manter a chave
anterior até essa data, repetir o comando com `--apply` para purgar os states
expirados e voltar a executar a verificação. Nunca retirar uma chave apenas
porque a primeira execução terminou sem erro.
