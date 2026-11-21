// Memory explorer: ai-memory wiki pages (per project) and Claude Code's own memory files (MEMORY.md + one .md per fact).
// Browse, search, read, edit, delete, create, or hand a page to the agent with a suggestion.
import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Brain, FileText, MessageSquarePlus, Pencil, Pin, Plus, Search, Trash2 } from 'lucide-react';
import { api, bridge } from '../api.js';
import { useT } from '../i18n.jsx';
import { Badge, Btn, Card, ErrorBox, Field, Sheet, useConfirm, useFmt, useLoad, useToast } from '../ui.jsx';

const mem = {
  projects: () => api('GET', '/bridge/memory/projects'),
  pages: (p) => api('GET', '/bridge/memory/pages?project=' + encodeURIComponent(p)),
  page: (p, path) => api('GET', '/bridge/memory/page?project=' + encodeURIComponent(p) + '&path=' + encodeURIComponent(path)),
  savePage: (b) => api('PUT', '/bridge/memory/page', b),
  deletePage: (p, path) => api('DELETE', '/bridge/memory/page?project=' + encodeURIComponent(p) + '&path=' + encodeURIComponent(path)),
  local: () => api('GET', '/bridge/memory/local'),
  saveLocal: (b) => api('PUT', '/bridge/memory/local', b),
  deleteLocal: (file) => api('DELETE', '/bridge/memory/local?file=' + encodeURIComponent(file)),
};

const Md = ({ text }) => <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text || ''}</ReactMarkdown></div>;
const KIND_GROUP = (k) => (k === 'session' ? 'session' : k === 'fact' || k === 'note' || k === 'rule' || k === 'decision' || k === 'gotcha' || k === 'procedure' ? 'fact' : 'other');

// Opens a new chat with the memory as context and the user's suggestion, then jumps to it.
async function suggest(t, toast, { source, label, ref, content }, text) {
  const c = await bridge.newWeb({ title: t('mem.suggestTitle', { n: label }).slice(0, 60) });
  const prompt = t('mem.suggestPrompt', { source, ref }) + '\n\n' + text.trim() + '\n\n---\n' + content.slice(0, 6000);
  await bridge.send(c.id, prompt, [], '');
  window.location.hash = '#/chat/' + c.id.replace(/^web:/, '');
}

function SuggestSheet({ item, onClose }) {
  const t = useT();
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title={t('mem.suggest')} onClose={onClose}>
      <div className="group pad stack">
        <p className="muted small">{t('mem.suggestHint', { n: item.label })}</p>
        <textarea rows={5} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={t('mem.suggestPh')} />
        <Btn icon={MessageSquarePlus} disabled={busy || !text.trim()} onClick={async () => {
          setBusy(true);
          try { await suggest(t, toast, item, text); } catch (e) { toast(e.message, 'err'); setBusy(false); }
        }}>{t('mem.suggestSend')}</Btn>
      </div>
    </Sheet>
  );
}

