// Agent Control backend: login, Coolify API (envs, logs, restart, deploy) and a proxy to the bridge's /admin API.
import express from 'express';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import * as webpushMod from 'web-push';
const webpush = webpushMod.default || webpushMod;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const PORT = Number(env.PORT || 3001);
const ADMIN_PASSWORD = env.ADMIN_PASSWORD || '';
const COOLIFY_URL = (env.COOLIFY_URL || '').replace(/\/+$/, '');
const COOLIFY_TOKEN = env.COOLIFY_TOKEN || '';
const APP_UUID = env.COOLIFY_APP_UUID || '';
const coolifyConfigured = () => Boolean(COOLIFY_URL && COOLIFY_TOKEN && APP_UUID);
const BRIDGE_URL = (env.BRIDGE_URL || 'http://claude-bridge-claude-zap:3000').replace(/\/+$/, '');
const BRIDGE_TOKEN = env.BRIDGE_ADMIN_TOKEN || '';
const SECRET = env.SESSION_SECRET || crypto.createHash('sha256').update('acp:' + ADMIN_PASSWORD + ':' + COOLIFY_TOKEN).digest('hex');
const SESSION_DAYS = 14;

if (!ADMIN_PASSWORD && !env.GOOGLE_OAUTH_CLIENT_ID) console.warn('WARNING: neither ADMIN_PASSWORD nor Google login is configured, nobody can sign in');

const app = express();
app.set('trust proxy', 1);
// ---------- public routine webhooks: POST /hooks/<id>/<token> goes to the bridge as is (the token is the auth) ----------
// Registered before the JSON parser so the body reaches the bridge untouched.
app.all('/hooks/:id/:token', express.raw({ type: () => true, limit: '1mb' }), async (req, res) => {
  const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  try {
    const r = await fetch(BRIDGE_URL + '/hooks/' + encodeURIComponent(req.params.id) + '/' + encodeURIComponent(req.params.token) + q, {
      method: req.method,
      headers: { 'Content-Type': req.get('content-type') || 'application/octet-stream' },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : (Buffer.isBuffer(req.body) ? req.body : undefined),
    });
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.status(502).json({ error: 'Bridge inacessível' });
  }
});

// ---------- public Slack webhooks: /slack/events and /slack/interactions (verified by HMAC in bridge) ----------
app.all(['/slack/events', '/slack/interactions'], express.raw({ type: () => true, limit: '1mb' }), async (req, res) => {
  try {
    const r = await fetch(BRIDGE_URL + req.originalUrl, {
      method: req.method,
      headers: {
        'Content-Type': req.get('content-type') || 'application/json',
        'x-slack-signature': req.get('x-slack-signature') || '',
        'x-slack-request-timestamp': req.get('x-slack-request-timestamp') || '',
      },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : (Buffer.isBuffer(req.body) ? req.body : undefined),
    });
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(Buffer.from(await r.arrayBuffer()));
  } catch {
    res.status(502).json({ error: 'Bridge inacessível' });
  }
});

// ---------- public shared pages + Mini-App data API: /p/<id>/<token> and /p/<id>/<token>/data ----------
app.get('/p/:id/:token', async (req, res) => {
  try {
    const r = await fetch(BRIDGE_URL + '/p/' + encodeURIComponent(req.params.id) + '/' + encodeURIComponent(req.params.token));
    res.status(r.status).type(r.headers.get('content-type') || 'text/html; charset=utf-8').send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.status(502).type('text/plain; charset=utf-8').send('Bridge inacessível');
  }
});

app.all('/p/:id/:token/data', express.raw({ type: () => true, limit: '1mb' }), async (req, res) => {
  try {
    const r = await fetch(BRIDGE_URL + '/p/' + encodeURIComponent(req.params.id) + '/' + encodeURIComponent(req.params.token) + '/data', {
      method: req.method,
      headers: { 'Content-Type': req.get('content-type') || 'application/json' },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : (Buffer.isBuffer(req.body) ? req.body : undefined),
    });
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(Buffer.from(await r.arrayBuffer()));
  } catch {
    res.status(502).json({ error: 'Bridge inacessível' });
  }
});

