import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, BarChart3, Bell, BellRing, Bot, Brain, CalendarClock, CheckSquare, ChevronLeft, ChevronRight, Download, FileCode2, FolderArchive, Gauge, GitBranch, Inbox, LayoutDashboard, KeyRound, Languages, LayoutGrid, LogOut, MessageSquare, Monitor, Moon, PanelBottom, Plug, RefreshCw, ScrollText, Search, Send, Sparkles, SquareTerminal, Sun, UserRound, Wand2, WifiOff } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { api, bridge, prefs, setUnauthorizedHandler } from './api.js';
import { DEFAULT_DOCK, DockSettingsModal, isSameList, normalizeDock } from './DockSettings.jsx';
import { ActionInboxModal, GlobalSearchModal } from './GlobalCommandHub.jsx';
import { LANGS, store, useI18n } from './i18n.jsx';
import { NotificationsProvider, useNotifications } from './notifications.jsx';
import { ErrorBoundary, IconButton, Sheet, haptic, refreshAll, useTheme } from './ui.jsx';
import { ContextMenuHost, PullToRefresh, ScreenCtx } from './native.jsx';
import { useEdgeBack, useNavStack } from './stack.jsx';
import { ViewerHost } from './viewer.jsx';
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
import Command from './pages/Command.jsx';
import Status from './pages/Status.jsx';
import Workflows from './pages/Workflows.jsx';
import Memory from './pages/Memory.jsx';
import Providers from './pages/Providers.jsx';
import Mcp from './pages/Mcp.jsx';
import Schedules from './pages/Schedules.jsx';
import Envs from './pages/Envs.jsx';
import Logs from './pages/Logs.jsx';

const PAGE_GROUPS = ['work', 'auto', 'knowledge', 'system'];

const PAGES = [
  { id: 'command', group: 'work', icon: LayoutDashboard, el: Command },
  { id: 'chat', group: 'work', icon: MessageSquare, el: Chat },
  { id: 'board', group: 'work', icon: CheckSquare, el: Board },
  { id: 'bots', group: 'work', icon: Bot, el: Bots },
  { id: 'computer', group: 'work', icon: Monitor, el: Computer },
  { id: 'schedules', group: 'auto', icon: CalendarClock, el: Schedules },
  { id: 'workflows', group: 'auto', icon: GitBranch, el: Workflows },
  { id: 'dashboards', group: 'knowledge', icon: FileCode2, el: Dashboards },
  { id: 'artifacts', group: 'knowledge', icon: FolderArchive, el: Artifacts },
  { id: 'skills', group: 'knowledge', icon: Wand2, el: Skills },
  { id: 'memory', group: 'knowledge', icon: Brain, el: Memory },
  { id: 'status', group: 'system', icon: Activity, el: Status },
  { id: 'usage', group: 'system', icon: BarChart3, el: Usage },
  { id: 'providers', group: 'system', icon: Sparkles, el: Providers },
  { id: 'mcp', group: 'system', icon: Plug, el: Mcp },
  { id: 'envs', group: 'system', icon: KeyRound, el: Envs },
  { id: 'logs', group: 'system', icon: ScrollText, el: Logs },
  { id: 'overview', group: 'system', icon: Gauge, el: Overview },
];

const pageFromHash = () => {
  const h = window.location.hash.replace('#/', '').split('/')[0];
  return h === 'more' || PAGES.some((p) => p.id === h) ? h : 'chat';
};

const THEMES = [{ id: 'system', icon: Monitor }, { id: 'light', icon: Sun }, { id: 'dark', icon: Moon }, { id: 'terminal', icon: SquareTerminal }];

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

