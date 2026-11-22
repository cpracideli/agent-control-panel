// Usage: plan limits right now, month spend (forecast, per bot, per routine, budget settings) and history.
// Each number appears once: limits as meters, spend in one card, today/7d in the history summary.
import { useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, Download, Gauge, Save, Sparkles, Wallet } from 'lucide-react';
import { bridge } from '../api.js';
import { useI18n, useT } from '../i18n.jsx';
import { ProvIcon, provIconFor } from '../ProvIcon.jsx';
import { PROVIDER_NAMES } from '../prov.js';
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
        {!expired && <span className={'meter-fill ' + lv} style={{ transform: `scaleX(${Math.min(100, Math.max(1, p)) / 100})` }} />}
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
  const available = rows.filter((r) => r.value != null);
  const rawMax = Math.max(0, ...available.map((r) => r.value));
  const max = rawMax > 0 ? rawMax : 1;
  const active = hover != null ? rows[hover] : rows[rows.length - 1];
  return (
    <div className="bars-card">
      <div className="bars-h">
        <span className="bars-title">{title}</span>
        <span className="bars-tip">{active && (active.value == null ? <>{active.label} · —</> : render(active))}</span>
      </div>
      {!available.length && empty ? <p className="muted small bars-empty">{empty}</p> : (
        <div className="bars" onPointerLeave={() => setHover(null)}>
          <span className="bars-max muted">{fmtMax ? fmtMax(rawMax) : compact(lang, max)}</span>
          {rows.map((r, i) => (
            <button type="button" key={r.key} className={'bar-hit' + (hover === i ? ' on' : '')} aria-label={r.label + ': ' + (r.value == null ? 'sem métrica' : fmtMax ? fmtMax(r.value) : compact(lang, r.value))}
              onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} onFocus={() => setHover(i)}>
              <span className="bar" style={{ transform: `scaleY(${r.value == null ? 0 : Math.max(r.value ? 3 : 0, (r.value / max) * 100) / 100})`, background: color }} />
              <span className="bar-x">{r.short}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const providerAliases = { 'github-copilot': 'copilot' };
const providerKey = (id) => providerAliases[String(id || '').trim().toLowerCase()] || String(id || '').trim().toLowerCase();
const metricFields = ['tokens', 'runs', 'cost'];
const CLAUDE_KIND_KEYS = { session: 'use.session', weekly: 'use.weekly', weekly_opus: 'use.weeklyOpus', weekly_sonnet: 'use.weeklySonnet' };
const PROVIDER_CHART_COLORS = {
  claude: 'var(--chart-1)',
  antigravity: 'var(--chart-2)',
  copilot: 'var(--chart-3)',
  opencode: 'var(--chart-4)',
};
const CopilotIcon = provIconFor('copilot');
const OpencodeIcon = provIconFor('opencode');
const fmtDec = (lang, n) => new Intl.NumberFormat(lang, { maximumFractionDigits: n >= 100 ? 0 : 2 }).format(n || 0);

function providerEntries(collection) {
  if (Array.isArray(collection)) {
    return collection.flatMap((item) => {
      const id = item?.id || item?.providerId || item?.provider;
      return id ? [[id, item]] : [];
    });
  }
  return collection && typeof collection === 'object' ? Object.entries(collection) : [];
}

function providerRecord(collection, id) {
  const key = providerKey(id);
  const match = providerEntries(collection).find(([entryId]) => providerKey(entryId) === key);
  return match?.[1] || null;
}

function usageMetrics(record) {
  const source = record?.metrics && typeof record.metrics === 'object' ? record.metrics : record;
  if (!source || typeof source !== 'object') return {};
  const telemetry = record?.telemetry || source?.telemetry;
  const result = {};
  const numeric = (value) => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value));
  for (const field of metricFields) {
    if (field === 'cost' && telemetry?.cost === false) continue;
    const value = source[field];
    if (numeric(value)) result[field] = Number(value);
  }
  if (result.runs == null && numeric(source.msgs)) result.msgs = Number(source.msgs);
  else if (numeric(source.msgs)) result.msgs = Number(source.msgs);
  if (numeric(source.cacheRead)) result.cacheRead = Number(source.cacheRead);
  if (numeric(source.totalTokens)) result.totalTokens = Number(source.totalTokens);
  if (numeric(source.credits) && (Number(source.credits) > 0 || telemetry?.credits === true)) result.credits = Number(source.credits);
  return result;
}

function metricValue(metrics, field) {
  if (field === 'runs' && metrics.runs == null && metrics.msgs != null) return metrics.msgs;
  return metrics[field] ?? null;
}

const hasUsageHistory = (m) => ['tokens', 'runs', 'cost', 'msgs', 'credits', 'cacheRead'].some((k) => Number(m?.[k]) > 0) || Number(metricValue(m, 'runs')) > 0;

function providerUsageRows(data, metadata) {
  const metaMap = new Map();
  for (const provider of Array.isArray(metadata) ? metadata : []) {
    if (!provider?.id) continue;
    const key = providerKey(provider.id);
    metaMap.set(key, {
      id: provider.id,
      name: provider.name || PROVIDER_NAMES[key] || provider.id,
      installed: provider.installed !== false,
    });
  }

  const candidates = new Map();
  for (const [key, meta] of metaMap) candidates.set(key, { id: meta.id, record: null });
  const addIds = (collection) => {
    for (const [id, record] of providerEntries(collection)) {
      const key = providerKey(id);
      if (!candidates.has(key)) candidates.set(key, { id, record });
    }
  };
  addIds(data?.providers);
  for (const day of Array.isArray(data?.days) ? data.days : []) {
    addIds(day?.providers);
    for (const id of ['claude', 'antigravity', 'copilot', 'opencode']) {
      if (day?.[id]) addIds({ [id]: day[id] });
    }
  }

  const rows = [];
  for (const [key, cand] of candidates) {
    const meta = metaMap.get(key);
    const rawTotal = providerRecord(data?.providers, cand.id);
    const total = usageMetrics(rawTotal);
    const days = (Array.isArray(data?.days) ? data.days : []).map((day) => {
      const generic = providerRecord(day?.providers, cand.id);
      return usageMetrics(Object.keys(usageMetrics(generic)).length ? generic : day?.[key]);
    });
    const dayRecords = (Array.isArray(data?.days) ? data.days : []).map((day) => providerRecord(day?.providers, cand.id));
    const telemetryAvailable = rawTotal?.telemetry?.available === true || dayRecords.some((record) => record?.telemetry?.available === true);
    const hasHistory = hasUsageHistory(total) || days.some(hasUsageHistory);
    const hasActivity = telemetryAvailable || hasHistory;
    const telemetryUnavailable = rawTotal?.telemetry?.available === false || dayRecords.some((record) => record?.telemetry?.available === false);
    if (!hasActivity && (meta?.installed === false || telemetryUnavailable)) continue;
    const name = meta?.name || rawTotal?.name || rawTotal?.displayName || cand.record?.name || cand.record?.displayName || PROVIDER_NAMES[key] || cand.id;
    const costSupported = rawTotal?.telemetry?.cost !== false && key !== 'copilot';
    rows.push({ id: cand.id, key, name, costSupported, total, days });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

function ProviderSummary({ providers, lang, f, t }) {
  if (!providers.length) return <p className="muted small">Nenhum provider configurado ou com métricas registradas.</p>;
  return (
    <div className="usage-provider-grid">
      {providers.map((provider) => {
        const key = providerKey(provider.id);
        const hasMetrics = metricFields.some((field) => provider.total[field] != null) || provider.total.msgs != null || provider.total.credits != null;
        const hasHistory = provider.days.some((day) => metricFields.some((field) => day[field] != null) || day.msgs != null || day.credits != null);
        const estimatedCost = key === 'antigravity';
        const showCredits = provider.total.cost == null && (provider.total.credits != null || key === 'copilot');
        const runsVal = metricValue(provider.total, 'runs');
        return (
          <section className="usage-provider" key={key}>
            <div className="usage-provider-head">
              <ProvIcon id={key} size={15} />
              <h4 title={provider.id}>{provider.name}</h4>
            </div>
            {hasMetrics ? (
              <div className="usage-provider-metrics">
                <div>
                  <span className="muted small">Tokens</span>
                  <b>{provider.total.tokens == null ? '—' : compact(lang, provider.total.tokens)}</b>
                  {provider.total.cacheRead > 0 && <span className="muted usage-provider-sub">{t('use.cacheHint', { n: compact(lang, provider.total.cacheRead) })}</span>}
                </div>
                <div>
                  <span className="muted small">{provider.total.msgs != null && provider.total.runs == null ? 'Respostas' : 'Execuções'}</span>
                  <b>{runsVal == null ? '—' : compact(lang, runsVal)}</b>
                  {provider.total.runs != null && provider.total.msgs > 0 && provider.total.msgs !== provider.total.runs && (
                    <span className="muted usage-provider-sub">{t('use.msgs', { n: compact(lang, provider.total.msgs) })}</span>
                  )}
                </div>
                <div>
                  <span className="muted small">{showCredits ? t('use.credits') : (estimatedCost ? 'Custo estimado' : 'Custo')}</span>
                  <b>
                    {showCredits
                      ? (provider.total.credits == null ? '—' : fmtDec(lang, provider.total.credits))
                      : (provider.total.cost == null ? '—' : `${estimatedCost ? '~' : ''}${f.usd(provider.total.cost)}`)}
                  </b>
                </div>
              </div>
            ) : <p className="muted small usage-provider-empty">{hasHistory ? 'Sem totais agregados; consulte o histórico abaixo.' : 'Sem métricas disponíveis.'}</p>}
          </section>
        );
      })}
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
              <span className="fc-fore" style={{ transform: `scaleX(${pct(spending.monthForecastUsd) / 100})` }} />
              <span className={'fc-spent ' + band(pct(spending.monthSpendUsd))} style={{ transform: `scaleX(${pct(spending.monthSpendUsd) / 100})` }} />
            </div>
          )}
        </div>
        {byBot.length > 0 && (
          <div className="stack use-sub">
            <b className="small muted">Por bot (tarefas recentes)</b>
            {byBot.map((b) => (
              <div key={b.name} className="botbar">
                <span className="ellipsis">{b.name}</span>
                <span className="botbar-track"><span style={{ transform: `scaleX(${maxBot ? b.cost / maxBot : 0})` }} /></span>
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

function CopilotBody({ cp, lang, t }) {
  const quotas = Array.isArray(cp.quotas) ? cp.quotas : [];
  const m = cp.month || {};
  const hasMonth = (m.tokens || 0) > 0 || (m.credits || 0) > 0 || (m.requests || 0) > 0;
  return (
    <>
      {quotas.map((q) => (q.unlimited ? (
        <div className="meter" key={q.id || q.label}>
          <div className="meter-h">
            <span className="meter-label">{q.label}</span>
            <Badge kind="ok">{t('use.unlimited')}</Badge>
          </div>
        </div>
      ) : (
        <Meter
          key={q.id || q.label}
          label={q.label}
          percent={q.percent}
          resetsAt={q.resetsAt || cp.resetsAt}
          sub={q.entitlement > 0 ? `${q.used ?? 0}/${q.entitlement} ${t('use.creditsShort')}` : undefined}
        />
      )))}
      {hasMonth && (
        <div className="usage-card-meta">
          <div className="usage-inline-metrics">
            <div>
              <span className="muted small">{t('use.monthSummary')}</span>
              <b>{compact(lang, m.tokens)} tok</b>
              {m.cacheRead > 0 && <span className="muted usage-provider-sub">{t('use.cacheHint', { n: compact(lang, m.cacheRead) })}</span>}
            </div>
            <div>
              <span className="muted small">{t('use.credits')}</span>
              <b>{fmtDec(lang, m.credits)}</b>
            </div>
            <div>
              <span className="muted small">{lang?.startsWith('en') ? 'Requests' : 'Pedidos'}</span>
              <b>{fmtDec(lang, m.requests)}</b>
            </div>
          </div>
          {Array.isArray(m.models) && m.models.length > 0 && (
            <div className="usage-models">{m.models.join(', ')}</div>
          )}
        </div>
      )}
    </>
  );
}

function OpencodeBody({ oc, lang, f, t }) {
  const m = oc.month || {};
  const when = (iso) => new Date(iso).toLocaleString(lang, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const hasActivity = (m.tokens || 0) > 0 || (m.messages || 0) > 0 || (m.cacheRead || 0) > 0;
  return (
    <>
      {oc.error ? (
        <p className="small meter-stale" role="status">
          <AlertTriangle size={13} />
          <span>{oc.error}{oc.limitHitAt ? ` (${when(oc.limitHitAt)})` : ''}</span>
        </p>
      ) : (
        <>
          <LimitStatus v={oc} />
          <p className="small muted" style={{ margin: 0 }}>{t('use.ocFreeMode')}</p>
        </>
      )}
      {hasActivity ? (
        <div className="usage-card-meta">
          <div className="usage-inline-metrics">
            <div>
              <span className="muted small">Tokens</span>
              <b>{compact(lang, m.tokens)}</b>
              {m.cacheRead > 0 && <span className="muted usage-provider-sub">{t('use.cacheHint', { n: compact(lang, m.cacheRead) })}</span>}
            </div>
            <div>
              <span className="muted small">{lang?.startsWith('en') ? 'Replies' : 'Respostas'}</span>
              <b>{compact(lang, m.messages)}</b>
              {m.sessions > 0 && <span className="muted usage-provider-sub">{t('use.sessions', { n: compact(lang, m.sessions) })}</span>}
            </div>
            <div>
              <span className="muted small">{lang?.startsWith('en') ? 'Cost' : 'Custo'}</span>
              <b>{m.costUsd > 0 ? f.usd(m.costUsd) : t('use.freeLabel')}</b>
            </div>
          </div>
          {Array.isArray(m.models) && m.models.length > 0 && (
            <div className="usage-models">{m.models.join(', ')}</div>
          )}
        </div>
      ) : (
        <p className="muted small" style={{ marginTop: 8 }}>{t('use.ocNoActivity')}</p>
      )}
    </>
  );
}

export default function Usage() {
  const t = useT();
  const f = useFmt();
  const { lang } = useI18n();
  const u = useLoad(() => bridge.usage(), [], { interval: 60000, cacheKey: '/bridge/usage' });
  const providerState = useLoad(() => bridge.providers(), [], { interval: 60000, cacheKey: '/bridge/providers' });
  const [range, setRange] = useState('day');
  const [metric, setMetric] = useState('tokens');
  const mobile = useIsMobile();
  const d = u.data;
  const providers = useMemo(() => providerUsageRows(d, providerState.data?.providers), [d, providerState.data]);

  const series = useMemo(() => {
    if (!d) return null;
    const days = Array.isArray(d.days) ? d.days : [];
    const fmtDay = (s, o) => new Date(s + 'T12:00:00').toLocaleDateString(lang, o);
    if (range === 'day') {
      return days.slice(-14).map((day) => ({
        key: day.date,
        label: fmtDay(day.date, { weekday: 'short', day: '2-digit', month: '2-digit' }),
        short: fmtDay(day.date, { day: 'numeric' }),
        day,
      }));
    }
    const weeks = new Map();
    for (const day of days) {
      const key = weekStart(day.date);
      const week = weeks.get(key) || { key, days: [] };
      week.days.push(day);
      weeks.set(key, week);
    }
    const weekFields = ['tokens', 'runs', 'cost', 'msgs', 'cacheRead', 'credits'];
    return [...weeks.values()].slice(-8).map((week) => ({
      ...week,
      label: t('use.weekOf', { d: fmtDay(week.key, { day: '2-digit', month: '2-digit' }) }),
      short: fmtDay(week.key, { day: 'numeric', month: 'numeric' }),
      values: Object.fromEntries(providers.map((provider) => {
        const daily = week.days.map((day) => {
          const generic = providerRecord(day.providers, provider.id);
          const legacy = day[providerKey(provider.id)];
          return usageMetrics(Object.keys(usageMetrics(generic)).length ? generic : legacy);
        });
        const fields = {};
        for (const field of weekFields) {
          const values = daily.map((entry) => (field === 'runs' ? metricValue(entry, 'runs') : entry[field] ?? null));
          fields[field] = values.some((value) => value != null)
            ? values.reduce((sum, value) => sum + (value || 0), 0)
            : null;
        }
        return [providerKey(provider.id), fields];
      })),
    }));
  }, [d, range, lang, t, providers]);

  const tok = (n) => compact(lang, n) + ' tokens';
  const historyNote = d && <>{t('use.note')}{d.historySince?.antigravity ? ' ' + t('use.agySince', { d: new Date(d.historySince.antigravity).toLocaleDateString(lang) }) : ' ' + t('use.agyFromNow')}</>;

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

  const charts = series && providers.length > 0 && (
    <div className="stack">
      {providers.map((provider, index) => {
        const key = providerKey(provider.id);
        const estimatedCost = metric === 'cost' && key === 'antigravity';
        const rows = series.map((entry) => {
          let raw;
          if (range === 'day') {
            const generic = providerRecord(entry.day?.providers, provider.id);
            raw = usageMetrics(Object.keys(usageMetrics(generic)).length ? generic : entry.day?.[key]);
          } else raw = entry.values[key] || {};
          return { key: entry.key, label: entry.label, short: entry.short, value: metricValue(raw, metric), raw };
        });
        const color = PROVIDER_CHART_COLORS[key] || `var(--chart-${(index % 6) + 1}, var(--accent))`;
        const countLabel = (record) => record.msgs != null && record.runs == null ? t('use.msgs', { n: record.msgs }) : t('use.runs', { n: record.runs ?? 0 });
        const noUsdCost = metric === 'cost' && !provider.costSupported && rows.every((r) => r.value == null);
        return (
          <BarChart key={key} title={provider.name + (estimatedCost ? ' (' + t('use.estimated') + ')' : '')} color={color} rows={rows}
            fmtMax={metric === 'cost' ? (value) => `${estimatedCost ? '~' : ''}${f.usd(value)}` : undefined}
            render={(row) => (
              <>
                <b>{row.label}</b> · {metric === 'cost' ? `${estimatedCost ? '~' : ''}${f.usd(row.value)}` : tok(row.value)}
                {metric === 'tokens' && row.raw.cacheRead > 0 ? <> ({t('use.cacheHint', { n: compact(lang, row.raw.cacheRead) })})</> : null}
                {row.raw.runs != null || row.raw.msgs != null ? <> · {countLabel(row.raw)}</> : null}
                {row.raw.credits > 0 ? <> · {fmtDec(lang, row.raw.credits)} {t('use.creditsShort')}</> : null}
              </>
            )}
            empty={noUsdCost ? t('use.copilotNoCost') : 'Sem métricas disponíveis para este provider no período.'} />
        );
      })}
    </div>
  );

  const claudeMeters = d?.claude?.limits?.map((l) => (
    <Meter key={l.kind} label={CLAUDE_KIND_KEYS[l.kind] ? t(CLAUDE_KIND_KEYS[l.kind]) : l.kind} percent={l.percent} resetsAt={l.resetsAt} />
  ));
  const agyMeters = d?.antigravity?.groups?.map((g) => (
    <Meter key={g.label + g.resetsAt} label={g.label} percent={g.percent} resetsAt={g.resetsAt} sub={t('use.models', { n: g.models.length })} />
  ));
  const showCopilot = Boolean(d?.copilot && (d.copilot.installed !== false || d.copilot.quotas?.length || d.copilot.month?.tokens > 0 || d.copilot.month?.credits > 0));
  const showOpencode = Boolean(d?.opencode && (d.opencode.installed !== false || d.opencode.month?.tokens > 0 || d.opencode.month?.messages > 0 || d.opencode.rateLimited));
  const cpBadge = d?.copilot?.planLabel || d?.copilot?.plan;
  const ocBadge = d?.opencode?.rateLimited ? t('use.ocLimitTitle') : (d?.opencode?.planLabel || t('use.freeLabel'));
  const spending = d?.spending && <SpendingCard spending={d.spending} routineForecasts={d.routineForecasts} onSaved={() => u.reload(true)} />;

  if (mobile) {
    return (
      <div className="page page-list">
        <ErrorBox error={u.error} onRetry={() => u.reload()} />
        <BudgetAlert sp={d?.spending} />
        <ListGroup title={<span className="with-ic">Claude {d?.claude?.plan && <Badge>{d.claude.plan.toUpperCase()}</Badge>}</span>}
          footer={d?.claude && <LimitStatus v={d.claude} as="span" />}>
          {claudeMeters}
          {!d && !u.error && <Skeleton rows={2} avatar={false} className="pad-row" />}
        </ListGroup>
        <ListGroup title={<span className="with-ic">Antigravity {d?.antigravity?.tier && <Badge>{d.antigravity.tier}</Badge>}</span>}
          footer={d?.antigravity && <LimitStatus v={d.antigravity} as="span" />}>
          {agyMeters}
          {!d && !u.error && <Skeleton rows={2} avatar={false} className="pad-row" />}
        </ListGroup>
        {showCopilot && (
          <ListGroup title={<span className="with-ic"><ProvIcon id="copilot" size={14} /> GitHub Copilot {cpBadge && <Badge>{cpBadge}</Badge>}</span>}
            footer={<LimitStatus v={d.copilot} as="span" />}>
            <div className="group-form">
              <CopilotBody cp={d.copilot} lang={lang} t={t} />
            </div>
          </ListGroup>
        )}
        {showOpencode && (
          <ListGroup title={<span className="with-ic"><ProvIcon id="opencode" size={14} /> OpenCode <Badge kind={d.opencode.rateLimited ? 'warn' : 'muted'}>{ocBadge}</Badge></span>}>
            <div className="group-form">
              <OpencodeBody oc={d.opencode} lang={lang} f={f} t={t} />
            </div>
          </ListGroup>
        )}
        {spending}
        <ListGroup title={t('use.history')} footer={historyNote}>
          <div className="group-form stack">
            {providerState.error && <p className="muted small">Não foi possível carregar os nomes dos providers; identificadores de uso ainda podem aparecer.</p>}
            {d && <ProviderSummary providers={providers} lang={lang} f={f} t={t} />}
            {segs}
            {charts}
            {d && <p className="muted small">{historyNote}</p>}
            {!d && !u.error && <Skeleton rows={3} avatar={false} className="pad-row" />}
          </div>
        </ListGroup>
      </div>
    );
  }

  return (
    <div className="page">
      <ErrorBox error={u.error} onRetry={() => u.reload()} />
      <BudgetAlert sp={d?.spending} />
      <div className="grid2">
        <Card title="Claude" icon={Gauge} actions={d?.claude?.plan && <Badge>{d.claude.plan.toUpperCase()}</Badge>}>
          {d?.claude && <LimitStatus v={d.claude} />}
          {claudeMeters}
          {!d && !u.error && <Skeleton rows={2} avatar={false} />}
        </Card>
        <Card title="Antigravity" icon={Sparkles} actions={d?.antigravity?.tier && <Badge>{d.antigravity.tier}</Badge>}>
          {d?.antigravity && <LimitStatus v={d.antigravity} />}
          {agyMeters}
          {!d && !u.error && <Skeleton rows={2} avatar={false} />}
        </Card>
      </div>
      {(showCopilot || showOpencode) && (
        <div className={showCopilot && showOpencode ? 'grid2' : ''}>
          {showCopilot && (
            <Card title="GitHub Copilot" icon={CopilotIcon} actions={cpBadge && <Badge>{cpBadge}</Badge>}>
              <LimitStatus v={d.copilot} />
              <CopilotBody cp={d.copilot} lang={lang} t={t} />
            </Card>
          )}
          {showOpencode && (
            <Card title="OpenCode" icon={OpencodeIcon} actions={<Badge kind={d.opencode.rateLimited ? 'warn' : 'muted'}>{ocBadge}</Badge>}>
              <OpencodeBody oc={d.opencode} lang={lang} f={f} t={t} />
            </Card>
          )}
        </div>
      )}
      {spending}
      <Card title={t('use.history')} icon={BarChart3} actions={segs}>
        <div className="stack">
          {providerState.error && <p className="muted small">Não foi possível carregar os nomes dos providers; identificadores de uso ainda podem aparecer.</p>}
          {d && <ProviderSummary providers={providers} lang={lang} f={f} t={t} />}
          {charts}
          {d && <p className="muted small">{historyNote}</p>}
          {!d && !u.error && <Skeleton rows={3} avatar={false} />}
        </div>
      </Card>
    </div>
  );
}
