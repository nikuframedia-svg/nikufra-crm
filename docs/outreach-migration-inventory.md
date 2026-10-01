# Inventário de migração Outreach

Inventário fechado em 2026-09-30 antes da integração no CRM.

## Fonte preservada

- Aplicação de referência: `/Users/joaomilhazes/nikufra-outreach` (read-only durante a migração).
- Arquivo cifrado autenticado: `outreach-20260930T150602Z-86f78826.noutbak`.
- Tamanho: `319914` bytes.
- SHA-256 do arquivo: `05bc193745174b1253cb57f69229516cec4d622e964351f57f431aa3adfc8bd6`.
- Chave: ficheiro separado, normal, sem symlink e em modo `0600`; não faz parte deste repositório nem acompanha o arquivo.
- Segunda cópia offsite verificada em `gdrive:crm-backups/legacy-outreach/`; inclui o arquivo cifrado e `SHA256SUMS`, mas não inclui a chave.
- O restauro foi ensaiado numa base temporária e a base temporária foi eliminada no fim.

## Conteúdo lógico verificado

| Coleção legada | Registos |
|---|---:|
| Snapshots de workspace | 1 |
| Ligações de provider | 3 |
| Mailboxes | 3 |
| Leads | 0 |
| Campanhas | 0 |
| Mensagens | 0 |
| Jobs | 0 |
| Suppressions | 0 |

SHA-256 do snapshot JSON canónico: `842c925eb78494ce8075485e2a2528396c3268236074d49b5c6e8660905fa764`.

As três mailboxes são importadas apenas como metadata, com limite inicial de 10/dia, `send_enabled=false` e estado desligado. Credenciais, OAuth states, webhooks, tokens de unsubscribe e a chave cifrada local nunca são importados. Cada conta terá de ser autorizada novamente em produção.
