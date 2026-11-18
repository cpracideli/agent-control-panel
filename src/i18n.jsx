import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const pt = {
  'app.loading': 'Carregando…',
  'nav.chat': 'Chat', 'nav.overview': 'Painel', 'nav.providers': 'Providers', 'nav.mcp': 'MCP', 'nav.schedules': 'Agendamentos',
  'nav.envs': 'Variáveis', 'nav.logs': 'Logs', 'nav.logout': 'Sair', 'nav.menu': 'Menu',
  'theme.label': 'Tema', 'theme.system': 'Sistema', 'theme.light': 'Claro', 'theme.dark': 'Escuro', 'lang.label': 'Idioma',
  'pwa.install': 'Instalar app', 'pwa.update': 'Nova versão disponível', 'pwa.reload': 'Atualizar', 'pwa.offline': 'Sem conexão',

  'common.cancel': 'Cancelar', 'common.save': 'Salvar', 'common.saved': 'Salvo', 'common.remove': 'Remover', 'common.removed': 'Removido',
  'common.edit': 'Editar', 'common.view': 'Ver', 'common.hide': 'Ocultar', 'common.add': 'Adicionar', 'common.close': 'Fechar',
  'common.retry': 'tentar de novo', 'common.filter': 'Filtrar…', 'common.loading': 'Carregando…', 'common.empty': '(vazio)',
  'common.copy': 'copiar', 'common.copied': 'Copiado', 'common.default': 'padrão', 'common.defaultModel': 'modelo padrão',
  'common.defaultEffort': 'esforço padrão', 'common.newSession': 'Nova sessão', 'common.stop': 'Parar', 'common.stopped': 'Interrompido',
  'common.updated': 'Atualizado', 'common.running': 'rodando', 'common.errors': '{n} erros', 'common.ok': 'ok',
  'common.installed': 'instalado', 'common.notInstalled': 'não instalado', 'common.none': 'nenhuma',

  'login.subtitle': 'Chat, MCP, providers e controle do agente.', 'login.password': 'Senha de acesso',
  'login.submit': 'Entrar', 'login.busy': 'Entrando…',

  'chat.new': 'Nova conversa', 'chat.none': 'Nenhuma conversa ainda.', 'chat.msgs': '{n} msgs', 'chat.conversations': 'Conversas',
  'chat.emptyTitle': 'Fale com o agente',
  'chat.emptyText': 'Mesmo agente do WhatsApp, com as mesmas ferramentas, MCPs e memória. As respostas aparecem aqui ao vivo.',
  'chat.s1': 'Quais MCPs você tem disponíveis agora?', 'chat.s2': 'Liste meus agendamentos', 'chat.s3': 'Quanto espaço em disco o container está usando?',
  'chat.placeholder': 'Mensagem para o agente…', 'chat.send': 'Enviar',
  'chat.working': 'trabalhando…', 'chat.ready': 'pronto', 'chat.busy': 'trabalhando',
  'chat.toolsOne': '1 ferramenta usada', 'chat.toolsMany': '{n} ferramentas usadas', 'chat.steps': '{n} passos',
  'chat.queued': 'Na fila: {n} à frente', 'chat.deleteConfirm': 'Apagar esta conversa e o histórico dela?', 'chat.delete': 'Apagar',
  'chat.resetDone': 'A próxima mensagem começa uma sessão nova (o histórico daqui fica).',
  'chat.resetTitle': 'Esquece o contexto da IA, mantém o histórico na tela',
  'chat.foot': '{runs} execuções · {time} · {cost}', 'chat.session': 'sessão {id}',
  'chat.provider': 'Provider', 'chat.model': 'Modelo', 'chat.effort': 'Esforço', 'chat.accountDefault': 'padrão ({m})',

  'ov.container': 'Container', 'ov.bridge': 'Bridge', 'ov.upFor': 'no ar há {t}', 'ov.runs': 'Execuções', 'ov.withErrors': '{n} com erro',
  'ov.cost': 'Custo estimado', 'ov.work': '{t} de trabalho', 'ov.running': 'Em andamento', 'ov.nothing': 'Nada rodando agora.',
  'ov.ago': 'há {t}', 'ov.actions': 'Ações do container', 'ov.restart': 'Reiniciar', 'ov.redeploy': 'Redeploy',
  'ov.restartConfirm': 'Reiniciar o agente? Tarefas em andamento serão interrompidas.', 'ov.restartOk': 'Reinício solicitado',
  'ov.deployConfirm': 'Fazer redeploy do agente (puxa o compose do repo)?', 'ov.deployOk': 'Deploy enfileirado',
  'ov.envNote': 'Mudanças em variáveis só valem depois de reiniciar ou fazer redeploy.', 'ov.chats': 'Conversas',
  'ov.chatLine': '{p} · {n} execuções · {cost} · última {t}', 'ov.noChats': 'Nenhuma conversa ainda.',
  'ov.send': 'Enviar WhatsApp', 'ov.to': 'Para', 'ov.toHint': 'Número com DDI (ex. +55 11 99999-8888) ou id do WhatsApp',
  'ov.message': 'Mensagem', 'ov.sendBtn': 'Enviar pelo número do bot', 'ov.sent': 'Mensagem enviada', 'ov.offline': 'offline',

  'pr.globals': 'Padrões globais', 'pr.defaultProvider': 'Provider padrão', 'pr.defaultProviderHint': 'Usado por conversas que nunca escolheram um',
  'pr.claudeModel': 'Modelo Claude padrão', 'pr.envModel': 'CLAUDE_MODEL do ambiente: {m}', 'pr.noEnvModel': 'Sem CLAUDE_MODEL: usa o padrão da conta',
  'pr.accountDefault': 'padrão da conta', 'pr.claudeEffort': 'Esforço Claude padrão', 'pr.defaultUpdated': 'Padrão atualizado',
  'pr.auth.oauth': 'Assinatura (CLAUDE_CODE_OAUTH_TOKEN)', 'pr.auth.apikey': 'API key (ANTHROPIC_API_KEY)', 'pr.auth.none': 'sem credencial',
  'pr.version': 'Versão', 'pr.auth': 'Autenticação', 'pr.permissions': 'Permissões', 'pr.models': 'Modelos', 'pr.noModels': 'nenhum lido',
  'pr.installAgy': 'Peça ao agente no chat: "instale o Antigravity CLI (agy)".',
  'pr.perChat': 'Por conversa do WhatsApp', 'pr.perChatHint': 'Mesmo efeito de /provider, /model e /effort', 'pr.noWa': 'Nenhuma conversa do WhatsApp ainda.',
  'pr.creds': 'Credenciais e opções (Coolify)', 'pr.restartAgent': 'Reiniciar agente', 'pr.savedRestart': 'Salvo. Reinicie o agente para aplicar.',
  'pr.set': 'definido', 'pr.empty': 'vazio', 'pr.keepHint': 'digite o novo valor',
  'pr.c.oauth': 'Token da assinatura Claude', 'pr.c.oauthHint': 'Gerado com "claude setup-token" (sk-ant-oat01-…)',
  'pr.c.apikey': 'Anthropic API key', 'pr.c.apikeyHint': 'Alternativa ao token. Deixe vazio para usar a assinatura.',
  'pr.c.perm': 'Modo de permissão', 'pr.c.permHint': 'bypassPermissions (padrão) libera tudo',
  'pr.c.timeout': 'Tempo limite por tarefa (s)', 'pr.c.timeoutHint': 'Padrão 1800',

  'mcp.test': 'Testar conexões', 'mcp.testing': 'Testando…', 'mcp.none': 'Nenhum servidor MCP configurado.', 'mcp.listOutput': 'Saída de claude mcp list',
  'mcp.agyMissing': 'agy não está instalado no container.', 'mcp.agyEmpty': '(agy mcp list não retornou nada)', 'mcp.config': 'Config: {p}',
  'mcp.removeName': 'nome do MCP para remover', 'mcp.removeConfirm': 'Remover o MCP "{n}"?',
  'mcp.note': 'MCPs novos valem a partir da próxima mensagem (cada mensagem abre um processo novo do agente). Você também pode pedir no chat: "instale o MCP do …".',
  'mcp.addTitle': 'Adicionar servidor MCP', 'mcp.provider': 'Provider', 'mcp.name': 'Nome', 'mcp.transport': 'Transporte',
  'mcp.stdio': 'stdio (comando local)', 'mcp.scope': 'Escopo', 'mcp.scopeHint': 'user = todas as conversas', 'mcp.local': 'local (workspace)',
  'mcp.command': 'Comando', 'mcp.args': 'Argumentos', 'mcp.env': 'Variáveis de ambiente', 'mcp.envHint': 'Uma por linha: CHAVE=valor',
  'mcp.headers': 'Headers', 'mcp.headersHint': 'Um por linha: Nome=valor (ex. Authorization=Bearer …)',
  'mcp.agyNote': 'No Antigravity o painel roda "agy mcp add -- nome comando…". Se precisar de opções extras, peça ao agente pelo chat.',
  'mcp.adding': 'Adicionando…', 'mcp.added': 'MCP "{n}" adicionado. Vale a partir da próxima mensagem.',
  'mcp.p.playwright': 'Playwright (navegador)', 'mcp.p.context7': 'Context7 (docs de libs)', 'mcp.p.fetch': 'Fetch (páginas web)',
  'mcp.p.filesystem': 'Filesystem (workspace)', 'mcp.p.github': 'GitHub (remoto)',

  'sch.title': 'Agendamentos ({n})', 'sch.new': 'Novo', 'sch.none': 'Nenhum agendamento. Crie aqui ou peça no chat: "todo dia às 8h me mande…".',
  'sch.paused': 'pausado', 'sch.once': 'uma vez em {d}', 'sch.last': 'última {d}', 'sch.runNow': 'Rodar agora', 'sch.running': 'Executando agora',
  'sch.pause': 'Pausar', 'sch.resume': 'Retomar', 'sch.removeConfirm': 'Remover #{id}?', 'sch.editTitle': 'Editar agendamento #{id}',
  'sch.newTitle': 'Novo agendamento', 'sch.deliver': 'Entregar em', 'sch.deliverHint': 'A resposta final vai para esta conversa',
  'sch.when': 'Quando', 'sch.cron': 'Recorrente (cron)', 'sch.onceOpt': 'Uma vez', 'sch.cronHint': 'minuto hora dia mês dia-da-semana',
  'sch.datetime': 'Data e hora', 'sch.description': 'Descrição', 'sch.descPh': 'Resumo de notícias de IA', 'sch.prompt': 'Instrução',
  'sch.promptHint': 'Roda numa sessão nova, sem contexto: escreva tudo o que o agente precisa saber.',
  'sch.saved': 'Agendamento salvo', 'sch.created': 'Agendamento criado',
  'sch.c.daily': 'todo dia às 8h', 'sch.c.weekdays': 'dias úteis às 9h', 'sch.c.30': 'a cada 30 min', 'sch.c.fri': 'sexta às 18h',

  'env.title': 'Variáveis do agente', 'env.apply': 'Aplicar (reiniciar)', 'env.applyConfirm': 'Reiniciar o agente para aplicar as variáveis?',
  'env.new': 'Nova variável', 'env.name': 'NOME_DA_VARIAVEL', 'env.value': 'valor', 'env.savedKey': '{k} salvo', 'env.added': '{k} adicionada',
  'env.removeConfirm': 'Remover {k}?',

  'logs.container': 'Container', 'logs.audit': 'Auditoria', 'logs.lines': '{n} linhas', 'logs.live': 'ao vivo',
  'logs.auditTitle': 'Auditoria (envios, agendamentos, MCP)', 'logs.nothing': 'Nada registrado.', 'logs.failed': '(falhou)', 'logs.to': 'para {n}',
  'logs.a.send': 'Mensagem enviada', 'logs.a.send-file': 'Arquivo enviado', 'logs.a.schedule-add': 'Agendamento criado',
  'logs.a.schedule-delete': 'Agendamento removido', 'logs.a.mcp-add': 'MCP adicionado', 'logs.a.mcp-remove': 'MCP removido', 'logs.a.event': 'evento',
};

