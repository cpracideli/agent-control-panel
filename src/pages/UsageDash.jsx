// Visual layer for Usage: ring gauges (Claude 5h/week, Antigravity groups), monthly forecast and per-bot spend.
import { useMemo } from 'react';
import { AlertTriangle, TrendingUp } from 'lucide-react';
import { bridge } from '../api.js';
import { Card, useFmt, useLoad } from '../ui.jsx';

const band = (p) => (p < 60 ? 'ok' : p < 85 ? 'warn' : 'err');

export function Ring({ label, percent, sub, size = 112 }) {
  const has = percent != null && !Number.isNaN(percent);
  const p = has ? Math.max(0, Math.min(100, percent)) : 0;
  const r = (size - 14) / 2, c = 2 * Math.PI * r;
  return (
    <div className="ring" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)} aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-bg" />
        {has && <circle cx={size / 2} cy={size / 2} r={r} className={'ring-fg ' + band(p)} strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="ring-txt">{has ? Math.round(p) + '%' : '—'}</text>
      </svg>
      <b className="ring-label">{label}</b>
      {sub && <span className="muted small ring-sub">{sub}</span>}
    </div>
  );
}

const live = (l) => !(l.resetsAt && new Date(l.resetsAt).getTime() <= Date.now());

export default function UsageDash({ d }) {
  const f = useFmt();
  const tasks = useLoad(() => bridge.tasks(), [], { interval: 60000 });
  const claudeName = { session: 'Sessão 5 h', weekly: 'Semana', weekly_opus: 'Semana Opus', weekly_sonnet: 'Semana Sonnet' };
  const byBot = useMemo(() => {
    const m = new Map();
    for (const t of Array.isArray(tasks.data) ? tasks.data : []) {
      const k = t.botName || t.bot || '—';
      const x = m.get(k) || { name: k, cost: 0, n: 0 };
      x.cost += t.cost || 0; x.n += 1; m.set(k, x);
    }
    return [...m.values()].sort((a, b) => b.cost - a.cost).slice(0, 8);
  }, [tasks.data]);
  if (!d) return null;
  const sp = d.spending;
  const lim = sp?.monthlyLimitUsd || 0;
  const maxBot = Math.max(0.0001, ...byBot.map((b) => b.cost));
  const days = (d.days || []).slice(-14);
  const maxDay = Math.max(0.0001, ...days.map((x) => (x.claude.cost || 0) + (x.antigravity.cost || 0)));
  return (
    <div className="stack usage-dash">
      {sp && lim > 0 && (sp.monthSpendUsd > lim || sp.monthForecastUsd > lim) && (
        <div className={'banner usage-alert ' + (sp.monthSpendUsd > lim ? 'over' : 'warn')} role="alert">
          <AlertTriangle size={16} />
          <span>{sp.monthSpendUsd > lim ? `Teto mensal estourado: ${f.usd(sp.monthSpendUsd)} de ${f.usd(lim)}.` : `A projeção do mês (${f.usd(sp.monthForecastUsd)}) passa do teto de ${f.usd(lim)}.`}</span>
        </div>
      )}
      <div className="grid2">
        <Card title="Claude" icon={TrendingUp}>
          <div className="rings">
            {(d.claude.limits || []).map((l) => <Ring key={l.kind} label={claudeName[l.kind] || l.kind} percent={live(l) ? l.percent : null} />)}
            {!(d.claude.limits || []).length && <p className="muted small">Sem leitura de limites.</p>}
          </div>
        </Card>
        <Card title="Antigravity" icon={TrendingUp}>
          <div className="rings">
            {(d.antigravity.groups || []).map((g) => <Ring key={g.label} label={g.label} percent={live(g) ? g.percent : null} sub={d.antigravity.stale ? 'dado antigo' : undefined} />)}
            {!(d.antigravity.groups || []).length && <p className="muted small">Sem leitura de grupos.</p>}
          </div>
        </Card>
      </div>
      {sp && (
        <Card title="Mês e previsão" icon={TrendingUp}>
          <div className="forecast">
            <div className="fc-bar" aria-hidden>
              <span className="fc-fore" style={{ width: lim > 0 ? Math.min(100, (sp.monthForecastUsd / lim) * 100) + '%' : '100%' }} />
              <span className={'fc-spent ' + (lim > 0 ? band((sp.monthSpendUsd / lim) * 100) : 'ok')} style={{ width: lim > 0 ? Math.min(100, (sp.monthSpendUsd / lim) * 100) + '%' : '40%' }} />
            </div>
            <div className="fc-nums small">
              <span>Gasto <b>{f.usd(sp.monthSpendUsd)}</b></span>
              <span>Previsão <b>{f.usd(sp.monthForecastUsd)}</b></span>
              <span>{lim > 0 ? <>Teto <b>{f.usd(lim)}</b></> : 'Sem teto'}</span>
            </div>
          </div>
          <div className="daybars" aria-label="Custo por dia">
            {days.map((x) => { const v = (x.claude.cost || 0) + (x.antigravity.cost || 0); return <span key={x.date} className="daybar" title={x.date + ' · ' + f.usd(v)} style={{ height: Math.max(v ? 4 : 1, (v / maxDay) * 100) + '%' }} />; })}
          </div>
        </Card>
      )}
      <Card title="Custo por bot (tarefas recentes)" icon={TrendingUp}>
        {byBot.length === 0 ? <p className="muted small">Sem tarefas registradas.</p> : byBot.map((b) => (
          <div key={b.name} className="botbar">
            <span className="ellipsis">{b.name}</span>
            <span className="botbar-track"><span style={{ width: (b.cost / maxBot) * 100 + '%' }} /></span>
            <b className="small">{f.usd(b.cost)}</b>
          </div>
        ))}
      </Card>
    </div>
  );
}
