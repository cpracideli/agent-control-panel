// Usage: plan limits right now (Claude session/week, Antigravity quota pools) and token history per day/week.
import { useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, Download, Gauge, Save, Sparkles, Wallet } from 'lucide-react';
import { bridge } from '../api.js';
import { useI18n, useT } from '../i18n.jsx';
import { Badge, Btn, Card, ErrorBox, Field, Skeleton, useAction, useFmt, useLoad } from '../ui.jsx';
import { ListGroup, Row, useIsMobile } from '../native.jsx';

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

function SpendingCard({ spending, routineForecasts, onSaved }) {
  const f = useFmt();
  const [monthlyLimitUsd, setMonthly] = useState(spending?.monthlyLimitUsd ?? 0);
  const [taskAlertUsd, setAlert] = useState(spending?.taskAlertUsd ?? 5);
  const [pauseRoutinesOnLimit, setPause] = useState(Boolean(spending?.pauseRoutinesOnLimit));
  const [busy, run] = useAction();
  const pct = spending?.monthlyLimitUsd > 0 ? Math.min(100, Math.round((spending.monthSpendUsd / spending.monthlyLimitUsd) * 100)) : 0;
  const save = async (e) => {
    e.preventDefault();
    const r = await run('sp', () => bridge.settings({ spending: { monthlyLimitUsd: Number(monthlyLimitUsd) || 0, taskAlertUsd: Number(taskAlertUsd) || 0, pauseRoutinesOnLimit } }), 'Orçamento atualizado');
    if (r) onSaved?.();
  };
  return (
    <Card title="Orçamento mensal & Auditoria" icon={Wallet} actions={
      <a className="btn ghost small" href={bridge.auditCsvUrl(1000)} download="agent-control-audit.csv">
        <Download size={14} /> Exportar Auditoria CSV
      </a>
    }>
      <div className="stack">
        <div className="stats">
          <div className="stat"><small>Gasto no mês ({spending?.month})</small><b>{f.usd(spending?.monthSpendUsd || 0)}</b><small>{spending?.monthRuns || 0} execuções</small></div>
          <div className="stat"><small>Projeção do mês</small><b>{f.usd(spending?.monthForecastUsd || 0)}</b><small>{spending?.monthlyLimitUsd > 0 ? `Teto: ${f.usd(spending.monthlyLimitUsd)} (${pct}%)` : 'Sem teto definido'}</small></div>
        </div>
        {spending?.limitReached && (
          <div className="banner warn" style={{ borderRadius: 10 }}>
            <AlertTriangle size={15} /><span>Teto mensal atingido ({f.usd(spending.monthSpendUsd)} / {f.usd(spending.monthlyLimitUsd)}).</span>
          </div>
        )}
        <form className="stack" onSubmit={save}>
          <div className="form-grid">
            <Field label="Teto mensal (USD)" hint="0 = sem limite"><input type="number" step="0.5" min="0" value={monthlyLimitUsd} onChange={(e) => setMonthly(e.target.value)} /></Field>
            <Field label="Alerta por tarefa (USD)" hint="Avisa se uma tarefa passar deste valor"><input type="number" step="0.5" min="0" value={taskAlertUsd} onChange={(e) => setAlert(e.target.value)} /></Field>
          </div>
          <label className="check">
            <input type="checkbox" checked={pauseRoutinesOnLimit} onChange={(e) => setPause(e.target.checked)} />
            <span>Pausar rotinas automáticas não urgentes ao atingir o teto mensal</span>
          </label>
          <div className="row end"><Btn icon={Save} className="small" disabled={busy === 'sp'}>Salvar orçamento</Btn></div>
        </form>
        {routineForecasts?.some((r) => r.projectedMonthlyUsd > 0) && (
          <div className="stack">
            <b className="small muted">Projeção mensal por rotina</b>
            {routineForecasts.filter((r) => r.projectedMonthlyUsd > 0).map((r) => (
              <div key={r.id} className="list-row">
                <div className="grow"><b>#{r.id} · {r.description}</b><div className="muted small">~{r.estMonthlyRuns} exec/mês · média {f.usd(r.avgCostUsd)}</div></div>
                <Badge>{f.usd(r.projectedMonthlyUsd)}/mês</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
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
      return days.map((x) => ({ key: x.date, label: fmtDay(x.date, { weekday: 'short', day: '2-digit', month: '2-digit' }), short: fmtDay(x.date, { day: 'numeric' }), c: x.claude, a: x.antigravity }));
    }
    const weeks = new Map();
    for (const x of d.days) {
      const k = weekStart(x.date);
      const w = weeks.get(k) || { key: k, c: { tokens: 0, msgs: 0, runs: 0, cost: 0 }, a: { tokens: 0, runs: 0, cost: 0 } };
      for (const f of ['tokens', 'msgs', 'runs', 'cost']) w.c[f] += x.claude[f] || 0;
      for (const f of ['tokens', 'runs', 'cost']) w.a[f] += x.antigravity[f] || 0;
      weeks.set(k, w);
    }
    return [...weeks.values()].slice(-8).map((w) => ({ ...w, label: t('use.weekOf', { d: fmtDay(w.key, { day: '2-digit', month: '2-digit' }) }), short: fmtDay(w.key, { day: 'numeric', month: 'numeric' }) }));
  }, [d, range, lang, t]);

  const sum = (n, pick) => (d ? d.days.slice(-n).reduce((a, x) => a + pick(x), 0) : 0);
  const today = d?.days.at(-1);
  const tok = (n) => compact(lang, n) + ' tokens';
  const claudeLabel = { session: t('use.session'), weekly: t('use.weekly'), weekly_opus: t('use.weeklyOpus'), weekly_sonnet: t('use.weeklySonnet') };

  const segs = (
    <div className="dash-seg">
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
  const fmtEstUsd = (v) => '~' + f.usd(v || 0);
  const charts = series && (
    <div className="stack">
      <BarChart title="Claude" color="var(--chart-1)" rows={series.map((r) => ({ key: r.key, label: r.label, short: r.short, value: metric === 'cost' ? (r.c.cost || 0) : r.c.tokens, raw: r.c }))}
        fmtMax={metric === 'cost' ? (v) => f.usd(v) : undefined}
        render={(r) => <><b>{r.label}</b> · {metric === 'cost' ? f.usd(r.value) : tok(r.value)} · {t('use.msgs', { n: r.raw.msgs })}</>} />
      <BarChart title={metric === 'cost' ? 'Antigravity (' + t('use.estimated') + ')' : 'Antigravity'} color="var(--chart-2)" rows={series.map((r) => ({ key: r.key, label: r.label, short: r.short, value: metric === 'cost' ? (r.a.cost || 0) : r.a.tokens, raw: r.a }))}
        fmtMax={metric === 'cost' ? fmtEstUsd : undefined}
        render={(r) => <><b>{r.label}</b> · {metric === 'cost' ? fmtEstUsd(r.value) : tok(r.value)} · {t('use.runs', { n: r.raw.runs })}</>}
        empty={t('use.agyEmpty')} />
    </div>
  );
  const note = d && <>{t('use.note')}{d.historySince?.antigravity ? ' ' + t('use.agySince', { d: new Date(d.historySince.antigravity).toLocaleDateString(lang) }) : ' ' + t('use.agyFromNow')}</>;

  if (mobile) {
    return (
      <div className="page page-list">
        <ErrorBox error={u.error} onRetry={() => u.reload()} />
        <ListGroup title={<span className="with-ic">Claude {d?.claude.plan && <Badge>{d.claude.plan.toUpperCase()}</Badge>}</span>}
          footer={d && <LimitStatus v={d.claude} as="span" />}>
          {d?.claude.limits?.map((l) => <Meter key={l.kind} label={claudeLabel[l.kind] || l.kind} percent={l.percent} resetsAt={l.resetsAt} />)}
          {!d && !u.error && <Skeleton rows={2} avatar={false} className="pad-row" />}
        </ListGroup>
        <ListGroup title={<span className="with-ic">Antigravity {d?.antigravity.tier && <Badge>{d.antigravity.tier}</Badge>}</span>}
          footer={d && <LimitStatus v={d.antigravity} as="span" />}>
          {d?.antigravity.groups?.map((g) => (
            <Meter key={g.label + g.resetsAt} label={g.label} percent={g.percent} resetsAt={g.resetsAt} sub={t('use.models', { n: g.models.length })} />
          ))}
          {!d && !u.error && <Skeleton rows={2} avatar={false} className="pad-row" />}
        </ListGroup>
        {d && (
          <ListGroup title={t('use.tokens')}>
            <Row icon={Gauge} tint="ic-overview" label={'Claude · ' + t('use.today')} sub={t('use.msgs', { n: today.claude.msgs })} value={<b>{tok(today.claude.tokens)}</b>} />
            <Row icon={Gauge} tint="ic-overview" label={'Claude · ' + t('use.last7')} sub={t('use.msgs', { n: sum(7, (x) => x.claude.msgs) })} value={<b>{tok(sum(7, (x) => x.claude.tokens))}</b>} />
            <Row icon={Sparkles} tint="ic-memory" label={'Antigravity · ' + t('use.today')} sub={t('use.runs', { n: today.antigravity.runs })} value={<b>{tok(today.antigravity.tokens)}</b>} />
            <Row icon={Sparkles} tint="ic-memory" label={'Antigravity · ' + t('use.last7')} sub={t('use.runs', { n: sum(7, (x) => x.antigravity.runs) })} value={<b>{tok(sum(7, (x) => x.antigravity.tokens))}</b>} />
          </ListGroup>
        )}
        <ListGroup title={t('use.history')} footer={note}>
          <div className="group-form stack">{segs}{charts}</div>
        </ListGroup>
        {d?.spending && <SpendingCard spending={d.spending} routineForecasts={d.routineForecasts} onSaved={() => u.reload(true)} />}
      </div>
    );
  }

  return (
    <div className="page">
      <ErrorBox error={u.error} onRetry={() => u.reload()} />

      <div className="grid2">
        <Card title="Claude" icon={Gauge} actions={d?.claude.plan && <Badge>{d.claude.plan.toUpperCase()}</Badge>}>
          {d && <LimitStatus v={d.claude} />}
          {d?.claude.limits?.map((l) => <Meter key={l.kind} label={claudeLabel[l.kind] || l.kind} percent={l.percent} resetsAt={l.resetsAt} />)}
          {!d && !u.error && <p className="muted">…</p>}
        </Card>
        <Card title="Antigravity" icon={Sparkles} actions={d?.antigravity.tier && <Badge>{d.antigravity.tier}</Badge>}>
          {d && <LimitStatus v={d.antigravity} />}
          {d?.antigravity.groups?.map((g) => (
            <Meter key={g.label + g.resetsAt} label={g.label} percent={g.percent} resetsAt={g.resetsAt} sub={t('use.models', { n: g.models.length })} />
          ))}
          {!d && !u.error && <p className="muted">…</p>}
        </Card>
      </div>

      {d && (
        <div className="stats">
          <div className="stat"><small>Claude · {t('use.today')}</small><b>{tok(today.claude.tokens)}</b><small>{t('use.msgs', { n: today.claude.msgs })}</small></div>
          <div className="stat"><small>Claude · {t('use.last7')}</small><b>{tok(sum(7, (x) => x.claude.tokens))}</b><small>{t('use.msgs', { n: sum(7, (x) => x.claude.msgs) })}</small></div>
          <div className="stat"><small>Antigravity · {t('use.today')}</small><b>{tok(today.antigravity.tokens)}</b><small>{t('use.runs', { n: today.antigravity.runs })}</small></div>
          <div className="stat"><small>Antigravity · {t('use.last7')}</small><b>{tok(sum(7, (x) => x.antigravity.tokens))}</b><small>{t('use.runs', { n: sum(7, (x) => x.antigravity.runs) })}</small></div>
        </div>
      )}

      <Card title={t('use.history')} icon={BarChart3} actions={<div className="row wrap">
        <div className="seg">
          <button type="button" className={metric === 'tokens' ? 'on' : ''} onClick={() => setMetric('tokens')}>{t('use.metricTokens')}</button>
          <button type="button" className={metric === 'cost' ? 'on' : ''} onClick={() => setMetric('cost')}>{t('use.metricCost')}</button>
        </div>
        <div className="seg">
          <button type="button" className={range === 'day' ? 'on' : ''} onClick={() => setRange('day')}>{t('use.days')}</button>
          <button type="button" className={range === 'week' ? 'on' : ''} onClick={() => setRange('week')}>{t('use.weeks')}</button>
        </div>
      </div>}>
        {series && (
          <div className="stack">
            <BarChart title="Claude" color="var(--chart-1)" rows={series.map((r) => ({ key: r.key, label: r.label, short: r.short, value: metric === 'cost' ? (r.c.cost || 0) : r.c.tokens, raw: r.c }))}
              fmtMax={metric === 'cost' ? (v) => f.usd(v) : undefined}
              render={(r) => <><b>{r.label}</b> · {metric === 'cost' ? f.usd(r.value) : tok(r.value)} · {t('use.msgs', { n: r.raw.msgs })}</>} />
            <BarChart title={metric === 'cost' ? 'Antigravity (' + t('use.estimated') + ')' : 'Antigravity'} color="var(--chart-2)" rows={series.map((r) => ({ key: r.key, label: r.label, short: r.short, value: metric === 'cost' ? (r.a.cost || 0) : r.a.tokens, raw: r.a }))}
              fmtMax={metric === 'cost' ? fmtEstUsd : undefined}
              render={(r) => <><b>{r.label}</b> · {metric === 'cost' ? fmtEstUsd(r.value) : tok(r.value)} · {t('use.runs', { n: r.raw.runs })}</>}
              empty={t('use.agyEmpty')} />
            <p className="muted small">{t('use.note')}{d.historySince?.antigravity ? ' ' + t('use.agySince', { d: new Date(d.historySince.antigravity).toLocaleDateString(lang) }) : ' ' + t('use.agyFromNow')}</p>
          </div>
        )}
      </Card>
      {d?.spending && <SpendingCard spending={d.spending} routineForecasts={d.routineForecasts} onSaved={() => u.reload(true)} />}
    </div>
  );
}
