import { useState } from 'react';
import { Bot, Brain, Copy, Download, History, MessageSquare, Pencil, Plus, RotateCcw, ShieldCheck, Sparkles, Trash2, Upload } from 'lucide-react';
import { bridge } from '../api.js';
import { useT } from '../i18n.jsx';
import { Badge, Btn, Card, ErrorBox, Field, IconButton, Modal, useAction, useConfirm, useFmt, useLoad, useToast } from '../ui.jsx';

const COLORS = ['#0a84ff', '#30d158', '#ff9f0a', '#ff375f', '#bf5af2', '#64d2ff', '#ffd60a', '#8e8e93'];
const EMOJIS = ['🤖', '🔎', '📊', '✍️', '💼', '🧑‍💻', '📅', '💰', '🏠', '❤️', '🎯', '✨'];

export function BotAvatar({ bot, size = 40 }) {
  return (
    <span className="bot-avatar" style={{ width: size, height: size, fontSize: size * 0.5, background: (bot?.color || '#8e8e93') + '33', borderColor: (bot?.color || '#8e8e93') + '66' }} aria-hidden>
      {bot?.avatar ? <img src={bot.avatar} alt="" /> : (bot?.emoji || <Bot size={size * 0.5} />)}
    </span>
  );
}

function resizeAvatar(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2, sy = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function BotForm({ initial, providers, mcpNames, onClose, onSaved }) {
  const t = useT();
  const editing = Boolean(initial?.id);
  const [f, setF] = useState({ name: '', emoji: '✨', avatar: '', color: COLORS[0], description: '', instructions: '', provider: '', model: '', effort: '', agyModel: '', agyEffort: '', memory: 'own', approvalMode: 'auto', allowRules: '', blockRules: '', mcp: null, ...initial });
  const [busy, run] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const pickAvatar = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await resizeAvatar(file);
    setF((cur) => ({ ...cur, avatar: dataUrl }));
    e.target.value = '';
  };
  const provs = providers?.providers || [];
  const agy = f.provider === 'antigravity';
  const prov = provs.find((p) => p.id === (f.provider || providers?.defaultProvider || 'claude')) || provs[0];
  const agyModel = agy && prov?.models.find((m) => m.id === f.agyModel);
  const efforts = agy ? (agyModel ? agyModel.efforts : []) : (prov?.efforts || []);
  const limited = Array.isArray(f.mcp);
  const toggleMcp = (n) => setF({ ...f, mcp: f.mcp.includes(n) ? f.mcp.filter((x) => x !== n) : [...f.mcp, n] });
  const submit = async (e) => {
    e.preventDefault();
    const body = { name: f.name.trim(), emoji: f.emoji, avatar: f.avatar || '', color: f.color, description: f.description, instructions: f.instructions,
      provider: f.provider, model: agy ? '' : f.model, effort: agy ? '' : f.effort, agyModel: agy ? f.agyModel : '', agyEffort: agy ? f.agyEffort : '', memory: f.memory,
      approvalMode: f.approvalMode || 'auto', allowRules: f.allowRules || '', blockRules: f.blockRules || '', mcp: f.mcp };
    const r = editing ? await run('save', () => bridge.patchBot(f.id, body), t('bots.saved')) : await run('save', () => bridge.addBot(body), t('bots.created'));
    if (r) { onSaved(r); onClose(); }
  };
  return (
    <Modal title={editing ? t('bots.editTitle', { n: initial.name }) : t('bots.newTitle')} onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field label={t('bots.name')}><input required autoFocus={!editing} value={f.name} onChange={set('name')} placeholder={t('bots.namePh')} maxLength={40} /></Field>
          <Field label={t('bots.emoji')}>
            <div className="stack">
              <div className="row wrap">
                <BotAvatar bot={f} size={36} />
                <label className="btn ghost small" style={{ cursor: 'pointer' }}>
                  Imagem
                  <input type="file" accept="image/*" hidden onChange={pickAvatar} />
                </label>
                {f.avatar && <button type="button" className="ghost small" onClick={() => setF({ ...f, avatar: '' })}>Remover imagem</button>}
              </div>
              <div className="row wrap emoji-pick">
                <input className="emoji-input" value={f.emoji} onChange={set('emoji')} maxLength={8} aria-label={t('bots.emoji')} />
                {EMOJIS.map((x) => <button type="button" key={x} className={'ghost small' + (f.emoji === x ? ' on' : '')} onClick={() => setF({ ...f, emoji: x, avatar: '' })}>{x}</button>)}
              </div>
            </div>
          </Field>
          <Field label={t('bots.color')}>
            <div className="row wrap">{COLORS.map((c) => <button type="button" key={c} className={'color-dot' + (f.color === c ? ' on' : '')} style={{ background: c }} aria-label={c} onClick={() => setF({ ...f, color: c })} />)}</div>
          </Field>
        </div>
        <Field label={t('bots.description')} hint={t('bots.descriptionHint')}><input value={f.description} onChange={set('description')} maxLength={300} placeholder={t('bots.descriptionPh')} /></Field>
        <Field label={t('bots.instructions')} hint={t('bots.instructionsHint')}>
          <textarea rows={9} value={f.instructions} onChange={set('instructions')} placeholder={t('bots.instructionsPh')} />
        </Field>
        <div className="form-grid">
          <Field label={t('chat.provider')}>
            <select value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value, model: '', effort: '', agyModel: '', agyEffort: '' })}>
              <option value="">{t('bots.inherit')}</option>
              {provs.map((p) => <option key={p.id} value={p.id} disabled={!p.installed}>{p.name}</option>)}
            </select>
          </Field>
          <Field label={t('chat.model')}>
            <select value={agy ? f.agyModel : f.model} onChange={(e) => setF(agy ? { ...f, agyModel: e.target.value, agyEffort: '' } : { ...f, model: e.target.value })}>
              <option value="">{t('bots.inherit')}</option>
              {(prov?.models || []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </Field>
          {efforts.length > 0 && (
            <Field label={t('chat.effort')}>
              <select value={agy ? f.agyEffort : f.effort} onChange={(e) => setF(agy ? { ...f, agyEffort: e.target.value } : { ...f, effort: e.target.value })}>
                <option value="">{t('bots.inherit')}</option>
                {efforts.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </Field>
          )}
          <Field label={t('bots.memory')} hint={t('bots.memoryHint')}>
            <select value={f.memory} onChange={set('memory')}><option value="own">{t('bots.memOwn')}</option><option value="shared">{t('bots.memShared')}</option></select>
          </Field>
          <Field label={t('bots.approval')} hint={t('bots.approvalHint')}>
            <select value={f.approvalMode || 'auto'} onChange={set('approvalMode')}>
              <option value="auto">{t('bots.appAuto')}</option>
              <option value="ask">{t('bots.appAsk')}</option>
              <option value="never">{t('bots.appNever')}</option>
            </select>
          </Field>
        </div>
        <details className="trigger-box">
          <summary className="small"><b><ShieldCheck size={14} style={{ verticalAlign: -2 }} /> {t('bots.rulesTitle')}</b></summary>
          <div className="form-grid" style={{ marginTop: 10 }}>
            <Field label={t('bots.allowRules')}><textarea rows={3} value={f.allowRules || ''} onChange={set('allowRules')} placeholder={t('bots.allowPh')} /></Field>
            <Field label={t('bots.blockRules')}><textarea rows={3} value={f.blockRules || ''} onChange={set('blockRules')} placeholder={t('bots.blockPh')} /></Field>
          </div>
        </details>
        <Field label={t('bots.mcp')} hint={agy ? t('bots.mcpAgy') : t('bots.mcpHint')}>
          <div className="stack">
            <div className="seg">
              <button type="button" className={!limited ? 'on' : ''} onClick={() => setF({ ...f, mcp: null })}>{t('bots.mcpAll')}</button>
              <button type="button" className={limited ? 'on' : ''} onClick={() => setF({ ...f, mcp: limited ? f.mcp : [] })}>{t('bots.mcpSome')}</button>
            </div>
            {limited && (
              <div className="row wrap">
                {!mcpNames.length && <span className="muted small">{t('bots.mcpNone')}</span>}
                {mcpNames.map((n) => (
                  <label key={n} className="check chip-check"><input type="checkbox" checked={f.mcp.includes(n)} onChange={() => toggleMcp(n)} />{n}</label>
                ))}
              </div>
            )}
          </div>
        </Field>
        <div className="row end"><button type="button" className="ghost" onClick={onClose}>{t('common.cancel')}</button><button disabled={busy === 'save'}>{t('common.save')}</button></div>
      </form>
    </Modal>
  );
}

function MemoryModal({ bot, onClose }) {
  const t = useT();
  const mem = useLoad(() => bridge.botMemory(bot.id), [bot.id]);
  const [text, setText] = useState(null);
  const [busy, run] = useAction();
  const value = text ?? mem.data?.content ?? '';
  const save = async () => { if (await run('save', () => bridge.saveBotMemory(bot.id, value), t('mem.saved'))) onClose(); };
  return (
    <Modal title={t('bots.memoryTitle', { n: bot.name })} onClose={onClose} wide>
      <div className="stack">
        <ErrorBox error={mem.error} onRetry={() => mem.reload()} />
        <p className="muted small">{t('bots.memoryHelp')}{mem.data?.file && <> <span className="mono">{mem.data.file}</span></>}</p>
        <textarea rows={14} className="mono" value={value} onChange={(e) => setText(e.target.value)} placeholder={t('bots.memoryPh')} />
        <div className="row between"><span className="muted small">{t('bots.bytes', { n: new Blob([value]).size })}</span>
          <div className="row"><button type="button" className="ghost" onClick={onClose}>{t('common.cancel')}</button><button disabled={busy === 'save' || mem.loading} onClick={save}>{t('common.save')}</button></div>
        </div>
      </div>
    </Modal>
  );
}

function HistoryModal({ bot, onClose, onRestored }) {
  const t = useT();
  const f = useFmt();
  const [busy, run] = useAction();
  const list = (bot.history || []).slice().reverse();
  return (
    <Modal title={t('bots.historyTitle', { n: bot.name })} onClose={onClose} wide>
      {!list.length && <p className="muted">{t('bots.historyNone')}</p>}
      {list.map((h) => (
        <div key={h.at} className="list-row wrap">
          <div className="grow">
            <div className="row wrap"><b>{f.date(h.at)}</b><Badge>{t('bots.via.' + (h.via || 'panel'))}</Badge></div>
            <pre className="history-preview">{h.instructions || t('common.empty')}</pre>
          </div>
          <Btn icon={RotateCcw} className="ghost small" disabled={busy === h.at} onClick={async () => { const r = await run(h.at, () => bridge.restoreBot(bot.id, h.at), t('bots.restored')); if (r) { onRestored(); onClose(); } }}>{t('bots.restore')}</Btn>
        </div>
      ))}
    </Modal>
  );
}

const GROK_EXPORT_PROMPT = `Export your complete configuration as a single JSON object (format "grok-bot-export") without any passwords, API keys, or private personal data. Include:
{
  "format": "grok-bot-export",
  "name": "...",
  "description": "...",
  "instructions": "...",
  "rules": ["..."],
  "skills": [{ "name": "...", "description": "...", "steps": "..." }],
  "routines": [{ "name": "...", "cron": "...", "trigger": "...", "prompt": "..." }]
}
Reply with only the JSON block.`;

function TemplatesModal({ onClose, onCreated }) {
  const t = useT();
  const tpls = useLoad(() => bridge.botTemplates(), []);
  const [busy, run] = useAction();
  const useTpl = async (tpl) => {
    const r = await run(tpl.id, () => bridge.botFromTemplate(tpl.id), t('bots.tplCreated'));
    if (r) { onCreated(r); onClose(); }
  };
  return (
    <Modal title={t('bots.tplTitle')} onClose={onClose} wide>
      <ErrorBox error={tpls.error} onRetry={() => tpls.reload()} />
      <p className="muted small" style={{ marginTop: 0 }}>{t('bots.tplIntro')}</p>
      <div className="bot-grid">
        {(tpls.data || []).map((tpl) => (
          <div key={tpl.id} className="bot-card">
            <div className="row">
              <BotAvatar bot={tpl} size={40} />
              <div className="grow">
                <b>{tpl.name}</b>
                <div className="muted small ellipsis-2">{tpl.description}</div>
              </div>
            </div>
            {tpl.example && <pre className="history-preview" style={{ maxHeight: 82 }}>{tpl.example}</pre>}
            <div className="row wrap bot-badges">
              {tpl.skill && <span className="chip">+ 1 skill</span>}
              {tpl.routine && <span className="chip">+ 1 rotina pausada</span>}
              {tpl.approvalMode && <span className="chip">{t('bots.app.' + tpl.approvalMode)}</span>}
            </div>
            <Btn icon={Plus} className="small block" disabled={busy === tpl.id} onClick={() => useTpl(tpl)}>{t('bots.tplUse')}</Btn>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function ImportBotModal({ onClose, onImported }) {
  const t = useT();
  const toast = useToast();
  const [tab, setTab] = useState('grok');
  const [text, setText] = useState('');
  const [busy, run] = useAction();
  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result || ''));
    reader.readAsText(f);
    e.target.value = '';
  };
  const submit = async (e) => {
    e.preventDefault();
    const r = await run('imp', () => bridge.botImport(text), t('bots.imported'));
    if (r) { onImported(r); onClose(); }
  };
  return (
    <Modal title={t('bots.importTitle')} onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <div className="seg">
          <button type="button" className={tab === 'grok' ? 'on' : ''} onClick={() => setTab('grok')}>{t('bots.importGrok')}</button>
          <button type="button" className={tab === 'json' ? 'on' : ''} onClick={() => setTab('json')}>{t('bots.importJson')}</button>
        </div>
        {tab === 'grok' && (
          <div className="trigger-box stack">
            <div className="row between wrap">
              <b className="small">{t('bots.importGrokStep1')}</b>
              <Btn icon={Copy} type="button" className="ghost small" onClick={() => { navigator.clipboard.writeText(GROK_EXPORT_PROMPT); toast(t('common.copied')); }}>
                {t('bots.copyExportPrompt')}
              </Btn>
            </div>
            <pre className="history-preview" style={{ maxHeight: 110 }}>{GROK_EXPORT_PROMPT}</pre>
          </div>
        )}
        <div className="row wrap">
          <label className="btn ghost small" style={{ cursor: 'pointer' }}>
            <Upload size={14} /> {t('bots.importFile')}
            <input type="file" accept=".json,.txt" hidden onChange={onFile} />
          </label>
          <span className="muted small">{t('bots.importHint')}</span>
        </div>
        <Field label="JSON">
          <textarea required rows={9} className="mono" value={text} onChange={(e) => setText(e.target.value)} placeholder='{"format":"grok-bot-export","name":"..."}' />
        </Field>
        <div className="row end">
          <button type="button" className="ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button disabled={busy === 'imp' || !text.trim()}>{t('bots.importBtn')}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Bots() {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const bots = useLoad(() => bridge.bots(), [], { interval: 30000 });
  const providers = useLoad(() => bridge.providers(), []);
  const mcp = useLoad(() => bridge.mcp(), []);
  const [form, setForm] = useState(null);
  const [memory, setMemory] = useState(null);
  const [history, setHistory] = useState(null);
  const [tplOpen, setTplOpen] = useState(false);
  const [impOpen, setImpOpen] = useState(false);
  const [busy, run] = useAction();
  const mcpNames = mcp.data ? [...new Set(['user', 'local', 'project'].flatMap((s) => Object.keys(mcp.data.claude?.[s] || {})))].sort() : [];
  const provLabel = (b) => {
    const p = (providers.data?.providers || []).find((x) => x.id === b.provider);
    const model = b.provider === 'antigravity' ? b.agyModel : b.model;
    return [p ? p.name : '', model, b.provider === 'antigravity' ? b.agyEffort : b.effort].filter(Boolean).join(' · ');
  };
  const chatWith = async (b) => {
    const c = await run('chat' + b.id, () => bridge.newWeb({ bot: b.id, title: t('bots.chatTitle', { n: b.name }) }));
    if (c) window.location.hash = '#/chat/' + c.id.slice(4);
  };
  const exportBot = async (b) => {
    const data = await run('exp' + b.id, () => bridge.botExport(b.id));
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = b.id + '-bot-recipe.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(t('bots.exported'));
  };
  return (
    <div className="page">
      <ErrorBox error={bots.error} onRetry={() => bots.reload()} />
      <p className="muted page-intro">{t('bots.intro')}</p>
      <Card title={t('bots.title', { n: bots.data?.length || 0 })} icon={Bot} actions={
        <div className="row wrap">
          <Btn icon={Sparkles} className="ghost small" onClick={() => setTplOpen(true)}>{t('bots.templates')}</Btn>
          <Btn icon={Upload} className="ghost small" onClick={() => setImpOpen(true)}>{t('bots.import')}</Btn>
          <Btn icon={Plus} className="small" onClick={() => setForm({})}>{t('bots.new')}</Btn>
        </div>
      }>
        <div className="bot-grid">
          {(bots.data || []).map((b) => (
            <div key={b.id} className="bot-card">
              <div className="row">
                <BotAvatar bot={b} size={44} />
                <div className="grow">
                  <div className="row wrap"><b>{b.name}</b>{b.isDefault && <Badge>{t('bots.default')}</Badge>}</div>
                  <div className="muted small ellipsis-2">{b.description || t('bots.noDescription')}</div>
                </div>
              </div>
              <div className="row wrap bot-badges">
                {provLabel(b) ? <span className="chip">{provLabel(b)}</span> : <span className="chip">{t('bots.inheritModel')}</span>}
                <span className="chip">{b.memory === 'own' ? t('bots.memOwnShort', { n: b.memorySize }) : t('bots.memSharedShort')}</span>
                {b.approvalMode && b.approvalMode !== 'auto' && <span className="chip">{t('bots.app.' + b.approvalMode)}</span>}
                {Array.isArray(b.mcp) && <span className="chip">{t('bots.mcpCount', { n: b.mcp.length })}</span>}
                {b.instructions ? <span className="chip">{t('bots.hasInstructions')}</span> : null}
                <span className="chip">{t('bots.stats', { c: b.chats, r: b.routines })}</span>
              </div>
              <div className="row bot-actions">
                <Btn icon={MessageSquare} className="small" disabled={busy === 'chat' + b.id} onClick={() => chatWith(b)}>{t('bots.chat')}</Btn>
                <span className="grow" />
                <IconButton icon={Download} label={t('bots.export')} disabled={busy === 'exp' + b.id} onClick={() => exportBot(b)} />
                <IconButton icon={Pencil} label={t('common.edit')} onClick={() => setForm(b)} />
                {b.memory === 'own' && <IconButton icon={Brain} label={t('bots.memory')} onClick={() => setMemory(b)} />}
                <IconButton icon={History} label={t('bots.history')} disabled={!b.history?.length} onClick={() => setHistory(b)} />
                {!b.isDefault && <IconButton icon={Trash2} className="ghost danger-text" label={t('common.remove')}
                  onClick={async () => (await confirm(t('bots.removeConfirm', { n: b.name }))) && run('d' + b.id, () => bridge.deleteBot(b.id), t('common.removed')).then(() => bots.reload(true))} />}
              </div>
            </div>
          ))}
        </div>
      </Card>
      {form && <BotForm initial={form} providers={providers.data} mcpNames={mcpNames} onClose={() => setForm(null)} onSaved={() => bots.reload(true)} />}
      {memory && <MemoryModal bot={memory} onClose={() => { setMemory(null); bots.reload(true); }} />}
      {history && <HistoryModal bot={history} onClose={() => setHistory(null)} onRestored={() => bots.reload(true)} />}
      {tplOpen && <TemplatesModal onClose={() => setTplOpen(false)} onCreated={() => bots.reload(true)} />}
      {impOpen && <ImportBotModal onClose={() => setImpOpen(false)} onImported={() => bots.reload(true)} />}
    </div>
  );
}
