export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

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
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b) => api('POST', p, b || {});
export const patch = (p, b) => api('PATCH', p, b);
export const put = (p, b) => api('PUT', p, b);
export const del = (p) => api('DELETE', p);

export const bridge = {
  overview: () => get('/bridge/overview'),
  usage: (days) => get('/bridge/usage' + (days ? '?days=' + days : '')),
  providers: () => get('/bridge/providers'),
  settings: (s) => put('/bridge/settings', s),
  chats: () => get('/bridge/chats'),
  patchChat: (id, b) => patch('/bridge/chats/' + encodeURIComponent(id), b),
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
  addBot: (b) => post('/bridge/bots', b),
  patchBot: (id, b) => patch('/bridge/bots/' + encodeURIComponent(id), b),
  deleteBot: (id) => del('/bridge/bots/' + encodeURIComponent(id)),
  botMemory: (id) => get('/bridge/bots/' + encodeURIComponent(id) + '/memory'),
  saveBotMemory: (id, content) => put('/bridge/bots/' + encodeURIComponent(id) + '/memory', { content }),
  restoreBot: (id, at) => post('/bridge/bots/' + encodeURIComponent(id) + '/restore', { at }),
  mcp: () => get('/bridge/mcp'),
  mcpStatus: (provider) => get('/bridge/mcp/status' + (provider ? '?provider=' + provider : '')),
  addMcp: (b) => post('/bridge/mcp', b),
  removeMcp: (provider, name, scope) => del(`/bridge/mcp/${provider}/${encodeURIComponent(name)}${scope ? '?scope=' + scope : ''}`),
  audit: (n = 200) => get('/bridge/audit?n=' + n),
  sendWhatsApp: (to, text) => post('/bridge/send', { to, text }),
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
