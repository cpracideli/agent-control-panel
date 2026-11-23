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
    const aiStatus = o?.aiMemory?.status;
    const aiOptional = aiStatus === 'não instalado' || aiStatus === 'off';
    r.push(o ? { s: aiStatus === 'ok' ? 'ok' : aiOptional ? 'n' : 'warn', t: 'Memória (ai-memory)', d: aiOptional ? 'opcional · ' + aiStatus : `${aiStatus} · ${o.aiMemory?.restarts || 0} reinícios` } : { s: 'n', t: 'Memória (ai-memory)', d: '…' });
    if (o?.disk?.usedPct != null) {
      r.push({ s: o.disk.usedPct >= 90 ? 'err' : o.disk.usedPct >= 80 ? 'warn' : 'ok', t: 'Disco', d: `${o.disk.usedPct}% usado · ${o.disk.freeGb} GB livres` });
    }
    const st = String(app.data?.status || '');
    const coolifyMissing = app.error && /não configurad/i.test(app.error);
    r.push(coolifyMissing ? { s: 'n', t: 'Coolify', d: 'opcional · não configurado' } : app.error ? { s: 'err', t: 'Coolify / painel', d: app.error } : st ? { s: st.startsWith('running') ? (/unhealthy/.test(st) ? 'warn' : 'ok') : 'err', t: 'Coolify / painel', d: st } : { s: 'n', t: 'Coolify / painel', d: '…' });
    for (const p of prov.data?.providers || []) {
      const bad = !p.installed;
      r.push({ s: bad ? 'warn' : 'ok', t: 'Provedor · ' + p.name, d: bad ? 'não configurado' : `v${String(p.version || '').split(' ')[0]}${p.id === prov.data.defaultProvider ? ' · padrão' : ''}` });
    }
    const agyInstalled = Boolean(prov.data?.providers?.find((p) => p.id === 'antigravity')?.installed);
    const u = use.data;
    if (u) {
      if (agyInstalled || (u.antigravity && !u.antigravity.error)) {
        r.push({ s: u.antigravity?.error ? (u.antigravity.stale ? 'warn' : 'err') : 'ok', t: 'Antigravity (cota)', d: u.antigravity?.error ? 'dado antigo: ' + u.antigravity.error : 'leitura em dia' });
      }
      r.push({ s: u.claude?.error ? 'warn' : 'ok', t: 'Claude (limites)', d: u.claude?.error || 'leitura em dia' });
      if (u.copilot) {
        const qs = Array.isArray(u.copilot.quotas) ? u.copilot.quotas : [];
        const maxQ = Math.max(0, ...qs.filter((q) => !q.unlimited && q.percent != null).map((q) => q.percent));
        const cpState = u.copilot.error ? (u.copilot.stale ? 'warn' : 'err') : maxQ >= 85 ? 'warn' : 'ok';
        const cpDetail = u.copilot.error
          ? (u.copilot.stale ? 'dado antigo: ' : '') + u.copilot.error
          : [u.copilot.planLabel || u.copilot.plan, ...qs.map((q) => `${q.label} ${q.unlimited ? '∞' : q.percent + '%'}`)].filter(Boolean).join(' · ') || 'leitura em dia';
        r.push({ s: cpState, t: 'GitHub Copilot (cota)', d: cpDetail });
      }
      if (u.opencode) {
        const ocState = u.opencode.rateLimited ? 'warn' : u.opencode.error ? 'err' : 'ok';
        const ocDetail = u.opencode.error || [u.opencode.planLabel || 'Gratuito', u.opencode.month?.messages ? `${u.opencode.month.messages} resp. no mês` : ''].filter(Boolean).join(' · ');
        r.push({ s: ocState, t: 'OpenCode', d: ocDetail });
      }
      const sp = u.spending;
      if (sp) r.push({ s: sp.limitReached ? 'err' : sp.monthlyLimitUsd && sp.monthForecastUsd > sp.monthlyLimitUsd ? 'warn' : 'ok', t: 'Orçamento do mês', d: `$${sp.monthSpendUsd.toFixed(2)} gasto · previsão $${sp.monthForecastUsd.toFixed(2)}${sp.monthlyLimitUsd ? ' · teto $' + sp.monthlyLimitUsd : ''}` });
    }
    const allScheds = Array.isArray(sch.data) ? sch.data : [];
    const scoreSched = (s) => {
      const bad = s.lastStatus && !['ok', 'quiet'].includes(s.lastStatus);
      const key = /backup|watchdog|briefing|email|mail/i.test(String(s.description || '')) || s.webhook;
      return (bad ? 100 : 0) + (key ? 20 : 0) + (!s.paused ? 10 : 0) + (s.lastRun ? 5 : 0);
    };
    const topScheds = [...allScheds].sort((a, b) => scoreSched(b) - scoreSched(a)).slice(0, 6);
    for (const s of topScheds) {
      const bad = s.lastStatus && !['ok', 'quiet'].includes(s.lastStatus);
      r.push({ s: bad ? 'err' : s.paused ? 'warn' : 'ok', t: s.description || s.id, d: s.paused ? 'rotina pausada' : `última execução ${ago(s.lastRun)} (${s.lastStatus || '—'})` });
    }
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
