// Real Liquid Glass via @ybouane/liquidglass (WebGL refraction, chromatic aberration, fresnel, rim).
// The library rasterises the root's non-glass children with html-to-image and shades each glass element
// in WebGL. It does not watch scrolling or deep DOM changes, so this module re-captures the content
// wrapper that changed (throttled) and asks the library to re-shade only the glass it overlaps.
//
// Where it runs: the floating chrome whose glass element can be a direct child of a root that also
// contains the content behind it:
//   - chat composer: root .chat-main, glass .composer-dock, content .chat-scroll/.chat-head
//   - tab bar (phone, other pages): root .shell, glass .dock, content .main
// Elsewhere (header capsule, glass buttons, sheets, modals, menus) the CSS glass in styles.css stays.
// Disabled for: terminal theme, reduced motion/transparency, more contrast, no WebGL, and the
// devices listed in shouldUseLib() (see the measurements in docs/liquid-glass.md).
import { LiquidGlass } from '@ybouane/liquidglass';
import { toCanvas } from 'html-to-image';

const PRESETS = {
  // "Regular Glass" from liquid-glass.ybouane.com (library defaults + these)
  light: { cornerRadius: 40, blurAmount: 0, refraction: 0.69, chromAberration: 0.05, edgeHighlight: 0.05, fresnel: 1, zRadius: 40, shadowOpacity: 0.3 },
  // "Dark Glass"
  dark: { cornerRadius: 40, blurAmount: 0.25, brightness: -0.3, refraction: 0.69, chromAberration: 0.05, edgeHighlight: 0.05, fresnel: 1, zRadius: 40, shadowOpacity: 0.3 },
};
// The composer sits over moving text that the user is reading while typing: a touch of blur.
const COMPOSER_EXTRA = { light: { blurAmount: 0.08 }, dark: { blurAmount: 0.3 } };

const TARGETS = [
  { root: '.chat-main', glass: '.composer-dock', kind: 'composer' },
  { root: '.shell', glass: '.dock', kind: 'dock' },
];

const mq = (q) => window.matchMedia(q).matches;
function isDark() {
  const t = document.documentElement.dataset.theme;
  return t === 'dark' || (t !== 'light' && mq('(prefers-color-scheme: dark)'));
}
function hasWebGL() {
  try { return !!document.createElement('canvas').getContext('webgl'); } catch { return false; }
}
export function shouldUseLib() {
  if (typeof window === 'undefined') return false;
  if (new URLSearchParams(location.search).has('lg-css')) return false; // manual fallback switch
  if (new URLSearchParams(location.search).has('lg-lib')) return hasWebGL(); // force on (testing)
  if (document.documentElement.dataset.theme === 'terminal') return false;
  if (mq('(prefers-reduced-motion: reduce), (prefers-reduced-transparency: reduce), (prefers-contrast: more)')) return false;
  // Touch devices (iPhone PWA) use the WebGL glass too (since v7). The cost that froze scrolling in the
  // v6 measurements (html-to-image captures, full-DPR canvases) is contained by the hybrid mode below
  // (CSS while moving, one capture once still), a capped pixel ratio and a paused loop when hidden.
  return hasWebGL();
}

// Phones: the library reads window.devicePixelRatio every frame and sizes the WebGL canvas, the scene
// canvases and the html-to-image captures with it. At the iPhone's 3x that is ~9x the pixels of 1x;
// 2x is visually the same for a refracted, slightly blurred lens and costs less than half.
const isTouch = () => mq('(hover: none), (pointer: coarse)');
const DPR_CAP = 2;
let dprCapped = false;
function capDevicePixelRatio() {
  if (dprCapped || !isTouch()) return;
  const desc = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')
    || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window), 'devicePixelRatio');
  const native = () => (desc?.get ? desc.get.call(window) : desc?.value) || 1;
  if (native() <= DPR_CAP) return;
  try {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => Math.min(native(), DPR_CAP) });
    dprCapped = true;
  } catch { /* read-only in this browser: keep the native ratio */ }
}

// Hidden tab / PWA in background: stop the library's requestAnimationFrame loop, resume on return.
function setPaused(paused) {
  for (const e of live.values()) {
    const i = e.instance;
    if (!i) continue;
    if (paused && i._running) { i._running = false; cancelAnimationFrame(i._rafId); e.paused = true; }
    else if (!paused && e.paused) {
      e.paused = false; i._running = true; i._globalDirty = true;
      i._rafId = requestAnimationFrame(() => i._renderLoop());
    }
  }
}