function Editor({ initial, local, onSave, onClose }) {
  const t = useT();
  const confirm = useConfirm();
  const [v, setV] = useState(initial);
  const [tab, setTab] = useState('edit');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const isNew = !initial.exists;
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const handleClose = async () => {
    if (!dirty || (await confirm(t('mem.unsavedConfirm')))) onClose();
  };
  const previewText = local ? (isNew ? v.body : v.raw) : v.body;
  return (
    <Sheet title={isNew ? t('mem.new') : t('mem.edit')} onClose={handleClose}>
      <form className="group pad stack" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await onSave(v); onClose(); } catch { setBusy(false); } }}>
        <div className="seg" style={{ alignSelf: 'flex-start' }}>
          <button type="button" className={tab === 'edit' ? 'on' : ''} onClick={() => setTab('edit')}>{t('common.editTab')}</button>
          <button type="button" className={tab === 'preview' ? 'on' : ''} onClick={() => setTab('preview')}>{t('common.preview')}</button>
        </div>
        {tab === 'preview' ? (
          <div className="mem-preview"><Md text={previewText} /></div>
        ) : local ? (
          isNew ? <>
            <Field label={t('mem.slug')} hint={t('mem.slugHint')}><input value={v.name} onChange={set('name')} required pattern="[\w\-.]+" /></Field>
            <Field label={t('mem.title')}><input value={v.title} onChange={set('title')} /></Field>
            <Field label={t('mem.desc')}><input value={v.description} onChange={set('description')} required /></Field>
            <Field label={t('mem.type')}>
              <select value={v.type} onChange={set('type')}>{['user', 'feedback', 'project', 'reference'].map((x) => <option key={x}>{x}</option>)}</select>
            </Field>
            <Field label="Área (Nod)">
              <select value={v.area || ''} onChange={set('area')}>
                <option value="">Sem área</option>
                <option value="about">about (quem você é)</option>
                <option value="preferences">preferences (preferências)</option>
                <option value="people">people (contatos)</option>
                <option value="routines">routines (rotinas)</option>
                <option value="lessons">lessons (lições aprendidas)</option>
              </select>
            </Field>
            <Field label={t('mem.body')}><textarea rows={10} value={v.body} onChange={set('body')} /></Field>
          </> : <Field label={t('mem.rawFile', { f: v.file })}><textarea className="mono" rows={18} value={v.raw} onChange={set('raw')} /></Field>
        ) : <>
          {isNew && <Field label={t('mem.path')} hint={t('mem.pathHint')}><input value={v.path} onChange={set('path')} required pattern="[\w\-./]+\.md" /></Field>}
          <Field label={t('mem.title')}><input value={v.title} onChange={set('title')} required /></Field>
          <Field label={t('mem.kind')}><input value={v.kind} onChange={set('kind')} placeholder="fact" /></Field>
          <Field label={t('mem.tags')}><input value={v.tags} onChange={set('tags')} placeholder="tag1, tag2" /></Field>
          <Field label={t('mem.body')}><textarea className="mono" rows={14} value={v.body} onChange={set('body')} /></Field>
        </>}
        <Btn disabled={busy}>{t('common.save')}</Btn>
      </form>
    </Sheet>
  );
}

function Viewer({ title, meta, body, onEdit, onDelete, onSuggest, onClose }) {
  const t = useT();
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="group pad">
        <div className="mem-meta">{meta}</div>
        <div className="row wrap mem-actions">
          <Btn icon={MessageSquarePlus} className="small" onClick={onSuggest}>{t('mem.suggest')}</Btn>
          {onEdit && <Btn icon={Pencil} className="ghost small" onClick={onEdit}>{t('mem.edit')}</Btn>}
          {onDelete && <Btn icon={Trash2} className="danger small" onClick={onDelete}>{t('common.delete')}</Btn>}
        </div>
        {body == null ? <p className="muted">…</p> : <Md text={body} />}
      </div>
    </Sheet>
  );
}