const en = {
  'app.loading': 'Loading…',
  'nav.chat': 'Chat', 'nav.overview': 'Overview', 'nav.providers': 'Providers', 'nav.mcp': 'MCP', 'nav.schedules': 'Schedules',
  'nav.envs': 'Variables', 'nav.logs': 'Logs', 'nav.logout': 'Sign out', 'nav.menu': 'Menu',
  'theme.label': 'Theme', 'theme.system': 'System', 'theme.light': 'Light', 'theme.dark': 'Dark', 'lang.label': 'Language',
  'pwa.install': 'Install app', 'pwa.update': 'New version available', 'pwa.reload': 'Reload', 'pwa.offline': 'Offline',

  'common.cancel': 'Cancel', 'common.save': 'Save', 'common.saved': 'Saved', 'common.remove': 'Remove', 'common.removed': 'Removed',
  'common.edit': 'Edit', 'common.view': 'View', 'common.hide': 'Hide', 'common.add': 'Add', 'common.close': 'Close',
  'common.retry': 'try again', 'common.filter': 'Filter…', 'common.loading': 'Loading…', 'common.empty': '(empty)',
  'common.copy': 'copy', 'common.copied': 'Copied', 'common.default': 'default', 'common.defaultModel': 'default model',
  'common.defaultEffort': 'default effort', 'common.newSession': 'New session', 'common.stop': 'Stop', 'common.stopped': 'Stopped',
  'common.updated': 'Updated', 'common.running': 'running', 'common.errors': '{n} errors', 'common.ok': 'ok',
  'common.installed': 'installed', 'common.notInstalled': 'not installed', 'common.none': 'none',

  'login.subtitle': 'Chat, MCP, providers and agent control.', 'login.password': 'Access password',
  'login.submit': 'Sign in', 'login.busy': 'Signing in…',

  'chat.new': 'New chat', 'chat.none': 'No conversations yet.', 'chat.msgs': '{n} msgs', 'chat.conversations': 'Conversations',
  'chat.emptyTitle': 'Talk to the agent',
  'chat.emptyText': 'Same agent as on WhatsApp, with the same tools, MCPs and memory. Answers stream here live.',
  'chat.s1': 'Which MCPs do you have available right now?', 'chat.s2': 'List my schedules', 'chat.s3': 'How much disk space is the container using?',
  'chat.placeholder': 'Message the agent…', 'chat.send': 'Send',
  'chat.working': 'working…', 'chat.ready': 'ready', 'chat.busy': 'working',
  'chat.toolsOne': '1 tool used', 'chat.toolsMany': '{n} tools used', 'chat.steps': '{n} steps',
  'chat.queued': 'Queued: {n} ahead', 'chat.deleteConfirm': 'Delete this conversation and its history?', 'chat.delete': 'Delete',
  'chat.resetDone': 'The next message starts a new session (the history here stays).',
  'chat.resetTitle': 'Forgets the AI context, keeps the history on screen',
  'chat.foot': '{runs} runs · {time} · {cost}', 'chat.session': 'session {id}',
  'chat.provider': 'Provider', 'chat.model': 'Model', 'chat.effort': 'Effort', 'chat.accountDefault': 'default ({m})',

  'ov.container': 'Container', 'ov.bridge': 'Bridge', 'ov.upFor': 'up for {t}', 'ov.runs': 'Runs', 'ov.withErrors': '{n} failed',
  'ov.cost': 'Estimated cost', 'ov.work': '{t} of work', 'ov.running': 'Running', 'ov.nothing': 'Nothing running right now.',
  'ov.ago': '{t} ago', 'ov.actions': 'Container actions', 'ov.restart': 'Restart', 'ov.redeploy': 'Redeploy',
  'ov.restartConfirm': 'Restart the agent? Running tasks will be interrupted.', 'ov.restartOk': 'Restart requested',
  'ov.deployConfirm': 'Redeploy the agent (pulls the compose file from the repo)?', 'ov.deployOk': 'Deploy queued',
  'ov.envNote': 'Variable changes only apply after a restart or redeploy.', 'ov.chats': 'Conversations',
  'ov.chatLine': '{p} · {n} runs · {cost} · last {t}', 'ov.noChats': 'No conversations yet.',
  'ov.send': 'Send WhatsApp', 'ov.to': 'To', 'ov.toHint': 'Number with country code (e.g. +55 11 99999-8888) or a WhatsApp id',
  'ov.message': 'Message', 'ov.sendBtn': 'Send from the bot number', 'ov.sent': 'Message sent', 'ov.offline': 'offline',

  'pr.globals': 'Global defaults', 'pr.defaultProvider': 'Default provider', 'pr.defaultProviderHint': 'Used by conversations that never picked one',
  'pr.claudeModel': 'Default Claude model', 'pr.envModel': 'CLAUDE_MODEL from the environment: {m}', 'pr.noEnvModel': 'No CLAUDE_MODEL: uses the account default',
  'pr.accountDefault': 'account default', 'pr.claudeEffort': 'Default Claude effort', 'pr.defaultUpdated': 'Default updated',
  'pr.auth.oauth': 'Subscription (CLAUDE_CODE_OAUTH_TOKEN)', 'pr.auth.apikey': 'API key (ANTHROPIC_API_KEY)', 'pr.auth.none': 'no credentials',
  'pr.version': 'Version', 'pr.auth': 'Authentication', 'pr.permissions': 'Permissions', 'pr.models': 'Models', 'pr.noModels': 'none read',
  'pr.installAgy': 'Ask the agent in the chat: "install the Antigravity CLI (agy)".',
  'pr.perChat': 'Per WhatsApp conversation', 'pr.perChatHint': 'Same as /provider, /model and /effort', 'pr.noWa': 'No WhatsApp conversations yet.',
  'pr.creds': 'Credentials and options (Coolify)', 'pr.restartAgent': 'Restart agent', 'pr.savedRestart': 'Saved. Restart the agent to apply.',
  'pr.set': 'set', 'pr.empty': 'empty', 'pr.keepHint': 'type the new value',
  'pr.c.oauth': 'Claude subscription token', 'pr.c.oauthHint': 'Generated with "claude setup-token" (sk-ant-oat01-…)',
  'pr.c.apikey': 'Anthropic API key', 'pr.c.apikeyHint': 'Alternative to the token. Leave empty to use the subscription.',
  'pr.c.perm': 'Permission mode', 'pr.c.permHint': 'bypassPermissions (default) allows everything',
  'pr.c.timeout': 'Task timeout (s)', 'pr.c.timeoutHint': 'Default 1800',

  'mcp.test': 'Test connections', 'mcp.testing': 'Testing…', 'mcp.none': 'No MCP servers configured.', 'mcp.listOutput': 'Output of claude mcp list',
  'mcp.agyMissing': 'agy is not installed in the container.', 'mcp.agyEmpty': '(agy mcp list returned nothing)', 'mcp.config': 'Config: {p}',
  'mcp.removeName': 'MCP name to remove', 'mcp.removeConfirm': 'Remove the MCP "{n}"?',
  'mcp.note': 'New MCPs apply from the next message (each message starts a new agent process). You can also ask in the chat: "install the … MCP".',
  'mcp.addTitle': 'Add MCP server', 'mcp.provider': 'Provider', 'mcp.name': 'Name', 'mcp.transport': 'Transport',
  'mcp.stdio': 'stdio (local command)', 'mcp.scope': 'Scope', 'mcp.scopeHint': 'user = all conversations', 'mcp.local': 'local (workspace)',
  'mcp.command': 'Command', 'mcp.args': 'Arguments', 'mcp.env': 'Environment variables', 'mcp.envHint': 'One per line: KEY=value',
  'mcp.headers': 'Headers', 'mcp.headersHint': 'One per line: Name=value (e.g. Authorization=Bearer …)',
  'mcp.agyNote': 'For Antigravity the panel runs "agy mcp add -- name command…". For extra options, ask the agent in the chat.',
  'mcp.adding': 'Adding…', 'mcp.added': 'MCP "{n}" added. It applies from the next message.',
  'mcp.p.playwright': 'Playwright (browser)', 'mcp.p.context7': 'Context7 (library docs)', 'mcp.p.fetch': 'Fetch (web pages)',
  'mcp.p.filesystem': 'Filesystem (workspace)', 'mcp.p.github': 'GitHub (remote)',

  'sch.title': 'Schedules ({n})', 'sch.new': 'New', 'sch.none': 'No schedules. Create one here or ask in the chat: "every day at 8am send me…".',
  'sch.paused': 'paused', 'sch.once': 'once at {d}', 'sch.last': 'last {d}', 'sch.runNow': 'Run now', 'sch.running': 'Running now',
  'sch.pause': 'Pause', 'sch.resume': 'Resume', 'sch.removeConfirm': 'Remove #{id}?', 'sch.editTitle': 'Edit schedule #{id}',
  'sch.newTitle': 'New schedule', 'sch.deliver': 'Deliver to', 'sch.deliverHint': 'The final answer goes to this conversation',
  'sch.when': 'When', 'sch.cron': 'Recurring (cron)', 'sch.onceOpt': 'Once', 'sch.cronHint': 'minute hour day month weekday',
  'sch.datetime': 'Date and time', 'sch.description': 'Description', 'sch.descPh': 'AI news digest', 'sch.prompt': 'Instruction',
  'sch.promptHint': 'Runs in a fresh session with no context: write everything the agent needs to know.',
  'sch.saved': 'Schedule saved', 'sch.created': 'Schedule created',
  'sch.c.daily': 'every day at 8am', 'sch.c.weekdays': 'weekdays at 9am', 'sch.c.30': 'every 30 min', 'sch.c.fri': 'Friday at 6pm',

  'env.title': 'Agent variables', 'env.apply': 'Apply (restart)', 'env.applyConfirm': 'Restart the agent to apply the variables?',
  'env.new': 'New variable', 'env.name': 'VARIABLE_NAME', 'env.value': 'value', 'env.savedKey': '{k} saved', 'env.added': '{k} added',
  'env.removeConfirm': 'Remove {k}?',

  'logs.container': 'Container', 'logs.audit': 'Audit', 'logs.lines': '{n} lines', 'logs.live': 'live',
  'logs.auditTitle': 'Audit (messages, schedules, MCP)', 'logs.nothing': 'Nothing recorded.', 'logs.failed': '(failed)', 'logs.to': 'to {n}',
  'logs.a.send': 'Message sent', 'logs.a.send-file': 'File sent', 'logs.a.schedule-add': 'Schedule created',
  'logs.a.schedule-delete': 'Schedule removed', 'logs.a.mcp-add': 'MCP added', 'logs.a.mcp-remove': 'MCP removed', 'logs.a.event': 'event',
};

