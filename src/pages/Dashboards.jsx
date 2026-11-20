import { useState } from 'react';
import { Code, Copy, ExternalLink, FileCode2, Globe, History, Lock, Maximize2, Pencil, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { bridge } from '../api.js';
import { useT } from '../i18n.jsx';
import { Badge, Btn, Card, ErrorBox, Field, IconButton, Modal, useAction, useConfirm, useFmt, useLoad, useToast } from '../ui.jsx';

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
          <a className="btn ghost small" href={rawUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {t('pg.full')}</a>
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
  const [busy, run] = useAction();

  return (
    <div className="page">
      <ErrorBox error={pages.error} onRetry={() => pages.reload()} />
      <p className="muted page-intro">{t('pg.intro')}</p>
      <Card title={t('pg.title', { n: pages.data?.length || 0 })} icon={FileCode2}
        actions={<Btn icon={Plus} className="small" onClick={() => setForm({})}>{t('pg.new')}</Btn>}>
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
                <div className="row bot-actions">
                  <Btn icon={Maximize2} className="small" onClick={() => setViewer(p)}>{t('pg.open')}</Btn>
                  <a className="btn ghost small" href={bridge.pageRawUrl(p.id)} target="_blank" rel="noreferrer"><ExternalLink size={14} /></a>
                  <span className="grow" />
                  <IconButton icon={ p.public ? Globe : Lock } label={t('pg.public')} disabled={busy === 'pub' + p.id}
                    onClick={() => run('pub' + p.id, () => bridge.patchPage(p.id, { public: !p.public }), t('pg.saved')).then(() => pages.reload(true))} />
                  <IconButton icon={Code} label={t('common.edit')} onClick={() => setForm(p)} />
                  <IconButton icon={History} label={t('bots.history')} disabled={!p.history?.length} onClick={() => setHistory(p)} />
                  <IconButton icon={Trash2} className="ghost danger-text" label={t('common.remove')}
                    onClick={async () => (await confirm(t('pg.removeConfirm', { n: p.title }))) && run('d' + p.id, () => bridge.deletePage(p.id), t('common.removed')).then(() => pages.reload(true))} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      {viewer && <PageViewer page={viewer} onClose={() => setViewer(null)} onEdit={(p) => setForm(p)} />}
      {form && <PageForm initial={form} bots={bots.data} onClose={() => setForm(null)} onSaved={() => pages.reload(true)} />}
      {history && <PageHistoryModal page={history} onClose={() => setHistory(null)} onRestored={() => pages.reload(true)} />}
    </div>
  );
}
