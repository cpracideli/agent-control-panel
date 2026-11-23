# Agent Control

Painel web (React + Vite, backend Express) para o [claude-zap](https://github.com/cpracideli/claude-zap):

- **Chat** com o agente direto no navegador, respostas ao vivo (texto, ferramentas, arquivos e voz), múltiplas conversas e seletor de provider/modelo/esforço por conversa.
- **Bots & Engenharia**: personas com instruções próprias, memória isolada, Board/Kanban, tarefas paralelas e delegação entre bots.
- **Computador ao Vivo & Local Bridge**: navegador visível no servidor (noVNC + Chromium persistente) e pareamento opcional com seu Mac/PC.
- **Páginas / Mini-Apps**: dashboards e apps HTML com banco JSON persistente (`/p/:id/:token/data`).
- **Cofre, Skills, MCP & Agendamentos**: segredos criptografados (AES-GCM + TOTP), habilidades reutilizáveis, gerenciamento de MCPs e rotinas com cron/webhook/watch.
- **Estado, Uso & Logs**: monitoramento do sistema, cotas/gastos por provider e (quando configurado) variáveis/logs/restart direto no Coolify.
- **PWA instalável + Web Push**: layout desktop e mobile, tema claro/escuro/terminal e suporte a `pt-BR`, `en`, `es`.

## Instalação recomendada (Stack 1-clique no Coolify)

Para subir **ponte + painel juntos** em um único recurso do Coolify (com Computador ao Vivo, voz e Claude Code prontos no primeiro boot), use o [`docker-compose.stack.yml`](https://github.com/cpracideli/claude-zap/blob/main/docker-compose.stack.yml) do repositório `claude-zap`.

## Variáveis de ambiente

Veja também [`.env.example`](.env.example).

| Variável | Obrigatória | Uso |
|---|---|---|
| `ADMIN_PASSWORD` | sim* | Senha de login no painel (*ou configure Google OAuth abaixo) |
| `BRIDGE_ADMIN_TOKEN` | sim | Mesmo token configurado na ponte (`claude-zap`) |
| `BRIDGE_URL` | sim | Endereço da ponte (`http://claude-bridge:3000` no stack único) |
| `PORT` | não | Porta HTTP do painel (padrão `3001`) |
| `SESSION_SECRET` | não | Chave para assinar cookies de sessão |
| `PUBLIC_URL` | recomendado | URL pública HTTPS do painel (OAuth, Web Push, links de webhooks e Mini-Apps) |
| `VAPID_SUBJECT` | não | Identificador VAPID (`mailto:...` ou `https://...`); se vazio usa o primeiro e-mail permitido ou `PUBLIC_URL` |
| `GOOGLE_OAUTH_CLIENT_ID` | não | Client ID do Google OAuth |
| `GOOGLE_OAUTH_CLIENT_SECRET` | não | Client Secret do Google OAuth |
| `ALLOWED_AUTH_EMAILS` | não | Lista de e-mails autorizados no login Google (separados por vírgula) |
| `COOLIFY_URL` | não | URL base da sua instância Coolify (ex.: `https://coolify.exemplo.com`) |
| `COOLIFY_TOKEN` | não | Token de API do Coolify |
| `COOLIFY_APP_UUID` | não | UUID da aplicação `claude-zap` no Coolify (habilita Envs/Logs/Restart/Deploy pelo painel) |

## Desenvolvimento local

```bash
npm install
BRIDGE_URL=http://localhost:3000 BRIDGE_ADMIN_TOKEN=... ADMIN_PASSWORD=... node server.js   # API em :3001
npm run dev                                                                                  # Vite em :5173
```

Deploy standalone: build pack `Dockerfile` (porta `3001`).
