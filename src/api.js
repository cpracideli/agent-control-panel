export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

// Local-first cache (memory + localStorage) for instant screen loads & stale-while-revalidate.
const CACHE_PREFIX = 'acp_lc:';
const MAX_CACHE_BYTES = 260000;
const memCache = new Map();
export const localCache = {
  get(key) {
    if (!key) return undefined;
    if (memCache.has(key)) return memCache.get(key);
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key);
      if (raw == null) return undefined;
      const val = JSON.parse(raw);
      memCache.set(key, val);
      return val;
    } catch { return undefined; }
  },
  set(key, val) {
    if (!key || val === undefined) return;
    memCache.set(key, val);
    try {
      const raw = JSON.stringify(val);
      if (raw.length <= MAX_CACHE_BYTES) localStorage.setItem(CACHE_PREFIX + key, raw);
    } catch {}
  },
  del(key) {
    if (!key) return;
    memCache.delete(key);
    try { localStorage.removeItem(CACHE_PREFIX + key); } catch {}
  },
};

export async function api(method, path, body) {
  const r = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  const text = await r.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (r.status === 401 && path !== '/login') onUnauthorized();
  if (!r.ok) throw new ApiError((data && data.error) || `Erro ${r.status}`, r.status);
  if (method === 'GET' && data !== null) localCache.set(path, data);
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b) => api('POST', p, b || {});
export const patch = (p, b) => api('PATCH', p, b);
export const put = (p, b) => api('PUT', p, b);
export const del = (p, b) => api('DELETE', p, b);

