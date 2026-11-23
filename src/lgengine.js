// Liquid Glass WebGL for every other glass surface of the panel (v8).
//
// @ybouane/liquidglass only shades elements that are direct children of a root that also holds the
// content behind them; that fits the composer and the tab bar (src/liquidglass.js) but not the header
// capsules, glass buttons, toasts, sheets, modals, menus or Cmd+K, which React renders nested or in
// overlays. For those this module drives the library's own GlassRenderer (same shaders, same Regular /
// Dark presets) with ONE shared WebGL context, and composes the scene behind each element itself:
//   1. the page background colour;
//   2. the items of the scroller behind the element, from the shared per-item capture cache
//      (src/lgitems.js: one html-to-image capture per message/card, reused by every glass);
//   3. the glass canvases below it (header/composer/dock under a sheet or toast, or the outer glass
//      for a glass nested inside another);
//   4. the overlay scrim (sheet/modal/action-sheet backdrop) when the element sits above one.
// Each element gets one <canvas class="lgx-canvas"> (z-index -1) and the class .lgx, which switches its
// CSS material off (styles.css, "v8"). Rendering is on demand (scroll of the scroller behind, item
// landed, size/position change, theme), coalesced per animation frame; elements off screen, closed or
// beyond MAX_ACTIVE keep the CSS glass. Everything is skipped where src/liquidglass.js keeps CSS
// (?lg-css, terminal theme, reduced transparency/motion, more contrast, no WebGL).
import { GlassRenderer } from '@lg-internal/GlassRenderer.js';
import { DEFAULTS, SHADOW_PAD } from '@lg-internal/defaults.js';
import { PRESETS, isDark, shouldUseLib, capDevicePixelRatio } from './liquidglass.js';
import { drawItems, markItemDirty, onItemLanded, overflowScrolls } from './lgitems.js';

// surfaces that simulated Liquid Glass with CSS (backdrop-filter + tint + rim)
const CONTROLS = ['.head-capsule', '.chat-head .nav-btn', '.glass-btn', '.glass-bar', '.iv-btn', '.wf-bar'];
const FLOATING = ['.toast', '.ctx-menu', '.bot-picker-menu', '.pg-more-menu'];
const PANELS = ['.sheet', '.modal', '.gsearch-panel', '.asheet-group', '.asheet-btn.cancel'];
const SEL = [...CONTROLS, ...FLOATING, ...PANELS].join(', ');
const OVERLAY_SEL = [...FLOATING, ...PANELS].join(', ');
const PANEL_SEL = PANELS.join(', ');
const SCRIM_SEL = '.modal-bg, .sheet-bg, .asheet-bg, .gsearch-bg';
// handled by the library itself (src/liquidglass.js) or not glass in this context
const SKIP_SEL = '.lgl, .lgl *, .chat.term *';
const MAX_ACTIVE = 18;
const PAD = SHADOW_PAD; // the shader draws the drop shadow in this margin around the element
const MOVE_GAP = 90; // ms between re-renders while an element is moving (sheet slide-in...)

// Big panels carry text: a bit more blur and a faint tint (in CSS, --lgx-panel-tint) keep it legible.
const PANEL_EXTRA = { light: { blurAmount: 1 }, dark: { blurAmount: 1 } };

let renderer = null;
let scene = null, sceneCtx = null;
const glasses = new Map(); // el -> state
let raf = 0, idle = 0, enabled = false;

const vis = (el) => {
  if (!el.isConnected || !el.offsetParent && getComputedStyle(el).position !== 'fixed') return false;
  const r = el.getBoundingClientRect();
  return r.width > 2 && r.height > 2 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
};

function configFor(el, st) {
  const theme = isDark() ? 'dark' : 'light';
  const cs = getComputedStyle(el);
  const w = el.offsetWidth, h = el.offsetHeight;
  const r = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, w / 2, h / 2);
  return {
    ...DEFAULTS, ...PRESETS[theme], ...(st.panel ? PANEL_EXTRA[theme] : {}),
    cornerRadius: r, zRadius: Math.min(40, Math.max(r, 8)),
  };
}

// the scroller behind el: walk the hit-test stack under the element (ignoring el, its subtree and its
// ancestors) and take the first scrolling ancestor of what is underneath
function findScroller(el) {
  const r = el.getBoundingClientRect();
  const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + r.width / 2, Math.min(innerHeight - 1, r.bottom + 4)]];
  for (const [x, y] of pts) {
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
    for (const hit of document.elementsFromPoint(x, y)) {
      if (el.contains(hit) || hit.contains(el)) continue;
      for (let n = hit; n && n !== document.body; n = n.parentElement) {
        if (n.contains(el)) break;
        if (overflowScrolls(n)) return n;
      }
    }
  }
  return null;
}