// ---------- iOS Shortcuts / Share Sheet / Siri ingest (authenticated by personal Bearer token in bridge) ----------
app.post('/api/shortcut', express.raw({ type: () => true, limit: '25mb' }), async (req, res) => {
  try {
    const r = await fetch(BRIDGE_URL + '/shortcut/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': req.get('content-type') || 'application/json',
        ...(req.get('authorization') ? { Authorization: req.get('authorization') } : {}),
        ...(req.get('x-shortcut-token') ? { 'x-shortcut-token': req.get('x-shortcut-token') } : {}),
      },
      body: Buffer.isBuffer(req.body) ? req.body : undefined,
    });
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(Buffer.from(await r.arrayBuffer()));
  } catch {
    res.status(502).json({ error: 'Bridge inacessível' });
  }
});

app.use(express.json({ limit: '40mb' })); // web chat attachments travel as base64 (25 MB per file)

// ---------- Google OAuth ----------
const GOOGLE_CLIENT_ID = env.GOOGLE_OAUTH_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = env.GOOGLE_OAUTH_CLIENT_SECRET || '';
const ALLOWED_EMAILS = (env.ALLOWED_AUTH_EMAILS || '').split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
const PUBLIC_URL = (env.PUBLIC_URL || '').replace(/\/+$/, '');
const googleOn = () => Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && ALLOWED_EMAILS.length);
if (GOOGLE_CLIENT_ID && !ALLOWED_EMAILS.length) console.warn('WARNING: ALLOWED_AUTH_EMAILS is empty, Google login is disabled');

// ---------- session cookie: "<expiry>.<b64url email>.<hmac>" ----------
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const b64u = (s) => Buffer.from(s).toString('base64url');
const cookieOf = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim()).filter(Boolean).map((c) => [c.slice(0, c.indexOf('=')), c.slice(c.indexOf('=') + 1)]));
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
function session(req) {
  const parts = String(cookieOf(req).acp_session || '').split('.');
  if (parts.length !== 3) return null;
  const [exp, who, mac] = parts;
  if (Number(exp) < Date.now() || !safeEq(mac, sign(exp + '.' + who))) return null;
  const email = Buffer.from(who, 'base64url').toString();
  // A Google session stops working as soon as the address leaves the allow list.
  if (email && email !== 'password' && !ALLOWED_EMAILS.includes(email)) return null;
  return { email };
}
const validSession = (req) => Boolean(session(req));
function startSession(req, res, who) {
  const exp = String(Date.now() + SESSION_DAYS * 86400000);
  const v = exp + '.' + b64u(who);
  res.append('Set-Cookie', `acp_session=${v}.${sign(v)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${req.secure ? '; Secure' : ''}`);
}
const auth = (req, res, next) => (validSession(req) ? next() : res.status(401).json({ error: 'Sessão expirada. Entre de novo.' }));

