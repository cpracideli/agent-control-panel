import { useState } from 'react';
import { Copy, Download, MessageSquare, Pencil, Plus, Search, Trash2, Wand2 } from 'lucide-react';
import { bridge } from '../api.js';
import { useT } from '../i18n.jsx';
import { Badge, Btn, Card, ErrorBox, Field, IconButton, Modal, useAction, useConfirm, useFmt, useLoad, useToast, useMore } from '../ui.jsx';
import { AddButton, DetailSheet, HeaderActions, ListGroup, ListRow, useIsMobile } from '../native.jsx';
import { BotSelect } from './Bots.jsx';

function SkillForm({ initial, bots, onClose, onSaved }) {
  const t = useT();
  const editing = Boolean(initial?.slug);
  const [f, setF] = useState({ name: '', slug: '', description: '', instructions: '', bot: '', ...initial });
  const [busy, run] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    const body = { name: f.name.trim(), slug: f.slug.trim() || undefined, description: f.description, instructions: f.instructions, bot: f.bot || '' };
    const r = editing
      ? await run('save', () => bridge.patchSkill(initial.slug, body), t('sk.saved'))
      : await run('save', () => bridge.addSkill(body), t('sk.created'));
    if (r) { onSaved(r); onClose(); }
  };

  return (
    <Modal title={editing ? t('sk.editTitle', { n: initial.name }) : t('sk.newTitle')} onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field label={t('sk.name')}><input required autoFocus={!editing} value={f.name} onChange={set('name')} placeholder={t('sk.namePh')} maxLength={80} /></Field>
          <Field label={t('bots.label')} hint={t('sk.botHint')}><BotSelect bots={bots || []} value={f.bot} onChange={(bot) => setF((cur) => ({ ...cur, bot }))} label={t('bots.label')} emptyLabel={t('sk.allBots')} /></Field>
        </div>
        <Field label={t('sk.desc')} hint={t('sk.descHint')}><input value={f.description} onChange={set('description')} placeholder={t('sk.descPh')} maxLength={300} /></Field>
        <Field label={t('sk.instructions')} hint={t('sk.instructionsHint')}>
          <textarea required rows={11} value={f.instructions} onChange={set('instructions')} placeholder={t('sk.instructionsPh')} />
        </Field>
        <div className="row end">
          <button type="button" className="ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button disabled={busy === 'save'}>{t('common.save')}</button>
        </div>
      </form>
    </Modal>
  );
}