export const bridge = {
  overview: () => get('/bridge/overview'),
  usage: (days) => get('/bridge/usage' + (days ? '?days=' + days : '')),
  providers: () => get('/bridge/providers'),
  getSettings: () => get('/bridge/settings'),
  settings: (s) => put('/bridge/settings', s),
  chats: () => get('/bridge/chats'),
  patchChat: (id, b) => patch('/bridge/chats/' + encodeURIComponent(id), b),
  autoTitleChat: (id) => post('/bridge/chats/' + encodeURIComponent(id) + '/auto-title'),
  stopChat: (id) => post('/bridge/chats/' + encodeURIComponent(id) + '/stop'),
  deleteChat: (id) => del('/bridge/chats/' + encodeURIComponent(id)),
  newWeb: (b) => post('/bridge/web', b),
  messages: (id) => get('/bridge/web/' + id.replace(/^web:/, '') + '/messages'),
  send: (id, text, files, transcript) => post('/bridge/web/' + id.replace(/^web:/, '') + '/messages', { text, files: files || [], transcript: transcript || '' }),
  tts: (id, msgId) => post('/bridge/web/' + id.replace(/^web:/, '') + '/tts', { id: msgId }),
  fileUrl: (file) => '/api/bridge/web/files/' + encodeURIComponent(file),
  eventsUrl: (id) => '/api/bridge/web/' + id.replace(/^web:/, '') + '/events',
  schedules: () => get('/bridge/schedules'),
  addSchedule: (b) => post('/bridge/schedules', b),
  patchSchedule: (id, b) => patch('/bridge/schedules/' + id, b),
  runSchedule: (id) => post('/bridge/schedules/' + id + '/run'),
  deleteSchedule: (id) => del('/bridge/schedules/' + id),
  scheduleRuns: (id) => get('/bridge/schedules/' + id + '/runs'),
  bots: () => get('/bridge/bots'),
  botTemplates: () => get('/bridge/bots/templates'),
  botFromTemplate: (templateId, chatId) => post('/bridge/bots/from-template', { templateId, chatId }),
  botExport: (id) => get('/bridge/bots/' + encodeURIComponent(id) + '/export'),
  botImport: (recipe, chatId) => post('/bridge/bots/import', { recipe, chatId }),
  addBot: (b) => post('/bridge/bots', b),
  patchBot: (id, b) => patch('/bridge/bots/' + encodeURIComponent(id), b),
  deleteBot: (id) => del('/bridge/bots/' + encodeURIComponent(id)),
  generateBotAvatar: (b) => post('/bridge/bots/generate-avatar', b),
  generateBotAvatarFor: (id, b) => post('/bridge/bots/' + encodeURIComponent(id) + '/generate-avatar', b),
  botMemory: (id) => get('/bridge/bots/' + encodeURIComponent(id) + '/memory'),
  saveBotMemory: (id, content) => put('/bridge/bots/' + encodeURIComponent(id) + '/memory', { content }),
  restoreBot: (id, at) => post('/bridge/bots/' + encodeURIComponent(id) + '/restore', { at }),
  skills: () => get('/bridge/skills'),
  addSkill: (b) => post('/bridge/skills', b),
  patchSkill: (slug, b) => patch('/bridge/skills/' + encodeURIComponent(slug), b),
  deleteSkill: (slug) => del('/bridge/skills/' + encodeURIComponent(slug)),
  importSkillsGithub: (url) => post('/bridge/skills/import-github', { url }),
  secrets: () => get('/bridge/secrets'),
  addSecret: (b) => post('/bridge/secrets', b),
  importSecretsCsv: (csv, scope) => post('/bridge/secrets/import-csv', { csv, scope: scope || 'global' }),
  deleteSecret: (name) => del('/bridge/secrets/' + encodeURIComponent(name)),
  tickets: () => get('/bridge/tickets'),
  addTicket: (b) => post('/bridge/tickets', b),
  patchTicket: (id, b) => patch('/bridge/tickets/' + encodeURIComponent(id), b),
  deleteTicket: (id) => del('/bridge/tickets/' + encodeURIComponent(id)),
  commentTicket: (id, text) => post('/bridge/tickets/' + encodeURIComponent(id) + '/comment', { text }),
  runTicket: (id) => post('/bridge/tickets/' + encodeURIComponent(id) + '/run'),
  resumeTicket: (id) => post('/bridge/tickets/' + encodeURIComponent(id) + '/resume'),
  ticketRunner: () => get('/bridge/tickets/runner'),
  saveTicketRunner: (b) => put('/bridge/tickets/runner', b),
  tickTicketRunner: () => post('/bridge/tickets/runner/tick'),
  tasks: (chatId) => get('/bridge/tasks' + (chatId ? '?chatId=' + encodeURIComponent(chatId) : '')),
  startTask: (b) => post('/bridge/tasks', b),
  stopTask: (id) => post('/bridge/tasks/' + encodeURIComponent(id) + '/stop'),
  nudges: () => get('/bridge/nudges'),
  createNudge: (b) => post('/bridge/nudges', b),
  computerStatus: () => get('/bridge/computer/status'),
  computerStart: (url) => post('/bridge/computer/start', { url: url || '' }),
  computerStop: () => post('/bridge/computer/stop'),
  computerControl: (mode) => post('/bridge/computer/control', { mode }),
  computerResolve: (action) => post('/bridge/computer/resolve', { action }),
  computerOpen: (url) => post('/bridge/computer/open', { url }),
  computerFillLogin: (b) => post('/bridge/computer/fill-login', b),
  computerTimeline: () => get('/bridge/computer/timeline'),
  computerCaptureTimeline: (label) => post('/bridge/computer/timeline/capture', { label: label || 'manual' }),
  computerTimelineFrameUrl: (id) => '/api/bridge/computer/timeline/' + encodeURIComponent(id),
  computerViewerUrl: (viewOnly) => '/api/bridge/computer/viewer?viewOnly=' + (viewOnly ? '1' : '0') + '&ws=' + encodeURIComponent('/api/bridge/computer/ws'),
  computerScreenshotUrl: () => '/api/bridge/computer/screenshot?t=' + Date.now(),
  artifacts: () => get('/bridge/artifacts'),
  artifactFileUrl: (name) => '/api/bridge/artifacts/file/' + encodeURIComponent(name),
  deleteArtifact: (name) => del('/bridge/artifacts/' + encodeURIComponent(name)),
  deleteAllArtifacts: (opts) => {
    const q = opts?.kind && opts.kind !== 'all' ? '?kind=' + encodeURIComponent(opts.kind) : '';
    const body = opts?.names?.length ? { names: opts.names } : (opts?.kind && opts.kind !== 'all' ? { kind: opts.kind } : {});
    return del('/bridge/artifacts' + q, body);
  },
  activity: () => get('/bridge/activity'),
  pages: () => get('/bridge/pages'),
  page: (id) => get('/bridge/pages/' + encodeURIComponent(id)),
  pageRawUrl: (id) => '/api/bridge/pages/' + encodeURIComponent(id) + '/raw',
  addPage: (b) => post('/bridge/pages', b),
  patchPage: (id, b) => patch('/bridge/pages/' + encodeURIComponent(id), b),
  deletePage: (id) => del('/bridge/pages/' + encodeURIComponent(id)),
  restorePage: (id, at) => post('/bridge/pages/' + encodeURIComponent(id) + '/restore', { at }),
  answerPrompt: (id, answer, note, secretValue, pin, answers) => post('/bridge/prompts/' + encodeURIComponent(id) + '/answer', { answer, note: note || '', ...(secretValue ? { secretValue } : {}), ...(pin ? { pin } : {}), ...(answers !== undefined ? { answers } : {}) }),
  mcp: () => get('/bridge/mcp'),
  mcpStatus: (provider) => get('/bridge/mcp/status' + (provider ? '?provider=' + provider : '')),
  addMcp: (b) => post('/bridge/mcp', b),
  removeMcp: (provider, name, scope) => del(`/bridge/mcp/${provider}/${encodeURIComponent(name)}${scope ? '?scope=' + scope : ''}`),
  audit: (n = 200) => get('/bridge/audit?n=' + n),
  auditCsvUrl: (n = 1000) => '/api/bridge/audit/csv?n=' + n,
  connectors: () => get('/bridge/connectors'),
  composioSetup: (b) => post('/bridge/connectors/composio/setup', b),
  composioApps: (q = '') => get('/bridge/connectors/composio/apps' + (q ? '?q=' + encodeURIComponent(q) : '')),
  composioConnect: (b) => post('/bridge/connectors/composio/connect', b),
  oauthSave: (b) => post('/bridge/connectors/oauth/save', b),
  localDevices: () => get('/bridge/local-bridge/devices'),
  localPair: (name) => post('/bridge/local-bridge/pair', { name }),
  localRevoke: (id) => del('/bridge/local-bridge/revoke/' + encodeURIComponent(id)),
  localCall: (b) => post('/bridge/local-bridge/call', b),
  localAgentUrl: (token) => '/api/bridge/local-bridge/agent.mjs?token=' + encodeURIComponent(token || '') + '&ws=' + encodeURIComponent(window.location.origin.replace(/^http/i, 'ws') + '/api/local-bridge/ws'),
  voiceLiveConfig: () => get('/bridge/voice/live-config'),
  sendWhatsApp: (to, text) => post('/bridge/send', { to, text }),
  search: (q, limit = 30) => get('/bridge/search?q=' + encodeURIComponent(q) + '&limit=' + limit),
  inbox: () => get('/bridge/inbox'),
  council: (prompt, providers, bot) => post('/bridge/council', { prompt, ...(providers?.length ? { providers } : {}), ...(bot ? { bot } : {}) }),
  drafts: () => get('/bridge/drafts'),
  addDraft: (b) => post('/bridge/drafts', b),
  patchDraft: (id, b) => patch('/bridge/drafts/' + encodeURIComponent(id), b),
  deleteDraft: (id) => del('/bridge/drafts/' + encodeURIComponent(id)),
  sendDraft: (id) => post('/bridge/drafts/' + encodeURIComponent(id) + '/send'),
  pageData: (id) => get('/bridge/pages/' + encodeURIComponent(id) + '/data'),
  setPageData: (id, data) => put('/bridge/pages/' + encodeURIComponent(id) + '/data', data),
  patchPageData: (id, data) => patch('/bridge/pages/' + encodeURIComponent(id) + '/data', data),
  forkChat: (id, b) => post('/bridge/web/' + id.replace(/^web:/, '') + '/fork', b || {}),
  shortcutConfig: () => get('/bridge/shortcuts/config'),
  rotateShortcutToken: () => post('/bridge/shortcuts/token'),
  revokeShortcutToken: () => del('/bridge/shortcuts/token'),
  undoList: () => get('/bridge/undo'),
  undoSnapshot: (b) => post('/bridge/undo/snapshot', b || {}),
  undoRestore: (id) => post('/bridge/undo/' + encodeURIComponent(id) + '/restore'),
  workflows: () => get('/bridge/workflows'),
  addWorkflow: (b) => post('/bridge/workflows', b),
  patchWorkflow: (id, b) => patch('/bridge/workflows/' + encodeURIComponent(id), b),
  deleteWorkflow: (id) => del('/bridge/workflows/' + encodeURIComponent(id)),
  runWorkflow: (id, trigger) => post('/bridge/workflows/' + encodeURIComponent(id) + '/run', { trigger: trigger || 'manual' }),
  workflowRuns: () => get('/bridge/workflows/runs'),
  resumeWorkflowRun: (runId, fromStep) => post('/bridge/workflows/runs/' + encodeURIComponent(runId) + '/resume', fromStep !== undefined ? { fromStep } : {}),
  morningBriefingPreset: (b) => post('/bridge/workflows/preset/morning-briefing', b || {}),
  correctFeedback: (b) => post('/bridge/feedback/correct', b),
};

export const webPush = {
  key: () => get('/push/key'),
  subscribe: (subscription) => post('/push/subscribe', { subscription }),
  unsubscribe: (endpoint) => post('/push/unsubscribe', { endpoint }),
  test: () => post('/push/test'),
};

export const prefs = {
  get: () => get('/prefs'),
  save: (b) => put('/prefs', b),
};

export const coolify = {
  status: () => get('/coolify/status'),
  envs: () => get('/coolify/envs'),
  addEnv: (key, value) => post('/coolify/envs', { key, value }),
  setEnv: (key, value) => patch('/coolify/envs', { key, value }),
  deleteEnv: (uuid) => del('/coolify/envs/' + uuid),
  restart: () => post('/coolify/restart'),
  deploy: () => post('/coolify/deploy'),
  logs: (lines) => get('/coolify/logs?lines=' + lines),
};