const attempts = new Map(); // ip -> { n, until }
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const a = attempts.get(ip) || { n: 0, until: 0 };
  if (a.until > Date.now()) return res.status(429).json({ error: 'Muitas tentativas. Aguarde um minuto.' });
  const got = String((req.body || {}).password || '');
  if (!ADMIN_PASSWORD || !safeEq(got, ADMIN_PASSWORD)) {
    a.n += 1; if (a.n >= 5) { a.until = Date.now() + 60000; a.n = 0; }
    attempts.set(ip, a);
    return res.status(401).json({ error: 'Senha incorreta' });
  }
  attempts.delete(ip);
  startSession(req, res, 'password');
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'acp_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});
const userProfiles = new Map(); // email -> { name, picture }
async function saveUserProfile(email, prof) {
  const key = String(email || '').trim().toLowerCase();
  if (!key || key === 'password') return;
  const clean = { name: String(prof?.name || '').trim(), picture: String(prof?.picture || '').trim() };
  if (!clean.name && !clean.picture) return;
  userProfiles.set(key, clean);
  if (!BRIDGE_TOKEN) return;
  try {
    await fetch(`${BRIDGE_URL}/admin/prefs/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${BRIDGE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: clean }),
    });
  } catch {}
}
async function loadUserProfile(email) {
  const key = String(email || '').trim().toLowerCase();
  if (!key || key === 'password') return { name: '', picture: '' };
  if (userProfiles.has(key)) return userProfiles.get(key);
  if (!BRIDGE_TOKEN) return { name: '', picture: '' };
  try {
    const r = await fetch(`${BRIDGE_URL}/admin/prefs/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${BRIDGE_TOKEN}` },
    });
    if (r.ok) {
      const data = await r.json().catch(() => ({}));
      const prof = { name: String(data?.profile?.name || ''), picture: String(data?.profile?.picture || '') };
      if (prof.name || prof.picture) userProfiles.set(key, prof);
      return prof;
    }
  } catch {}
  return { name: '', picture: '' };
}
app.get('/api/me', async (req, res) => {
  const s = session(req);
  const email = s && s.email !== 'password' ? s.email : null;
  const prof = email ? await loadUserProfile(email) : { name: '', picture: '' };
  res.json({ ok: Boolean(s), email, name: prof.name || '', picture: prof.picture || '', google: googleOn(), password: Boolean(ADMIN_PASSWORD), coolify: coolifyConfigured() });
});

// ---------- per-user preferences (persisted in the bridge's settings.json) ----------
const VALID_DOCK_PAGES = new Set(['command', 'status', 'workflows', 'chat', 'calls', 'bots', 'computer', 'skills', 'board', 'dashboards', 'schedules', 'artifacts', 'memory', 'usage', 'overview', 'providers', 'mcp', 'envs', 'logs', 'search', 'inbox', 'more']);
function parseDockPref(raw) {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 5) return undefined;
  const clean = raw.map((x) => String(x || '').trim());
  if (clean.some((x) => !VALID_DOCK_PAGES.has(x)) || new Set(clean).size !== clean.length) return undefined;
  return clean;
}
const prefUserOf = (req) => String(session(req)?.email || 'password').trim().toLowerCase();

app.get('/api/prefs', auth, async (req, res) => {
  if (!BRIDGE_TOKEN) return res.json({ dock: null, synced: false });
  const user = prefUserOf(req);
  try {
    const r = await fetch(`${BRIDGE_URL}/admin/prefs/${encodeURIComponent(user)}`, {
      headers: { Authorization: `Bearer ${BRIDGE_TOKEN}` },
    });
    if (r.status === 404) return res.json({ dock: null, synced: false });
    if (!r.ok) return res.json({ dock: null, synced: false });
    const data = await r.json().catch(() => ({}));
    const dock = parseDockPref(data?.dock);
    res.json({ dock: dock === undefined ? null : dock, synced: true });
  } catch {
    res.json({ dock: null, synced: false });
  }
});

app.put('/api/prefs', auth, async (req, res) => {
  const body = req.body || {};
  if (!('dock' in body)) return res.status(400).json({ error: 'Campo dock é obrigatório' });
  const dock = parseDockPref(body.dock);
  if (dock === undefined) return res.status(400).json({ error: 'Escolha entre 1 e 5 páginas válidas e diferentes' });
  if (!BRIDGE_TOKEN) return res.json({ ok: true, dock, synced: false });
  const user = prefUserOf(req);
  try {
    const r = await fetch(`${BRIDGE_URL}/admin/prefs/${encodeURIComponent(user)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${BRIDGE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dock }),
    });
    if (r.status === 404) return res.json({ ok: true, dock, synced: false });
    const text = await r.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!r.ok) return res.status(r.status === 401 ? 502 : r.status).json({ error: data.error || 'Falha ao salvar preferências' });
    const saved = parseDockPref(data?.dock);
    res.json({ ok: true, dock: saved === undefined ? dock : saved, synced: true });
  } catch (e) {
    res.status(502).json({ error: 'Bridge inacessível: ' + (e.cause?.code || e.message) });
  }
});