const live = new Map(); // glass element -> { instance, root, kind, cleanup }

function configFor(el, kind) {
  const theme = isDark() ? 'dark' : 'light';
  const r = Math.min(PRESETS[theme].cornerRadius, el.offsetHeight / 2);
  return { ...PRESETS[theme], ...(kind === 'composer' ? COMPOSER_EXTRA[theme] : {}), cornerRadius: r, zRadius: Math.min(40, r) };
}

// Re-capture the content wrapper (a direct child of root) that contains `node`, at most every `gap` ms,
// plus a trailing capture so the glass always ends up showing the latest content.
// Every html-to-image capture is a main-thread long task (measured 465-1090 ms on the server's ARM
// CPU, 100-560 ms long tasks, several seconds with 4x CPU throttling). So the WebGL lens never re-captures
// while things move: on scroll/mutation the glass switches to the CSS material (.lgl-moving), and only
// once the content has been still for IDLE_MS it captures once and fades the WebGL glass back in.
const IDLE_MS = 450;
const idleMs = () => (isTouch() ? 650 : IDLE_MS); // phones: wait for momentum scrolling to settle
function makeRefresher(entry) {
  const pending = new Set();
  let timer = 0;
  const run = () => {
    timer = 0;
    const { instance } = entry;
    if (!instance) return;
    if (entry.busy.size) { timer = setTimeout(run, idleMs()); return; }
    const ws = [...pending]; pending.clear();
    entry.waiting = new Set(ws);
    ws.forEach((w) => instance.capture.captureElement(w, true)); // keeps the old frame until the new one lands
    if (!ws.length) entry.glass.classList.remove('lgl-moving');
  };
  return (node) => {
    let w = node instanceof Element ? node : node?.parentElement;
    while (w && w.parentElement !== entry.root) w = w.parentElement;
    if (!w || w === entry.glass) return;
    pending.add(w);
    entry.glass.classList.add('lgl-moving');
    clearTimeout(timer);
    timer = setTimeout(run, idleMs());
  };
}

// html-to-image clones a scroll container from its top, so the glass would refract the wrong part of
// the chat. For a scrolling wrapper we clone only the children that sit behind the glass (cheaper, too)
// and shift them to where they are on screen.
export const captureLog = [];
function patchCapture(entry) {
  const cap = entry.instance.capture;
  const original = cap._captureWithHtmlToImage.bind(cap);
  const landed = cap.onCacheUpdate;
  cap.onCacheUpdate = (el) => {
    landed?.(el);
    entry.waiting?.delete(el);
    // let the library re-shade on its next frame, then show the WebGL glass again
    if (!entry.waiting?.size) requestAnimationFrame(() => requestAnimationFrame(() => entry.glass.classList.remove('lgl-moving')));
  };
  cap._captureWithHtmlToImage = async (element, w, h, cssW, cssH) => {
    const t0 = performance.now();
    entry.busy.add(element);
    try {
      const scrolls = element.scrollHeight > element.clientHeight + 1;
      if (!scrolls || cssW <= 0 || cssH <= 0) return await original(element, w, h, cssW, cssH);
      const box = element.getBoundingClientRect();
      const g = entry.glass.getBoundingClientRect();
      const top = g.top - 60, bottom = g.bottom + 60;
      const keep = new Set([...element.children].filter((c) => {
        const r = c.getBoundingClientRect();
        return r.bottom > top && r.top < bottom;
      }));
      const first = [...keep][0];
      const off = first ? first.getBoundingClientRect().top - box.top : 0;
      const rendered = await toCanvas(element, {
        width: cssW, height: cssH, pixelRatio: cap.dpr,
        fontEmbedCSS: cap.fontEmbedCSSForElement(element),
        filter: (n) => n.parentElement !== element || keep.has(n),
        style: {
          paddingTop: Math.max(off, 0) + 'px', marginTop: Math.min(off, 0) + 'px',
          height: (cssH - Math.min(off, 0)) + 'px', overflow: 'hidden', boxSizing: 'border-box',
        },
      });
      cap.cache.set(element, { canvas: rendered, w, h });
      cap.onCacheUpdate?.(element);
    } catch (err) {
      console.warn('liquidglass: capture failed', err);
    } finally {
      entry.busy.delete(element);
      captureLog.push({ kind: entry.kind, el: element.className.split(' ')[0], ms: Math.round(performance.now() - t0) });
      if (captureLog.length > 500) captureLog.shift();
    }
  };
}

