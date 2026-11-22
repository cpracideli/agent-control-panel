// Interactive Liquid Glass: the highlight follows the pointer/finger and the dock swells while touched.
// Only elements that are actually tappable opt in. Performance: the element rect is measured once per
// press (or once per hover entry), moves are coalesced to one style write per animation frame, and
// touch moves are ignored unless a finger is down on a glass element.
const SEL = '.glass-btn, .dock-capsule';

let cur = null;      // { el, rect }
let pending = null;  // last pointer position waiting for the next frame
let raf = 0;
let held = null;

function flush() {
  raf = 0;
  if (!cur || !pending) return;
  const { el, rect } = cur;
  el.style.setProperty('--mx', `${pending.x - rect.left}px`);
  el.style.setProperty('--my', `${pending.y - rect.top}px`);
  pending = null;
}
function schedule(e) {
  pending = { x: e.clientX, y: e.clientY };
  if (!raf) raf = requestAnimationFrame(flush);
}
function target(e) { return e.target instanceof Element ? e.target.closest(SEL) : null; }

function onDown(e) {
  const el = target(e);
  if (!el) return;
  cur = { el, rect: el.getBoundingClientRect() };
  schedule(e);
  if (el.classList.contains('dock-capsule')) { held = el; el.classList.add('touching'); }
}
function onMove(e) {
  if (e.pointerType === 'mouse') {
    // hover: re-measure only when the pointer enters another glass element
    const el = target(e);
    if (!el) { cur = null; return; }
    if (!cur || cur.el !== el) cur = { el, rect: el.getBoundingClientRect() };
  } else if (!cur || !held) return; // touch/pen: only while pressing the dock
  schedule(e);
}
function release() {
  if (held) { held.classList.remove('touching'); held = null; }
  if (cur && cur.el && !cur.el.matches(':hover')) cur = null;
}

export function initGlass() {
  if (typeof window === 'undefined') return;
  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerdown', onDown, { passive: true });
  ['pointerup', 'pointercancel', 'blur'].forEach((t) => window.addEventListener(t, release, { passive: true }));
  // rects go stale when anything scrolls or resizes
  const drop = () => { if (!held) cur = null; };
  window.addEventListener('scroll', drop, { passive: true, capture: true });
  window.addEventListener('resize', drop, { passive: true });
}

// ---------------------------------------------------------------------------------------------
// Refraction (the "liquid" part of Liquid Glass).
// Apple's material is a lens, not frosted glass: the middle stays almost clear and the content
// bends near the rim, where the surface curves. We model each glass shape as a slab with a convex
// squircle bezel, trace a vertical ray through it with Snell's law (n = 1.5) and store how far the
// ray lands from where it entered as a displacement map (R = x, G = y). The map feeds an SVG
// feDisplacementMap used as a backdrop-filter. Only Chromium applies SVG filters in
// backdrop-filter; Safari/Firefox keep the clear CSS glass from styles.css.
// ---------------------------------------------------------------------------------------------
// Only the big, mostly static chrome refracts. Small glass buttons keep the clear CSS glass: on a phone
// a dozen SVG-filtered backdrops re-rendered on every scrolled frame was the main source of jank.
const REFRACT_SEL = '.dock-capsule, .composer, .head-capsule';
const N_GLASS = 1.5;
const NS = 'http://www.w3.org/2000/svg';

export function canRefract() {
  const ua = navigator.userAgent;
  return /Chrome\/|Chromium\/|Edg\//.test(ua) && !/iPhone|iPad|iPod/.test(ua);
}

const profile = (t) => Math.pow(1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 4), 0.25); // convex squircle

