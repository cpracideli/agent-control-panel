import { useState } from 'react';
import { bridge, coolify } from '../api.js';
import { Badge, Card, ErrorBox, Field, confirmAsk, fmtAgo, fmtDur, useAction, useLoad, usd } from '../ui.jsx';

const statusKind = (s) => (String(s).startsWith('running') ? 'ok' : String(s).includes('exit') || String(s).includes('stop') ? 'err' : 'warn');

export default function Overview() {
  const app = useLoad(() => coolify.status(), [], { interval: 20000 });
  const ov = useLoad(() => bridge.overview(), [], { interval: 10000 });
  const chats = useLoad(() => bridge.chats(), [], { interval: 20000 });
  const [busy, run] = useAction();
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState('');

  const all = chats.data || [];
  const totals = all.reduce((t, c) => ({ runs: t.runs + c.totals.runs, cost: t.cost + c.totals.cost, ms: t.ms + c.totals.ms, errors: t.errors + c.totals.errors }), { runs: 0, cost: 0, ms: 0, errors: 0 });
  const o = ov.data;

  return (
    <div className="page">
      <div className="stats">
        <div className="stat"><small>Container</small><b><Badge kind={statusKind(app.data?.status)}>{app.data?.status || '…'}</Badge></b></div>
        <div className="stat"><small>Bridge</small><b>{o ? 'v' + o.version.slice(0, 7) : ov.error ? 'offline' : '…'}</b><small>{o ? 'no ar há ' + fmtDur(o.uptime * 1000) : ''}</small></div>
        <div className="stat"><small>Execuções</small><b>{totals.runs}</b><small>{totals.errors} com erro</small></div>
        <div className="stat"><small>Custo estimado</small><b>{usd(totals.cost)}</b><small>{fmtDur(totals.ms)} de trabalho</small></div>
        <div className="stat"><small>ai-memory</small><b><Badge kind={o?.aiMemory.status === 'ok' ? 'ok' : 'warn'}>{o?.aiMemory.status || '…'}</Badge></b></div>
      </div>
      <ErrorBox error={ov.error && 'Bridge: ' + ov.error} onRetry={() => ov.reload()} />
      <ErrorBox error={app.error && 'Coolify: ' + app.error} onRetry={() => app.reload()} />

      <div className="grid2">
        <Card title="Em andamento">
          {o && !o.running.length && <p className="muted">Nada rodando agora.</p>}
          {o?.running.map((r) => (
            <div key={r.chatId} className="list-row">
              <div><b>{r.chatId.startsWith('web:') ? 'Web' : r.chatId.split('@')[0]}</b><div className="muted small">"{r.prompt}" · há {fmtAgo(r.started)}</div></div>
              <button className="danger small" disabled={busy === r.chatId} onClick={() => run(r.chatId, () => bridge.stopChat(r.chatId), 'Interrompido').then(() => ov.reload(true))}>Parar</button>
            </div>
          ))}
        </Card>

        <Card title="Ações do container">
          <p className="muted small">{app.data?.name} · {app.data?.git_repository}@{app.data?.git_branch}</p>
          <div className="row wrap">
            <button className="warn" disabled={!!busy} onClick={() => confirmAsk('Reiniciar o agente? Tarefas em andamento serão interrompidas.') && run('restart', coolify.restart, 'Reinício solicitado')}>Reiniciar</button>
            <button className="ghost" disabled={!!busy} onClick={() => confirmAsk('Fazer redeploy do agente (puxa o compose do repo)?') && run('deploy', coolify.deploy, 'Deploy enfileirado')}>Redeploy</button>
          </div>
          <p className="muted small">Mudanças em variáveis só valem depois de reiniciar ou fazer redeploy.</p>
        </Card>
      </div>

      <div className="grid2">
        <Card title="Conversas">
          {all.map((c) => (
            <div key={c.id} className="list-row">
              <div>
                <b>{c.kind === 'web' ? '🌐 ' : '📱 '}{c.title}</b>
                <div className="muted small">{c.provider === 'antigravity' ? 'Antigravity' : 'Claude'} · {c.totals.runs} execuções · {usd(c.totals.cost)} · última {fmtAgo((c.runs.at(-1) || {}).at) || '—'}</div>
              </div>
              {c.running ? <Badge kind="warn">rodando</Badge> : c.totals.errors ? <Badge kind="err">{c.totals.errors} erros</Badge> : <Badge>ok</Badge>}
            </div>
          ))}
          {chats.data && !all.length && <p className="muted">Nenhuma conversa ainda.</p>}
        </Card>

        <Card title="Enviar WhatsApp">
          <form className="stack" onSubmit={(e) => { e.preventDefault(); run('send', () => bridge.sendWhatsApp(to, msg), 'Mensagem enviada').then((r) => r && setMsg('')); }}>
            <Field label="Para" hint="Número com DDI (ex. +55 11 99999-8888) ou id do WhatsApp"><input value={to} onChange={(e) => setTo(e.target.value)} placeholder="+55 11 99999-8888" /></Field>
            <Field label="Mensagem"><textarea rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} /></Field>
            <button disabled={busy === 'send' || !to || !msg.trim()}>Enviar pelo número do bot</button>
          </form>
        </Card>
      </div>
    </div>
  );
}
