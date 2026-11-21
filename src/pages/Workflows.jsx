// Visual workflow editor: block canvas (drag to reorder), inspector, live run highlighting.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Bot as BotIc, ChevronDown, ChevronUp, FileText, GitBranch, GitFork, Hand, Plus, Save, Trash2, Zap, Database } from 'lucide-react';
import { bridge } from '../api.js';
import { Badge, Btn, Card, ErrorBox, Field, IconButton, useAction, useConfirm, useLoad } from '../ui.jsx';

const KINDS = {
  bot: { label: 'Bot', icon: BotIc, color: '#0a84ff' },
  condition: { label: 'Condição', icon: GitFork, color: '#ff9f0a' },
  approval: { label: 'Aprovação', icon: Hand, color: '#bf5af2' },
  notify: { label: 'Notificar', icon: Bell, color: '#30d158' },
  draft: { label: 'Rascunho', icon: FileText, color: '#64d2ff' },
  page_data: { label: 'Mini-App', icon: Database, color: '#ff375f' },
};
const blank = (type, n) => ({ id: 's' + n, name: KINDS[type].label + ' ' + n, type, ...(type === 'bot' ? { bot: 'default', prompt: '' } : type === 'condition' ? { expr: '' } : type === 'approval' ? { title: 'Confirmar', question: 'Aprovar?' } : type === 'page_data' ? { pageId: '' } : { prompt: '{{last}}' }) });
const uid = (steps) => { let n = steps.length + 1; while (steps.some((s) => s.id === 's' + n)) n++; return n; };