function AiMemory() {
  const t = useT();
  const f = useFmt();
  const toast = useToast();
  const confirm = useConfirm();
  const projects = useLoad(() => mem.projects(), [], { cacheKey: 'mem:projects' });
  const [project, setProject] = useState('workspace');
  const pages = useLoad(() => mem.pages(project), [project]);
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('fact');
  const [open, setOpen] = useState(null); // { path, page? }
  const [editing, setEditing] = useState(null);
  const [suggesting, setSuggesting] = useState(null);

  const list = useMemo(() => (pages.data || [])
    .filter((p) => group === 'all' || KIND_GROUP(p.kind) === group)
    .filter((p) => !q || (p.title + ' ' + p.path).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [pages.data, group, q]);
  const counts = useMemo(() => (pages.data || []).reduce((a, p) => ({ ...a, [KIND_GROUP(p.kind)]: (a[KIND_GROUP(p.kind)] || 0) + 1 }), {}), [pages.data]);

  const openPage = async (path) => {
    setOpen({ path });
    try { const page = await mem.page(project, path); setOpen((o) => o && o.path === path && { path, page }); } catch (e) { toast(e.message, 'err'); setOpen(null); }
  };
  const save = async (v) => {
    try {
      await mem.savePage({ project, path: v.path, title: v.title, body: v.body, kind: v.kind || undefined, tags: String(v.tags || '').split(',').map((x) => x.trim()).filter(Boolean), pinned: v.pinned, tier: v.tier });
      toast(t('mem.saved')); pages.reload(true); if (open) openPage(v.path);
    } catch (e) { toast(e.message, 'err'); throw e; }
  };
  const del = async (p) => {
    if (!(await confirm(t('mem.deleteConfirm', { n: p.title })))) return;
    try { await mem.deletePage(project, p.path); toast(t('mem.deleted')); setOpen(null); pages.reload(true); } catch (e) { toast(e.message, 'err'); }
  };
  const pg = open?.page;

  return (
    <>
      <div className="mem-toolbar">
        <select value={project} onChange={(e) => { setProject(e.target.value); setOpen(null); }} aria-label={t('mem.project')}>
          {(projects.data?.projects || [{ project_name: 'workspace' }]).map((p) => (
            <option key={p.project_id || p.project_name} value={p.project_name}>{p.project_name}{p.page_count != null ? ` (${p.page_count})` : ''}</option>
          ))}
        </select>
        <div className="seg">
          {['fact', 'session', 'other', 'all'].map((g) => (
            <button key={g} type="button" className={group === g ? 'on' : ''} onClick={() => setGroup(g)}>{t('mem.g.' + g)}{g !== 'all' && counts[g] ? ' ' + counts[g] : ''}</button>
          ))}
        </div>
        <label className="mem-search"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('mem.search')} /></label>
        <Btn icon={Plus} className="small" onClick={() => setEditing({ exists: false, path: 'notes/', title: '', kind: 'fact', tags: '', body: '' })}>{t('mem.new')}</Btn>
      </div>
      <ErrorBox error={pages.error || projects.error} onRetry={() => { projects.reload(); pages.reload(); }} />
      <Card>
        {pages.data && !list.length && <p className="muted">{t('mem.empty')}</p>}
        {list.map((p) => (
          <button type="button" key={p.path} className="list-row mem-row" onClick={() => openPage(p.path)}>
            <div className="grow">
              <b className="with-ic">{p.pinned && <Pin size={13} />}<span className="ellipsis">{p.title}</span></b>
              <div className="muted small ellipsis">{p.path} · {t('ov.ago', { t: f.ago(p.updated_at) })}</div>
            </div>
            <Badge>{p.kind}</Badge>
          </button>
        ))}
      </Card>
      {open && (
        <Viewer title={pg?.title || open.path} body={pg?.body_markdown}
          meta={pg && <>
            <code>{pg.path}</code>
            <div className="mem-badges"><Badge>{pg.kind}</Badge><Badge>{pg.tier}</Badge>{pg.pinned && <Badge kind="ok">pinned</Badge>}</div>
            {pg.frontmatter?.tags?.length ? <div className="muted small">#{pg.frontmatter.tags.join(' #')}</div> : null}
            <div className="muted small">{t('mem.updated', { d: f.date(pg.updated_at) })}</div>
          </>}
          onSuggest={() => pg && setSuggesting({ source: 'ai-memory', label: pg.title, ref: `${project} / ${pg.path}`, content: pg.body_markdown })}
          onEdit={pg && (() => setEditing({ exists: true, path: pg.path, title: pg.title, kind: pg.kind, tier: pg.tier, pinned: pg.pinned, tags: (pg.frontmatter?.tags || []).join(', '), body: pg.body_markdown }))}
          onDelete={pg && (() => del(pg))}
          onClose={() => setOpen(null)} />
      )}
      {editing && <Editor initial={editing} onSave={save} onClose={() => setEditing(null)} />}
      {suggesting && <SuggestSheet item={suggesting} onClose={() => setSuggesting(null)} />}
    </>
  );
}

function LocalMemory() {
  const t = useT();
  const f = useFmt();
  const toast = useToast();
  const confirm = useConfirm();
  const data = useLoad(() => mem.local(), [], { cacheKey: 'mem:local' });
  const [q, setQ] = useState('');
  const [area, setArea] = useState('');
  const [open, setOpen] = useState(null);
  const [editing, setEditing] = useState(null);
  const [suggesting, setSuggesting] = useState(null);
  const items = (data.data?.items || []).filter((x) => (!area || x.area === area) && (!q || (x.name + ' ' + x.description + ' ' + x.body).toLowerCase().includes(q.toLowerCase())));
  const save = async (v) => {
    try {
      await mem.saveLocal(v.exists ? { file: v.file, raw: v.raw } : { name: v.name, title: v.title, description: v.description, type: v.type, area: v.area || '', body: v.body });
      toast(t('mem.saved')); setOpen(null); data.reload(true);
    } catch (e) { toast(e.message, 'err'); throw e; }
  };
  const del = async (x) => {
    if (!(await confirm(t('mem.deleteConfirm', { n: x.name })))) return;
    try { await mem.deleteLocal(x.file); toast(t('mem.deletedLocal')); setOpen(null); data.reload(true); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <>
      <div className="mem-toolbar">
        <span className="muted small ellipsis grow"><code>{data.data?.dir}</code></span>
        <div className="seg">
          {[['', 'Todas'], ['about', 'about'], ['preferences', 'pref'], ['people', 'people'], ['routines', 'routines'], ['lessons', 'lessons']].map(([k, lbl]) => (
            <button key={k || 'all'} type="button" className={area === k ? 'on' : ''} onClick={() => setArea(k)}>{lbl}</button>
          ))}
        </div>
        <label className="mem-search"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('mem.search')} /></label>
        <Btn icon={Plus} className="small" onClick={() => setEditing({ exists: false, name: '', title: '', description: '', type: 'project', area: area || '', body: '' })}>{t('mem.new')}</Btn>
      </div>
      <ErrorBox error={data.error} onRetry={() => data.reload()} />
      <Card>
        {data.data && !items.length && <p className="muted">{t('mem.empty')}</p>}
        {items.map((x) => (
          <button type="button" key={x.file} className="list-row mem-row" onClick={() => setOpen(x)}>
            <div className="grow">
              <b className="ellipsis">{x.name}</b>
              <div className="muted small mem-desc">{x.description}</div>
              <div className="muted small">{x.file} · {t('ov.ago', { t: f.ago(x.updated_at) })}{!x.indexed && <> · <span className="meter-err">{t('mem.notIndexed')}</span></>}</div>
            </div>
            <div className="row" style={{ gap: 4 }}>
              {x.area && <Badge kind="ok">{x.area}</Badge>}
              {x.type && <Badge>{x.type}</Badge>}
            </div>
          </button>
        ))}
      </Card>
      {open && (
        <Viewer title={open.name} body={open.body}
          meta={<><code>{open.file}</code>{open.type && <div className="mem-badges"><Badge>{open.type}</Badge></div>}<div className="muted small">{open.description}</div></>}
          onSuggest={() => setSuggesting({ source: t('mem.localSource'), label: open.name, ref: open.file, content: open.raw })}
          onEdit={() => setEditing({ exists: true, file: open.file, raw: open.raw })}
          onDelete={() => del(open)}
          onClose={() => setOpen(null)} />
      )}
      {editing && <Editor local initial={editing} onSave={save} onClose={() => setEditing(null)} />}
      {suggesting && <SuggestSheet item={suggesting} onClose={() => setSuggesting(null)} />}
    </>
  );
}

export default function Memory() {
  const t = useT();
  const [tab, setTab] = useState('ai');
  return (
    <div className="page">
      <div className="seg big mem-tabs">
        <button type="button" className={tab === 'ai' ? 'on' : ''} onClick={() => setTab('ai')}><Brain size={14} /> ai-memory</button>
        <button type="button" className={tab === 'local' ? 'on' : ''} onClick={() => setTab('local')}><FileText size={14} /> {t('mem.local')}</button>
      </div>
      {tab === 'ai' ? <AiMemory /> : <LocalMemory />}
    </div>
  );
}
