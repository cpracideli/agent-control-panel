const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 3001;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const COOLIFY_URL = (process.env.COOLIFY_URL || 'http://137.131.175.211:8000').replace(/\/$/, '');
const COOLIFY_TOKEN = process.env.COOLIFY_TOKEN || '';
const COOLIFY_APP_UUID = process.env.COOLIFY_APP_UUID || 'xwdcjbwbo2sqvjhfpxzdwsuf';

function authMiddleware(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || token !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Não autorizado. Informe a senha de acesso.' });
  }
  next();
}

async function coolifyFetch(endpoint, options = {}) {
  const url = `${COOLIFY_URL}/api/v1${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${COOLIFY_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch (_) {}
  if (!res.ok) {
    throw new Error(typeof data === 'object' ? JSON.stringify(data) : text);
  }
  return data;
}

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Senha incorreta' });
});

app.get('/api/status', authMiddleware, async (req, res) => {
  try {
    const appData = await coolifyFetch(`/applications/${COOLIFY_APP_UUID}`);
    res.json({
      name: appData.name,
      status: appData.status,
      fqdn: appData.fqdn,
      git_repository: appData.git_repository,
      git_branch: appData.git_branch,
      updated_at: appData.updated_at
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/envs', authMiddleware, async (req, res) => {
  try {
    const envs = await coolifyFetch(`/applications/${COOLIFY_APP_UUID}/envs`);
    res.json(envs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/envs', authMiddleware, async (req, res) => {
  try {
    const { key, value, is_preview = false } = req.body;
    if (!key) return res.status(400).json({ error: 'key é obrigatória' });
    const data = await coolifyFetch(`/applications/${COOLIFY_APP_UUID}/envs`, {
      method: 'POST',
      body: JSON.stringify({ key, value: value ?? '', is_preview })
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/envs', authMiddleware, async (req, res) => {
  try {
    const { key, value, is_preview = false } = req.body;
    if (!key) return res.status(400).json({ error: 'key é obrigatória' });
    const data = await coolifyFetch(`/applications/${COOLIFY_APP_UUID}/envs`, {
      method: 'PATCH',
      body: JSON.stringify({ key, value: value ?? '', is_preview })
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/envs/:uuid', authMiddleware, async (req, res) => {
  try {
    const data = await coolifyFetch(`/applications/${COOLIFY_APP_UUID}/envs/${req.params.uuid}`, {
      method: 'DELETE'
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/restart', authMiddleware, async (req, res) => {
  try {
    const data = await coolifyFetch(`/applications/${COOLIFY_APP_UUID}/restart`, {
      method: 'POST'
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs', authMiddleware, async (req, res) => {
  try {
    const data = await coolifyFetch(`/applications/${COOLIFY_APP_UUID}/logs?lines=100`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Agent Control Panel rodando na porta ${PORT}`);
});