function attach(el) {
  const canvas = document.createElement('canvas');
  canvas.className = 'lgx-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const st = {
    el, canvas, ctx: canvas.getContext('2d'), S: null, rect: null, size: '', dirty: true, last: 0,
    overlay: el.matches(OVERLAY_SEL) || !!el.closest(OVERLAY_SEL),
    panel: el.matches(PANEL_SEL),
    staticPos: getComputedStyle(el).position === 'static',
    depth: 0,
  };
  for (let n = el.parentElement; n; n = n.parentElement) st.depth++;
  if (st.staticPos) el.style.position = 'relative';
  el.classList.add('lgx');
  if (st.panel) el.classList.add('lgx-panel');
  el.appendChild(canvas);
  st.S = findScroller(el);
  st.onScroll = () => { canvas.style.transform = `translate(${el.scrollLeft}px, ${el.scrollTop}px)`; };
  if (overflowScrolls(el)) el.addEventListener('scroll', st.onScroll, { passive: true });
  glasses.set(el, st);
}

function detach(el) {
  const st = glasses.get(el);
  if (!st) return;
  glasses.delete(el);
  st.canvas.remove();
  el.removeEventListener('scroll', st.onScroll);
  el.classList.remove('lgx', 'lgx-panel');
  if (st.staticPos) el.style.removeProperty('position');
}

// ---- scene + shading ----
function scrimColor() {
  for (const s of document.querySelectorAll(SCRIM_SEL)) {
    if (!s.isConnected || !s.getClientRects().length) continue;
    const c = getComputedStyle(s).backgroundColor;
    const op = parseFloat(getComputedStyle(s).opacity);
    if (c && !/rgba\(.*,\s*0\)|transparent/.test(c)) return { c, op: isNaN(op) ? 1 : op };
  }
  return null;
}
let bgColor = '';
function pageBg() {
  if (!bgColor) {
    const b = getComputedStyle(document.body).backgroundColor;
    bgColor = /rgba\(.*,\s*0\)|transparent/.test(b) ? getComputedStyle(document.documentElement).backgroundColor : b;
    if (!bgColor || /rgba\(.*,\s*0\)|transparent/.test(bgColor)) bgColor = isDark() ? '#000' : '#f2f2f7';
  }
  return bgColor;
}

