import { useEffect, useRef, useState } from 'react';
import { CalendarMinus, CalendarPlus, Circle, FileText, Plug, Search, Send, ShieldCheck, Terminal, Unplug } from 'lucide-react';
import { bridge, coolify } from '../api.js';
import { useT } from '../i18n.jsx';
import { Card, ErrorBox, useFmt, useLoad } from '../ui.jsx';

function ContainerLogs() {
  const t = useT();
  const [lines, setLines] = useState(300);
  const [auto, setAuto] = useState(true);
  const [filter, setFilter] = useState('');
  const logs = useLoad(() => coolify.logs(lines), [lines], { interval: auto ? 5000 : 0 });
  const ref = useRef(null);
  const text = String(logs.data?.logs ?? (typeof logs.data === 'string' ? logs.data : '') ?? '');
  const shown = filter ? text.split('\n').filter((l) => l.toLowerCase().includes(filter.toLowerCase())).join('\n') : text;
  useEffect(() => { if (auto && ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [shown, auto]);
  return (
    <Card title={t('logs.container')} icon={Terminal} actions={<>
      <label className="search"><Search size={14} /><input placeholder={t('common.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
      <select value={lines} onChange={(e) => setLines(Number(e.target.value))}>{[100, 300, 1000, 2000].map((n) => <option key={n} value={n}>{t('logs.lines', { n })}</option>)}</select>
      <label className="check"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />{t('logs.live')}</label>
    </>}>
      <ErrorBox error={logs.error} onRetry={() => logs.reload()} />
      <pre ref={ref} className="logs">{shown || (logs.loading ? t('common.loading') : t('common.empty'))}</pre>
    </Card>
  );
}

const ICONS = { send: Send, 'send-file': FileText, 'schedule-add': CalendarPlus, 'schedule-delete': CalendarMinus, 'mcp-add': Plug, 'mcp-remove': Unplug };

function Audit() {
  const t = useT();
  const f = useFmt();
  const a = useLoad(() => bridge.audit(300), [], { interval: 30000 });
  return (
    <Card title={t('logs.auditTitle')} icon={ShieldCheck}>
      <ErrorBox error={a.error} />
      {a.data && !a.data.length && <p className="muted">{t('logs.nothing')}</p>}
      {(a.data || []).map((e, i) => {
        const Icon = ICONS[e.action] || Circle;
        return (
          <div key={i} className="list-row">
            <div className="grow">
              <b className="with-ic"><Icon size={14} />{ICONS[e.action] ? t('logs.a.' + e.action) : (e.action || t('logs.a.event'))}</b>{e.ok === false && <span className="danger-text"> {t('logs.failed')}</span>}
              <div className="muted small ellipsis">{[e.to && t('logs.to', { n: e.to.split('@')[0] }), e.name, e.description, e.preview && '"' + e.preview + '"', e.file, e.id && '#' + e.id].filter(Boolean).join(' · ')}</div>
            </div>
            <small className="muted nowrap">{f.date(e.at)}</small>
          </div>
        );
      })}
    </Card>
  );
}

export default function Logs() {
  const t = useT();
  const [tab, setTab] = useState('container');
  return (
    <div className="page">
      <div className="seg big" role="tablist">
        <button role="tab" aria-selected={tab === 'container'} className={tab === 'container' ? 'on' : ''} onClick={() => setTab('container')}><Terminal size={15} />{t('logs.container')}</button>
        <button role="tab" aria-selected={tab === 'audit'} className={tab === 'audit' ? 'on' : ''} onClick={() => setTab('audit')}><ShieldCheck size={15} />{t('logs.audit')}</button>
      </div>
      {tab === 'container' ? <ContainerLogs /> : <Audit />}
    </div>
  );
}