// Keyboard open (a text field focused on a phone): flag <html class="kb-open"> so the dock gets out of
// the way. Uses focus plus visualViewport (iOS keeps the layout viewport and shrinks the visual one;
// Android with interactive-widget=resizes-content resizes the layout instead).
function useKeyboardFlag() {
  useEffect(() => {
    const root = document.documentElement;
    const isField = (el) => el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable ||
      (el.tagName === 'INPUT' && !/^(checkbox|radio|range|button|submit|file|color)$/i.test(el.type)));
    const mobile = () => window.matchMedia('(max-width: 820px)').matches;
    const vv = window.visualViewport;
    let baseH = window.innerHeight;
    const update = () => {
      // the on-screen keyboard only exists while a field has focus; a smaller viewport alone (rotation,
      // split screen) must not hide the dock
      const focused = isField(document.activeElement);
      root.classList.toggle('kb-open', mobile() && focused);
      root.classList.toggle('kb-shrunk', Boolean(vv) && focused && vv.height < baseH * 0.78);
      if (vv) root.style.setProperty('--vv-h', Math.round(vv.height) + 'px');
    };
    const onFocusOut = () => setTimeout(update, 60); // focus may be moving to another field
    const onResize = () => { if (!isField(document.activeElement)) baseH = Math.max(baseH, window.innerHeight); update(); };
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', onFocusOut);
    vv?.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => { baseH = window.innerHeight; });
    return () => {
      document.removeEventListener('focusin', update); document.removeEventListener('focusout', onFocusOut);
      vv?.removeEventListener('resize', onResize); root.classList.remove('kb-open', 'kb-shrunk');
    };
  }, []);
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

const DOCK_ACTIONS = new Set(['search', 'inbox']);
const DOCK_OPTIONS = [
  ...PAGES,
  { id: 'search', icon: Search, action: true },
  { id: 'inbox', icon: Inbox, action: true },
  { id: 'more', icon: LayoutGrid },
];
const DOCK_IDS = DOCK_OPTIONS.map((p) => p.id);
const readCachedDock = (key) => {
  try {
    const raw = store.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length >= 1 && parsed.length <= 5 ? normalizeDock(parsed, DOCK_IDS) : null;
  } catch { return null; }
};

function Avatar({ me, size = 34 }) {
  const pic = me?.picture;
  const [imgErr, setImgErr] = useState(false);
  useEffect(() => { setImgErr(false); }, [pic]);
  const letter = (me?.name || me?.email || '?').trim()[0]?.toUpperCase();
  return (
    <span className="avatar-ring" style={{ width: size, height: size }}>
      {pic && !imgErr ? <img src={pic} alt="" referrerPolicy="no-referrer" onError={() => setImgErr(true)} /> : me?.email ? <span className="avatar-letter">{letter}</span> : <UserRound size={size * 0.55} />}
    </span>
  );
}

function DesktopNotifButton() {
  const { t } = useI18n();
  const notif = useNotifications();
  if (!notif.supported) return null;
  const label = notif.permission === 'denied'
    ? t('notif.deniedShort')
    : notif.enabled
      ? t('notif.toggleOn')
      : t('notif.toggleOff');
  return (
    <button
      type="button"
      className={'ghost small notif-nav-btn' + (notif.enabled ? ' on' : '')}
      style={{ padding: '6px 9px' }}
      disabled={notif.busy}
      aria-pressed={notif.enabled}
      aria-label={label}
      title={label}
      onClick={() => notif.toggle()}
    >
      {notif.enabled ? <BellRing size={15} /> : <Bell size={15} />}
    </button>
  );
}

