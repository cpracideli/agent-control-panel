// Interactive Liquid Glass: the highlight follows the pointer/finger and the
// dock swells while touched. Only elements that are actually tappable opt in.
const SEL = '.glass-btn, .dock-capsule';

function track(e) {
  const el = e.target instanceof Element ? e.target.closest(SEL) : null;
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${e.clientX - r.left}px`);
  el.style.setProperty('--my', `${e.clientY - r.top}px`);
  return el;
}

let held = null;
function release() { if (held) { held.classList.remove('touching'); held = null; } }

export function initGlass() {
  if (typeof window === 'undefined') return;
  document.addEventListener('pointermove', track, { passive: true });
  document.addEventListener('pointerdown', (e) => {
    const el = track(e);
    if (el && el.classList.contains('dock-capsule')) { held = el; el.classList.add('touching'); }
  }, { passive: true });
  ['pointerup', 'pointercancel', 'blur'].forEach((t) => window.addEventListener(t, release, { passive: true }));
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
const REFRACT_SEL = '.dock-capsule, .composer, .head-capsule, .glass-btn, .chat-head .nav-btn';
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
  // the edge also splits colours a little (dispersion): red bends a bit less than blue
  f.innerHTML = `
    <feImage href="${url}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>
    <feDisplacementMap in="SourceGraphic" in2="map" scale="${scale * 0.92}" xChannelSelector="R" yChannelSelector="G" result="r"/>
    <feDisplacementMap in="SourceGraphic" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="g"/>
    <feDisplacementMap in="SourceGraphic" in2="map" scale="${scale * 1.08}" xChannelSelector="R" yChannelSelector="G" result="b"/>
    <feColorMatrix in="r" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="rr"/>
    <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="gg"/>
    <feColorMatrix in="b" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="bb"/>
    <feBlend in="rr" in2="gg" mode="screen" result="rg"/>
    <feBlend in="rg" in2="bb" mode="screen"/>`;
  svgRoot.appendChild(f);
  const value = `url(#${id}) blur(1.2px) saturate(165%) brightness(1.04)`;
  el.style.setProperty('backdrop-filter', value, 'important');
  el.style.setProperty('-webkit-backdrop-filter', value, 'important');
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
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();
}