export default function Workflows() {
  const wfs = useLoad(() => bridge.workflows(), [], { interval: 30000 });
  const bots = useLoad(() => bridge.bots(), [], { cacheKey: '/bridge/bots' });
  const [runs, setRuns] = useState([]);
  const [sel, setSel] = useState(null);
  const [draft, setDraft] = useState(null); // {id?, name, cron, steps}
  const [cur, setCur] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, act] = useAction();
  const confirm = useConfirm();
  const dragFrom = useRef(null);
  const [over, setOver] = useState(null);

  useEffect(() => { // poll runs
    let stop = false;
    const tick = () => bridge.workflowRuns().then((r) => !stop && setRuns(Array.isArray(r) ? r : [])).catch(() => {});
    tick(); const i = setInterval(tick, 2000);
    return () => { stop = true; clearInterval(i); };
  }, []);

  const list = Array.isArray(wfs.data) ? wfs.data : [];
  useEffect(() => { if (!sel && list.length) setSel(list[0].id); }, [list, sel]);
  const wf = list.find((w) => w.id === sel);
  useEffect(() => { if (wf && !dirty) { setDraft({ id: wf.id, name: wf.name, cron: wf.trigger?.cron || '', steps: JSON.parse(JSON.stringify(wf.steps || [])) }); setCur(0); } }, [wf, dirty]);

  const run = useMemo(() => (draft?.id ? runs.filter((r) => r.workflowId === draft.id).sort((a, b) => String(b.started).localeCompare(String(a.started)))[0] : null), [runs, draft?.id]);
  const stat = (i) => {
    if (!run || dirty) return '';
    const log = run.stepLogs?.[i];
    if (log) return log.status === 'ok' ? 'ok' : log.status === 'error' ? 'err' : log.status === 'running' ? 'live' : 'wait';
    return '';
  };
  const setSteps = (steps) => { setDraft((d) => ({ ...d, steps })); setDirty(true); };
  const patchStep = (i, p) => setSteps(draft.steps.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (a, b) => { if (b < 0 || b >= draft.steps.length || a === b) return; const s = [...draft.steps]; const [x] = s.splice(a, 1); s.splice(b, 0, x); setSteps(s); setCur(b); };
  const add = (type, at) => { const s = [...draft.steps]; const n = blank(type, uid(s)); s.splice(at ?? s.length, 0, n); setSteps(s); setCur(at ?? s.length - 1); };

  const startNew = () => { setSel(null); setDirty(true); setDraft({ name: 'Novo workflow', cron: '', steps: [blank('bot', 1)] }); setCur(0); };
  const save = async () => {
    const body = { name: draft.name.trim() || 'Workflow', trigger: draft.cron.trim() ? { cron: draft.cron.trim() } : {}, steps: draft.steps };
    const r = await act('save', () => (draft.id ? bridge.patchWorkflow(draft.id, body) : bridge.addWorkflow({ ...body, chatId: '' })), 'Workflow salvo');
    if (r) { setDirty(false); const id = draft.id || r.id; await wfs.reload(true); if (id) setSel(id); }
  };
  const del = async () => { if (!draft?.id || !(await confirm('Remover workflow "' + draft.name + '"?'))) return; await act('del', () => bridge.deleteWorkflow(draft.id), 'Removido'); setDirty(false); setSel(null); setDraft(null); wfs.reload(true); };
  const runNow = () => act('run', () => bridge.runWorkflow(draft.id, 'manual'), 'Execução iniciada');
  const step = draft?.steps?.[cur];

  return (
    <div className="page wf-page">
      <ErrorBox error={wfs.error} onRetry={() => wfs.reload()} />
      <Card title="Editor de workflows" icon={GitBranch} actions={<Btn icon={Plus} className="small" onClick={startNew}>Novo</Btn>}>
        <div className="wf-tabs">
          {list.map((w) => <button key={w.id} className={'chip' + (w.id === sel && !(dirty && !draft?.id) ? ' active' : '')} onClick={() => { if (dirty && !window.confirm('Descartar alterações não salvas?')) return; setDirty(false); setSel(w.id); }}>{w.name}</button>)}
          {!list.length && !draft && <span className="muted small">Nenhum workflow ainda. Toque em Novo para montar o primeiro.</span>}
        </div>
      </Card>

      {draft && (
        <div className="wf-layout">
          <Card title={null} className="wf-canvas-card">
            <div className="wf-head">
              <input aria-label="Nome" className="grow" value={draft.name} onChange={(e) => { setDraft({ ...draft, name: e.target.value }); setDirty(true); }} />
              <input aria-label="Cron" className="mono wf-cron" placeholder="cron (opcional)" value={draft.cron} onChange={(e) => { setDraft({ ...draft, cron: e.target.value }); setDirty(true); }} />
            </div>
            <div className="wf-canvas" role="list">
              <div className="wf-start">Gatilho{draft.cron ? ' · ' + draft.cron : ' · manual'}</div>
              {draft.steps.map((s, i) => {
                const K = KINDS[s.type] || KINDS.bot; const Ic = K.icon; const st = stat(i);
                return (
                  <div key={s.id + i} role="listitem">
                    <div className="wf-link"><button className="wf-ins" aria-label="Inserir bloco aqui" onClick={() => add('bot', i)}><Plus size={12} /></button></div>
                    <div className={'wf-node ' + st + (i === cur ? ' sel' : '') + (over === i ? ' over' : '')} style={{ '--k': K.color }} draggable
                      onDragStart={() => { dragFrom.current = i; }} onDragOver={(e) => { e.preventDefault(); setOver(i); }} onDragLeave={() => setOver(null)}
                      onDrop={(e) => { e.preventDefault(); setOver(null); if (dragFrom.current != null) move(dragFrom.current, i); dragFrom.current = null; }}
                      onClick={() => setCur(i)}>
                      <span className="wf-ic"><Ic size={16} /></span>
                      <div className="grow"><b className="ellipsis">{s.name}</b><div className="muted small">{K.label}{s.type === 'bot' ? ' · ' + (s.bot || 'default') : ''}</div></div>
                      {st && <Badge kind={st === 'ok' ? 'ok' : st === 'err' ? 'err' : 'warn'}>{st === 'live' ? 'rodando' : st === 'ok' ? 'ok' : st === 'err' ? 'erro' : 'aguarda'}</Badge>}
                      <span className="wf-mv"><IconButton icon={ChevronUp} label="Subir" onClick={(e) => { e.stopPropagation(); move(i, i - 1); }} /><IconButton icon={ChevronDown} label="Descer" onClick={(e) => { e.stopPropagation(); move(i, i + 1); }} /></span>
                    </div>
                  </div>
                );
              })}
              <div className="wf-link end" />
              <div className="wf-start end">Fim</div>
            </div>
            <div className="wf-palette" aria-label="Blocos">
              {Object.entries(KINDS).map(([k, v]) => <button key={k} className="wf-chip" style={{ '--k': v.color }} onClick={() => add(k)}><v.icon size={14} />{v.label}</button>)}
            </div>
          </Card>

          <Card title={step ? 'Bloco: ' + step.name : 'Bloco'} className="wf-inspector">
            {step ? (
              <div className="stack" style={{ gap: 10 }}>
                <Field label="Nome"><input value={step.name} onChange={(e) => patchStep(cur, { name: e.target.value })} /></Field>
                <div className="form-grid">
                  <Field label="ID"><input className="mono" value={step.id} onChange={(e) => patchStep(cur, { id: e.target.value.replace(/\W/g, '') })} /></Field>
                  <Field label="Tipo"><select value={step.type} onChange={(e) => patchStep(cur, { type: e.target.value })}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
                </div>
                {step.type === 'bot' && <Field label="Bot"><select value={step.bot || 'default'} onChange={(e) => patchStep(cur, { bot: e.target.value })}>{(bots.data || [{ id: 'default', name: 'default' }]).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>}
                {step.type === 'condition' && <Field label="Expressão" hint="Se falsa, o fluxo termina aqui."><input className="mono" value={step.expr || ''} onChange={(e) => patchStep(cur, { expr: e.target.value })} placeholder="{{steps.s1}} contains urgente" /></Field>}
                {step.type === 'approval' && <><Field label="Título"><input value={step.title || ''} onChange={(e) => patchStep(cur, { title: e.target.value })} /></Field><Field label="Pergunta"><textarea rows={3} value={step.question || ''} onChange={(e) => patchStep(cur, { question: e.target.value })} /></Field></>}
                {step.type === 'page_data' && <Field label="ID da página"><input className="mono" value={step.pageId || ''} onChange={(e) => patchStep(cur, { pageId: e.target.value })} /></Field>}
                {step.type === 'draft' && <div className="form-grid"><Field label="Canal"><select value={step.channel || 'whatsapp'} onChange={(e) => patchStep(cur, { channel: e.target.value })}><option value="whatsapp">WhatsApp</option><option value="email">E-mail</option></select></Field><Field label="Para"><input value={step.to || ''} onChange={(e) => patchStep(cur, { to: e.target.value })} /></Field></div>}
                {['bot', 'notify', 'draft'].includes(step.type) && <Field label="Texto / prompt" hint="Use {{trigger}}, {{last}}, {{steps.s1}}"><textarea rows={5} value={step.prompt || ''} onChange={(e) => patchStep(cur, { prompt: e.target.value })} /></Field>}
                {draft.steps.length > 1 && <div className="row end"><button className="ghost small danger-text" onClick={() => { setSteps(draft.steps.filter((_, j) => j !== cur)); setCur(0); }}><Trash2 size={13} /> Remover bloco</button></div>}
              </div>
            ) : <p className="muted small">Adicione um bloco.</p>}
          </Card>
        </div>
      )}

      {draft && (
        <div className="wf-bar">
          <span className="muted small">{dirty ? 'Alterações não salvas' : run ? 'Última execução: ' + run.status : 'Salvo'}</span>
          <div className="row">
            {draft.id && <IconButton icon={Trash2} className="ghost danger-text" label="Remover workflow" onClick={del} />}
            {draft.id && <Btn icon={Zap} className="ghost small" disabled={dirty || busy === 'run'} onClick={runNow}>Rodar</Btn>}
            <Btn icon={Save} className="small" disabled={!dirty || busy === 'save'} onClick={save}>Salvar</Btn>
          </div>
        </div>
      )}
    </div>
  );
}