function render(st) {
  const { el, canvas } = st;
  const k = window.devicePixelRatio || 1;
  const w = el.offsetWidth, h = el.offsetHeight;
  const r = el.getBoundingClientRect();
  const W = Math.round((w + PAD * 2) * k), H = Math.round((h + PAD * 2) * k);
  if (W <= 0 || H <= 0) return;
  // scene origin (viewport px) = top-left of the padded element box
  const ox = r.left + (r.width - w) / 2 - PAD, oy = r.top + (r.height - h) / 2 - PAD;
  if (scene.width < W || scene.height < H) { scene.width = Math.max(scene.width, W); scene.height = Math.max(scene.height, H); }
  const ctx = sceneCtx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = pageBg();
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
  if (st.S?.isConnected) drawItems(st.S, ctx, 0, 0, ox, oy, oy, oy + h + PAD * 2);
  // glass below this one: library canvases (composer/dock) and engine canvases
  const below = [];
  document.querySelectorAll('.lgl > canvas').forEach((c) => { if (!el.contains(c) && st.overlay) below.push(c); });
  for (const o of glasses.values()) {
    if (o === st || el.contains(o.el) || !o.drawn) continue;
    if (o.el.contains(el) || (st.overlay && !o.overlay)) below.push(o.canvas);
  }
  for (const c of below) {
    const cr = c.getBoundingClientRect();
    if (cr.right < ox || cr.bottom < oy || cr.left > ox + w + PAD * 2 || cr.top > oy + h + PAD * 2 || !c.width) continue;
    ctx.drawImage(c, (cr.left - ox) * k, (cr.top - oy) * k, cr.width * k, cr.height * k);
  }
  if (st.overlay) {
    const s = scrimColor();
    if (s) { ctx.globalAlpha = s.op; ctx.fillStyle = s.c; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  }
  ctx.restore();

  const cfg = configFor(el, st);
  renderer.uploadAndBlur(scene, 0, 0, W, H, cfg.blurAmount);
  renderer.clear();
  renderer.renderGlassPanel(cfg, w, h, k);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const out = st.ctx;
  out.clearRect(0, 0, W, H);
  out.drawImage(renderer.canvas, 0, 0, W, H, 0, 0, W, H);
  st.drawn = true;
  st.last = performance.now();
  st.dirty = false;
}

function frame() {
  raf = 0;
  if (!enabled || document.hidden) return;
  let any = false;
  // outer glass first, page chrome before overlays: what a glass refracts is already up to date
  const list = [...glasses.values()].sort((a, b) => (a.overlay - b.overlay) || (a.depth - b.depth));
  const now = performance.now();
  for (const st of list) {
    if (!st.el.isConnected) { detach(st.el); continue; }
    if (st.canvas.parentElement !== st.el) { st.el.appendChild(st.canvas); st.dirty = true; } // React replaced the text content
    const r = st.el.getBoundingClientRect();
    const key = `${Math.round(r.left)},${Math.round(r.top)},${st.el.offsetWidth},${st.el.offsetHeight}`;
    if (key !== st.size) {
      const resized = st.size.split(',').slice(2).join() !== key.split(',').slice(2).join();
      st.size = key;
      // moving (slide-in, press scale): the canvas moves with the element; re-shade at most every MOVE_GAP
      if (resized || now - st.last > MOVE_GAP) st.dirty = true; else { any = true; st.pendingMove = true; }
    } else if (st.pendingMove) { st.pendingMove = false; st.dirty = true; }
    if (st.dirty) {
      try { render(st); } catch (err) { console.warn('liquidglass: render failed', err); st.dirty = false; }
      any = true;
    }
  }
  idle = any ? 0 : idle + 1;
  if (idle < 20) raf = requestAnimationFrame(frame); // keep watching positions for a few frames
}
function wake() { idle = 0; if (!raf && enabled) raf = requestAnimationFrame(frame); }
function markAll() { for (const st of glasses.values()) st.dirty = true; wake(); }

// ---- discovery ----
function scan() {
  const on = shouldUseLib();
  if (on !== enabled) {
    enabled = on;
    document.documentElement.classList.toggle('lgx-on', on);
    if (on && !renderer) {
      try {
        renderer = new GlassRenderer();
        scene = document.createElement('canvas');
        sceneCtx = scene.getContext('2d', { willReadFrequently: false });
      } catch (err) { console.warn('liquidglass: WebGL renderer unavailable, keeping CSS glass', err); enabled = false; document.documentElement.classList.remove('lgx-on'); }
    }
  }
  if (!enabled) { [...glasses.keys()].forEach(detach); return; }
  capDevicePixelRatio();
  for (const [el] of glasses) if (!vis(el) || el.matches(SKIP_SEL)) detach(el);
  const cand = [];
  document.querySelectorAll(SEL).forEach((el) => {
    if (glasses.has(el) || el.matches(SKIP_SEL) || !vis(el)) return;
    cand.push(el);
  });
  // overlays first (they are what the user is looking at), then the larger controls
  cand.sort((a, b) => (b.matches(OVERLAY_SEL) - a.matches(OVERLAY_SEL)) || (b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight));
  for (const el of cand) {
    if (glasses.size >= MAX_ACTIVE) break;
    attach(el);
  }
  for (const st of glasses.values()) { const S = findScroller(st.el); if (S !== st.S) { st.S = S; st.dirty = true; } }
  wake();
}

export function getEngineStats() {
  return { active: glasses.size, els: [...glasses.values()].map((s) => s.el.className.split(' ')[0] + (s.S ? '>' + s.S.className.split(' ')[0] : '')) };
}

export function initLiquidGlassEngine() {
  if (typeof window === 'undefined') return;
  let q = 0;
  const queue = (ms = 120) => { if (!q) q = setTimeout(() => { q = 0; scan(); }, ms); };
  new MutationObserver((list) => {
    let structural = false;
    for (const m of list) {
      const t = m.target;
      if (m.type === 'childList' || m.attributeName === 'class') structural = true;
      // content changed inside a scroller that some glass refracts: re-capture that item only
      for (const st of glasses.values()) if (st.S && st.S.contains(t) && t !== st.S) { markItemDirty(t, st.S); break; }
    }
    if (structural) queue();
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'open', 'hidden'] });
  document.addEventListener('scroll', (e) => {
    const t = e.target === document ? document.scrollingElement : e.target;
    for (const st of glasses.values()) if (st.S && (t === st.S || t.contains?.(st.S))) st.dirty = true;
    wake();
    queue(250); // elements scrolled into / out of view
  }, { capture: true, passive: true });
  onItemLanded((item) => { for (const st of glasses.values()) if (st.S?.contains(item)) st.dirty = true; wake(); });
  window.addEventListener('resize', () => { bgColor = ''; markAll(); queue(); }, { passive: true });
  const retheme = () => { bgColor = ''; markAll(); queue(); };
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  ['(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce)', '(prefers-contrast: more)', '(prefers-reduced-transparency: reduce)']
    .forEach((m) => window.matchMedia(m).addEventListener?.('change', retheme));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) markAll(); });
  document.addEventListener('transitionend', wake, { passive: true });
  document.addEventListener('animationend', wake, { passive: true });
  window.__lgx = { stats: getEngineStats, glasses };
  queue(300);
}