// Authorization-code flow. The callback does not set the session directly: it hands the
// page a one-time code that the page exchanges with fetch. That way the cookie lands in
// the context that asked for it, which matters for an installed iOS PWA, whose cookie jar
// is separate from the in-app browser where the Google screen opens.
const baseUrl = (req) => PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
const redirectUri = (req) => baseUrl(req) + '/api/auth/google/callback';
const pendingStates = new Map(); // state -> expiry
const loginCodes = new Map(); // code -> { email, exp }
const sweep = (m) => { const now = Date.now(); for (const [k, v] of m) if ((v.exp ?? v) < now) m.delete(k); };

app.get('/api/auth/google', (req, res) => {
  if (!googleOn()) return res.redirect('/?auth_error=' + encodeURIComponent('Login com Google não configurado'));
  sweep(pendingStates);
  const state = crypto.randomBytes(18).toString('base64url');
  pendingStates.set(state, Date.now() + 10 * 60000);
  const q = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID, redirect_uri: redirectUri(req), response_type: 'code',
    scope: 'openid email profile', state, prompt: 'select_account',
  });
  if (ALLOWED_EMAILS.length === 1) q.set('login_hint', ALLOWED_EMAILS[0]);
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + q);
});

app.get('/api/auth/google/callback', async (req, res) => {
  const fail = (msg) => res.redirect('/?auth_error=' + encodeURIComponent(msg));
  const { code, state, error } = req.query;
  if (error) return fail(error === 'access_denied' ? 'Login cancelado' : String(error));
  const exp = pendingStates.get(String(state || ''));
  pendingStates.delete(String(state || ''));
  if (!exp || exp < Date.now()) return fail('Sessão de login expirada, tente de novo');
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: String(code || ''), client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri(req), grant_type: 'authorization_code' }),
    });
    const tok = await r.json();
    if (!r.ok || !tok.id_token) throw new Error(tok.error_description || tok.error || 'Falha ao trocar o código com o Google');
    // The id_token came straight from Google's token endpoint over TLS, so its payload is trusted.
    const p = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString());
    const email = String(p.email || '').toLowerCase();
    if (p.aud !== GOOGLE_CLIENT_ID || !['accounts.google.com', 'https://accounts.google.com'].includes(p.iss)) throw new Error('Token do Google inválido');
    if (!p.email_verified || !ALLOWED_EMAILS.includes(email)) {
      console.warn('Google login denied for', email || '(no email)');
      return fail(`Acesso negado para ${email || 'esta conta'}`);
    }
    sweep(loginCodes);
    const one = crypto.randomBytes(24).toString('base64url');
    const prof = { name: p.name || '', picture: p.picture || '' };
    saveUserProfile(email, prof).catch(() => {});
    loginCodes.set(one, { email, name: prof.name, picture: prof.picture, exp: Date.now() + 2 * 60000 });
    res.redirect('/?auth_code=' + one);
  } catch (e) {
    console.error('Google callback:', e.message);
    fail(e.message);
  }
});

app.post('/api/auth/exchange', (req, res) => {
  const code = String((req.body || {}).code || '');
  const c = loginCodes.get(code);
  loginCodes.delete(code);
  if (!c || c.exp < Date.now()) return res.status(401).json({ error: 'Código de login expirado, entre de novo' });
  saveUserProfile(c.email, { name: c.name, picture: c.picture }).catch(() => {});
  startSession(req, res, c.email);
  res.json({ ok: true, email: c.email, name: c.name, picture: c.picture });
});

