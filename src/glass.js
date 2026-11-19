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
