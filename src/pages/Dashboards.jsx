import { useEffect, useState } from 'react';
import { LayoutTemplate, Code, Copy, Database, ExternalLink, FileCode2, Globe, History, Lock, Maximize2, MoreHorizontal, Pencil, Plus, RefreshCw, RotateCcw, Save, Sparkles, Trash2 } from 'lucide-react';
import { bridge } from '../api.js';
import { useT } from '../i18n.jsx';
import { Badge, Btn, Card, ErrorBox, Field, IconButton, Modal, useAction, useConfirm, useFmt, useLoad, useToast } from '../ui.jsx';
import { docLink } from '../viewer.jsx';
import TemplateGallery from './PageTemplates.jsx';

const MINI_APP_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Checklist Interativo</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 20px; background: #0b0d12; color: #f8fafc; }
  .wrap { max-width: 560px; margin: 0 auto; }
  h1 { margin: 0 0 12px; font-size: 22px; }
  .row { display: flex; gap: 8px; margin-bottom: 14px; }
  input { flex: 1; padding: 10px 12px; border-radius: 10px; border: 1px solid #334155; background: #161a24; color: #f8fafc; font-size: 16px; }
  button { padding: 10px 14px; border-radius: 10px; border: 0; background: #0a84ff; color: #fff; font-weight: 600; cursor: pointer; }
  .item { display: flex; align-items: center; gap: 10px; background: #161a24; padding: 11px 14px; border-radius: 12px; margin-bottom: 8px; }
  .done { text-decoration: line-through; opacity: .55; }
  .del { background: transparent; color: #f87171; padding: 4px 8px; margin-left: auto; }
</style>
</head>
<body>
<div class="wrap">
  <h1>✅ Lista Interativa (Mini-App)</h1>
  <div class="row"><input id="inp" placeholder="Adicionar item..." /><button id="add">Adicionar</button></div>
  <div id="list">Carregando...</div>
</div>
<script>
  let state = { items: [] };
  const listEl = document.getElementById('list');
  const inp = document.getElementById('inp');
  async function save() { if (window.PageData) await window.PageData.set(state); render(); }
  function render() {
    listEl.innerHTML = '';
    if (!state.items.length) { listEl.innerHTML = '<p style="opacity:.6">Nenhum item ainda.</p>'; return; }
    state.items.forEach((it, idx) => {
      const d = document.createElement('div'); d.className = 'item';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!it.done; cb.style.flex = '0';
      cb.onchange = () => { state.items[idx].done = cb.checked; save(); };
      const sp = document.createElement('span'); sp.textContent = it.text; if (it.done) sp.className = 'done';
      const rm = document.createElement('button'); rm.className = 'del'; rm.textContent = '✕';
      rm.onclick = () => { state.items.splice(idx, 1); save(); };
      d.append(cb, sp, rm); listEl.appendChild(d);
    });
  }
  document.getElementById('add').onclick = () => { const v = inp.value.trim(); if (!v) return; state.items.push({ text: v, done: false }); inp.value = ''; save(); };
  inp.onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('add').click(); };
  (window.PageData ? window.PageData.get() : Promise.resolve({})).then((d) => { if (d && Array.isArray(d.items)) state = d; render(); }).catch(render);
</script>
</body>
</html>`;

function PageDataModal({ page, onClose, onSaved }) {
  const toast = useToast();
  const ld = useLoad(() => bridge.pageData(page.id), [page.id]);
  const [raw, setRaw] = useState('');
  const [busy, run] = useAction();
  useEffect(() => {
    if (ld.data !== undefined && ld.data !== null) setRaw(JSON.stringify(ld.data, null, 2));
  }, [ld.data]);
  const save = async () => {
    let parsed;
    try { parsed = JSON.parse(raw || '{}'); } catch { return toast('JSON inválido', 'err'); }
    const r = await run('save', () => bridge.setPageData(page.id, parsed), 'Dados do Mini-App salvos');
    if (r) { onSaved?.(); onClose(); }
  };
  return (
    <Modal title={'Dados persistentes — ' + page.title} onClose={onClose} wide>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>
          Estado JSON salvo no SQLite e acessível via <code className="mono">window.PageData</code> dentro da página (e em <code className="mono">/p/{page.id}/TOKEN/data</code> se pública).
        </p>
        <ErrorBox error={ld.error} onRetry={() => ld.reload()} />
        <textarea rows={14} className="mono" value={raw} onChange={(e) => setRaw(e.target.value)} />
        <div className="row end">
          <button type="button" className="ghost" onClick={onClose}>Cancelar</button>
          <Btn icon={Save} disabled={busy === 'save' || ld.loading} onClick={save}>Salvar JSON</Btn>
        </div>
      </div>
    </Modal>
  );
}

const SAMPLE_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Dashboard</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 24px; background: #0f172a; color: #f8fafc; }
  h1 { margin: 0 0 8px; font-size: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-top: 18px; }
  .card { background: #1e293b; border-radius: 14px; padding: 16px; }
  .val { font-size: 28px; font-weight: 700; color: #38bdf8; margin-top: 4px; }
</style>
</head>
<body>
  <h1>Painel Resumo</h1>
  <div class="grid">
    <div class="card"><div>Total</div><div class="val">128</div></div>
    <div class="card"><div>Status</div><div class="val">Ativo</div></div>
  </div>
</body>
</html>`;

function publicUrlOf(p) {
  if (!p?.public || !p?.shareToken) return '';
  return window.location.origin + '/p/' + encodeURIComponent(p.id) + '/' + encodeURIComponent(p.shareToken);
}

function PageForm({ initial, bots, onClose, onSaved }) {
  const t = useT();
  const editing = Boolean(initial?.id);
  const full = useLoad(() => (editing ? bridge.page(initial.id) : Promise.resolve(null)), [initial?.id]);
  const [f, setF] = useState({
    title: initial?.title || '',
    description: initial?.description || '',
    bot: initial?.bot || 'default',
    public: Boolean(initial?.public),
    html: initial?.html || (editing ? null : SAMPLE_HTML),
  });
  const [busy, run] = useAction();
  const htmlVal = f.html ?? full.data?.html ?? '';
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    const body = { title: f.title.trim(), description: f.description, bot: f.bot, public: Boolean(f.public), html: htmlVal };
    const r = editing
      ? await run('save', () => bridge.patchPage(initial.id, body), t('pg.saved'))
      : await run('save', () => bridge.addPage(body), t('pg.created'));
    if (r) { onSaved(r); onClose(); }
  };

  return (
    <Modal title={editing ? t('pg.editTitle', { n: initial.title }) : t('pg.newTitle')} onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <ErrorBox error={full.error} onRetry={() => full.reload()} />
        <div className="form-grid">
          <Field label={t('pg.name')}><input required autoFocus={!editing} value={f.title} onChange={set('title')} placeholder={t('pg.namePh')} maxLength={120} /></Field>
          <Field label={t('bots.label')}>
            <select value={f.bot} onChange={set('bot')}>
              {(bots || []).map((b) => <option key={b.id} value={b.id}>{(b.emoji ? b.emoji + ' ' : '') + b.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t('pg.desc')}><input value={f.description} onChange={set('description')} placeholder={t('pg.descPh')} maxLength={300} /></Field>
        <label className="check">
          <input type="checkbox" checked={f.public} onChange={(e) => setF({ ...f, public: e.target.checked })} />
          <span><b>{t('pg.public')}</b> — {t('pg.publicHint')}</span>
        </label>
        <Field label={t('pg.html')}>
          <textarea rows={14} className="mono" required value={htmlVal} onChange={(e) => setF({ ...f, html: e.target.value })} />
        </Field>
        <div className="row end">
          <button type="button" className="ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button disabled={busy === 'save' || (editing && full.loading)}>{t('common.save')}</button>
        </div>
      </form>
    </Modal>
  );
}

function PageViewer({ page, onClose, onEdit }) {
  const t = useT();
  const toast = useToast();
  const [rev, setRev] = useState(0);
  const pubUrl = publicUrlOf(page);
  const rawUrl = bridge.pageRawUrl(page.id) + '?v=' + (page.updated || '') + '-' + rev;
  return (
    <Modal title={page.title} onClose={onClose} wide>
      <div className="stack">
        {page.description && <p className="muted small" style={{ margin: 0 }}>{page.description}</p>}
        <div className="row wrap">
          <Badge kind={page.public ? 'ok' : 'muted'}>{page.public ? t('pg.publicBadge') : t('pg.privateBadge')}</Badge>
          <Badge>{t('pg.revs', { n: page.revisions || 1 })}</Badge>
          {page.botName && <span className="chip">{page.botName}</span>}
          <span className="grow" />
          <IconButton icon={RefreshCw} label="Reload" onClick={() => setRev((n) => n + 1)} />
          <Btn icon={Pencil} className="ghost small" onClick={() => { onClose(); onEdit(page); }}>{t('common.edit')}</Btn>
          <a className="btn ghost small" {...docLink(rawUrl, page.title, 'text/html')}><ExternalLink size={14} /> {t('pg.full')}</a>
          {pubUrl && (
            <Btn icon={Copy} className="small" onClick={() => { navigator.clipboard.writeText(pubUrl); toast(t('common.copied')); }}>{t('pg.copyLink')}</Btn>
          )}
        </div>
        <div className="page-frame-wrap">
          <iframe key={rawUrl} src={rawUrl} title={page.title} className="page-frame" sandbox="allow-scripts allow-forms allow-popups" />
        </div>
      </div>
    </Modal>
  );
}

function PageHistoryModal({ page, onClose, onRestored }) {
  const t = useT();
  const f = useFmt();
  const full = useLoad(() => bridge.page(page.id), [page.id]);
  const [busy, run] = useAction();
  const list = (full.data?.history || page.history || []).slice().reverse();
  return (
    <Modal title={t('pg.historyTitle', { n: page.title })} onClose={onClose} wide>
      <ErrorBox error={full.error} onRetry={() => full.reload()} />
      {!list.length && <p className="muted">{t('bots.historyNone')}</p>}
      {list.map((h) => (
        <div key={h.at} className="list-row wrap">
          <div className="grow">
            <div className="row wrap"><b>{f.date(h.at)}</b>{h.title && <Badge>{h.title}</Badge>}</div>
            <pre className="history-preview">{(h.html || '').slice(0, 600)}</pre>
          </div>
          <Btn icon={RotateCcw} className="ghost small" disabled={busy === h.at}
            onClick={async () => {
              const r = await run(h.at, () => bridge.restorePage(page.id, h.at), t('pg.restored'));
              if (r) { onRestored(); onClose(); }
            }}>{t('bots.restore')}</Btn>
        </div>
      ))}
    </Modal>
  );
}

export default function Dashboards() {
  const t = useT();
  const f = useFmt();
  const toast = useToast();
  const confirm = useConfirm();
  const pages = useLoad(() => bridge.pages(), [], { interval: 20000, cacheKey: '/bridge/pages' });
  const bots = useLoad(() => bridge.bots(), [], { cacheKey: '/bridge/bots' });
  const [viewer, setViewer] = useState(null);
  const [form, setForm] = useState(null);
  const [history, setHistory] = useState(null);
  const [openMenu, setOpenMenu] = useState(null);
  const [dataModal, setDataModal] = useState(null);
  const [gallery, setGallery] = useState(false);
  const [busy, run] = useAction();

  return (
    <div className="page">
      <ErrorBox error={pages.error} onRetry={() => pages.reload()} />
      <p className="muted page-intro">{t('pg.intro')}</p>
      <Card title={t('pg.title', { n: pages.data?.length || 0 })} icon={FileCode2}
        actions={<div className="row wrap" style={{ gap: 6 }}>
          <Btn icon={LayoutTemplate} className="ghost small" onClick={() => setGallery(true)}>Modelos</Btn>
          <Btn icon={Sparkles} className="ghost small" onClick={() => setForm({ title: 'Lista Interativa', description: 'Mini-App com estado persistente via window.PageData', html: MINI_APP_HTML })}>Novo Mini-App</Btn>
          <Btn icon={Plus} className="small" onClick={() => setForm({})}>{t('pg.new')}</Btn>
        </div>}>
        {pages.data && !pages.data.length && <p className="muted">{t('pg.none')}</p>}
        <div className="bot-grid">
          {(pages.data || []).map((p) => {
            const pubUrl = publicUrlOf(p);
            return (
              <div key={p.id} className="bot-card">
                <div className="row">
                  <span className="row-ic ic-dashboards" style={{ width: 38, height: 38, borderRadius: 11 }}><FileCode2 size={19} /></span>
                  <div className="grow">
                    <div className="row wrap">
                      <b>{p.title}</b>
                      <Badge kind={p.public ? 'ok' : 'muted'}>{p.public ? t('pg.publicBadge') : t('pg.privateBadge')}</Badge>
                      {p.hasData && <Badge kind="ok">Mini-App</Badge>}
                      <Badge>{t('pg.revs', { n: p.revisions || 1 })}</Badge>
                    </div>
                    <div className="muted small ellipsis-2">{p.description || ('/' + p.id)}</div>
                  </div>
                </div>
                <div className="row wrap bot-badges">
                  <span className="chip mono">{p.id}</span>
                  {p.botName && <span className="chip">{p.botName}</span>}
                  <span className="chip">{f.ago(p.updated)}</span>
                  <span className="chip">{Math.max(1, Math.round((p.size || 0) / 1024))} KB</span>
                </div>
                {pubUrl && (
                  <div className="row hook-url" style={{ paddingLeft: 0 }}>
                    <Globe size={14} className="muted" />
                    <code className="grow ellipsis">{pubUrl}</code>
                    <IconButton icon={Copy} size={14} label={t('pg.copyLink')} onClick={() => { navigator.clipboard.writeText(pubUrl); toast(t('common.copied')); }} />
                  </div>
                )}
                <div className="row bot-actions" style={{ position: 'relative' }}>
                  <Btn icon={Maximize2} className="small" onClick={() => setViewer(p)}>{t('pg.open')}</Btn>
                  <span className="grow" />
                  <IconButton icon={MoreHorizontal} label={t('pg.more')} onClick={() => setOpenMenu(openMenu === p.id ? null : p.id)} />
                  {openMenu === p.id && (
                    <div className="pg-more-menu">
                      <a className="pg-menu-item" {...docLink(bridge.pageRawUrl(p.id), p.title, 'text/html')} onClick={() => setOpenMenu(null)}>
                        <ExternalLink size={14} /><span>{t('pg.full')}</span>
                      </a>
                      <button type="button" className="pg-menu-item" disabled={busy === 'pub' + p.id}
                        onClick={() => { setOpenMenu(null); run('pub' + p.id, () => bridge.patchPage(p.id, { public: !p.public }), t('pg.saved')).then(() => pages.reload(true)); }}>
                        {p.public ? <Globe size={14} /> : <Lock size={14} />}
                        <span>{t('pg.public')}</span>
                      </button>
                      <button type="button" className="pg-menu-item" onClick={() => { setOpenMenu(null); setDataModal(p); }}>
                        <Database size={14} /><span>Dados do Mini-App</span>
                      </button>
                      <button type="button" className="pg-menu-item" onClick={() => { setOpenMenu(null); setForm(p); }}>
                        <Code size={14} /><span>{t('common.edit')}</span>
                      </button>
                      <button type="button" className="pg-menu-item" disabled={!p.history?.length} onClick={() => { setOpenMenu(null); setHistory(p); }}>
                        <History size={14} /><span>{t('bots.history')}</span>
                      </button>
                      <button type="button" className="pg-menu-item danger-text"
                        onClick={async () => {
                          setOpenMenu(null);
                          if (await confirm(t('pg.removeConfirm', { n: p.title }))) {
                            run('d' + p.id, () => bridge.deletePage(p.id), t('common.removed')).then(() => pages.reload(true));
                          }
                        }}>
                        <Trash2 size={14} /><span>{t('common.remove')}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      {viewer && <PageViewer page={viewer} onClose={() => setViewer(null)} onEdit={(p) => setForm(p)} />}
      {form && <PageForm initial={form} bots={bots.data} onClose={() => setForm(null)} onSaved={() => pages.reload(true)} />}
      {gallery && <TemplateGallery bots={bots.data || []} onClose={() => setGallery(false)} onCreated={() => pages.reload(true)} />}
      {history && <PageHistoryModal page={history} onClose={() => setHistory(null)} onRestored={() => pages.reload(true)} />}
      {dataModal && <PageDataModal page={dataModal} onClose={() => setDataModal(null)} onSaved={() => pages.reload(true)} />}
    </div>
  );
}
