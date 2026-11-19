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

// ---------- public shared pages: GET /p/<id>/<token> serves the HTML page from the bridge ----------
app.get('/p/:id/:token', async (req, res) => {
  try {
    const r = await fetch(BRIDGE_URL + '/p/' + encodeURIComponent(req.params.id) + '/' + encodeURIComponent(req.params.token));
    res.status(r.status).type(r.headers.get('content-type') || 'text/html; charset=utf-8').send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.status(502).type('text/plain; charset=utf-8').send('Bridge inacessível');
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
app.get('/api/me', (req, res) => {
  const s = session(req);
  res.json({ ok: Boolean(s), email: s && s.email !== 'password' ? s.email : null, google: googleOn(), password: Boolean(ADMIN_PASSWORD) });
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
    loginCodes.set(one, { email, name: p.name || '', picture: p.picture || '', exp: Date.now() + 2 * 60000 });
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
  startSession(req, res, c.email);
  res.json({ ok: true, email: c.email, name: c.name, picture: c.picture });
});

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
  // A 401/403 from Coolify is not our session expiring: report it as an upstream error so the page does not log out.
  try { res.json(await fn(req)); } catch (e) { res.status(e.status && e.status < 500 && ![401, 403].includes(e.status) ? e.status : 502).json({ error: e.message }); }
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
// Files are at most 25 MB, so the proxy fetches the whole file and slices it here.
app.get('/api/bridge/web/files/:name', auth, async (req, res) => {
  if (!BRIDGE_TOKEN) return res.status(503).json({ error: 'BRIDGE_ADMIN_TOKEN não configurado no painel' });
  try {
    const r = await fetch(BRIDGE_URL + '/admin/web/files/' + encodeURIComponent(req.params.name), { headers: { Authorization: `Bearer ${BRIDGE_TOKEN}` } });
    if (!r.ok) return res.status(r.status === 401 ? 502 : r.status).json({ error: 'arquivo não encontrado' });
    const buf = Buffer.from(await r.arrayBuffer());
    const size = buf.length;
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=86400');
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

// ---------- bridge /admin proxy (JSON and SSE) ----------
app.all('/api/bridge/*', auth, async (req, res) => {
  if (!BRIDGE_TOKEN) return res.status(503).json({ error: 'BRIDGE_ADMIN_TOKEN não configurado no painel' });
  const target = BRIDGE_URL + '/admin/' + req.params[0] + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
  const ctrl = new AbortController();
  res.on('close', () => ctrl.abort());
  try {
    const r = await fetch(target, {
      method: req.method,
      // X-Panel-Url lets the bridge tell the agent the public address of routine webhooks.
      headers: { Authorization: `Bearer ${BRIDGE_TOKEN}`, 'Content-Type': 'application/json', 'X-Panel-Url': PUBLIC_URL || `${req.protocol}://${req.get('host')}` },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body || {}),
      signal: ctrl.signal,
    });
    const type = r.headers.get('content-type') || 'application/json';
    res.status(r.status === 401 ? 502 : r.status); // a bridge 401 means a bad BRIDGE_ADMIN_TOKEN, not an expired panel session
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
const noCache = /(^|\/)(sw\.js|workbox-[^/]+\.js|manifest\.webmanifest|index\.html)$/;
app.use(express.static(dist, {
  index: false,
  setHeaders: (res, file) => res.setHeader('Cache-Control', noCache.test(file) ? 'no-cache' : file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600'),
}));
app.get('*', (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(dist, 'index.html')); });

app.listen(PORT, () => console.log(`Agent Control on :${PORT} | bridge ${BRIDGE_URL} | app ${APP_UUID}`));