// ---------- Coolify ----------
async function coolify(endpoint, options = {}) {
  if (!coolifyConfigured()) {
    throw Object.assign(new Error('Integração Coolify não configurada (defina COOLIFY_URL, COOLIFY_TOKEN e COOLIFY_APP_UUID)'), { status: 503 });
  }
  const r = await fetch(`${COOLIFY_URL}/api/v1${endpoint}`, {
    ...options,
    headers: { Authorization: `Bearer ${COOLIFY_TOKEN}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await r.text();
  let data = text;
  try { data = JSON.parse(text); } catch {}
  if (!r.ok) throw Object.assign(new Error(typeof data === 'object' ? (data.message || JSON.stringify(data)) : text), { status: r.status });
  return data;
}
const wrap = (fn) => async (req, res) => {
  // A 401/403 from Coolify is not our session expiring: report it as an upstream error so the page does not log out.
  try { res.json(await fn(req)); } catch (e) { res.status(e.status && (e.status < 500 || e.status === 503) && ![401, 403].includes(e.status) ? e.status : 502).json({ error: e.message }); }
};

app.get('/api/coolify/status', auth, wrap(async () => {
  const d = await coolify(`/applications/${APP_UUID}`);
  return { name: d.name, status: d.status, fqdn: d.fqdn, git_repository: d.git_repository, git_branch: d.git_branch, updated_at: d.updated_at };
}));
app.get('/api/coolify/envs', auth, wrap(async () => (await coolify(`/applications/${APP_UUID}/envs`)).filter((e) => !e.is_preview)));
app.post('/api/coolify/envs', auth, wrap(async (req) => {
  const { key, value } = req.body || {};
  if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw Object.assign(new Error('Nome inválido'), { status: 400 });
  return coolify(`/applications/${APP_UUID}/envs`, { method: 'POST', body: JSON.stringify({ key, value: value ?? '' }) });
}));
app.patch('/api/coolify/envs', auth, wrap(async (req) => {
  const { key, value } = req.body || {};
  if (!key) throw Object.assign(new Error('key é obrigatória'), { status: 400 });
  return coolify(`/applications/${APP_UUID}/envs`, { method: 'PATCH', body: JSON.stringify({ key, value: value ?? '' }) });
}));
app.delete('/api/coolify/envs/:uuid', auth, wrap((req) => coolify(`/applications/${APP_UUID}/envs/${encodeURIComponent(req.params.uuid)}`, { method: 'DELETE' })));
app.post('/api/coolify/restart', auth, wrap(() => coolify(`/applications/${APP_UUID}/restart`, { method: 'POST' })));
app.post('/api/coolify/deploy', auth, wrap(() => coolify(`/deploy?uuid=${APP_UUID}`, { method: 'POST' })));
app.get('/api/coolify/logs', auth, wrap((req) => coolify(`/applications/${APP_UUID}/logs?lines=${Math.min(Number(req.query.lines) || 200, 2000)}`)));

// ---------- web chat files with byte ranges ----------
// Safari (iPhone/Mac) only plays <audio>/<video> when the server answers Range requests with 206.
// Files are at most ~100 MB (agent uploads), so the proxy fetches the whole file and slices it here.
app.get('/api/bridge/web/files/:name', auth, async (req, res) => {
  if (!BRIDGE_TOKEN) return res.status(503).json({ error: 'BRIDGE_ADMIN_TOKEN não configurado no painel' });
  try {
    const r = await fetch(BRIDGE_URL + '/admin/web/files/' + encodeURIComponent(req.params.name) + (req.query.download ? '?download=1' : ''), { headers: { Authorization: `Bearer ${BRIDGE_TOKEN}` } });
    if (!r.ok) return res.status(r.status === 401 ? 502 : r.status).json({ error: 'arquivo não encontrado' });
    const buf = Buffer.from(await r.arrayBuffer());
    const size = buf.length;
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const cd = r.headers.get('content-disposition');
    if (cd) res.setHeader('Content-Disposition', cd);
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim());
    if (!m || (!m[1] && !m[2])) { res.setHeader('Content-Length', size); return res.end(buf); }
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    let end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) { res.setHeader('Content-Range', `bytes */${size}`); return res.status(416).end(); }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', end - start + 1);
    res.end(buf.subarray(start, end + 1));
  } catch (e) {
    res.status(502).json({ error: 'Bridge inacessível: ' + (e.cause?.code || e.message) });
  }
});

// ---------- Web Push (VAPID keys & subscriptions persisted in the bridge's ~/.bridge/push.json) ----------
let vapidCache = null;
function resolveVapidSubject(panelOrigin = '') {
  const explicit = String(env.VAPID_SUBJECT || '').trim();
  if (explicit) return explicit;
  if (ALLOWED_EMAILS.length) return 'mailto:' + ALLOWED_EMAILS[0];
  const origin = String(panelOrigin || PUBLIC_URL || '').trim();
  if (/^https:\/\//i.test(origin) && !/^https:\/\/localhost\b/i.test(origin)) return origin;
  return 'https://agent-control.invalid';
}
async function ensureVapid(panelOrigin = '') {
  if (!BRIDGE_TOKEN) return null;
  if (vapidCache) return vapidCache;
  const subject = resolveVapidSubject(panelOrigin);
  try {
    const r = await fetch(`${BRIDGE_URL}/admin/push/config`, { headers: { Authorization: `Bearer ${BRIDGE_TOKEN}` } });
    if (r.ok) {
      const cfg = await r.json();
      if (cfg?.vapid?.publicKey && cfg?.vapid?.privateKey) {
        vapidCache = cfg.vapid;
        webpush.setVapidDetails(subject, vapidCache.publicKey, vapidCache.privateKey);
        return vapidCache;
      }
    }
    const keys = webpush.generateVAPIDKeys();
    const saveRes = await fetch(`${BRIDGE_URL}/admin/push/config`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${BRIDGE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ vapid: keys, panelPushUrl: panelOrigin || PUBLIC_URL || '' }),
    });
    if (saveRes.ok) {
      vapidCache = keys;
      webpush.setVapidDetails(subject, vapidCache.publicKey, vapidCache.privateKey);
      return vapidCache;
    }
  } catch (e) {
    console.warn('Web Push VAPID init skipped:', e.message);
  }
  return null;
}
async function sendPushToAll(payload, panelOrigin = '') {
  const keys = await ensureVapid(panelOrigin);
  if (!keys || !BRIDGE_TOKEN) return { sent: 0, failed: 0 };
  const r = await fetch(`${BRIDGE_URL}/admin/push/subscriptions`, { headers: { Authorization: `Bearer ${BRIDGE_TOKEN}` } });
  if (!r.ok) return { sent: 0, failed: 0 };
  const subs = await r.json().catch(() => []);
  let sent = 0, failed = 0;
  const msg = JSON.stringify({ title: payload.title || 'Agent Control', body: payload.body || '', chatId: payload.chatId || '', tag: payload.tag || 'agent-control', url: payload.url || '' });
  for (const sub of (Array.isArray(subs) ? subs : [])) {
    try {
      await webpush.sendNotification(sub, msg);
      sent += 1;
    } catch (e) {
      failed += 1;
      if (e.statusCode === 404 || e.statusCode === 410) {
        fetch(`${BRIDGE_URL}/admin/push/subscriptions?endpoint=${encodeURIComponent(sub.endpoint)}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${BRIDGE_TOKEN}` },
        }).catch(() => {});
      }
    }
  }
  return { sent, failed };
}

app.get('/api/push/key', auth, async (req, res) => {
  try {
    const keys = await ensureVapid(baseUrl(req));
    if (!keys) return res.status(503).json({ error: 'Web Push indisponível (ponte sem token)' });
    const cfg = await fetch(`${BRIDGE_URL}/admin/push/config`, { headers: { Authorization: `Bearer ${BRIDGE_TOKEN}` } }).then((r) => r.json()).catch(() => ({}));
    res.json({ publicKey: keys.publicKey, count: cfg.count || 0 });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.post('/api/push/subscribe', auth, async (req, res) => {
  try {
    await ensureVapid(baseUrl(req));
    const r = await fetch(`${BRIDGE_URL}/admin/push/subscriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${BRIDGE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: req.body?.subscription || req.body, panelPushUrl: baseUrl(req) }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: d.error || 'Falha ao salvar inscrição push' });
    res.json(d);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.post('/api/push/unsubscribe', auth, async (req, res) => {
  try {
    const ep = String(req.body?.endpoint || '');
    const r = await fetch(`${BRIDGE_URL}/admin/push/subscriptions?endpoint=${encodeURIComponent(ep)}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${BRIDGE_TOKEN}` },
    });
    const d = await r.json().catch(() => ({}));
    res.status(r.ok ? 200 : r.status).json(d);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.post('/api/push/test', auth, async (req, res) => {
  try {
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    const safeUrl = (rawUrl.startsWith('/') || rawUrl.startsWith('#')) ? rawUrl.slice(0, 240) : '';
    const out = await sendPushToAll({ title: 'Agent Control', body: 'Notificações Web Push ativas neste dispositivo!', tag: 'push-test', ...(safeUrl ? { url: safeUrl } : {}) }, baseUrl(req));
    res.json(out);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.post('/api/push/dispatch', async (req, res) => {
  const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!BRIDGE_TOKEN || !safeEq(got, BRIDGE_TOKEN)) return res.status(401).json({ error: 'não autorizado' });
  try {
    const out = await sendPushToAll(req.body || {}, baseUrl(req));
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- bridge /admin proxy (JSON and SSE) ----------
app.all('/api/bridge/*', auth, async (req, res) => {
  if (!BRIDGE_TOKEN) return res.status(503).json({ error: 'BRIDGE_ADMIN_TOKEN não configurado no painel' });
  const subPath = String(req.params[0] || '').replace(/^admin\/wacalls(\/|$)/, 'wacalls$1');
  const target = BRIDGE_URL + '/admin/' + subPath + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
  const ctrl = new AbortController();
  res.on('close', () => ctrl.abort());
  const isEventStreamPath = /(?:^|\/)events$/.test(subPath);
  if (isEventStreamPath) {
    req.setTimeout?.(0);
    res.setTimeout?.(0);
  }
  try {
    const hdrs = {
      Authorization: `Bearer ${BRIDGE_TOKEN}`,
      // X-Panel-Url lets the bridge tell the agent the public address of routine webhooks.
      'X-Panel-Url': PUBLIC_URL || `${req.protocol}://${req.get('host')}`,
    };
    const clientId = req.get('x-client-id');
    if (clientId) hdrs['X-Client-Id'] = clientId;
    const isBodylessMethod = ['GET', 'HEAD'].includes(req.method);
    const hasDeleteBody = req.method === 'DELETE' && req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0;
    const sendBody = !isBodylessMethod && (req.method !== 'DELETE' || hasDeleteBody);
    if (sendBody) hdrs['Content-Type'] = 'application/json';
    const r = await fetch(target, {
      method: req.method,
      headers: hdrs,
      body: sendBody ? JSON.stringify(req.body || {}) : undefined,
      signal: ctrl.signal,
    });
    if (r.status === 204 || r.status === 304) {
      return res.status(r.status).end();
    }
    const type = r.headers.get('content-type') || 'application/json';
    res.status(r.status === 401 ? 502 : r.status); // a bridge 401 means a bad BRIDGE_ADMIN_TOKEN, not an expired panel session
    res.setHeader('Content-Type', type);
    const disp = r.headers.get('content-disposition');
    if (disp) res.setHeader('Content-Disposition', disp);
    if (type.includes('text/event-stream')) {
      req.setTimeout?.(0);
      res.setTimeout?.(0);
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      Readable.fromWeb(r.body).on('error', () => res.end()).pipe(res);
    } else {
      res.send(Buffer.from(await r.arrayBuffer()));
    }
  } catch (e) {
    if (ctrl.signal.aborted) return;
    res.status(502).json({ error: 'Bridge inacessível: ' + (e.cause?.code || e.message) });
  }
});

// ---------- frontend ----------
const dist = path.join(__dirname, 'dist');
const noCache = /(^|\/)(sw\.js|workbox-[^/]+\.js|manifest\.webmanifest|index\.html|voice-worklet\.js)$/;
// The web manifest's background/theme colors paint the Android splash and the installed app's title bar,
// so they follow the theme the user picked (acp_theme cookie, set by the page) or, for "system", the
// Sec-CH-Prefers-Color-Scheme client hint.
const THEME_BG = { light: '#f2f2f7', dark: '#000000', terminal: '#141413' };
let manifestCache = null;
app.get('/manifest.webmanifest', (req, res, next) => {
  try {
    if (!manifestCache) manifestCache = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.webmanifest'), 'utf8'));
    const theme = cookieOf(req).acp_theme;
    const sys = String(req.headers['sec-ch-prefers-color-scheme'] || '').includes('dark') ? 'dark' : 'light';
    const color = THEME_BG[theme] || THEME_BG[sys];
    res.setHeader('Content-Type', 'application/manifest+json');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Vary', 'Cookie, Sec-CH-Prefers-Color-Scheme');
    res.send(JSON.stringify({ ...manifestCache, background_color: color, theme_color: color }));
  } catch { next(); }
});
app.use((req, res, next) => { res.setHeader('Accept-CH', 'Sec-CH-Prefers-Color-Scheme'); next(); });
app.use(express.static(dist, {
  index: false,
  setHeaders: (res, file) => res.setHeader('Cache-Control', noCache.test(file) ? 'no-cache' : file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600'),
}));
app.get('*', (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(dist, 'index.html')); });

const httpServer = http.createServer(app);

// WebSocket proxy for live agent computer (noVNC), Gemini Live voice (/api/bridge/voice/ws), WaCalls audio (/api/bridge/wacalls/ws), AND Local Computer Bridge (/api/local-bridge/ws)
httpServer.on('upgrade', (req, socket, head) => {
  const fullUrl = req.url || '/';
  const pathname = fullUrl.split('?')[0];
  const qs = fullUrl.includes('?') ? fullUrl.slice(fullUrl.indexOf('?')) : '';
  const isLocalBridge = pathname === '/api/local-bridge/ws';
  const isComputer = pathname === '/api/bridge/computer/ws';
  const isVoice = pathname === '/api/bridge/voice/ws';
  const isWaCalls = pathname === '/api/bridge/wacalls/ws';
  if (!isLocalBridge && !isComputer && !isVoice && !isWaCalls) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    return socket.destroy();
  }
  if ((isComputer || isVoice || isWaCalls) && (!BRIDGE_TOKEN || !validSession(req))) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return socket.destroy();
  }
  let target;
  try { target = new URL(BRIDGE_URL); } catch { return socket.destroy(); }
  const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
  const upstreamPath = isLocalBridge
    ? ('/admin/local-bridge/ws' + qs)
    : isVoice
      ? ('/admin/voice/ws' + qs)
      : isWaCalls
        ? ('/admin/wacalls/ws' + qs)
        : '/admin/computer/ws';
  const upstream = net.connect(port, target.hostname, () => {
    try { socket.setNoDelay(true); upstream.setNoDelay(true); } catch {}
    const hdrs = [
      `GET ${upstreamPath} HTTP/1.1`,
      `Host: ${target.host}`,
      ...(BRIDGE_TOKEN ? [`Authorization: Bearer ${BRIDGE_TOKEN}`] : []),
    ];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i], v = req.rawHeaders[i + 1];
      if (/^(host|authorization|cookie)$/i.test(k)) continue;
      hdrs.push(`${k}: ${v}`);
    }
    upstream.write(hdrs.join('\r\n') + '\r\n\r\n');
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  const close = () => { try { socket.destroy(); } catch {} try { upstream.destroy(); } catch {} };
  upstream.on('error', close);
  socket.on('error', close);
});

httpServer.listen(PORT, () => console.log(`Agent Control on :${PORT} | bridge ${BRIDGE_URL} | coolify ${coolifyConfigured() ? APP_UUID : 'off'}`));
