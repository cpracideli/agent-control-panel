import { useEffect, useState } from 'react';
import { BarChart3, Bot, Brain, CalendarClock, CheckSquare, ChevronRight, Download, FileCode2, FolderArchive, Gauge, KeyRound, Languages, LayoutGrid, LogOut, MessageSquare, Monitor, Moon, Plug, RefreshCw, ScrollText, Sparkles, Sun, UserRound, Wand2, WifiOff } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { api, bridge, setUnauthorizedHandler } from './api.js';
import { LANGS, store, useI18n } from './i18n.jsx';
import { IconButton, Sheet, useTheme } from './ui.jsx';
import Login from './pages/Login.jsx';
import Chat from './pages/Chat.jsx';
import Bots from './pages/Bots.jsx';
import Computer from './pages/Computer.jsx';
import Skills from './pages/Skills.jsx';
import Board from './pages/Board.jsx';
import Artifacts from './pages/Artifacts.jsx';
import Dashboards from './pages/Dashboards.jsx';
import Overview from './pages/Overview.jsx';
import Usage from './pages/Usage.jsx';
import Memory from './pages/Memory.jsx';
import Providers from './pages/Providers.jsx';
import Mcp from './pages/Mcp.jsx';
import Schedules from './pages/Schedules.jsx';
import Envs from './pages/Envs.jsx';
import Logs from './pages/Logs.jsx';

const PAGES = [
  { id: 'chat', icon: MessageSquare, el: Chat },
  { id: 'bots', icon: Bot, el: Bots },
  { id: 'computer', icon: Monitor, el: Computer },
  { id: 'skills', icon: Wand2, el: Skills },
  { id: 'board', icon: CheckSquare, el: Board },
  { id: 'dashboards', icon: FileCode2, el: Dashboards },
  { id: 'schedules', icon: CalendarClock, el: Schedules },
  { id: 'artifacts', icon: FolderArchive, el: Artifacts },
  { id: 'memory', icon: Brain, el: Memory },
  { id: 'usage', icon: BarChart3, el: Usage },
  { id: 'overview', icon: Gauge, el: Overview },
  { id: 'providers', icon: Sparkles, el: Providers },
  { id: 'mcp', icon: Plug, el: Mcp },
  { id: 'envs', icon: KeyRound, el: Envs },
  { id: 'logs', icon: ScrollText, el: Logs },
];

const pageFromHash = () => {
  const h = window.location.hash.replace('#/', '').split('/')[0];
  return PAGES.some((p) => p.id === h) ? h : 'chat';
};

const THEMES = [{ id: 'system', icon: Monitor }, { id: 'light', icon: Sun }, { id: 'dark', icon: Moon }];

function ThemeSwitch({ compact, glass, labels }) {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  if (compact) {
    const i = THEMES.findIndex((x) => x.id === theme);
    const next = THEMES[(i + 1) % THEMES.length];
    const Icon = THEMES[i].icon;
    return <IconButton icon={Icon} className={glass ? 'glass-btn press' : 'ghost'} label={t('theme.label') + ': ' + t('theme.' + theme)} onClick={() => setTheme(next.id)} />;
  }
  return (
    <div className={'seg' + (labels ? ' seg-ios' : '')} role="radiogroup" aria-label={t('theme.label')}>
      {THEMES.map(({ id, icon: Icon }) => (
        <button key={id} type="button" role="radio" aria-checked={theme === id} className={theme === id ? 'on' : ''} title={t('theme.' + id)} onClick={() => setTheme(id)}>
          <Icon size={15} />
        </button>
      ))}
    </div>
  );
}

function LangSelect({ compact, glass, bare }) {
  const { lang, setLang, t } = useI18n();
  return (
    <label className={'lang' + (compact ? ' compact' : '') + (glass ? ' glass-btn' : '')} title={t('lang.label')}>
      {!bare && <Languages size={15} />}
      <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t('lang.label')}>
        {LANGS.map((l) => <option key={l.id} value={l.id}>{compact ? l.id.slice(0, 2).toUpperCase() : l.label}</option>)}
      </select>
    </label>
  );
}

