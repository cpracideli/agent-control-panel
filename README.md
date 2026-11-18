# Agent Control

Painel web (React + Vite, backend Express) para o [claude-zap](https://github.com/cpracideli/claude-zap):

- **Chat** com o agente direto no navegador, com respostas ao vivo (texto, ferramentas e resultados), várias conversas, provider/modelo/esforço por conversa, parar tarefa.
- **MCP**: lista, testa (`claude mcp list`), adiciona (stdio, HTTP, SSE, com presets) e remove servidores do Claude Code e do Antigravity.
- **Providers**: provider/modelo/esforço padrão, ajuste por conversa do WhatsApp, versões e credenciais (via Coolify).
- **Agendamentos**: criar, editar, pausar, rodar agora, remover.
- **Painel**: status do container e do bridge, tarefas em andamento, custo, reiniciar/redeploy, enviar WhatsApp.
- **Variáveis** do Coolify e **Logs** (container ao vivo + auditoria).

## Variáveis

| Variável | Uso |
|---|---|
| `ADMIN_PASSWORD` | Senha de login (obrigatória) |
| `COOLIFY_URL`, `COOLIFY_TOKEN`, `COOLIFY_APP_UUID` | API do Coolify e app do claude-zap |
| `BRIDGE_URL` | Padrão `http://claude-bridge-claude-zap:3000` (rede interna `coolify`) |
| `BRIDGE_ADMIN_TOKEN` | Mesmo valor configurado no claude-zap |
| `SESSION_SECRET` | Opcional; assina o cookie de sessão |

## Desenvolvimento

```bash
npm install
BRIDGE_URL=http://localhost:3000 BRIDGE_ADMIN_TOKEN=... ADMIN_PASSWORD=... node server.js   # API em :3001
npm run dev                                                                                  # Vite em :5173
```

Deploy: Coolify com build pack Dockerfile (porta 3001).
