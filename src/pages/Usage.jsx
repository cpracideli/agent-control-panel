// Usage: plan limits right now (Claude session/week, Antigravity quota pools) and token history per day/week.
import { useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, Gauge, Sparkles } from 'lucide-react';
import { bridge } from '../api.js';
import { useI18n, useT } from '../i18n.jsx';
import { Badge, Card, ErrorBox, useFmt, useLoad } from '../ui.jsx';

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
  const p = Math.max(0, Math.min(100, percent ?? 0));
  const lv = level(p);
  return (
    <div className="meter">
      <div className="meter-h">
        <span className="meter-label">{label}</span>
        <b className="meter-val">{percent == null ? '—' : (Math.round(p * 10) / 10).toLocaleString(lang) + '%'}</b>
      </div>
      <div className="meter-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={label}>
        <span className={'meter-fill ' + lv} style={{ width: p + '%' }} />
      </div>
      <div className="meter-foot muted small">
        <span>{resetsIn(t, lang, resetsAt)}</span>
        {lv !== 'ok' && <span className={'meter-flag ' + lv}><AlertTriangle size={12} />{t(lv === 'err' ? 'use.almostOut' : 'use.high')}</span>}
        {sub && <span className="ellipsis">{sub}</span>}
      </div>
    </div>
  );
}

// Sunday-based weeks are confusing for "this week"; group by ISO week starting Monday.
function weekStart(date) {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function BarChart({ title, rows, color, render, empty }) {
  const { lang } = useI18n();
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...rows.map((r) => r.value));
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
          <span className="bars-max muted">{compact(lang, max)}</span>
          {rows.map((r, i) => (
            <button type="button" key={r.key} className={'bar-hit' + (hover === i ? ' on' : '')} aria-label={r.label + ': ' + compact(lang, r.value)}
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

export default function Usage() {
  const t = useT();
  const f = useFmt();
  const { lang } = useI18n();
  const u = useLoad(() => bridge.usage(), [], { interval: 60000 });
  const [range, setRange] = useState('day');
  const [metric, setMetric] = useState('tokens');
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
      const w = weeks.get(k) || { key: k, c: { tokens: 0, msgs: 0, runs: 0, cost: 0 }, a: { tokens: 0, runs: 0 } };
      for (const f of ['tokens', 'msgs', 'runs', 'cost']) w.c[f] += x.claude[f] || 0;
      for (const f of ['tokens', 'runs']) w.a[f] += x.antigravity[f] || 0;
      weeks.set(k, w);
    }
    return [...weeks.values()].slice(-8).map((w) => ({ ...w, label: t('use.weekOf', { d: fmtDay(w.key, { day: '2-digit', month: '2-digit' }) }), short: fmtDay(w.key, { day: 'numeric', month: 'numeric' }) }));
  }, [d, range, lang, t]);

  const sum = (n, pick) => (d ? d.days.slice(-n).reduce((a, x) => a + pick(x), 0) : 0);
  const today = d?.days.at(-1);
  const tok = (n) => compact(lang, n) + ' tokens';
  const claudeLabel = { session: t('use.session'), weekly: t('use.weekly'), weekly_opus: t('use.weeklyOpus'), weekly_sonnet: t('use.weeklySonnet') };

  return (
    <div className="page">
      <ErrorBox error={u.error} onRetry={() => u.reload()} />

      <div className="grid2">
        <Card title="Claude" icon={Gauge} actions={d?.claude.plan && <Badge>{d.claude.plan.toUpperCase()}</Badge>}>
          {d?.claude.error && <p className={'small ' + (d.claude.stale ? 'muted' : 'meter-err')}>{d.claude.stale ? t('use.stale') : ''}{d.claude.error}</p>}
          {d?.claude.limits?.map((l) => <Meter key={l.kind} label={claudeLabel[l.kind] || l.kind} percent={l.percent} resetsAt={l.resetsAt} />)}
          {!d && !u.error && <p className="muted">…</p>}
        </Card>
        <Card title="Antigravity" icon={Sparkles} actions={d?.antigravity.tier && <Badge>{d.antigravity.tier}</Badge>}>
          {d?.antigravity.error && <p className={'small ' + (d.antigravity.stale ? 'muted' : 'meter-err')}>{d.antigravity.stale ? t('use.stale') : ''}{d.antigravity.error}</p>}
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
              render={(r) => <><b>{r.label}</b> · {metric === 'cost' ? f.usd(r.value) : tok(r.value)} · {t('use.msgs', { n: r.raw.msgs })}</>} />
            <BarChart title="Antigravity" color="var(--chart-2)" rows={series.map((r) => ({ key: r.key, label: r.label, short: r.short, value: r.a.tokens, raw: r.a }))}
              render={(r) => <><b>{r.label}</b> · {tok(r.value)} · {t('use.runs', { n: r.raw.runs })}</>}
              empty={t('use.agyEmpty')} />
            <p className="muted small">{t('use.note')}{d.historySince?.antigravity ? ' ' + t('use.agySince', { d: new Date(d.historySince.antigravity).toLocaleDateString(lang) }) : ' ' + t('use.agyFromNow')}</p>
          </div>
        )}
      </Card>
    </div>
  );
}