// "Install app" button: shown when the browser offers it (Chrome/Edge/Android). iOS installs from the share menu.
function useInstall() {
  const [evt, setEvt] = useState(null);
  useEffect(() => {
    const on = (e) => { e.preventDefault(); setEvt(e); };
    window.addEventListener('beforeinstallprompt', on);
    window.addEventListener('appinstalled', () => setEvt(null));
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, []);
  return evt ? async () => { evt.prompt(); await evt.userChoice; setEvt(null); } : null;
}

function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOn(true), down = () => setOn(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return on;
}

// Back from Google: the server put a one-time code (or an error) in the query string.
function takeAuthParams() {
  const q = new URLSearchParams(window.location.search);
  const code = q.get('auth_code');
  const error = q.get('auth_error');
  if (code || error) window.history.replaceState(null, '', window.location.pathname + (window.location.hash || '#/chat'));
  return { code, error };
}

const DOCK = ['chat', 'bots', 'usage', 'overview'];
const MORE = PAGES.filter((p) => !DOCK.includes(p.id));

function Avatar({ me, size = 34 }) {
  const pic = me?.picture;
  const letter = (me?.name || me?.email || '?').trim()[0]?.toUpperCase();
  return (
    <span className="avatar-ring" style={{ width: size, height: size }}>
      {pic ? <img src={pic} alt="" referrerPolicy="no-referrer" /> : me?.email ? <span className="avatar-letter">{letter}</span> : <UserRound size={size * 0.55} />}
    </span>
  );
}

function MoreSheet({ me, page, go, install, logout, onClose }) {
  const { t } = useI18n();
  return (
    <Sheet title={t('nav.more')} onClose={onClose}>
      <div className="group-label">{t('nav.pages')}</div>
      <div className="group">
        {MORE.map(({ id, icon: Icon }) => (
          <button key={id} className={'group-row press' + (id === page ? ' on' : '')} onClick={() => { go(id); onClose(); }}>
            <span className={'row-ic ic-' + id}><Icon size={17} /></span>
            <span className="grow">{t('nav.' + id)}</span>
            <ChevronRight size={17} className="chev" />
          </button>
        ))}
      </div>
      <div className="group-label">{t('nav.appearance')}</div>
      <div className="group">
        <div className="group-row"><span className="row-ic ic-theme"><Moon size={17} /></span><span className="grow">{t('theme.label')}</span><ThemeSwitch labels /></div>
        <div className="group-row"><span className="row-ic ic-lang"><Languages size={17} /></span><span className="grow">{t('lang.label')}</span><LangSelect bare /></div>
      </div>
      <div className="group-label">{t('nav.account')}</div>
      <div className="group">
        <div className="group-row">
          <Avatar me={me} size={36} />
          <span className="grow"><b className="ellipsis">{me?.name || me?.email || t('nav.signedPwd')}</b>{me?.name && <small className="muted ellipsis">{me.email}</small>}</span>
        </div>
        {install && <button className="group-row press" onClick={install}><span className="row-ic ic-install"><Download size={17} /></span><span className="grow">{t('pwa.install')}</span></button>}
        <button className="group-row press danger-text" onClick={logout}><span className="row-ic ic-logout"><LogOut size={17} /></span><span className="grow">{t('nav.logout')}</span></button>
      </div>
    </Sheet>
  );
}

export default function App() {
  const { t } = useI18n();
  const [authed, setAuthed] = useState(null);
  const [me, setMe] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [page, setPage] = useState(pageFromHash);
  const [more, setMore] = useState(false);
  const [navStatus, setNavStatus] = useState({ running: 0, unread: 0, pendingPrompts: 0, computerNeedsHuman: false, computerRunning: false, openTickets: 0, offline: false });
  const install = useInstall();
  const online = useOnline();
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();

  useEffect(() => {
    if (!authed) return undefined;
    let stop = false;
    const poll = () => {
      if (document.hidden || stop) return;
      bridge.overview()
        .then((o) => !stop && setNavStatus({
          running: o.running?.length || 0, unread: o.unread || 0, pendingPrompts: o.pendingPrompts || 0,
          computerNeedsHuman: Boolean(o.computer?.needsHuman), computerRunning: o.computer?.status === 'running',
          openTickets: o.openTickets || 0, offline: false,
        }))
        .catch(() => !stop && setNavStatus((s) => ({ ...s, offline: true })));
    };
    poll();
    const id = setInterval(poll, 30000);
    return () => { stop = true; clearInterval(id); };
  }, [authed]);

  useEffect(() => {
    setUnauthorizedHandler(() => setAuthed(false));
    const { code, error } = takeAuthParams();
    if (error) setAuthError(error);
    (async () => {
      if (code) {
        try {
          const r = await api('POST', '/auth/exchange', { code });
          store.set('acp_profile', JSON.stringify({ name: r.name, picture: r.picture, email: r.email }));
        } catch (e) { setAuthError(e.message); }
      }
      try {
        const r = await api('GET', '/me');
        let prof = {};
        try { prof = JSON.parse(store.get('acp_profile') || '{}'); } catch {}
        setMe({ ...r, ...(prof.email === r.email ? prof : {}) });
        setAuthed(r.ok);
      } catch { setMe({ google: false, password: true }); setAuthed(false); }
    })();
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const banners = (
    <>
      {!online && <div className="banner warn"><WifiOff size={15} />{t('pwa.offline')}</div>}
      {needRefresh && <div className="banner"><RefreshCw size={15} />{t('pwa.update')}<button className="small" onClick={() => updateServiceWorker(true)}>{t('pwa.reload')}</button></div>}
    </>
  );

  if (authed === null) return <div className="boot"><img src="/pwa-192.png" alt="" width="56" height="56" className="app-icon" /></div>;
  if (!authed) {
    return (
      <>{banners}<Login config={me || {}} initialError={authError} onLogin={() => { setAuthed(true); setMe((m) => ({ ...m, ok: true })); }}
        extras={<><LangSelect compact glass /><ThemeSwitch compact glass /></>} /></>
    );
  }

  const Page = PAGES.find((p) => p.id === page).el;
  // Replace instead of push: in the installed app an edge swipe is "back", and the history would fight the drawer gesture.
  const go = (id) => { window.history.replaceState(null, '', '#/' + id); setPage(id); };
  const logout = async () => { await api('POST', '/logout').catch(() => {}); store.set('acp_profile', ''); setMore(false); setAuthed(false); };
  const dockIndex = DOCK.includes(page) ? DOCK.indexOf(page) : 4;

  return (
    <div className={'shell' + (page === 'chat' ? ' on-chat' : '')}>
      <aside className="nav">
        <div className="brand"><img src="/pwa-192.png" alt="" width="26" height="26" className="app-icon sm" />Agent Control</div>
        <nav>
          {PAGES.map(({ id, icon: Icon }) => (
            <button key={id} className={'nav-item' + (id === page ? ' active' : '')} onClick={() => go(id)} aria-current={id === page ? 'page' : undefined}>
              <span className={'row-ic ic-' + id}><Icon size={15} /></span>
              <span className="grow">{t('nav.' + id)}</span>
              {id === 'chat' && (navStatus.pendingPrompts > 0
                ? <span className="nav-dot err" aria-label={t('prp.pending')} />
                : (navStatus.running > 0 || navStatus.unread > 0) && <span className="nav-dot warn" aria-label={t('common.running')} />)}
              {id === 'computer' && (navStatus.computerNeedsHuman
                ? <span className="nav-dot err" aria-label={t('comp.needsYou')} />
                : navStatus.computerRunning && <span className="nav-dot ok" aria-label={t('comp.running')} />)}
              {id === 'overview' && navStatus.offline && <span className="nav-dot err" aria-label={t('ov.offline')} />}
            </button>
          ))}
        </nav>
        <div className="nav-foot">
          {install && <button className="nav-item" onClick={install}><Download size={17} />{t('pwa.install')}</button>}
          <div className="row between"><ThemeSwitch /><LangSelect compact /></div>
          <div className="nav-user">
            <Avatar me={me} size={30} />
            <span className="grow ellipsis small">{me?.email || t('nav.signedPwd')}</span>
            <IconButton icon={LogOut} className="ghost bare" label={t('nav.logout')} onClick={logout} />
          </div>
        </div>
      </aside>

      <main className={'main' + (page === 'chat' ? ' main-chat' : '')}>
        <header className="topbar">
          <h1 className="large-title serif-title grow ellipsis">{t('nav.' + page)}</h1>
          <button className="avatar-btn press" aria-label={t('nav.settings')} onClick={() => setMore(true)}><Avatar me={me} size={38} /></button>
        </header>
        {banners}
        <Page openMore={() => setMore(true)} me={me} />
      </main>

      <nav className="dock" aria-label={t('nav.menu')}>
        <div className="dock-capsule">
          <span className="dock-pill" style={{ transform: `translateX(${dockIndex * 100}%)` }} aria-hidden><span key={dockIndex} /></span>
          {DOCK.map((id) => {
            const { icon: Icon } = PAGES.find((p) => p.id === id);
            const dot = (id === 'chat' && (navStatus.pendingPrompts > 0 ? 'err' : (navStatus.running > 0 || navStatus.unread > 0) && 'warn')) || (id === 'overview' && navStatus.offline && 'err');
            return (
              <button key={id} className={id === page ? 'active' : ''} onClick={() => go(id)} aria-current={id === page ? 'page' : undefined}>
                <span className="dock-ic"><Icon size={21} strokeWidth={id === page ? 2.3 : 1.9} />{dot && <span className={'nav-dot ' + dot} />}</span><span>{t('nav.' + id)}</span>
              </button>
            );
          })}
          <button className={dockIndex === 4 ? 'active' : ''} onClick={() => setMore(true)}>
            <LayoutGrid size={21} strokeWidth={dockIndex === 4 ? 2.3 : 1.9} /><span>{t('nav.more')}</span>
          </button>
        </div>
      </nav>

      {more && <MoreSheet me={me} page={page} go={go} install={install} logout={logout} onClose={() => setMore(false)} />}
    </div>
  );
}
