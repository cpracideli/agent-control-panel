// Shared per-item capture cache for the Liquid Glass WebGL backdrops (src/liquidglass.js + src/lgengine.js).
// A scroller's items (chat messages, cards, list rows) are each rasterised once with html-to-image into
// their own canvas and drawn at their live position every frame, so scrolling never re-captures the DOM.
// html-to-image (a main-thread long task) runs only for items that appear for the first time (prefetched
// about a screen around the glass, nearest first, one per task) or whose content changed (throttled).
// Every glass on the page shares this cache: a message is captured once, whatever glass sits over it.
import { toCanvas } from 'html-to-image';
import { HtmlCapture } from '@lg-internal/HtmlCapture.js';

const isTouch = () => window.matchMedia('(hover: none), (pointer: coarse)').matches;
export const mutationGap = () => (isTouch() ? 700 : 350); // re-capture a changing item at most this often
const MAX_ITEM_PX = 12e6; // iOS canvas area limit is ~16.7 M px: skip absurdly tall items

export const captureLog = [];
const log = (el, t0) => { captureLog.push({ el, ms: Math.round(performance.now() - t0) }); if (captureLog.length > 500) captureLog.shift(); };

// web fonts embedded in the captures (same filtering the library does for its own captures)
let fonts = null;
const fontCSS = (el) => {
  if (!fonts) { fonts = new HtmlCapture(document.body); fonts.prefetchFontEmbedCSS().catch(() => {}); }
  return fonts.fontEmbedCSSForElement(el);
};

export const overflowScrolls = (el) => el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY);

// Items of scroller S: its children; a tall transparent container (list wrapper) is replaced by its own
// children, so a long list is not one giant capture and a change re-captures only the row that changed.
export function itemsOf(S) {
  const out = [];
  const walk = (parent, depth) => {
    for (const c of parent.children) {
      if (c.classList.contains('lgx-canvas')) continue;
      if (depth < 4 && c.children.length > 1 && c.offsetHeight > innerHeight * 1.2) {
        const cs = getComputedStyle(c);
        const clear = /rgba\(.*,\s*0\)|transparent/.test(cs.backgroundColor) && cs.backgroundImage === 'none' && !parseFloat(cs.borderTopWidth);
        if (clear) { walk(c, depth + 1); continue; }
      }
      out.push(c);
    }
  };
  walk(S, 0);
  return out;
}

const cache = new WeakMap(); // item -> { canvas, dpr, dirty, last }
const queue = new Set();
const listeners = new Set();
let working = null, again = false, focusY = 0;
const k = () => window.devicePixelRatio || 1;
const fresh = (c) => { const x = cache.get(c); return !!x && !x.dirty && x.dpr === k(); };

export function onItemLanded(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function pump() {
  if (working) return;
  let best = null, bestD = Infinity, wait = Infinity;
  for (const c of queue) {
    if (!c.isConnected || fresh(c)) { queue.delete(c); continue; }
    const x = cache.get(c);
    const due = x?.canvas ? x.last + mutationGap() - performance.now() : 0; // throttle re-captures only
    if (due > 0) { wait = Math.min(wait, due); continue; }
    const r = c.getBoundingClientRect();
    if (!r.width && !r.height) { queue.delete(c); continue; }
    const d = Math.abs((r.top + r.bottom) / 2 - focusY);
    if (d < bestD) { bestD = d; best = c; }
  }
  if (!best) { if (wait < Infinity) setTimeout(pump, wait + 5); return; }
  queue.delete(best);
  working = best; again = false;
  capture(best).finally(() => { working = null; setTimeout(pump, 0); });
}

async function capture(c) {
  const t0 = performance.now();
  const dpr = k();
  const prev = cache.get(c);
  const w = c.offsetWidth, h = c.offsetHeight;
  try {
    if (w < 1 || h < 1 || w * h * dpr * dpr > MAX_ITEM_PX) { cache.set(c, { canvas: null, dpr, dirty: false, last: performance.now() }); return; }
    const canvas = await toCanvas(c, {
      width: w, height: h, pixelRatio: dpr,
      fontEmbedCSS: fontCSS(c),
      filter: (n) => !(n.classList?.contains('lgx-canvas')),
      style: { margin: '0', transform: 'none', animation: 'none', transition: 'none' },
    });
    cache.set(c, { canvas, dpr, dirty: again, last: performance.now() });
    if (again) queue.add(c);
    listeners.forEach((fn) => { try { fn(c); } catch { /* ignore */ } });
  } catch (err) {
    console.warn('liquidglass: item capture failed', err);
    cache.set(c, { canvas: prev?.canvas || null, dpr, dirty: false, last: performance.now() });
  } finally {
    log('item', t0);
  }
}

// Draw S's items that touch [top, bottom] (viewport px) into ctx, where viewport point (originX, originY)
// maps to canvas pixel (ox, oy). Items near the range that are not cached yet are queued (+ prefetch).
export function drawItems(S, ctx, ox, oy, originX, originY, top, bottom) {
  const kk = k();
  const s = S.getBoundingClientRect();
  top = Math.max(top, s.top); bottom = Math.min(bottom, s.bottom);
  focusY = (top + bottom) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox + (s.left - originX) * kk, oy + (s.top - originY) * kk, s.width * kk, s.height * kk);
  ctx.clip();
  let fetch = false;
  for (const c of itemsOf(S)) {
    const r = c.getBoundingClientRect();
    if (r.bottom < top - innerHeight) continue;
    if (r.top > bottom + innerHeight) break;
    if (!fresh(c)) { queue.add(c); fetch = true; }
    if (r.bottom < top || r.top > bottom) continue;
    const e = cache.get(c);
    if (e?.canvas) ctx.drawImage(e.canvas, ox + (r.left - originX) * kk, oy + (r.top - originY) * kk, r.width * kk, r.height * kk);
  }
  ctx.restore();
  if (fetch) pump();
}

// Content inside S changed: re-capture only the item that holds `node` (keeps the old canvas meanwhile).
export function markItemDirty(node, S) {
  let c = node instanceof Element ? node : node?.parentElement;
  if (!c || c === S) return false;
  const items = new Set(itemsOf(S));
  while (c && c !== S && !items.has(c)) c = c.parentElement;
  if (!c || c === S) return false;
  if (c === working) again = true;
  const x = cache.get(c);
  if (x) x.dirty = true;
  queue.add(c); pump();
  return true;
}
if (typeof window !== 'undefined') window.__lgItems = { get: (c) => cache.get(c), captureLog };