// Pages + appearance + account. Root of the "Mais" tab, and also the sheet behind the avatar.
function MoreList({ me, page, go, install, logout, onClose, dock, morePages, openDockSettings, openSearch, openInbox, inboxCount }) {
  const { t } = useI18n();
  const notif = useNotifications();
  const notifSub = !notif.supported
    ? t('notif.unsupported')
    : notif.permission === 'denied'
      ? t('notif.deniedShort')
      : notif.enabled
        ? (notif.pushSubscribed ? t('notif.pushActive') : t('notif.browserActive'))
        : t('notif.hint');
  const showSearchShortcut = !dock.includes('search');
  const showInboxShortcut = !dock.includes('inbox');
  const dockLabel = (id) => (t('dock.label.' + id) !== 'dock.label.' + id ? t('dock.label.' + id) : t('nav.' + id));
  return (
    <>
      {(showSearchShortcut || showInboxShortcut) && (
        <>
          <div className="group-label">Atalhos rápidos</div>
          <div className="group">
            {showSearchShortcut && (
              <button type="button" className="group-row press" onClick={() => { onClose?.(); openSearch(); }}>
                <span className="row-ic ic-search"><Search size={17} /></span>
                <span className="grow"><b>{t('dock.sub.search')}</b></span>
                <ChevronRight size={17} className="chev" />
              </button>
            )}
            {showInboxShortcut && (
              <button type="button" className="group-row press" onClick={() => { onClose?.(); openInbox(); }}>
                <span className="row-ic ic-inbox"><Inbox size={17} /></span>
                <span className="grow"><b>{t('dock.sub.inbox')}</b></span>
                {inboxCount > 0 && <span className="nav-dot err" style={{ marginRight: 6 }} />}
                <ChevronRight size={17} className="chev" />
              </button>
            )}
          </div>
        </>
      )}
      {PAGE_GROUPS.map((g) => {
        const items = morePages.filter((p) => p.group === g);
        if (!items.length) return null;
        return (
          <div key={g}>
            <div className="group-label">{t('nav.g.' + g)}</div>
            <div className="group">
              {items.map(({ id, icon: Icon }) => (
                <button key={id} className={'group-row press' + (id === page ? ' on' : '')} onClick={() => { go(id); onClose?.(); }}>
                  <span className={'row-ic ic-' + id}><Icon size={17} /></span>
                  <span className="grow">
                    <b>{t('nav.' + id)}</b>
                    <small className="muted ellipsis">{t('nav.sub.' + id)}</small>
                  </span>
                  <ChevronRight size={17} className="chev" />
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <div className="group-label">{t('nav.appearance')}</div>
      <div className="group">
        <div className="group-row"><span className="row-ic ic-theme"><Moon size={17} /></span><span className="grow">{t('theme.label')}</span><ThemeSwitch labels /></div>
        <div className="group-row"><span className="row-ic ic-lang"><Languages size={17} /></span><span className="grow">{t('lang.label')}</span><LangSelect bare /></div>
        <button type="button" className="group-row press" onClick={() => { onClose?.(); openDockSettings(); }}>
          <span className="row-ic ic-dock"><PanelBottom size={17} /></span>
          <span className="grow">
            <span>{t('dock.title')}</span>
            <small className="muted ellipsis">{dock.map(dockLabel).join(' · ')}</small>
          </span>
          <ChevronRight size={17} className="chev" />
        </button>
      </div>
      <div className="group-label">{t('notif.title')}</div>
      <div className="group">
        <label className="group-row">
          <span className="row-ic ic-notif">{notif.enabled ? <BellRing size={17} /> : <Bell size={17} />}</span>
          <span className="grow">
            <b>{t('notif.title')}</b>
            <small className="muted">{notifSub}</small>
          </span>
          <input
            type="checkbox"
            checked={notif.enabled}
            disabled={!notif.supported || notif.busy}
            onChange={() => notif.toggle()}
            aria-label={t('notif.title')}
          />
        </label>
        {notif.enabled && (
          <button type="button" className="group-row press" disabled={notif.busy} onClick={() => notif.test()}>
            <span className="row-ic ic-plain"><Send size={15} /></span>
            <span className="grow">{t('notif.test')}</span>
            <ChevronRight size={17} className="chev" />
          </button>
        )}
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
    </>
  );
}

function MoreSheet(props) {
  const { t } = useI18n();
  return <Sheet title={t('nav.more')} onClose={props.onClose}><MoreList {...props} /></Sheet>;
}

const hashOf = (id) => '#/' + id;

// Pages only depend on these two props (plus context): memo keeps a tab switch, a push or the header
// collapsing from re-rendering every mounted page (the chat with all its markdown, dashboards...).
const PageView = memo(function PageView({ Page, openMore, me }) { return <Page openMore={openMore} me={me} />; });

// One screen of a navigation stack: its own nav bar (back button, collapsing title, actions slot),
// its own scroll position and pull-to-refresh. Chat draws its own header.
function Screen({ id, depth, backLabel, onBack, isTop, active, me, openMore, banners, cls, moreProps }) {
  const { t } = useI18n();
  const [el, setEl] = useState(null);
  const [actionsEl, setActionsEl] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const collapsedRef = useRef(false);
  const scrollRaf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(scrollRaf.current), []);
  // large title collapse: sample scrollTop once per frame, re-render only when the state flips
  const onScroll = (e) => {
    if (scrollRaf.current) return;
    const target = e.currentTarget;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0;
      const c = target.scrollTop > 40;
      if (c !== collapsedRef.current) { collapsedRef.current = c; setCollapsed(c); }
    });
  };
  const screenCtx = useMemo(() => ({ actionsEl, active: active && isTop }), [actionsEl, active, isTop]);
  const chat = id === 'chat';
  const Page = id === 'more' ? null : PAGES.find((p) => p.id === id).el;
  const title = t('nav.' + id);
  return (
    <section ref={setEl} className={'screen screen-' + id + (isTop ? ' top' : '') + (cls ? ' ' + cls : '')} data-screen={id} aria-hidden={!active || !isTop}
      onScroll={chat ? undefined : onScroll}>
      {!chat && (
        <header className={'topbar' + (collapsed ? ' collapsed' : '') + (depth > 0 ? ' has-back' : '')}>
          {depth > 0 && (
            <button type="button" className="nav-back press" onClick={onBack} aria-label={backLabel}>
              <ChevronLeft size={24} strokeWidth={2.4} /><span className="ellipsis">{backLabel}</span>
            </button>
          )}
          <span className="topbar-title ellipsis" aria-hidden={!collapsed}>{title}</span>
          <div className="topbar-actions" ref={setActionsEl} />
          <button className="avatar-btn press" aria-label={t('nav.settings')} onClick={openMore}><Avatar me={me} size={34} /></button>
        </header>
      )}
      {!chat && <h1 className="large-title serif-title ellipsis page-title">{title}</h1>}
      {!chat && <PullToRefresh enabled={active && isTop} onRefresh={refreshAll} scrollEl={el} />}
      {active && isTop && banners}
      <ScreenCtx.Provider value={screenCtx}>
        <ErrorBoundary resetKey={id}>
          {id === 'more'
            ? <div className="page page-list more-root"><MoreList {...moreProps} /></div>
            : <PageView Page={Page} openMore={openMore} me={me} />}
        </ErrorBoundary>
      </ScreenCtx.Provider>
    </section>
  );
}

// A tab's stack of screens. Only the top one is shown, except while a push/pop or an edge drag is running.
function TabLayer({ tab, stack, active, anim, onPop, renderScreen }) {
  const ref = useRef(null);
  useEdgeBack(ref, { enabled: active && stack.length > 1 && !anim, onPop });
  const a = anim && anim.tab === tab ? anim.kind : null;
  return (
    <div ref={ref} className={'tab-layer' + (active ? ' active' : '') + (a ? ' anim-' + a : '')} hidden={!active}>
      {stack.map((id, i) => {
        const isTop = i === stack.length - 1;
        const isUnder = i === stack.length - 2;
        const cls = a === 'push' ? (isTop ? 'enter-push' : isUnder ? 'leave-push' : '')
          : a === 'pop' ? (isTop ? 'leave-pop' : isUnder ? 'enter-pop' : '') : '';
        return renderScreen(id, i, isTop, cls, stack[i - 1]);
      })}
    </div>
  );
}

export default function App() {
  const { t } = useI18n();
  const [authed, setAuthed] = useState(null);
  const [me, setMe] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [dock, setDock] = useState(() => readCachedDock('acp_dock:last') || [...DEFAULT_DOCK]);
  const [dockModal, setDockModal] = useState(false);
  // Keep 'more' as an internal overflow tab even when the user removes it from the bottom bar,
  // and exclude dock-only actions (search, inbox) so Screen never tries to render them as pages.
  const pageDock = useMemo(() => dock.filter((id) => !DOCK_ACTIONS.has(id)), [dock]);
  const tabs = useMemo(() => (pageDock.includes('more') ? pageDock : [...pageDock, 'more']), [pageDock]);
  const tabOf = useCallback((id) => (pageDock.includes(id) ? id : 'more'), [pageDock]);
  const morePages = useMemo(() => PAGES.filter((p) => !pageDock.includes(p.id)), [pageDock]);
  const stackNav = useNavStack({ tabs, tabOf, initial: pageFromHash(), hashOf, parseHash: pageFromHash });
  const stackNavRef = useRef(stackNav);
  stackNavRef.current = stackNav;
  const { nav } = stackNav;
  const page = stackNav.top();
  const [more, setMore] = useState(false);
  const openMoreSheet = useCallback(() => setMore(true), []);
  const [searchOpen, setSearchOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [navStatus, setNavStatus] = useState({ running: 0, webRunning: 0, unread: 0, pendingPrompts: 0, inboxCount: 0, computerNeedsHuman: false, computerRunning: false, openTickets: 0, offline: false });

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => {
          if (!v) setInboxOpen(false);
          return !v;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const install = useInstall();
  const online = useOnline();
  useKeyboardFlag();
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();

  const userKey = (me?.email || 'password').toLowerCase();
  useEffect(() => {
    if (!authed) return undefined;
    let stop = false;
    const cached = readCachedDock('acp_dock:' + userKey);
    if (cached) setDock((cur) => (isSameList(cur, cached) ? cur : cached));
    prefs.get().then((r) => {
      if (stop || !r || !r.synced) return;
      const next = r.dock ? normalizeDock(r.dock, DOCK_IDS) : [...DEFAULT_DOCK];
      setDock((cur) => (isSameList(cur, next) ? cur : next));
      const serialized = JSON.stringify(next);
      store.set('acp_dock:' + userKey, serialized);
      store.set('acp_dock:last', serialized);
    }).catch(() => {});
    return () => { stop = true; };
  }, [authed, userKey]);

  useEffect(() => {
    if (!authed) return undefined;
    let stop = false;
    const poll = () => {
      if (document.hidden || stop) return;
      bridge.overview()
        .then((o) => !stop && setNavStatus({
          running: o.running?.length || 0,
          webRunning: Array.isArray(o.webRunning) ? o.webRunning.length : 0,
          unread: o.unread || 0, pendingPrompts: o.pendingPrompts || 0, inboxCount: o.inboxCount || 0,
          computerNeedsHuman: Boolean(o.computer?.needsHuman), computerRunning: o.computer?.status === 'running',
          openTickets: o.openTickets || 0, offline: false,
        }))
        .catch(() => !stop && setNavStatus((s) => ({ ...s, offline: true })));
    };
    const onVis = () => { if (!document.hidden) poll(); };
    poll();
    const id = setInterval(poll, 30000);
    window.addEventListener('acp:nav-refresh', poll);
    document.addEventListener('visibilitychange', onVis);
    return () => { stop = true; clearInterval(id); window.removeEventListener('acp:nav-refresh', poll); document.removeEventListener('visibilitychange', onVis); };
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
        const sameCached = prof.email && r.email && prof.email === r.email ? prof : {};
        const merged = {
          ...r,
          name: r.name || sameCached.name || '',
          picture: r.picture || sameCached.picture || '',
        };
        if (merged.email && (merged.name || merged.picture)) {
          store.set('acp_profile', JSON.stringify({ name: merged.name, picture: merged.picture, email: merged.email }));
        }
        setMe(merged);
        setAuthed(r.ok);
      } catch { setMe({ google: false, password: true }); setAuthed(false); }
    })();
    const onHash = () => stackNavRef.current.go(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const banners = (
    <>
      {!online && <div className="banner warn"><WifiOff size={15} />{t('pwa.offline')}</div>}
      {needRefresh && <div className="banner"><RefreshCw size={15} />{t('pwa.update')}<button className="small" onClick={() => updateServiceWorker(true)}>{t('pwa.reload')}</button></div>}
    </>
  );

  if (authed === null) return <NotificationsProvider authed={false}><div className="boot"><img src="/pwa-192.png" alt="" width="56" height="56" className="app-icon" /></div></NotificationsProvider>;
  if (!authed) {
    return (
      <NotificationsProvider authed={false}>
        <>{banners}<Login config={me || {}} initialError={authError} onLogin={() => { setAuthed(true); setMe((m) => ({ ...m, ok: true })); }}
          extras={<><LangSelect compact glass /><ThemeSwitch compact glass /></>} /></>
      </NotificationsProvider>
    );
  }

  // Sidebar, avatar sheet, links: tab roots switch tabs, other pages are pushed on the "Mais" stack.
  const go = (id) => stackNav.go(id);
  // Dock: run modal actions (search, inbox) or switch tab; tapping the active tab pops to its root, or scrolls it back to the top.
  const tapTab = (id) => {
    if (id === 'search') {
      haptic(8);
      setInboxOpen(false);
      setSearchOpen(true);
      return;
    }
    if (id === 'inbox') {
      haptic(8);
      setSearchOpen(false);
      setInboxOpen(true);
      return;
    }
    if (id !== nav.tab) { stackNav.switchTab(id); return; }
    if (stackNav.popToRoot(id)) { haptic(8); return; }
    // the chat keeps its position (scrolling a long conversation to its first message would be a surprise)
    if (id !== 'chat') document.querySelector('.tab-layer.active > .screen.top')?.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  const logout = async () => { await api('POST', '/logout').catch(() => {}); store.set('acp_profile', ''); setMore(false); setDockModal(false); setAuthed(false); };
  const saveDock = async (nextList) => {
    const clean = normalizeDock(nextList, DOCK_IDS);
    const isDef = isSameList(clean, DEFAULT_DOCK);
    setDock(clean);
    const serialized = JSON.stringify(clean);
    store.set('acp_dock:' + userKey, serialized);
    store.set('acp_dock:last', serialized);
    return prefs.save({ dock: isDef ? null : clean });
  };
  const activeDockId = searchOpen && dock.includes('search')
    ? 'search'
    : inboxOpen && dock.includes('inbox')
      ? 'inbox'
      : nav.tab;
  const dockIndex = dock.indexOf(activeDockId);
  const moreProps = { me, page, go, install, logout, dock, morePages, openDockSettings: () => setDockModal(true), openSearch: () => { setInboxOpen(false); setSearchOpen(true); }, openInbox: () => { setSearchOpen(false); setInboxOpen(true); }, inboxCount: navStatus.inboxCount };
  const renderScreen = (id, depth, isTop, cls, prev) => (
    <Screen key={id} id={id} depth={depth} isTop={isTop} active={tabOf(id) === nav.tab} cls={cls}
      backLabel={prev ? t('nav.' + prev) : ''} onBack={() => stackNav.pop()}
      me={me} openMore={openMoreSheet} banners={banners} moreProps={moreProps} />
  );
  const dockDot = (id) =>
    (id === 'chat' && (navStatus.pendingPrompts > 0 ? 'err' : (navStatus.webRunning > 0 || navStatus.unread > 0) && 'warn'))
    || (id === 'inbox' && navStatus.inboxCount > 0 && 'err')
    || (id === 'computer' && (navStatus.computerNeedsHuman ? 'err' : navStatus.computerRunning && 'ok'))
    || (id === 'overview' && navStatus.offline && 'err');

  return (
    <NotificationsProvider authed={Boolean(authed)}>
    <div className={'shell' + (page === 'chat' ? ' on-chat' : '') + (nav.anim ? ' navigating' : '')}>
      <aside className="nav">
        <div className="brand"><img src="/pwa-192.png" alt="" width="26" height="26" className="app-icon sm" />Agent Control</div>
        <div className="row" style={{ padding: '0 10px 8px', gap: 6 }}>
          <button type="button" className="ghost small grow" style={{ justifyContent: 'flex-start', gap: 6 }} onClick={() => setSearchOpen(true)} title="Busca Global (Cmd+K)">
            <Search size={14} /><span>Buscar</span><span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>⌘K</span>
          </button>
          <button type="button" className="ghost small" style={{ position: 'relative', padding: '6px 9px' }} onClick={() => setInboxOpen(true)} title="Central de Decisões (Inbox)">
            <Inbox size={15} />
            {navStatus.inboxCount > 0 && <span className="nav-dot err" style={{ position: 'absolute', top: 3, right: 3 }} />}
          </button>
          <DesktopNotifButton />
        </div>
        <nav>
          {PAGE_GROUPS.map((g) => (
            <div key={g} className="nav-group">
              <div className="nav-group-label">{t('nav.g.' + g)}</div>
              {PAGES.filter((p) => p.group === g).map(({ id, icon: Icon }) => (
                <button key={id} className={'nav-item' + (id === page ? ' active' : '')} onClick={() => go(id)} aria-current={id === page ? 'page' : undefined}>
                  <span className={'row-ic ic-' + id}><Icon size={15} /></span>
                  <span className="grow">{t('nav.' + id)}</span>
                  {id === 'chat' && (navStatus.pendingPrompts > 0
                    ? <span className="nav-dot err" aria-label={t('prp.pending')} />
                    : (navStatus.webRunning > 0 || navStatus.unread > 0) && <span className="nav-dot warn" aria-label={t('common.running')} />)}
                  {id === 'computer' && (navStatus.computerNeedsHuman
                    ? <span className="nav-dot err" aria-label={t('comp.needsYou')} />
                    : navStatus.computerRunning && <span className="nav-dot ok" aria-label={t('comp.running')} />)}
                  {id === 'overview' && navStatus.offline && <span className="nav-dot err" aria-label={t('ov.offline')} />}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="nav-foot">
          {install && <button className="nav-item" onClick={install}><Download size={17} />{t('pwa.install')}</button>}
          <div className="row between"><ThemeSwitch /><LangSelect compact /></div>
          <div className="nav-user">
            <button type="button" className="nav-user-btn" onClick={() => setMore(true)} aria-label={t('nav.settings')} title={t('nav.settings')}>
              <Avatar me={me} size={30} />
              <span className="grow ellipsis small">{me?.email || t('nav.signedPwd')}</span>
            </button>
            <IconButton icon={LogOut} className="ghost bare" label={t('nav.logout')} onClick={logout} />
          </div>
        </div>
      </aside>

      <main className="main">
        {tabs.filter((tab) => nav.visited.includes(tab) || tab === nav.tab).map((tab) => (
          <TabLayer key={tab} tab={tab} stack={nav.stacks[tab] || [tab]} active={tab === nav.tab} anim={nav.anim}
            onPop={() => stackNav.pop({ animated: false })} renderScreen={renderScreen} />
        ))}
      </main>

      <nav className="dock" style={{ '--dock-n': dock.length }} aria-label={t('nav.menu')}>
        <div className="dock-capsule">
          {dockIndex >= 0 && <span className="dock-pill" style={{ transform: `translateX(${dockIndex * 100}%)` }} aria-hidden><span key={dockIndex} /></span>}
          {dock.map((id) => {
            const { icon: Icon, action } = DOCK_OPTIONS.find((p) => p.id === id);
            const active = id === activeDockId;
            const dot = dockDot(id);
            return (
              <button
                key={id}
                className={active ? 'active' : ''}
                onClick={() => tapTab(id)}
                aria-current={!action && active ? 'page' : undefined}
                aria-expanded={action ? active : undefined}
              >
                <span className="dock-ic"><Icon size={21} strokeWidth={active ? 2.3 : 1.9} />{dot && <span className={'nav-dot ' + dot} />}</span><span>{t('dock.label.' + id) !== 'dock.label.' + id ? t('dock.label.' + id) : t('nav.' + id)}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <ContextMenuHost />
      <ViewerHost />
      {more && <MoreSheet {...moreProps} onClose={() => setMore(false)} />}
      {dockModal && <DockSettingsModal pages={DOCK_OPTIONS} dock={dock} onSave={saveDock} onClose={() => setDockModal(false)} />}
      {searchOpen && <GlobalSearchModal onClose={() => setSearchOpen(false)} go={go} />}
      {inboxOpen && <ActionInboxModal onClose={() => setInboxOpen(false)} go={go} />}
    </div>
    </NotificationsProvider>
  );
}