function GithubImportModal({ onClose, onImported }) {
  const t = useT();
  const [url, setUrl] = useState('');
  const [busy, run] = useAction();
  const submit = async (e) => {
    e.preventDefault();
    const r = await run('imp', () => bridge.importSkillsGithub(url.trim()), t('sk.imported'));
    if (r) { onImported(r); onClose(); }
  };
  return (
    <Modal title={t('sk.githubTitle')} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small" style={{ margin: 0 }}>{t('sk.githubHint')}</p>
        <Field label="URL do GitHub">
          <input required autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/dono/repo/tree/main/skills" />
        </Field>
        <div className="row end">
          <button type="button" className="ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button disabled={busy === 'imp'}>{t('sk.importBtn')}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Skills() {
  const t = useT();
  const f = useFmt();
  const toast = useToast();
  const confirm = useConfirm();
  const skills = useLoad(() => bridge.skills(), [], { interval: 30000, cacheKey: '/bridge/skills' });
  const bots = useLoad(() => bridge.bots(), [], { cacheKey: '/bridge/bots' });
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);
  const [ghOpen, setGhOpen] = useState(false);
  const [busy, run] = useAction();

  const list = (skills.data || []).filter((s) => !q.trim() || (s.name + ' ' + s.slug + ' ' + s.description).toLowerCase().includes(q.toLowerCase()));
  const [vis_list, moreBtn_list] = useMore(list);

  const runInChat = async (sk) => {
    const c = await run('run' + sk.slug, () => bridge.newWeb({ bot: sk.bot || undefined, title: sk.name }));
    if (c) {
      sessionStorage.setItem('acp_prefill', '/' + sk.slug + ' ');
      window.location.hash = '#/chat/' + c.id.slice(4);
    }
  };

  const mobile = useIsMobile();
  const [detail, setDetail] = useState(null);
  const removeSkill = async (sk) => (await confirm(t('sk.removeConfirm', { n: sk.name }))) && run('d' + sk.slug, () => bridge.deleteSkill(sk.slug), t('common.removed')).then(() => skills.reload(true));
  const copySlug = (sk) => { navigator.clipboard.writeText('/' + sk.slug); toast(t('common.copied')); };
  const modals = (
    <>
      {form && <SkillForm initial={form} bots={bots.data} onClose={() => setForm(null)} onSaved={() => skills.reload(true)} />}
      {ghOpen && <GithubImportModal onClose={() => setGhOpen(false)} onImported={() => skills.reload(true)} />}
    </>
  );
  if (mobile) {
    const sel = (skills.data || []).find((x) => x.slug === detail);
    return (
      <div className="page page-list">
        <HeaderActions>
          <AddButton label={t('sk.new')} items={[
            { icon: Plus, label: t('sk.new'), onClick: () => setForm({}) },
            { icon: Download, label: t('sk.fromGithub'), onClick: () => setGhOpen(true) },
          ]} />
        </HeaderActions>
        <ErrorBox error={skills.error} onRetry={() => skills.reload()} />
        <label className="search search-native"><Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.filter')} /></label>
        {skills.data && !list.length && <p className="muted empty-note">{t('sk.none')}</p>}
        {list.length > 0 && (
          <ListGroup>
            {vis_list.map((sk) => (
              <ListRow key={sk.slug} leading={<span className="row-ic ic-skills"><Wand2 size={18} /></span>}
                title={sk.name} badges={<Badge>/{sk.slug}</Badge>}
                subtitle={sk.description || t('bots.noDescription')}
                onOpen={() => setDetail(sk.slug)}
                swipe={[
                  { icon: Pencil, label: t('common.edit'), kind: 'accent', onClick: () => setForm(sk) },
                  { icon: Trash2, label: t('common.remove'), kind: 'danger', onClick: () => removeSkill(sk) },
                ]} />
            ))}
{moreBtn_list}
          </ListGroup>
        )}
        {sel && (
          <DetailSheet title={'/' + sel.slug} onClose={() => setDetail(null)}
            header={<>
              <span className="row-ic detail-ic ic-skills"><Wand2 size={30} /></span>
              <h2>{sel.name}</h2>
              <p className="muted">{sel.description || t('bots.noDescription')}</p>
              <div className="row wrap center bot-badges">
                <span className="chip">{sel.botName || t('sk.allBots')}</span><span className="chip">{sel.source || 'manual'}</span><span className="chip">{f.ago(sel.updated)}</span>
              </div>
              <pre className="history-preview">{sel.instructions}</pre>
            </>}
            actions={[
              { icon: MessageSquare, label: t('sk.useInChat'), kind: 'primary', disabled: busy === 'run' + sel.slug, onClick: () => runInChat(sel) },
              { icon: Copy, label: t('common.copy') + ' /' + sel.slug, onClick: () => copySlug(sel) },
              { icon: Pencil, label: t('common.edit'), onClick: () => setForm(sel) },
              { icon: Trash2, label: t('common.remove'), kind: 'danger', onClick: () => removeSkill(sel) },
            ]} />
        )}
        {modals}
      </div>
    );
  }

  return (
    <div className="page">
      <ErrorBox error={skills.error} onRetry={() => skills.reload()} />
      <p className="muted page-intro">{t('sk.intro')}</p>
      <Card title={t('sk.title', { n: list.length })} icon={Wand2} actions={
        <div className="row wrap">
          <label className="search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.filter')} /></label>
          <Btn icon={Download} className="ghost small" onClick={() => setGhOpen(true)}>{t('sk.fromGithub')}</Btn>
          <Btn icon={Plus} className="small" onClick={() => setForm({})}>{t('sk.new')}</Btn>
        </div>
      }>
        {skills.data && !list.length && <p className="muted">{t('sk.none')}</p>}
        <div className="bot-grid">
          {vis_list.map((sk) => (
            <div key={sk.slug} className="bot-card">
              <div className="row">
                <span className="row-ic ic-skills" style={{ width: 38, height: 38, borderRadius: 11 }}><Wand2 size={18} /></span>
                <div className="grow">
                  <div className="row wrap"><b>{sk.name}</b><Badge>/{sk.slug}</Badge></div>
                  <div className="muted small ellipsis-2">{sk.description || t('bots.noDescription')}</div>
                </div>
              </div>
              <div className="row wrap bot-badges">
                <span className="chip">{sk.botName || t('sk.allBots')}</span>
                <span className="chip">{sk.source || 'manual'}</span>
                <span className="chip">{f.ago(sk.updated)}</span>
              </div>
              <pre className="history-preview" style={{ maxHeight: 84 }}>{sk.instructions}</pre>
              <div className="row bot-actions">
                <Btn icon={MessageSquare} className="small" disabled={busy === 'run' + sk.slug} onClick={() => runInChat(sk)}>{t('sk.useInChat')}</Btn>
                <span className="grow" />
                <IconButton icon={Copy} label={t('common.copy')} onClick={() => { navigator.clipboard.writeText('/' + sk.slug); toast(t('common.copied')); }} />
                <IconButton icon={Pencil} label={t('common.edit')} onClick={() => setForm(sk)} />
                <IconButton icon={Trash2} className="ghost danger-text" label={t('common.remove')}
                  onClick={async () => (await confirm(t('sk.removeConfirm', { n: sk.name }))) && run('d' + sk.slug, () => bridge.deleteSkill(sk.slug), t('common.removed')).then(() => skills.reload(true))} />
              </div>
            </div>
          ))}
{moreBtn_list}
        </div>
      </Card>
      {modals}
    </div>
  );
}