async function attach(root, glass, kind) {
  glass.classList.add('lgl');
  // drop the SVG-refraction backdrop that glass.js set inline (it skips .lgl from now on)
  glass.querySelectorAll('[data-lg-filter]').forEach((n) => { n.style.removeProperty('backdrop-filter'); n.style.removeProperty('-webkit-backdrop-filter'); });
  glass.dataset.config = JSON.stringify(configFor(glass, kind));
  const entry = { root, glass, kind, instance: null, busy: new Set() };
  live.set(glass, entry);
  const refresh = makeRefresher(entry);
  const onScroll = (e) => refresh(e.target === document ? document.scrollingElement : e.target);
  root.addEventListener('scroll', onScroll, { capture: true, passive: true });
  const mo = new MutationObserver((list) => { for (const m of list) if (!glass.contains(m.target)) refresh(m.target); });
  mo.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'src'] });
  const ro = new ResizeObserver(() => { glass.dataset.config = JSON.stringify(configFor(glass, kind)); });
  ro.observe(glass);
  entry.cleanup = () => { root.removeEventListener('scroll', onScroll, true); mo.disconnect(); ro.disconnect(); };
  try {
    entry.instance = await LiquidGlass.init({ root, glassElements: [glass] });
    patchCapture(entry);
    if (document.hidden) setPaused(true);
    // the prewarm ran with the stock capture: redo the scrolling wrappers with the patched one
    entry.waiting = new Set([...root.children].filter((c) => c !== glass && c.scrollHeight > c.clientHeight + 1));
    if (entry.waiting.size) { glass.classList.add('lgl-moving'); entry.waiting.forEach((c) => entry.instance.capture.captureElement(c, true)); }
    if (!live.has(glass)) entry.instance.destroy(); // detached while initialising
  } catch (err) {
    console.warn('liquidglass: init failed, keeping CSS glass', err);
    detach(glass);
  }
}

function detach(glass) {
  const e = live.get(glass);
  if (!e) return;
  live.delete(glass);
  e.cleanup?.();
  try { e.instance?.destroy(); } catch { /* ignore */ }
  glass.classList.remove('lgl', 'lgl-moving');
  delete glass.dataset.config;
  window.dispatchEvent(new Event('scroll')); // glass.js re-applies its CSS lens after the "busy" pause
}

function scan() {
  const on = shouldUseLib();
  document.documentElement.classList.toggle('lg-lib', on);
  for (const [glass, e] of live) {
    if (!on || !glass.isConnected || glass.parentElement !== e.root || !glass.offsetParent) detach(glass);
  }
  if (!on) return;
  capDevicePixelRatio();
  for (const t of TARGETS) {
    document.querySelectorAll(t.glass).forEach((glass) => {
      const root = glass.parentElement;
      if (!root?.matches(t.root) || live.has(glass) || !glass.offsetParent) return;
      if (getComputedStyle(root).position === 'static') root.style.position = 'relative';
      attach(root, glass, t.kind);
    });
  }
}

export function getLiquidGlassStats() {
  return [...live.values()].map((e) => ({ kind: e.kind, fps: e.instance?.fps ?? null }));
}

export function initLiquidGlass() {
  if (typeof window === 'undefined') return;
  let queued = 0;
  const queue = () => { if (!queued) queued = setTimeout(() => { queued = 0; scan(); }, 250); };
  new MutationObserver(queue).observe(document.body, { childList: true, subtree: true });
  // theme change: destroy and re-init with the other preset
  const retheme = () => { [...live.keys()].forEach(detach); scan(); };
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  ['(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce)', '(prefers-contrast: more)', '(prefers-reduced-transparency: reduce)']
    .forEach((q) => window.matchMedia(q).addEventListener?.('change', retheme));
  window.addEventListener('resize', queue, { passive: true });
  document.addEventListener('visibilitychange', () => setPaused(document.hidden));
  window.addEventListener('pagehide', () => setPaused(true));
  window.addEventListener('pageshow', () => setPaused(document.hidden));
  window.__lg = { stats: getLiquidGlassStats, live, captureLog, dpr: () => window.devicePixelRatio };
  queue();
}
