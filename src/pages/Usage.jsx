// Usage: plan limits right now, month spend (forecast, per bot, per routine, budget settings) and history.
// Each number appears once: limits as meters, spend in one card, today/7d in the history summary.
import { useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, Download, Gauge, Save, Sparkles, Wallet } from 'lucide-react';
import { bridge } from '../api.js';
import { useI18n, useT } from '../i18n.jsx';
import { Badge, Btn, Card, ErrorBox, Field, Skeleton, useAction, useFmt, useLoad } from '../ui.jsx';
import { ListGroup, useIsMobile } from '../native.jsx';

const band = (p) => (p < 60 ? 'ok' : p < 85 ? 'warn' : 'err');
const compact = (lang, n) => new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: n >= 1e6 ? 1 : 0 }).format(n || 0);
const level = (p) => (p >= 95 ? 'err' : p >= 80 ? 'warn' : 'ok');

function resetsIn(t, lang, iso) {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return t('use.resetNow');
  const mins = Math.max(1, Math.round(ms / 60000)), h = Math.floor(mins / 60), m = mins % 60;
  if (ms < 24 * 3600000) return t('use.resetsIn', { t: h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min` });
  return t('use.resetsAt', { t: new Date(iso).toLocaleString(lang, { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) });
}

function Meter({ label, percent, resetsAt, sub }) {
  const t = useT();
  const { lang } = useI18n();
  // A window whose reset time has passed: the stored percent belongs to the old window, so don't show it.
  const expired = Boolean(resetsAt) && new Date(resetsAt).getTime() <= Date.now();
  const p = expired ? 0 : Math.max(0, Math.min(100, percent ?? 0));
  const lv = level(p);
  return (
    <div className={'meter' + (expired ? ' meter-expired' : '')}>
      <div className="meter-h">
        <span className="meter-label">{label}</span>
        <b className="meter-val">{expired || percent == null ? '—' : (Math.round(p * 10) / 10).toLocaleString(lang) + '%'}</b>
      </div>
      <div className="meter-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={label}>
        {!expired && <span className={'meter-fill ' + lv} style={{ width: p + '%' }} />}
      </div>
      <div className="meter-foot muted small">
        <span>{expired ? t('use.expired') : resetsIn(t, lang, resetsAt)}</span>
        {!expired && lv !== 'ok' && <span className={'meter-flag ' + lv}><AlertTriangle size={12} />{t(lv === 'err' ? 'use.almostOut' : 'use.high')}</span>}
        {sub && <span className="ellipsis">{sub}</span>}
      </div>
    </div>
  );
}

// Status line under a provider: stale data warning (with error and last good reading) or plain error.
function LimitStatus({ v, as: Tag = 'p' }) {
  const t = useT();
  const { lang } = useI18n();
  if (!v) return null;
  const when = (iso) => new Date(iso).toLocaleString(lang, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  if (v.error && v.stale) {
    return (
      <Tag className="small meter-stale" role="status">
        <AlertTriangle size={13} />
        <span>{v.fetchedAt ? t('use.staleAt', { t: when(v.fetchedAt) }) : t('use.stale')}{' '}{t('use.errorWas', { e: v.error })}</span>
      </Tag>
    );
  }
  if (v.error) return <Tag className="small meter-err">{v.error}</Tag>;
  if (v.fetchedAt) return <Tag className="small muted">{t('use.updated', { t: when(v.fetchedAt) })}</Tag>;
  return null;
}

// Sunday-based weeks are confusing for "this week"; group by ISO week starting Monday.
function weekStart(date) {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function BarChart({ title, rows, color, render, empty, fmtMax }) {
  const { lang } = useI18n();
  const [hover, setHover] = useState(null);
  const rawMax = Math.max(0, ...rows.map((r) => r.value || 0));
  const max = rawMax > 0 ? rawMax : 1;
  const active = hover != null ? rows[hover] : rows[rows.length - 1];
  const allZero = rows.every((r) => !r.value);
  return (
    <div className="bars-card">
      <div className="bars-h">
        <span className="bars-title">{title}</span>
        <span className="bars-tip">{active && render(active)}</span>
      </div>
      {allZero && empty ? <p className="muted small bars-empty">{empty}</p> : (
        <div className="bars" onPointerLeave={() => setHover(null)}>
          <span className="bars-max muted">{fmtMax ? fmtMax(rawMax) : compact(lang, max)}</span>
          {rows.map((r, i) => (
            <button type="button" key={r.key} className={'bar-hit' + (hover === i ? ' on' : '')} aria-label={r.label + ': ' + (fmtMax ? fmtMax(r.value) : compact(lang, r.value))}
              onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} onFocus={() => setHover(i)}>
              <span className="bar" style={{ height: Math.max(r.value ? 3 : 0, (r.value / max) * 100) + '%', background: color }} />
              <span className="bar-x">{r.short}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Month spend in one place: progress vs. ceiling, where the money goes (bots, routines) and the budget form (collapsed).
function SpendingCard({ spending, routineForecasts, onSaved }) {
  const f = useFmt();
  const [monthlyLimitUsd, setMonthly] = useState(spending?.monthlyLimitUsd ?? 0);
  const [taskAlertUsd, setAlert] = useState(spending?.taskAlertUsd ?? 5);
  const [pauseRoutinesOnLimit, setPause] = useState(Boolean(spending?.pauseRoutinesOnLimit));
  const [busy, run] = useAction();
  const tasks = useLoad(() => bridge.tasks(), [], { interval: 60000 });
  const byBot = useMemo(() => {
    const m = new Map();
    for (const t of Array.isArray(tasks.data) ? tasks.data : []) {
      const k = t.botName || t.bot || '—';
      const x = m.get(k) || { name: k, cost: 0, n: 0 };
      x.cost += t.cost || 0; x.n += 1; m.set(k, x);
    }
    return [...m.values()].filter((b) => b.cost > 0).sort((a, b) => b.cost - a.cost).slice(0, 8);
  }, [tasks.data]);
  const lim = spending.monthlyLimitUsd || 0;
  const pct = (v) => (lim > 0 ? Math.min(100, (v / lim) * 100) : 0);
  const maxBot = Math.max(0.0001, ...byBot.map((b) => b.cost));
  const routines = (routineForecasts || []).filter((r) => r.projectedMonthlyUsd > 0);
  const save = async (e) => {
    e.preventDefault();
    const r = await run('sp', () => bridge.settings({ spending: { monthlyLimitUsd: Number(monthlyLimitUsd) || 0, taskAlertUsd: Number(taskAlertUsd) || 0, pauseRoutinesOnLimit } }), 'Orçamento atualizado');
    if (r) onSaved?.();
  };
  return (
    <Card title={`Gasto do mês (${spending.month})`} icon={Wallet} actions={
      <a className="btn ghost small" href={bridge.auditCsvUrl(1000)} download="agent-control-audit.csv"><Download size={14} /> CSV</a>
    }>
      <div className="stack">
        <div className="forecast">
          <div className="fc-nums">
            <span>Gasto <b>{f.usd(spending.monthSpendUsd || 0)}</b> <span className="muted small">· {spending.monthRuns || 0} execuções</span></span>
            <span>Previsão <b>{f.usd(spending.monthForecastUsd || 0)}</b></span>
            <span>{lim > 0 ? <>Teto <b>{f.usd(lim)}</b> <span className="muted small">({Math.round(pct(spending.monthSpendUsd))}%)</span></> : <span className="muted">Sem teto</span>}</span>
          </div>
          {lim > 0 && (
            <div className="fc-bar" aria-hidden style={{ marginTop: 8 }}>
              <span className="fc-fore" style={{ width: pct(spending.monthForecastUsd) + '%' }} />
              <span className={'fc-spent ' + band(pct(spending.monthSpendUsd))} style={{ width: pct(spending.monthSpendUsd) + '%' }} />
            </div>
          )}
        </div>
        {byBot.length > 0 && (
          <div className="stack use-sub">
            <b className="small muted">Por bot (tarefas recentes)</b>
            {byBot.map((b) => (
              <div key={b.name} className="botbar">
                <span className="ellipsis">{b.name}</span>
                <span className="botbar-track"><span style={{ width: (b.cost / maxBot) * 100 + '%' }} /></span>
                <b className="small">{f.usd(b.cost)}</b>
              </div>
            ))}
          </div>
        )}
        {routines.length > 0 && (
          <div className="stack use-sub">
            <b className="small muted">Projeção por rotina</b>
            {routines.map((r) => (
              <div key={r.id} className="list-row">
                <div className="grow"><b>{r.description}</b><div className="muted small">~{r.estMonthlyRuns} exec/mês · média {f.usd(r.avgCostUsd)}</div></div>
                <Badge>{f.usd(r.projectedMonthlyUsd)}/mês</Badge>
              </div>
            ))}
          </div>
        )}
        <details className="use-settings">
          <summary>Configurar teto e alertas</summary>
          <form className="stack" onSubmit={save}>
            <div className="form-grid">
              <Field label="Teto mensal (USD)" hint="0 = sem limite"><input type="number" step="0.5" min="0" value={monthlyLimitUsd} onChange={(e) => setMonthly(e.target.value)} /></Field>
              <Field label="Alerta por tarefa (USD)" hint="Avisa se uma tarefa passar deste valor"><input type="number" step="0.5" min="0" value={taskAlertUsd} onChange={(e) => setAlert(e.target.value)} /></Field>
            </div>
            <label className="check">
              <input type="checkbox" checked={pauseRoutinesOnLimit} onChange={(e) => setPause(e.target.checked)} />
              <span>Pausar rotinas automáticas não urgentes ao atingir o teto</span>
            </label>
            <div className="row end"><Btn icon={Save} className="small" disabled={busy === 'sp'}>Salvar</Btn></div>
          </form>
        </details>
      </div>
    </Card>
  );
}

function BudgetAlert({ sp }) {
  const f = useFmt();
  const lim = sp?.monthlyLimitUsd || 0;
  if (!sp || lim <= 0 || (sp.monthSpendUsd <= lim && sp.monthForecastUsd <= lim)) return null;
  const over = sp.monthSpendUsd > lim;
  return (
    <div className={'banner usage-alert ' + (over ? 'over' : 'warn')} role="alert">
      <AlertTriangle size={16} />
      <span>{over ? `Teto mensal estourado: ${f.usd(sp.monthSpendUsd)} de ${f.usd(lim)}.` : `A previsão do mês (${f.usd(sp.monthForecastUsd)}) passa do teto de ${f.usd(lim)}.`}</span>
    </div>
  );
}

export default function Usage() {
  const t = useT();
  const f = useFmt();
  const { lang } = useI18n();
  const u = useLoad(() => bridge.usage(), [], { interval: 60000, cacheKey: '/bridge/usage' });
  const [range, setRange] = useState('day');
  const [metric, setMetric] = useState('tokens');
  const mobile = useIsMobile();
  const d = u.data;

  const series = useMemo(() => {
    if (!d) return null;
    const fmtDay = (s, o) => new Date(s + 'T12:00:00').toLocaleDateString(lang, o);
    if (range === 'day') {
      const days = d.days.slice(-14);
      return days.map((x) => ({ key: x.date, label: fmtDay(x.date, { weekday: 'short', day: '2-digit', month: '2-digit' }), short: fmtDay(x.date, { day: 'numeric' }), c: x.claude, a: x.antigravity, cp: x.copilot || { tokens: 0, runs: 0 } }));
    }
    const weeks = new Map();
    for (const x of d.days) {
      const k = weekStart(x.date);
      const w = weeks.get(k) || { key: k, c: { tokens: 0, msgs: 0, runs: 0, cost: 0 }, a: { tokens: 0, runs: 0, cost: 0 }, cp: { tokens: 0, runs: 0 } };
      for (const f of ['tokens', 'msgs', 'runs', 'cost']) w.c[f] += x.claude[f] || 0;
      for (const f of ['tokens', 'runs', 'cost']) w.a[f] += x.antigravity[f] || 0;
      for (const f of ['tokens', 'runs']) w.cp[f] += (x.copilot && x.copilot[f]) || 0;
      weeks.set(k, w);
    }
    return [...weeks.values()].slice(-8).map((w) => ({ ...w, label: t('use.weekOf', { d: fmtDay(w.key, { day: '2-digit', month: '2-digit' }) }), short: fmtDay(w.key, { day: 'numeric', month: 'numeric' }) }));
  }, [d, range, lang, t]);

  const sum = (n, pick) => (d ? d.days.slice(-n).reduce((a, x) => a + pick(x), 0) : 0);
  const today = d?.days.at(-1);
  const tok = (n) => compact(lang, n) + ' tokens';
  const claudeLabel = { session: t('use.session'), weekly: t('use.weekly'), weekly_opus: t('use.weeklyOpus'), weekly_sonnet: t('use.weeklySonnet') };
  const fmtEstUsd = (v) => '~' + f.usd(v || 0);

  const segs = (
    <div className="row wrap">
      <div className="seg">
        <button type="button" className={metric === 'tokens' ? 'on' : ''} onClick={() => setMetric('tokens')}>{t('use.metricTokens')}</button>
        <button type="button" className={metric === 'cost' ? 'on' : ''} onClick={() => setMetric('cost')}>{t('use.metricCost')}</button>
      </div>
      <div className="seg">
        <button type="button" className={range === 'day' ? 'on' : ''} onClick={() => setRange('day')}>{t('use.days')}</button>
        <button type="button" className={range === 'week' ? 'on' : ''} onClick={() => setRange('week')}>{t('use.weeks')}</button>
      </div>
    </div>
  );

  // Today / last 7 days per provider in one compact table instead of six tiles.
  const summary = d && today && (
    <table className="use-sum small">
      <thead><tr><th /><th>{t('use.today')}</th><th>{t('use.last7')}</th></tr></thead>
      <tbody>
        {[
          ['Claude', (x) => x.claude.tokens, (x) => x.claude.msgs, 'use.msgs'],
          ['Antigravity', (x) => x.antigravity.tokens, (x) => x.antigravity.runs, 'use.runs'],
          ['Copilot', (x) => x.copilot?.tokens || 0, (x) => x.copilot?.runs || 0, 'use.runs'],
        ].map(([name, tk, n, key]) => (
          <tr key={name}>
            <th scope="row">{name}</th>
            <td><b>{compact(lang, tk(today))}</b> <span className="muted">· {t(key, { n: n(today) })}</span></td>
            <td><b>{compact(lang, sum(7, tk))}</b> <span className="muted">· {t(key, { n: sum(7, n) })}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const charts = series && (
    <div className="stack">
      <BarChart title="Claude" color="var(--chart-1)" rows={series.map((r) => ({ key: r.key, label: r.label, short: r.short, value: metric === 'cost' ? (r.c.cost || 0) : r.c.tokens, raw: r.c }))}
        fmtMax={metric === 'cost' ? (v) => f.usd(v) : undefined}
        render={(r) => <><b>{r.label}</b> · {metric === 'cost' ? f.usd(r.value) : tok(r.value)} · {t('use.msgs', { n: r.raw.msgs })}</>} />
      <BarChart title={metric === 'cost' ? 'Antigravity (' + t('use.estimated') + ')' : 'Antigravity'} color="var(--chart-2)" rows={series.map((r) => ({ key: r.key, label: r.label, short: r.short, value: metric === 'cost' ? (r.a.cost || 0) : r.a.tokens, raw: r.a }))}
        fmtMax={metric === 'cost' ? fmtEstUsd : undefined}
        render={(r) => <><b>{r.label}</b> · {metric === 'cost' ? fmtEstUsd(r.value) : tok(r.value)} · {t('use.runs', { n: r.raw.runs })}</>}
        empty={t('use.agyEmpty')} />
      {metric === 'tokens' && series.some((r) => r.cp.tokens) && (
        <BarChart title="GitHub Copilot" color="var(--chart-3, #6366f1)" rows={series.map((r) => ({ key: r.key, label: r.label, short: r.short, value: r.cp.tokens, raw: r.cp }))}
          render={(r) => <><b>{r.label}</b> · {tok(r.value)} · {t('use.runs', { n: r.raw.runs })}</>}
          empty="Sem chamadas do Copilot no período." />
      )}
    </div>
  );
  const note = d && <>{t('use.note')}{d.historySince?.antigravity ? ' ' + t('use.agySince', { d: new Date(d.historySince.antigravity).toLocaleDateString(lang) }) : ' ' + t('use.agyFromNow')}</>;

  const claudeMeters = d?.claude.limits?.map((l) => <Meter key={l.kind} label={claudeLabel[l.kind] || l.kind} percent={l.percent} resetsAt={l.resetsAt} />);
  const agyMeters = d?.antigravity.groups?.map((g) => (
    <Meter key={g.label + g.resetsAt} label={g.label} percent={g.percent} resetsAt={g.resetsAt} sub={t('use.models', { n: g.models.length })} />
  ));
  const spending = d?.spending && <SpendingCard spending={d.spending} routineForecasts={d.routineForecasts} onSaved={() => u.reload(true)} />;

  if (mobile) {
    return (
      <div className="page page-list">
        <ErrorBox error={u.error} onRetry={() => u.reload()} />
        <BudgetAlert sp={d?.spending} />
        <ListGroup title={<span className="with-ic">Claude {d?.claude.plan && <Badge>{d.claude.plan.toUpperCase()}</Badge>}</span>}
          footer={d && <LimitStatus v={d.claude} as="span" />}>
          {claudeMeters}
          {!d && !u.error && <Skeleton rows={2} avatar={false} className="pad-row" />}
        </ListGroup>
        <ListGroup title={<span className="with-ic">Antigravity {d?.antigravity.tier && <Badge>{d.antigravity.tier}</Badge>}</span>}
          footer={d && <LimitStatus v={d.antigravity} as="span" />}>
          {agyMeters}
          {!d && !u.error && <Skeleton rows={2} avatar={false} className="pad-row" />}
        </ListGroup>
        {spending}
        <ListGroup title={t('use.history')} footer={note}>
          <div className="group-form stack">{summary}{segs}{charts}</div>
        </ListGroup>
      </div>
    );
  }

  return (
    <div className="page">
      <ErrorBox error={u.error} onRetry={() => u.reload()} />
      <BudgetAlert sp={d?.spending} />
      <div className="grid2">
        <Card title="Claude" icon={Gauge} actions={d?.claude.plan && <Badge>{d.claude.plan.toUpperCase()}</Badge>}>
          {d && <LimitStatus v={d.claude} />}
          {claudeMeters}
          {!d && !u.error && <Skeleton rows={2} avatar={false} />}
        </Card>
        <Card title="Antigravity" icon={Sparkles} actions={d?.antigravity.tier && <Badge>{d.antigravity.tier}</Badge>}>
          {d && <LimitStatus v={d.antigravity} />}
          {agyMeters}
          {!d && !u.error && <Skeleton rows={2} avatar={false} />}
        </Card>
      </div>
      {spending}
      <Card title={t('use.history')} icon={BarChart3} actions={segs}>
        <div className="stack">
          {summary}
          {charts}
          {d && <p className="muted small">{note}</p>}
        </div>
      </Card>
    </div>
  );
}
