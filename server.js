// Agent Control backend: login, Coolify API (envs, logs, restart, deploy) and a proxy to the bridge's /admin API.
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const PORT = Number(env.PORT || 3001);
const ADMIN_PASSWORD = env.ADMIN_PASSWORD || '';
const COOLIFY_URL = (env.COOLIFY_URL || 'http://137.131.175.211:8000').replace(/\/+$/, '');
const COOLIFY_TOKEN = env.COOLIFY_TOKEN || '';
const APP_UUID = env.COOLIFY_APP_UUID || 'xwdcjbwbo2sqvjhfpxzdwsuf';
const BRIDGE_URL = (env.BRIDGE_URL || 'http://claude-bridge-claude-zap:3000').replace(/\/+$/, '');
const BRIDGE_TOKEN = env.BRIDGE_ADMIN_TOKEN || '';
const SECRET = env.SESSION_SECRET || crypto.createHash('sha256').update('acp:' + ADMIN_PASSWORD + ':' + COOLIFY_TOKEN).digest('hex');
const SESSION_DAYS = 14;

if (!ADMIN_PASSWORD) console.warn('WARNING: ADMIN_PASSWORD is empty, login is disabled');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

// ---------- session cookie: "<expiry>.<hmac>" ----------
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const cookieOf = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]));
function validSession(req) {
  const v = cookieOf(req).acp_session;
  if (!v) return false;
  const [exp, mac] = v.split('.');
  if (!exp || !mac || Number(exp) < Date.now()) return false;
  const want = sign(exp);
  return mac.length === want.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want));
}
const auth = (req, res, next) => (validSession(req) ? next() : res.status(401).json({ error: 'Sessão expirada. Entre de novo.' }));

const attempts = new Map(); // ip -> { n, until }
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const a = attempts.get(ip) || { n: 0, until: 0 };
  if (a.until > Date.now()) return res.status(429).json({ error: 'Muitas tentativas. Aguarde um minuto.' });
  const got = Buffer.from(String((req.body || {}).password || ''));
  const want = Buffer.from(ADMIN_PASSWORD);
  if (!ADMIN_PASSWORD || got.length !== want.length || !crypto.timingSafeEqual(got, want)) {
    a.n += 1; if (a.n >= 5) { a.until = Date.now() + 60000; a.n = 0; }
    attempts.set(ip, a);
    return res.status(401).json({ error: 'Senha incorreta' });
  }
  attempts.delete(ip);
  const exp = String(Date.now() + SESSION_DAYS * 86400000);
  res.setHeader('Set-Cookie', `acp_session=${exp}.${sign(exp)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'acp_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => res.json({ ok: validSession(req) }));

// ---------- Coolify ----------
async function coolify(endpoint, options = {}) {
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
  try { res.json(await fn(req)); } catch (e) { res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message }); }
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

// ---------- bridge /admin proxy (JSON and SSE) ----------
app.all('/api/bridge/*', auth, async (req, res) => {
  if (!BRIDGE_TOKEN) return res.status(503).json({ error: 'BRIDGE_ADMIN_TOKEN não configurado no painel' });
  const target = BRIDGE_URL + '/admin/' + req.params[0] + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
  const ctrl = new AbortController();
  res.on('close', () => ctrl.abort());
  try {
    const r = await fetch(target, {
      method: req.method,
      headers: { Authorization: `Bearer ${BRIDGE_TOKEN}`, 'Content-Type': 'application/json' },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body || {}),
      signal: ctrl.signal,
    });
    const type = r.headers.get('content-type') || 'application/json';
    res.status(r.status);
    res.setHeader('Content-Type', type);
    if (type.includes('text/event-stream')) {
      res.setHeader('Cache-Control', 'no-cache');
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
app.use(express.static(dist, { index: false, maxAge: '1h' }));
app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));

app.listen(PORT, () => console.log(`Agent Control on :${PORT} | bridge ${BRIDGE_URL} | app ${APP_UUID}`));
