import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { bridge, webPush } from './api.js';
import { store, useI18n } from './i18n.jsx';
import { useToast } from './ui.jsx';

const NotificationsCtx = createContext(null);

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function normalizeTargetHash(url, chatId) {
  if (url) {
    const str = String(url);
    const hashIdx = str.indexOf('#');
    if (hashIdx >= 0) return str.slice(hashIdx).replace(/\/+$/, '');
    if (str.startsWith('/')) return '#' + str.replace(/\/+$/, '');
  }
  if (chatId && String(chatId).startsWith('web:')) {
    return '#/chat/' + String(chatId).slice(4);
  }
  return '#/chat';
}

function isViewingTarget(targetHash) {
  if (typeof document === 'undefined' || document.hidden) return false;
  if (typeof document.hasFocus === 'function' && !document.hasFocus()) return false;
  if (!targetHash) return false;
  const cur = (window.location.hash || '').replace(/\/+$/, '');
  return cur === targetHash;
}

const isNotifSupported = () => typeof window !== 'undefined' && typeof Notification !== 'undefined';
const isPushSupported = () => isNotifSupported() && 'serviceWorker' in navigator && 'PushManager' in window;

export function NotificationsProvider({ authed, children }) {
  const { t } = useI18n();
  const toast = useToast();
  const supported = isNotifSupported();
  const pushSupported = isPushSupported();

  const [permission, setPermission] = useState(() => (supported ? Notification.permission : 'unsupported'));
  const [prefOn, setPrefOn] = useState(() => store.get('acp_push') !== '0');
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  const enabled = supported && permission === 'granted' && prefOn;

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const pushSubscribedRef = useRef(pushSubscribed);
  pushSubscribedRef.current = pushSubscribed;
  const tRef = useRef(t);
  tRef.current = t;
  const reconciledRef = useRef(false);

  // Keep permission and local preference in sync across tabs or browser settings changes.
  useEffect(() => {
    if (!supported) return undefined;
    const syncState = () => {
      setPermission(Notification.permission);
      setPrefOn(store.get('acp_push') !== '0');
    };
    const onVis = () => { if (!document.hidden) syncState(); };
    const onStorage = (e) => { if (e.key === 'acp_push') setPrefOn(e.newValue !== '0'); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('storage', onStorage);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('storage', onStorage);
    };
  }, [supported]);

  const ensurePushSubscription = useCallback(async () => {
    if (!pushSupported) return false;
    const { publicKey } = await webPush.key();
    if (!publicKey) return false;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    await webPush.subscribe(sub.toJSON());
    setPushSubscribed(true);
    return true;
  }, [pushSupported]);

  // Silent reconciliation once per authenticated session.
  useEffect(() => {
    if (!authed) {
      reconciledRef.current = false;
      return undefined;
    }
    if (!pushSupported) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (!cancelled) setPushSubscribed(Boolean(existing));
        if (reconciledRef.current || cancelled) return;
        reconciledRef.current = true;
        if (Notification.permission === 'granted' && store.get('acp_push') !== '0') {
          await ensurePushSubscription().catch(() => {
            if (!cancelled) setPushSubscribed(false);
          });
        }
      } catch {
        // Silent failure: never bother user during background reconciliation.
      }
    })();
    return () => { cancelled = true; };
  }, [authed, pushSupported, ensurePushSubscription]);

  const enable = useCallback(async () => {
    if (!supported) {
      toast(tRef.current('notif.unsupported'), 'err');
      return false;
    }
    setBusy(true);
    try {
      let perm = Notification.permission;
      if (perm === 'denied') {
        setPermission('denied');
        toast(tRef.current('notif.denied'), 'err');
        return false;
      }
      if (perm !== 'granted') {
        perm = await Notification.requestPermission();
        setPermission(perm);
        if (perm !== 'granted') {
          toast(tRef.current('notif.denied'), 'err');
          return false;
        }
      } else {
        setPermission('granted');
      }
      store.set('acp_push', '1');
      setPrefOn(true);
      let subscribed = false;
      if (pushSupported) {
        try {
          subscribed = await ensurePushSubscription();
        } catch {
          // Browser notifications remain active even if Web Push registration fails.
        }
      }
      toast(subscribed ? tRef.current('notif.enabledPush') : tRef.current('notif.on'));
      return true;
    } finally {
      setBusy(false);
    }
  }, [supported, pushSupported, ensurePushSubscription, toast]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      store.set('acp_push', '0');
      setPrefOn(false);
      if (pushSupported) {
        try {
          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            await webPush.unsubscribe(sub.endpoint).catch(() => {});
            await sub.unsubscribe().catch(() => {});
          }
        } catch {
          // Ignore service worker/subscription cleanup errors.
        }
        setPushSubscribed(false);
      }
      toast(tRef.current('notif.off'));
      return true;
    } finally {
      setBusy(false);
    }
  }, [pushSupported, toast]);

  const toggle = useCallback(() => (enabled ? disable() : enable()), [enabled, disable, enable]);

  const test = useCallback(async () => {
    if (!supported) {
      toast(tRef.current('notif.unsupported'), 'err');
      return false;
    }
    setBusy(true);
    try {
      if (pushSubscribed) {
        await webPush.test();
        toast(tRef.current('notif.testSent'));
        return true;
      }
      if (Notification.permission === 'granted') {
        new Notification('Agent Control', {
          body: tRef.current('notif.testBody'),
          icon: '/pwa-192.png',
          badge: '/pwa-64.png',
          tag: 'push-test',
        });
        toast(tRef.current('notif.testSent'));
        return true;
      }
      toast(tRef.current('notif.denied'), 'err');
      return false;
    } catch (e) {
      toast(e?.message || 'Erro ao testar notificação', 'err');
      return false;
    } finally {
      setBusy(false);
    }
  }, [supported, pushSubscribed, toast]);

  // Global app-wide SSE listener for real-time notifications and nav status refresh.
  useEffect(() => {
    if (!authed || typeof EventSource === 'undefined') return undefined;
    let closed = false;
    let es;
    try {
      es = new EventSource(bridge.webEventsUrl());
    } catch {
      return undefined;
    }

    const showLocalNotification = (title, body, tag, url, chatId) => {
      if (!enabledRef.current || !isNotifSupported() || Notification.permission !== 'granted') return;
      const targetHash = normalizeTargetHash(url, chatId);
      if (isViewingTarget(targetHash)) return;
      try {
        const n = new Notification(title || 'Agent Control', {
          body: String(body || '').slice(0, 220),
          icon: '/pwa-192.png',
          badge: '/pwa-64.png',
          tag: tag || 'agent-control',
        });
        n.onclick = () => {
          try { window.focus(); } catch {}
          if (targetHash) window.location.hash = targetHash;
          if (chatId && String(chatId).startsWith('web:')) {
            window.dispatchEvent(new CustomEvent('acp:open-chat', { detail: { chatId } }));
          }
          try { n.close(); } catch {}
        };
      } catch {
        // Ignore browsers where direct `new Notification` is restricted in favor of SW push.
      }
    };

    es.onmessage = (e) => {
      if (closed || !e?.data) return;
      let ev;
      try { ev = JSON.parse(e.data); } catch { return; }
      if (!ev || ev.type === 'hello') return;

      if (ev.type === 'message' || ev.type === 'prompt' || ev.type === 'task' || ev.type === 'computer_need_human') {
        window.dispatchEvent(new Event('acp:nav-refresh'));
      } else {
        return;
      }

      if (!enabledRef.current || pushSubscribedRef.current) return;

      if (ev.type === 'message') {
        const m = ev.message;
        if (!m || m.stopped || m.role !== 'assistant') return;
        const title = ev.botName
          ? (ev.chatTitle ? `${ev.botName} · ${ev.chatTitle}` : ev.botName)
          : (ev.chatTitle || 'Agent Control');
        const body = m.text || (m.error ? 'Erro na resposta' : '');
        const tag = ev.tag || (m.id ? 'msg-' + m.id : 'agent-control');
        showLocalNotification(title, body, tag, ev.url, ev.chatId);
      } else if (ev.type === 'prompt') {
        const pr = ev.prompt;
        if (pr && pr.status && pr.status !== 'pending') return;
        const title = pr?.title || ev.chatTitle || tRef.current('prp.pending');
        const body = pr?.question || '';
        const tag = ev.tag || (pr?.id ? 'prompt-' + pr.id : 'prompt');
        showLocalNotification(title, body, tag, ev.url, ev.chatId);
      } else if (ev.type === 'task') {
        const title = ev.title
          ? (ev.error ? `Erro na tarefa: ${ev.title}` : `Tarefa concluída: ${ev.title}`)
          : 'Agent Control';
        const body = (typeof ev.error === 'string' && ev.error) ? ev.error : (ev.text || '');
        const tag = ev.tag || (ev.id ? 'task-' + ev.id : 'task');
        showLocalNotification(title, body, tag, ev.url, ev.chatId);
      } else if (ev.type === 'computer_need_human') {
        const title = tRef.current('comp.needsYou');
        const body = ev.reason || '';
        const tag = ev.tag || 'computer-need-human';
        showLocalNotification(title, body, tag, ev.url || '/#/computer', ev.chatId);
      }
    };

    es.onerror = () => {
      // Do not break or spam if bridge has not been restarted yet; EventSource reconnects silently.
    };

    return () => {
      closed = true;
      try { es.close(); } catch {}
    };
  }, [authed]);

  const value = useMemo(() => ({
    supported,
    pushSupported,
    permission,
    enabled,
    pushSubscribed,
    busy,
    enable,
    disable,
    toggle,
    test,
  }), [supported, pushSupported, permission, enabled, pushSubscribed, busy, enable, disable, toggle, test]);

  return <NotificationsCtx.Provider value={value}>{children}</NotificationsCtx.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationsCtx);
  if (!ctx) {
    return {
      supported: false,
      pushSupported: false,
      permission: 'unsupported',
      enabled: false,
      pushSubscribed: false,
      busy: false,
      enable: async () => false,
      disable: async () => false,
      toggle: async () => false,
      test: async () => false,
    };
  }
  return ctx;
}
