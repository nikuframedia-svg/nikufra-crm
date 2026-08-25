# Releases da aplicação desktop

O canal de distribuição produz um DMG universal para macOS e um instalador NSIS x64 para Windows. Ambos são assinados pelo respetivo sistema operativo; os pacotes de atualização recebem ainda uma assinatura Tauri independente. A publicação só acontece depois de todas as assinaturas serem verificadas e o payload completo ser enviado atomicamente para `crm.nikufra.ai`.

## Configuração única

### macOS

É necessária uma subscrição Apple Developer ativa, um certificado **Developer ID Application** exportado em P12 e credenciais de notarização. Configurar estes GitHub Actions secrets:

- `APPLE_CERTIFICATE`: P12 codificado em base64 numa única linha.
- `APPLE_CERTIFICATE_PASSWORD`: palavra-passe de exportação do P12.
- `APPLE_KEYCHAIN_PASSWORD`: palavra-passe aleatória usada apenas pelo keychain efémero do runner.
- `APPLE_ID`: conta Apple Developer.
- `APPLE_PASSWORD`: palavra-passe específica de app criada em `appleid.apple.com`.
- `APPLE_TEAM_ID`: Team ID da subscrição Apple Developer.

Referência oficial: <https://v2.tauri.app/distribute/sign/macos/>.

### Windows

O workflow usa Azure Artifact Signing para evitar certificados privados exportáveis no GitHub. Criar uma conta e um perfil de assinatura Azure, dar à aplicação Entra os papéis necessários e configurar:

- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TENANT_ID`
- `AZURE_ARTIFACT_SIGNING_ENDPOINT`
- `AZURE_ARTIFACT_SIGNING_ACCOUNT`
- `AZURE_ARTIFACT_SIGNING_PROFILE`

Referência oficial: <https://v2.tauri.app/distribute/sign/windows/#azure-artifact-signing>.

O portão CI recusa qualquer release se uma destas configurações estiver vazia. Depois do build, `codesign`, Gatekeeper/stapler e Authenticode confirmam os artefactos antes de a publicação poder avançar.

## Publicar uma atualização

Partir sempre de `main` limpa e atualizada. Para a primeira publicação da versão atual:

```bash
pnpm release:publish 0.1.0
```

Para cada atualização seguinte, substituir `0.1.1` pela nova versão:

```bash
pnpm release:publish 0.1.1
```

O comando exige a confirmação exata da tag, confirma que `main` está limpa e sincronizada e executa todos os testes. Na primeira publicação aplica a tag à versão atual; nas seguintes alinha as quatro fontes de versão e cria o commit. O envio de `main` e da tag é sempre um único push atómico. Se a ligação falhar depois de criar a tag local, apresenta o comando exato para retomar sem recriar a release.

A tag inicia automaticamente:

1. validação da tag e de todos os segredos obrigatórios;
2. build universal macOS e x64 Windows;
3. assinatura do sistema operativo, notarização Apple e assinatura do updater;
4. validação do manifesto e dos três alvos de update;
5. publicação atómica de `latest.json`, instaladores estáveis e assets;
6. promoção da release GitHub de rascunho para pública.

Os links permanentes para a equipa não mudam entre versões:

- `https://crm.nikufra.ai/updates/assets/Nikufra-CRM-macOS.dmg`
- `https://crm.nikufra.ai/updates/assets/Nikufra-CRM-Windows.exe`

## Correção urgente

Não se reutiliza nem se altera uma tag já publicada. Corrigir em `main`, aumentar a versão patch e repetir o processo. O cliente aceita apenas manifests com assinatura Tauri válida e nunca instala silenciosamente um binário que não corresponda à assinatura publicada.
