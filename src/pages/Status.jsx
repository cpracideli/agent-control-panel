// "Estado do sistema": traffic lights built from endpoints that already exist (read-only).
import { useMemo } from 'react';
import { Activity } from 'lucide-react';
import { bridge, coolify } from '../api.js';
import { Card, ErrorBox, useLoad } from '../ui.jsx';

const ago = (iso) => { if (!iso) return 'nunca'; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 60 ? m + ' min atrás' : m < 2880 ? Math.round(m / 60) + ' h atrás' : Math.round(m / 1440) + ' d atrás'; };

function Light({ state, title, detail }) {
  return (
    <div className={'st-row ' + state}>
      <span className="st-light" aria-hidden />
      <div className="grow"><b>{title}</b><div className="muted small">{detail}</div></div>
      <span className="st-word small">{state === 'ok' ? 'OK' : state === 'warn' ? 'Atenção' : state === 'err' ? 'Falha' : '—'}</span>
    </div>
  );
}

export default function Status() {
  const ov = useLoad(() => bridge.overview(), [], { interval: 15000 });
  const app = useLoad(() => coolify.status(), [], { interval: 30000 });
  const prov = useLoad(() => bridge.providers(), [], { interval: 60000 });
  const use = useLoad(() => bridge.usage(), [], { interval: 60000, cacheKey: '/bridge/usage' });
  const sch = useLoad(() => bridge.schedules(), [], { interval: 60000 });

  const rows = useMemo(() => {
    const r = [];
    const o = ov.data;
    r.push(ov.error ? { s: 'err', t: 'Ponte (claude-zap)', d: ov.error } : o ? { s: 'ok', t: 'Ponte (claude-zap)', d: `v${String(o.version).slice(0, 7)} · ${o.running.length} em execução · ${o.storage?.pendingJobs ?? 0} jobs na fila` } : { s: 'n', t: 'Ponte (claude-zap)', d: 'verificando…' });
    r.push(o ? { s: o.aiMemory?.status === 'ok' ? 'ok' : 'warn', t: 'Memória (ai-memory)', d: `${o.aiMemory?.status} · ${o.aiMemory?.restarts || 0} reinícios` } : { s: 'n', t: 'Memória (ai-memory)', d: '…' });
    const st = String(app.data?.status || '');
    r.push(app.error ? { s: 'err', t: 'Coolify / painel', d: app.error } : st ? { s: st.startsWith('running') ? (/unhealthy/.test(st) ? 'warn' : 'ok') : 'err', t: 'Coolify / painel', d: st } : { s: 'n', t: 'Coolify / painel', d: '…' });
    for (const p of prov.data?.providers || []) {
      const bad = !p.installed;
      r.push({ s: bad ? 'warn' : 'ok', t: 'Provedor · ' + p.name, d: bad ? 'não configurado' : `v${String(p.version || '').split(' ')[0]}${p.id === prov.data.defaultProvider ? ' · padrão' : ''}` });
    }
    const u = use.data;
    if (u) {
      r.push({ s: u.antigravity?.error ? (u.antigravity.stale ? 'warn' : 'err') : 'ok', t: 'Antigravity (cota)', d: u.antigravity?.error ? 'dado antigo: ' + u.antigravity.error : 'leitura em dia' });
      r.push({ s: u.claude?.error ? 'warn' : 'ok', t: 'Claude (limites)', d: u.claude?.error || 'leitura em dia' });
      const sp = u.spending;
      if (sp) r.push({ s: sp.limitReached ? 'err' : sp.monthlyLimitUsd && sp.monthForecastUsd > sp.monthlyLimitUsd ? 'warn' : 'ok', t: 'Orçamento do mês', d: `$${sp.monthSpendUsd.toFixed(2)} gasto · previsão $${sp.monthForecastUsd.toFixed(2)}${sp.monthlyLimitUsd ? ' · teto $' + sp.monthlyLimitUsd : ''}` });
    }
    const find = (id, name) => { const s = (sch.data || []).find((x) => x.id === id); if (!s) return null; const bad = s.lastStatus && !['ok', 'quiet'].includes(s.lastStatus); return { s: bad ? 'err' : s.paused ? 'warn' : 'ok', t: name, d: s.paused ? 'rotina pausada' : `última execução ${ago(s.lastRun)} (${s.lastStatus || '—'})` }; };
    for (const x of [find('b80f57', 'Drive · backup diário'), find('c772db', 'E-mail · AgentMail (webhook)'), find('41f73f', 'Watchdog diário')]) if (x) r.push(x);
    return r;
  }, [ov, app, prov, use, sch]);

  const worst = rows.some((x) => x.s === 'err') ? 'err' : rows.some((x) => x.s === 'warn') ? 'warn' : 'ok';
  return (
    <div className="page">
      <ErrorBox error={ov.error && 'Ponte: ' + ov.error} onRetry={() => ov.reload()} />
      <Card title="Estado do sistema" icon={Activity} actions={<span className={'st-pill ' + worst}>{worst === 'ok' ? 'Tudo certo' : worst === 'warn' ? 'Há avisos' : 'Há falhas'}</span>}>
        <div className="st-list">{rows.map((x, i) => <Light key={i} state={x.s} title={x.t} detail={x.d} />)}</div>
        <p className="muted small" style={{ marginTop: 12 }}>Atalho: <kbd>Ctrl/⌘</kbd> + <kbd>K</kbd> abre a busca e a paleta de comandos.</p>
      </Card>
    </div>
  );
}