const es = {
  'app.loading': 'Cargando…',
  'nav.chat': 'Chat', 'nav.overview': 'Panel', 'nav.providers': 'Proveedores', 'nav.mcp': 'MCP', 'nav.schedules': 'Programaciones',
  'nav.envs': 'Variables', 'nav.logs': 'Logs', 'nav.logout': 'Salir', 'nav.menu': 'Menú',
  'theme.label': 'Tema', 'theme.system': 'Sistema', 'theme.light': 'Claro', 'theme.dark': 'Oscuro', 'lang.label': 'Idioma',
  'pwa.install': 'Instalar app', 'pwa.update': 'Nueva versión disponible', 'pwa.reload': 'Actualizar', 'pwa.offline': 'Sin conexión',

  'common.cancel': 'Cancelar', 'common.save': 'Guardar', 'common.saved': 'Guardado', 'common.remove': 'Eliminar', 'common.removed': 'Eliminado',
  'common.edit': 'Editar', 'common.view': 'Ver', 'common.hide': 'Ocultar', 'common.add': 'Agregar', 'common.close': 'Cerrar',
  'common.retry': 'reintentar', 'common.filter': 'Filtrar…', 'common.loading': 'Cargando…', 'common.empty': '(vacío)',
  'common.copy': 'copiar', 'common.copied': 'Copiado', 'common.default': 'predeterminado', 'common.defaultModel': 'modelo predeterminado',
  'common.defaultEffort': 'esfuerzo predeterminado', 'common.newSession': 'Nueva sesión', 'common.stop': 'Detener', 'common.stopped': 'Detenido',
  'common.updated': 'Actualizado', 'common.running': 'ejecutando', 'common.errors': '{n} errores', 'common.ok': 'ok',
  'common.installed': 'instalado', 'common.notInstalled': 'no instalado', 'common.none': 'ninguna',

  'login.subtitle': 'Chat, MCP, proveedores y control del agente.', 'login.password': 'Contraseña de acceso',
  'login.submit': 'Entrar', 'login.busy': 'Entrando…',

  'chat.new': 'Nueva conversación', 'chat.none': 'Aún no hay conversaciones.', 'chat.msgs': '{n} msgs', 'chat.conversations': 'Conversaciones',
  'chat.emptyTitle': 'Habla con el agente',
  'chat.emptyText': 'El mismo agente de WhatsApp, con las mismas herramientas, MCPs y memoria. Las respuestas aparecen aquí en vivo.',
  'chat.s1': '¿Qué MCPs tienes disponibles ahora?', 'chat.s2': 'Lista mis programaciones', 'chat.s3': '¿Cuánto disco está usando el contenedor?',
  'chat.placeholder': 'Mensaje para el agente…', 'chat.send': 'Enviar',
  'chat.working': 'trabajando…', 'chat.ready': 'listo', 'chat.busy': 'trabajando',
  'chat.toolsOne': '1 herramienta usada', 'chat.toolsMany': '{n} herramientas usadas', 'chat.steps': '{n} pasos',
  'chat.queued': 'En cola: {n} por delante', 'chat.deleteConfirm': '¿Borrar esta conversación y su historial?', 'chat.delete': 'Borrar',
  'chat.resetDone': 'El próximo mensaje inicia una sesión nueva (el historial se mantiene).',
  'chat.resetTitle': 'Olvida el contexto de la IA, mantiene el historial en pantalla',
  'chat.foot': '{runs} ejecuciones · {time} · {cost}', 'chat.session': 'sesión {id}',
  'chat.provider': 'Proveedor', 'chat.model': 'Modelo', 'chat.effort': 'Esfuerzo', 'chat.accountDefault': 'predeterminado ({m})',

  'ov.container': 'Contenedor', 'ov.bridge': 'Bridge', 'ov.upFor': 'activo hace {t}', 'ov.runs': 'Ejecuciones', 'ov.withErrors': '{n} con error',
  'ov.cost': 'Costo estimado', 'ov.work': '{t} de trabajo', 'ov.running': 'En curso', 'ov.nothing': 'Nada en ejecución ahora.',
  'ov.ago': 'hace {t}', 'ov.actions': 'Acciones del contenedor', 'ov.restart': 'Reiniciar', 'ov.redeploy': 'Redeploy',
  'ov.restartConfirm': '¿Reiniciar el agente? Las tareas en curso se interrumpirán.', 'ov.restartOk': 'Reinicio solicitado',
  'ov.deployConfirm': '¿Hacer redeploy del agente (toma el compose del repo)?', 'ov.deployOk': 'Deploy en cola',
  'ov.envNote': 'Los cambios de variables solo aplican tras reiniciar o hacer redeploy.', 'ov.chats': 'Conversaciones',
  'ov.chatLine': '{p} · {n} ejecuciones · {cost} · última {t}', 'ov.noChats': 'Aún no hay conversaciones.',
  'ov.send': 'Enviar WhatsApp', 'ov.to': 'Para', 'ov.toHint': 'Número con código de país (ej. +55 11 99999-8888) o id de WhatsApp',
  'ov.message': 'Mensaje', 'ov.sendBtn': 'Enviar desde el número del bot', 'ov.sent': 'Mensaje enviado', 'ov.offline': 'sin conexión',

  'pr.globals': 'Valores globales', 'pr.defaultProvider': 'Proveedor predeterminado', 'pr.defaultProviderHint': 'Para conversaciones que nunca eligieron uno',
  'pr.claudeModel': 'Modelo Claude predeterminado', 'pr.envModel': 'CLAUDE_MODEL del entorno: {m}', 'pr.noEnvModel': 'Sin CLAUDE_MODEL: usa el de la cuenta',
  'pr.accountDefault': 'predeterminado de la cuenta', 'pr.claudeEffort': 'Esfuerzo Claude predeterminado', 'pr.defaultUpdated': 'Valor actualizado',
  'pr.auth.oauth': 'Suscripción (CLAUDE_CODE_OAUTH_TOKEN)', 'pr.auth.apikey': 'API key (ANTHROPIC_API_KEY)', 'pr.auth.none': 'sin credenciales',
  'pr.version': 'Versión', 'pr.auth': 'Autenticación', 'pr.permissions': 'Permisos', 'pr.models': 'Modelos', 'pr.noModels': 'ninguno leído',
  'pr.installAgy': 'Pídele al agente en el chat: "instala el Antigravity CLI (agy)".',
  'pr.perChat': 'Por conversación de WhatsApp', 'pr.perChatHint': 'Igual que /provider, /model y /effort', 'pr.noWa': 'Aún no hay conversaciones de WhatsApp.',
  'pr.creds': 'Credenciales y opciones (Coolify)', 'pr.restartAgent': 'Reiniciar agente', 'pr.savedRestart': 'Guardado. Reinicia el agente para aplicar.',
  'pr.set': 'definido', 'pr.empty': 'vacío', 'pr.keepHint': 'escribe el nuevo valor',
  'pr.c.oauth': 'Token de suscripción Claude', 'pr.c.oauthHint': 'Generado con "claude setup-token" (sk-ant-oat01-…)',
  'pr.c.apikey': 'API key de Anthropic', 'pr.c.apikeyHint': 'Alternativa al token. Déjalo vacío para usar la suscripción.',
  'pr.c.perm': 'Modo de permisos', 'pr.c.permHint': 'bypassPermissions (predeterminado) permite todo',
  'pr.c.timeout': 'Tiempo límite por tarea (s)', 'pr.c.timeoutHint': 'Predeterminado 1800',

  'mcp.test': 'Probar conexiones', 'mcp.testing': 'Probando…', 'mcp.none': 'No hay servidores MCP configurados.', 'mcp.listOutput': 'Salida de claude mcp list',
  'mcp.agyMissing': 'agy no está instalado en el contenedor.', 'mcp.agyEmpty': '(agy mcp list no devolvió nada)', 'mcp.config': 'Config: {p}',
  'mcp.removeName': 'nombre del MCP a eliminar', 'mcp.removeConfirm': '¿Eliminar el MCP "{n}"?',
  'mcp.note': 'Los MCPs nuevos aplican desde el próximo mensaje (cada mensaje abre un proceso nuevo del agente). También puedes pedirlo en el chat: "instala el MCP de …".',
  'mcp.addTitle': 'Agregar servidor MCP', 'mcp.provider': 'Proveedor', 'mcp.name': 'Nombre', 'mcp.transport': 'Transporte',
  'mcp.stdio': 'stdio (comando local)', 'mcp.scope': 'Alcance', 'mcp.scopeHint': 'user = todas las conversaciones', 'mcp.local': 'local (workspace)',
  'mcp.command': 'Comando', 'mcp.args': 'Argumentos', 'mcp.env': 'Variables de entorno', 'mcp.envHint': 'Una por línea: CLAVE=valor',
  'mcp.headers': 'Headers', 'mcp.headersHint': 'Uno por línea: Nombre=valor (ej. Authorization=Bearer …)',
  'mcp.agyNote': 'En Antigravity el panel ejecuta "agy mcp add -- nombre comando…". Para opciones extra, pídelo al agente en el chat.',
  'mcp.adding': 'Agregando…', 'mcp.added': 'MCP "{n}" agregado. Aplica desde el próximo mensaje.',
  'mcp.p.playwright': 'Playwright (navegador)', 'mcp.p.context7': 'Context7 (docs de librerías)', 'mcp.p.fetch': 'Fetch (páginas web)',
  'mcp.p.filesystem': 'Filesystem (workspace)', 'mcp.p.github': 'GitHub (remoto)',

  'sch.title': 'Programaciones ({n})', 'sch.new': 'Nueva', 'sch.none': 'No hay programaciones. Crea una aquí o pídela en el chat: "todos los días a las 8 envíame…".',
  'sch.paused': 'pausada', 'sch.once': 'una vez el {d}', 'sch.last': 'última {d}', 'sch.runNow': 'Ejecutar ahora', 'sch.running': 'Ejecutando ahora',
  'sch.pause': 'Pausar', 'sch.resume': 'Reanudar', 'sch.removeConfirm': '¿Eliminar #{id}?', 'sch.editTitle': 'Editar programación #{id}',
  'sch.newTitle': 'Nueva programación', 'sch.deliver': 'Entregar en', 'sch.deliverHint': 'La respuesta final va a esta conversación',
  'sch.when': 'Cuándo', 'sch.cron': 'Recurrente (cron)', 'sch.onceOpt': 'Una vez', 'sch.cronHint': 'minuto hora día mes día-de-la-semana',
  'sch.datetime': 'Fecha y hora', 'sch.description': 'Descripción', 'sch.descPh': 'Resumen de noticias de IA', 'sch.prompt': 'Instrucción',
  'sch.promptHint': 'Se ejecuta en una sesión nueva, sin contexto: escribe todo lo que el agente necesita saber.',
  'sch.saved': 'Programación guardada', 'sch.created': 'Programación creada',
  'sch.c.daily': 'todos los días a las 8', 'sch.c.weekdays': 'días hábiles a las 9', 'sch.c.30': 'cada 30 min', 'sch.c.fri': 'viernes a las 18',

  'env.title': 'Variables del agente', 'env.apply': 'Aplicar (reiniciar)', 'env.applyConfirm': '¿Reiniciar el agente para aplicar las variables?',
  'env.new': 'Nueva variable', 'env.name': 'NOMBRE_DE_VARIABLE', 'env.value': 'valor', 'env.savedKey': '{k} guardada', 'env.added': '{k} agregada',
  'env.removeConfirm': '¿Eliminar {k}?',

  'logs.container': 'Contenedor', 'logs.audit': 'Auditoría', 'logs.lines': '{n} líneas', 'logs.live': 'en vivo',
  'logs.auditTitle': 'Auditoría (envíos, programaciones, MCP)', 'logs.nothing': 'Nada registrado.', 'logs.failed': '(falló)', 'logs.to': 'para {n}',
  'logs.a.send': 'Mensaje enviado', 'logs.a.send-file': 'Archivo enviado', 'logs.a.schedule-add': 'Programación creada',
  'logs.a.schedule-delete': 'Programación eliminada', 'logs.a.mcp-add': 'MCP agregado', 'logs.a.mcp-remove': 'MCP eliminado', 'logs.a.event': 'evento',
};

export const LANGS = [
  { id: 'pt-BR', label: 'Português', dict: pt },
  { id: 'en', label: 'English', dict: en },
  { id: 'es', label: 'Español', dict: es },
];

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
export { store };

function detect() {
  const saved = store.get('acp_lang');
  if (LANGS.some((l) => l.id === saved)) return saved;
  const nav = (navigator.languages || [navigator.language || 'pt-BR']).map((x) => x.toLowerCase());
  for (const n of nav) {
    if (n.startsWith('pt')) return 'pt-BR';
    if (n.startsWith('es')) return 'es';
    if (n.startsWith('en')) return 'en';
  }
  return 'pt-BR';
}

const I18nCtx = createContext(null);
export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(detect);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const setLang = useCallback((l) => { store.set('acp_lang', l); setLangState(l); }, []);
  const value = useMemo(() => {
    const dict = (LANGS.find((l) => l.id === lang) || LANGS[0]).dict;
    const t = (key, vars) => {
      let s = dict[key] ?? pt[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.split('{' + k + '}').join(String(v));
      return s;
    };
    return { lang, setLang, t };
  }, [lang, setLang]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}
export const useI18n = () => useContext(I18nCtx);
export const useT = () => useContext(I18nCtx).t;
