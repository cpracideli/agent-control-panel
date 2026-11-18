import { useState } from 'react';
import { bridge } from '../api.js';
import { Badge, Card, ErrorBox, Field, Modal, confirmAsk, fmtDate, useAction, useLoad } from '../ui.jsx';

const CRON_HELP = [['0 8 * * *', 'todo dia às 8h'], ['0 9 * * 1-5', 'dias úteis às 9h'], ['*/30 * * * *', 'a cada 30 min'], ['0 18 * * 5', 'sexta às 18h']];

function ScheduleForm({ initial, chats, onClose, onSaved }) {
  const editing = Boolean(initial?.id);
  const [f, setF] = useState({ chatId: chats[0]?.id || '', kind: 'cron', cron: '0 8 * * *', at: '', description: '', prompt: '', ...initial, ...(initial?.at ? { kind: 'at' } : {}) });
  const [busy, run] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const r = editing
      ? await run('save', () => bridge.patchSchedule(f.id, { description: f.description, prompt: f.prompt, ...(f.cron && f.kind === 'cron' ? { cron: f.cron } : {}) }), 'Agendamento salvo')
      : await run('save', () => bridge.addSchedule({ chatId: f.chatId, description: f.description, prompt: f.prompt, ...(f.kind === 'cron' ? { cron: f.cron } : { at: new Date(f.at).toISOString() }) }), 'Agendamento criado');
    if (r) { onSaved(); onClose(); }
  };
  return (
    <Modal title={editing ? 'Editar agendamento #' + f.id : 'Novo agendamento'} onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Entregar em" hint="A resposta final vai para esta conversa">
            <select value={f.chatId} onChange={set('chatId')} disabled={editing}>
              {chats.map((c) => <option key={c.id} value={c.id}>{c.kind === 'web' ? '🌐 ' : '📱 '}{c.title}</option>)}
            </select>
          </Field>
          <Field label="Quando">
            <select value={f.kind} onChange={set('kind')} disabled={editing}><option value="cron">Recorrente (cron)</option><option value="at">Uma vez</option></select>
          </Field>
          {f.kind === 'cron'
            ? <Field label="Cron" hint="minuto hora dia mês dia-da-semana"><input className="mono" required value={f.cron} onChange={set('cron')} /></Field>
            : <Field label="Data e hora"><input type="datetime-local" required value={f.at} onChange={set('at')} disabled={editing} /></Field>}
        </div>
        {f.kind === 'cron' && <div className="presets">{CRON_HELP.map(([c, l]) => <button type="button" key={c} className="ghost small" onClick={() => setF({ ...f, cron: c })}>{l}</button>)}</div>}
        <Field label="Descrição"><input required value={f.description} onChange={set('description')} placeholder="Resumo de notícias de IA" /></Field>
        <Field label="Instrução" hint="Roda numa sessão nova, sem contexto: escreva tudo o que o agente precisa saber."><textarea required rows={5} value={f.prompt} onChange={set('prompt')} /></Field>
        <div className="row end"><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button disabled={busy === 'save'}>Salvar</button></div>
      </form>
    </Modal>
  );
}

export default function Schedules() {
  const sch = useLoad(() => bridge.schedules(), [], { interval: 30000 });
  const chats = useLoad(() => bridge.chats(), []);
  const [form, setForm] = useState(null);
  const [busy, run] = useAction();
  const list = sch.data || [];
  return (
    <div className="page">
      <ErrorBox error={sch.error} onRetry={() => sch.reload()} />
      <Card title={`Agendamentos (${list.length})`} actions={<button className="small" disabled={!chats.data?.length} onClick={() => setForm({})}>+ Novo</button>}>
        {sch.data && !list.length && <p className="muted">Nenhum agendamento. Crie aqui ou peça no chat: "todo dia às 8h me mande…".</p>}
        {list.map((s) => (
          <div key={s.id} className="list-row wrap">
            <div className="grow">
              <b>#{s.id} · {s.description}</b> {s.paused && <Badge kind="warn">pausado</Badge>}
              <div className="muted small">
                <span className="mono">{s.cron ? s.cron : 'uma vez em ' + fmtDate(s.at)}</span> · {s.chatId.startsWith('web:') ? '🌐 ' : '📱 '}{s.chatTitle}
                {s.lastRun && ' · última ' + fmtDate(s.lastRun)}
              </div>
            </div>
            <div className="row wrap">
              <button className="ghost small" disabled={busy === 'run' + s.id} onClick={() => run('run' + s.id, () => bridge.runSchedule(s.id), 'Executando agora')}>Rodar agora</button>
              <button className="ghost small" onClick={() => run('p' + s.id, () => bridge.patchSchedule(s.id, { paused: !s.paused })).then(() => sch.reload(true))}>{s.paused ? 'Retomar' : 'Pausar'}</button>
              <button className="ghost small" onClick={() => setForm(s)}>Editar</button>
              <button className="ghost small danger-text" onClick={() => confirmAsk('Remover #' + s.id + '?') && run('d' + s.id, () => bridge.deleteSchedule(s.id), 'Removido').then(() => sch.reload(true))}>Remover</button>
            </div>
          </div>
        ))}
      </Card>
      {form && <ScheduleForm initial={form} chats={chats.data || []} onClose={() => setForm(null)} onSaved={() => sch.reload(true)} />}
    </div>
  );
}