function sdfRoundRect(x, y, hw, hh, r) {
  const qx = Math.abs(x) - (hw - r), qy = Math.abs(y) - (hh - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

// Returns { url, scale } for a w x h shape with corner radius r and bezel width b.
const mapCache = new Map();
function displacementMap(w, h, r, b) {
  const key = [w, h, r, b].join('x');
  if (mapCache.has(key)) return mapCache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const hw = w / 2, hh = h / 2;
  // bend per bezel position: angle between the surface normal and the refracted ray
  const bend = (t) => {
    const e = 0.002;
    const slope = (profile(t + e) - profile(t - e)) / (2 * e); // height and bezel share units
    const a1 = Math.atan(slope);
    const a2 = Math.asin(Math.sin(a1) / N_GLASS);
    return Math.tan(a1 - a2);
  };
  const maxBend = bend(0.001) || 1;
  const maxPx = Math.max(4, b * 0.85);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hw, py = y + 0.5 - hh;
      const s = sdfRoundRect(px, py, hw, hh, r);
      let dx = 0, dy = 0;
      const depth = -s;
      if (depth > 0 && depth < b) {
        const m = bend(depth / b) / maxBend; // 1 at the rim, 0 on the flat top
        const gx = sdfRoundRect(px + 0.5, py, hw, hh, r) - sdfRoundRect(px - 0.5, py, hw, hh, r);
        const gy = sdfRoundRect(px, py + 0.5, hw, hh, r) - sdfRoundRect(px, py - 0.5, hw, hh, r);
        const gl = Math.hypot(gx, gy) || 1;
        dx = (-gx / gl) * m; dy = (-gy / gl) * m; // sample toward the centre, like a convex lens
      }
      const i = (y * w + x) * 4;
      d[i] = 128 + dx * 127; d[i + 1] = 128 + dy * 127; d[i + 2] = 128; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const out = { url: c.toDataURL(), scale: maxPx * 2 };
  if (mapCache.size > 40) mapCache.clear();
  mapCache.set(key, out);
  return out;
}

let svgRoot = null, seq = 0;
function filterFor(el) {
  const rect = el.getBoundingClientRect();
  const w = Math.round(rect.width), h = Math.round(rect.height);
  if (w < 8 || h < 8) return;
  const cs = getComputedStyle(el);
  const r = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, w / 2, h / 2);
  const b = Math.max(6, Math.min(22, Math.min(w, h) * 0.32));
  const sig = [w, h, Math.round(r), Math.round(b)].join(':');
  if (el.dataset.lgSig === sig) return;
  el.dataset.lgSig = sig;
  const { url, scale } = displacementMap(w, h, r, b);
  if (!svgRoot) {
    svgRoot = document.createElementNS(NS, 'svg');
    svgRoot.setAttribute('aria-hidden', 'true');
    svgRoot.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    document.body.appendChild(svgRoot);
  }
  let id = el.dataset.lgId;
  if (!id) { id = 'lg-' + (++seq); el.dataset.lgId = id; }
  let f = svgRoot.querySelector('#' + id);
  if (f) f.remove();
  f = document.createElementNS(NS, 'filter');
  f.id = id;
  for (const [k, v] of Object.entries({ x: 0, y: 0, width: w, height: h, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' })) f.setAttribute(k, v);
  // a single displacement pass: the old 3-channel dispersion (3 maps + 3 matrices + 2 blends) cost ~5x
  // more per frame for a fringe that is barely visible at phone pixel densities
  f.innerHTML = `
    <feImage href="${url}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>
    <feDisplacementMap in="SourceGraphic" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/>`;
  svgRoot.appendChild(f);
  el.dataset.lgFilter = `url(#${id}) blur(1.2px) saturate(165%) brightness(1.04)`;
  applyFilter(el);
}

// While anything scrolls or a screen/sheet transition runs, the content under the glass changes every
// frame and the SVG filter would be re-run each time. Fall back to the plain CSS glass meanwhile (same
// tint and rim, just no bent edge) and bring the lens back once things settle.
let paused = false;
const PLAIN = 'blur(5px) saturate(175%) brightness(1.06)';
function applyFilter(el) {
  const value = paused || !el.dataset.lgFilter ? PLAIN : el.dataset.lgFilter;
  el.style.setProperty('backdrop-filter', value, 'important');
  el.style.setProperty('-webkit-backdrop-filter', value, 'important');
}
function setPaused(p) {
  if (paused === p) return;
  paused = p;
  document.querySelectorAll('[data-lg-filter]').forEach(applyFilter);
}

export function initRefraction() {
  if (typeof window === 'undefined' || !canRefract()) return;
  if (window.matchMedia('(prefers-reduced-transparency: reduce)').matches) return;
  document.documentElement.classList.add('lg-refract');
  const pending = new Set();
  let raf = 0;
  const flush = () => { raf = 0; pending.forEach((el) => el.isConnected && filterFor(el)); pending.clear(); };
  const queue = (el) => { pending.add(el); if (!raf) raf = requestAnimationFrame(flush); };
  const ro = new ResizeObserver((entries) => entries.forEach((e) => queue(e.target)));
  const seen = new WeakSet();
  const scan = () => document.querySelectorAll(REFRACT_SEL).forEach((el) => { if (!seen.has(el)) { seen.add(el); ro.observe(el); queue(el); } });
  let scanQueued = false;
  new MutationObserver(() => {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => { scanQueued = false; scan(); });
  }).observe(document.body, { childList: true, subtree: true });
  scan();

  let idle = 0;
  const busy = () => { setPaused(true); clearTimeout(idle); idle = setTimeout(() => setPaused(false), 220); };
  window.addEventListener('scroll', busy, { passive: true, capture: true });
  window.addEventListener('touchmove', busy, { passive: true });
  document.addEventListener('animationstart', busy, true);
  document.addEventListener('transitionrun', (e) => { if (e.propertyName === 'transform') busy(); }, true);
}
