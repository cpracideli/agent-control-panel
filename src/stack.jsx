// Per-tab navigation stacks, like a native tab bar app:
// - every tab keeps its own stack of screens; switching tabs keeps screens mounted (state + scroll)
// - push slides the new screen in from the right while the previous one moves -30% (parallax)
// - pop: "‹ Back" in the nav bar, the system back (Android / browser history) or a drag from the left edge
// - switching tabs is instant (as on iOS); the dock lens slides to the new tab
import { useCallback, useEffect, useRef, useState } from 'react';
import { haptic } from './ui.jsx';

const DUR = 420;
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * tabs: ['chat', 'bots', ..., 'more']; tabOf(id) -> the tab a screen id belongs to.
 * initial: screen id from the URL.
 */
export function useNavStack({ tabs, tabOf, initial, hashOf, parseHash }) {
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const tabOfRef = useRef(tabOf);
  tabOfRef.current = tabOf;
  const build = (id) => {
    const curTabs = tabsRef.current;
    const stacks = Object.fromEntries(curTabs.map((t) => [t, [t]]));
    const tab = tabOfRef.current(id);
    if (id !== tab) stacks[tab] = [tab, id];
    return { tab, stacks, visited: [tab], anim: null };
  };
  const [nav, setNav] = useState(() => build(initial));
  const navRef = useRef(nav);
  navRef.current = nav;
  const pushed = useRef(0);      // history entries we created with pushState
  const ignoreUntil = useRef(0); // our own history.back() fires popstate/hashchange: ignore them
  const tabsKey = tabs.join(',');
  const prevTabsKey = useRef(tabsKey);

  // Reconcile per-tab stacks whenever the user customizes the bottom bar tabs.
  useEffect(() => {
    if (prevTabsKey.current === tabsKey) return;
    prevTabsKey.current = tabsKey;
    setNav((n) => {
      const curStack = n.stacks[n.tab] || [n.tab];
      const curTop = curStack[curStack.length - 1];
      const curTabs = tabsRef.current;
      const curTabOf = tabOfRef.current;
      const stacks = {};
      for (const tb of curTabs) {
        if (n.stacks[tb]) {
          const kept = n.stacks[tb].filter((id, idx) => idx === 0 || curTabOf(id) === tb);
          stacks[tb] = kept.length ? kept : [tb];
        } else {
          stacks[tb] = [tb];
        }
      }
      const nextTab = curTabOf(curTop);
      if (curTop !== nextTab) {
        const base = stacks[nextTab] || [nextTab];
        stacks[nextTab] = base[base.length - 1] === curTop ? base : [nextTab, curTop];
      }
      const visited = [...new Set([...n.visited.filter((tb) => curTabs.includes(tb)), nextTab])];
      return { tab: nextTab, stacks, visited, anim: null };
    });
  }, [tabsKey]);

  const top = (n = navRef.current) => {
    const st = n.stacks[n.tab];
    return st && st.length ? st[st.length - 1] : n.tab;
  };
  const writeHash = (id, push) => {
    const h = hashOf(id);
    if (window.location.hash === h || window.location.hash.startsWith(h + '/')) return;
    if (push) { window.history.pushState({ acpDepth: 1 }, '', h); pushed.current += 1; } else window.history.replaceState(null, '', h);
  };

  // Tab switches are instant, like UITabBarController: a full-screen View Transition snapshot
  // (rasterizing both pages, glass included) cost several frames on phones for a 200ms crossfade.
  const commit = (next) => setNav(next);

  const switchTab = useCallback((tab) => {
    const n = navRef.current;
    if (n.anim) return;
    if (tab === n.tab) return;
    haptic(8);
    const stacks = n.stacks[tab] ? n.stacks : { ...n.stacks, [tab]: [tab] };
    const next = { ...n, tab, stacks, visited: n.visited.includes(tab) ? n.visited : [...n.visited, tab] };
    commit(next);
    writeHash(stacks[tab][stacks[tab].length - 1], false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const push = useCallback((id) => {
    const n = navRef.current;
    if (n.anim) return;
    const tab = tabOfRef.current(id);
    if (id === tab) { switchTab(tab); return; }
    const stack = n.stacks[tab] || [tab];
    if (stack[stack.length - 1] === id && n.tab === tab) return;
    if (n.tab !== tab) {
      // coming from another tab (dock, links, avatar sheet): land straight on the screen, no slide
      const stacks = { ...n.stacks, [tab]: [tab, id] };
      commit({ ...n, tab, stacks, visited: n.visited.includes(tab) ? n.visited : [...n.visited, tab] });
      writeHash(id, false);
      return;
    }
    const stacks = { ...n.stacks, [tab]: [...stack.filter((x) => x !== id), id] };
    setNav({ ...n, stacks, anim: reduced() ? null : { kind: 'push', tab } });
    if (!reduced()) setTimeout(() => setNav((m) => ({ ...m, anim: null })), DUR);
    writeHash(id, true);
  }, [switchTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // finish a pop: drop the top screen once the slide is over
  const finishPop = (tab) => setNav((m) => ({ ...m, anim: null, stacks: { ...m.stacks, [tab]: (m.stacks[tab] || [tab]).slice(0, -1) } }));

  const pop = useCallback(({ fromHistory = false, animated = true } = {}) => {
    const n = navRef.current;
    const stack = n.stacks[n.tab] || [n.tab];
    if (stack.length < 2 || (n.anim && n.anim.kind !== 'gesture')) return false;
    if (!fromHistory && pushed.current > 0) { pushed.current -= 1; ignoreUntil.current = Date.now() + 500; window.history.back(); }
    else if (fromHistory) pushed.current = Math.max(0, pushed.current - 1);
    if (!fromHistory) window.history.replaceState(null, '', hashOf(stack[stack.length - 2]));
    if (!animated || reduced()) { finishPop(n.tab); return true; }
    setNav({ ...n, anim: { kind: 'pop', tab: n.tab } });
    setTimeout(() => finishPop(n.tab), DUR);
    return true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const popToRoot = useCallback((tab) => {
    const n = navRef.current;
    const stack = n.stacks[tab] || [tab];
    if (stack.length < 2) return false;
    if (n.tab === tab && stack.length === 2) return pop();
    setNav({ ...n, stacks: { ...n.stacks, [tab]: [tab] } });
    writeHash(tab, false);
    return true;
  }, [pop]); // eslint-disable-line react-hooks/exhaustive-deps

  // URL-driven navigation (links like #/chat/<id>, #/computer) and the system back button
  const go = useCallback((id) => {
    const n = navRef.current;
    const tab = tabOfRef.current(id);
    if (id === tab) {
      if (n.tab !== tab) switchTab(tab);
      else if (tab === 'more' && (n.stacks.more?.length || 0) > 1) pop();
      return;
    }
    push(id);
  }, [push, switchTab, pop]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // popstate also fires for plain hash links (location.hash = ...), so only a move to the screen right
    // below the top counts as "back"; anything else is routed by the hashchange handler (go)
    const onPop = () => {
      if (Date.now() < ignoreUntil.current) return;
      const n = navRef.current;
      const stack = n.stacks[n.tab] || [n.tab];
      if (stack.length > 1 && parseHash() === stack[stack.length - 2]) { ignoreUntil.current = Date.now() + 300; pop({ fromHistory: true }); }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [pop]);

  return { nav, setNav, top, go, push, pop, popToRoot, switchTab, finishPop };
}

/**
 * Drag from the left edge of a pushed screen to go back: the screen follows the finger and the one
 * below slides in with parallax; past ~35% of the width (or a flick) it pops, otherwise it springs back.
 */
export function useEdgeBack(layerRef, { enabled, onPop }) {
  const cb = useRef(onPop);
  cb.current = onPop;
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !enabled) return undefined;
    let s = null;
    const parts = () => {
      const screens = layer.querySelectorAll(':scope > .screen');
      return { topEl: screens[screens.length - 1], under: screens[screens.length - 2] };
    };
    const start = (e) => {
      if (e.touches.length !== 1) return;
      const p = e.touches[0];
      if (p.clientX > 24) return;
      if (e.target.closest?.('.sheet-bg, .modal-bg, .ctx-bg, .iv-bg, .doc-bg, .gsearch-bg')) return;
      if (e.cancelable) e.preventDefault(); // claim the edge so iOS Safari doesn't run its own back swipe
      const { topEl, under } = parts();
      if (!topEl || !under) return;
      s = { x0: p.clientX, y0: p.clientY, topEl, under, drag: false, samples: [[p.clientX, e.timeStamp]] };
    };
    const move = (e) => {
      if (!s) return;
      const p = e.touches[0];
      const dx = p.clientX - s.x0, dy = p.clientY - s.y0;
      if (!s.drag) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { s = null; return; }
        if (dx < 8) return;
        s.drag = true;
        layer.classList.add('edge-dragging');
        s.under.classList.add('under-visible');
      }
      if (e.cancelable) e.preventDefault();
      const w = layer.clientWidth;
      const x = Math.max(0, Math.min(w, dx));
      s.x = x;
      s.topEl.style.transform = `translateX(${x}px)`;
      s.under.style.transform = `translateX(${-30 + (x / w) * 30}%)`;
      s.under.style.setProperty('--dim', String(0.12 * (1 - x / w)));
      s.samples.push([p.clientX, e.timeStamp]);
      if (s.samples.length > 6) s.samples.shift();
    };
    const end = (e) => {
      if (!s) return;
      const g = s; s = null;
      if (!g.drag) return;
      const w = layer.clientWidth;
      const [xl, tl] = g.samples[g.samples.length - 1];
      const [x1, t1] = g.samples[0];
      const v = tl > t1 ? (xl - x1) / (tl - t1) : 0;
      const go = (g.x || 0) > w * 0.35 || (v > 0.5 && (g.x || 0) > 30);
      const ms = 260;
      g.topEl.style.transition = `transform ${ms}ms cubic-bezier(.22, 1, .36, 1)`;
      g.under.style.transition = `transform ${ms}ms cubic-bezier(.22, 1, .36, 1)`;
      g.topEl.style.transform = go ? `translateX(${w}px)` : 'translateX(0)';
      g.under.style.transform = go ? 'translateX(0)' : 'translateX(-30%)';
      setTimeout(() => {
        // pop first (React removes the top screen), then clear the inline styles on the next frame,
        // so the dismissed screen never flashes back into place
        if (go) { haptic(8); cb.current(); }
        requestAnimationFrame(() => {
          layer.classList.remove('edge-dragging');
          for (const el of [g.topEl, g.under]) { el.style.transition = ''; el.style.transform = ''; el.style.removeProperty('--dim'); }
          g.under.classList.remove('under-visible');
        });
      }, ms);
    };
    layer.addEventListener('touchstart', start, { passive: false });
    layer.addEventListener('touchmove', move, { passive: false });
    layer.addEventListener('touchend', end);
    layer.addEventListener('touchcancel', end);
    return () => {
      layer.removeEventListener('touchstart', start); layer.removeEventListener('touchmove', move);
      layer.removeEventListener('touchend', end); layer.removeEventListener('touchcancel', end);
    };
  }, [layerRef, enabled]);
}
