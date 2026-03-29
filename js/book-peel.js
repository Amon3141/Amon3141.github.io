/**
 * Corner-peel page transition between #page-home and #page-projects.
 * Tweak SHADOW_MAX, ANIM_MS / ANIM_MS_REVERT for feel; commit threshold in shouldCommitPeel.
 */

/** Max warm overlay alpha on the page underneath (slightly off-white, not gray). */
const SHADOW_MAX = 0.045;
const ANIM_MS = 420;
const ANIM_MS_REVERT = 380;

const isTouchLike =
  typeof window !== 'undefined' &&
  (window.matchMedia('(pointer: coarse)').matches ||
    window.matchMedia('(max-width: 640px)').matches);

/** Default peel inset / revert target; must match .page-peel width & height in global.css. */
const PEEL_CORNER_PX = 80;
const ANIM_MS_MOBILE = 300;
const ANIM_MS_REVERT_MOBILE = 260;

/** Perpendicular bisector of segment C–P: f(x,y) = |X-C|² - |X-P|² = a x + b y + c (linear). */
function bisectorCoeffsForCorners(Cx, Cy, px, py) {
  const a = 2 * (px - Cx);
  const b = 2 * (py - Cy);
  const c = Cx * Cx + Cy * Cy - px * px - py * py;
  return { a, b, c };
}

function valuePlane(x, y, a, b, c) {
  return a * x + b * y + c;
}

/** Axis-aligned rectangle ∩ half-plane (a x + b y + c >= 0 if keepPositive). */
function clipRectHalfPlane(W, H, a, b, c, keepPositive) {
  const inside = (x, y) => {
    const v = valuePlane(x, y, a, b, c);
    return keepPositive ? v >= -1e-6 : v <= 1e-6;
  };

  const corners = [
    { x: 0, y: 0 },
    { x: W, y: 0 },
    { x: W, y: H },
    { x: 0, y: H }
  ];

  const pts = [];
  const pushPt = (p) => {
    for (const q of pts) {
      if (Math.hypot(p.x - q.x, p.y - q.y) < 1e-4) return;
    }
    pts.push(p);
  };

  for (const p of corners) {
    if (inside(p.x, p.y)) pushPt({ ...p });
  }

  for (let i = 0; i < 4; i++) {
    const p1 = corners[i];
    const p2 = corners[(i + 1) % 4];
    const v1 = valuePlane(p1.x, p1.y, a, b, c);
    const v2 = valuePlane(p2.x, p2.y, a, b, c);
    if (v1 * v2 < 0) {
      const denom = v1 - v2;
      if (Math.abs(denom) < 1e-12) continue;
      const t = v1 / denom;
      pushPt({ x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) });
    }
  }

  if (pts.length < 3) return [];

  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= pts.length;
  cy /= pts.length;

  pts.sort((p, q) => {
    return Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx);
  });

  return pts;
}

function polygonToClipPathPercent(poly, W, H) {
  if (poly.length < 3) return 'none';
  const pts = poly
    .map((p) => `${(p.x / W) * 100}% ${(p.y / H) * 100}%`)
    .join(', ');
  return `polygon(${pts})`;
}

function polygonToSvgPoints(poly) {
  return poly.map((p) => `${p.x},${p.y}`).join(' ');
}

function polygonArea(poly) {
  if (poly.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    s += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return Math.abs(s) / 2;
}

/** 0 = just starting peel (under page still in shadow), 1 = almost fully revealed (white). */
function getPeelProgressFromFlap(flap, W, H) {
  if (flap.length < 3) return 1;
  const a = polygonArea(flap);
  const half = (W * H) / 2;
  return Math.min(1, (a / half) * 1.05);
}

function getVisiblePolygon(W, H, Cx, Cy, px, py) {
  const { a, b, c } = bisectorCoeffsForCorners(Cx, Cy, px, py);
  return clipRectHalfPlane(W, H, a, b, c, true);
}

function getFlapPolygon(W, H, Cx, Cy, px, py) {
  const { a, b, c } = bisectorCoeffsForCorners(Cx, Cy, px, py);
  const poly = clipRectHalfPlane(W, H, a, b, c, false);

  const denom = a * a + b * b;
  if (denom < 1e-12) return poly;

  return poly.map((pt) => {
    const v = a * pt.x + b * pt.y + c;
    return {
      x: pt.x - (2 * a * v) / denom,
      y: pt.y - (2 * b * v) / denom
    };
  });
}

export function initBookPeel() {
  const book = document.getElementById('book');
  const pageHome = document.getElementById('page-home');
  const pageProjects = document.getElementById('page-projects');
  const foldOverlay = document.getElementById('fold-overlay');
  const foldPoly = document.getElementById('fold-poly');
  const foldSvg = document.getElementById('fold-svg');
  const btnForward = document.getElementById('peel-forward');
  const btnBack = document.getElementById('peel-back');

  if (!book || !pageHome || !pageProjects || !foldOverlay || !foldPoly || !foldSvg || !btnForward || !btnBack) {
    console.warn('book-peel: missing required DOM nodes');
    return { getAnimating: () => false, getState: () => null };
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let state = 'home';
  let drag = null;
  let activePointerId = null;
  let animating = false;
  let animFrame = null;
  let animStart = 0;
  let animFrom = null;
  let animTo = null;
  let animOnDone = null;

  function updatePeelBusyClass() {
    const busy = drag != null || animating;
    book.classList.toggle('is-peel-busy', busy);
  }

  function cancelPendingPointerPeel() {
    if (drag && drag.peelRaf != null) {
      cancelAnimationFrame(drag.peelRaf);
      drag.peelRaf = null;
    }
  }

  function setStack() {
    if (state === 'home') {
      pageHome.style.zIndex = '3';
      pageProjects.style.zIndex = '1';
      pageHome.hidden = false;
      pageProjects.hidden = false;
      btnForward.style.display = '';
      btnBack.style.display = 'none';
    } else {
      pageProjects.style.zIndex = '3';
      pageHome.style.zIndex = '1';
      pageHome.hidden = false;
      pageProjects.hidden = false;
      btnForward.style.display = 'none';
      btnBack.style.display = '';
    }
  }

  function clearShadeBoth() {
    pageHome.style.setProperty('--peel-shadow', '0');
    pageProjects.style.setProperty('--peel-shadow', '0');
  }

  function applyDefaultPeel() {
    if (reducedMotion) {
      pageHome.style.clipPath = '';
      pageProjects.style.clipPath = '';
      foldOverlay.classList.remove('is-visible');
      book.classList.remove('is-peeling');
      clearShadeBoth();
      return;
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    book.classList.remove('is-peeling');
    const s = PEEL_CORNER_PX;
    if (state === 'home') {
      pageProjects.style.clipPath = '';
      applyPeel(W, H, pageHome, W, 0, W - s, s, 'forward');
    } else {
      pageHome.style.clipPath = '';
      applyPeel(W, H, pageProjects, W, 0, W - s, s, 'back');
    }
  }

  function acceleratePointer(Cx, Cy, px, py, W, H) {
    let dx = px - Cx;
    let dy = py - Cy;
    const dist0 = Math.hypot(dx, dy);
    if (dist0 < 1e-6) {
      const n = nudgeFromCorner(Cx, Cy, px, py);
      dx = n.px - Cx;
      dy = n.py - Cy;
    }
    const baseBoost = 1.8;
    const ref = Math.min(W, H) * 0.42;
    const closeness = Math.max(0, 1 - Math.hypot(dx, dy) / ref);
    const boost = baseBoost + 1.2 * closeness;
    let npx = Cx + dx * boost;
    let npy = Cy + dy * boost;
    npx = Math.max(-W * 1.5, Math.min(W * 2.5, npx));
    npy = Math.max(-H * 1.5, Math.min(H * 2.5, npy));
    return { px: npx, py: npy };
  }

  function nudgeFromCorner(Cx, Cy, px, py) {
    const EPS = 10;
    let dx = px - Cx;
    let dy = py - Cy;
    if (Math.hypot(dx, dy) < EPS) {
      if (Math.hypot(dx, dy) < 1e-6) {
        dx = Cx === 0 ? 1 : -1;
        dy = 1;
      }
      const len = Math.hypot(dx, dy);
      return {
        px: Cx + (dx / len) * EPS,
        py: Cy + (dy / len) * EPS
      };
    }
    return { px, py };
  }

  function applyPeel(W, H, topEl, Cx, Cy, px, py, mode) {
    const n = nudgeFromCorner(Cx, Cy, px, py);
    px = n.px;
    py = n.py;
    const vis = getVisiblePolygon(W, H, Cx, Cy, px, py);
    const flap = getFlapPolygon(W, H, Cx, Cy, px, py);
    clearShadeBoth();
    if (vis.length < 3) {
      topEl.style.clipPath = 'inset(50% 50% 50% 50%)';
    } else {
      topEl.style.clipPath = polygonToClipPathPercent(vis, W, H);
    }
    const bottomEl = mode === 'forward' ? pageProjects : pageHome;
    if (flap.length >= 3) {
      foldPoly.setAttribute('points', polygonToSvgPoints(flap));
      foldOverlay.classList.add('is-visible');
      const pr = getPeelProgressFromFlap(flap, W, H);
      bottomEl.style.setProperty('--peel-shadow', String((1 - pr) * SHADOW_MAX));
    } else {
      foldOverlay.classList.remove('is-visible');
      bottomEl.style.setProperty('--peel-shadow', '0');
    }
  }

  function applyPeelFromClient(mode, clientX, clientY) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const Cx = W;
    const Cy = 0;
    const acc = acceleratePointer(Cx, Cy, clientX, clientY, W, H);
    const topEl = mode === 'forward' ? pageHome : pageProjects;
    applyPeel(W, H, topEl, Cx, Cy, acc.px, acc.py, mode);
    return { px: acc.px, py: acc.py, W, H };
  }

  function peelProgressAtClient(mode, clientX, clientY) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const Cx = W;
    const Cy = 0;
    const acc = acceleratePointer(Cx, Cy, clientX, clientY, W, H);
    const n = nudgeFromCorner(Cx, Cy, acc.px, acc.py);
    const flap = getFlapPolygon(W, H, Cx, Cy, n.px, n.py);
    return getPeelProgressFromFlap(flap, W, H);
  }

  function shouldCommitPeel(mode, clientX, clientY, vx) {
    const VEL_THRESHOLD = 0.3;
    if (Math.abs(vx) > VEL_THRESHOLD) {
      return vx < -VEL_THRESHOLD;
    }
    return peelProgressAtClient(mode, clientX, clientY) > 0.5;
  }

  function startAnim(from, to, mode, onDone, durationMs = ANIM_MS) {
    if (!mode) return;
    cancelAnimationFrame(animFrame);
    animating = true;
    updatePeelBusyClass();
    animFrom = from;
    animTo = to;
    animOnDone = onDone;
    animStart = performance.now();
    const animDuration = durationMs;
    function tick(now) {
      const t = Math.min(1, (now - animStart) / animDuration);
      const e = 1 - Math.pow(1 - t, 3);
      const px = animFrom.px + (animTo.px - animFrom.px) * e;
      const py = animFrom.py + (animTo.py - animFrom.py) * e;
      const W = window.innerWidth;
      const H = window.innerHeight;
      if (mode === 'forward') {
        applyPeel(W, H, pageHome, W, 0, px, py, 'forward');
      } else if (mode === 'back') {
        applyPeel(W, H, pageProjects, W, 0, px, py, 'back');
      }
      if (t < 1) {
        animFrame = requestAnimationFrame(tick);
      } else {
        animating = false;
        updatePeelBusyClass();
        animOnDone && animOnDone();
        animOnDone = null;
      }
    }
    animFrame = requestAnimationFrame(tick);
  }

  function finishForward() {
    state = 'projects';
    setStack();
    applyDefaultPeel();
    drag = null;
  }

  function finishBack() {
    state = 'home';
    setStack();
    applyDefaultPeel();
    drag = null;
  }

  function attachGlobalPointerListeners() {
    window.addEventListener('pointermove', onGlobalPointerMove, true);
    window.addEventListener('pointerup', onGlobalPointerUp, true);
    window.addEventListener('pointercancel', onGlobalPointerUp, true);
  }

  function detachGlobalPointerListeners() {
    window.removeEventListener('pointermove', onGlobalPointerMove, true);
    window.removeEventListener('pointerup', onGlobalPointerUp, true);
    window.removeEventListener('pointercancel', onGlobalPointerUp, true);
    activePointerId = null;
  }

  function onGlobalPointerMove(e) {
    if (e.pointerId !== activePointerId || !drag || reducedMotion) return;
    e.preventDefault();

    const now = performance.now();
    const dt = now - (drag.lastTime || now);
    if (dt > 0) {
      drag.vx = (e.clientX - drag.lastClientX) / dt;
    }
    drag.lastTime = now;
    drag.lastClientX = e.clientX;
    drag.pendingClientX = e.clientX;
    drag.pendingClientY = e.clientY;

    if (drag.peelRaf != null) return;
    drag.peelRaf = requestAnimationFrame(() => {
      drag.peelRaf = null;
      if (!drag) return;
      const o = applyPeelFromClient(drag.mode, drag.pendingClientX, drag.pendingClientY);
      drag.lastPx = o.px;
      drag.lastPy = o.py;
    });
  }

  function onGlobalPointerUp(e) {
    if (e.pointerId !== activePointerId || !drag || reducedMotion) return;
    e.preventDefault();
    cancelPendingPointerPeel();
    const W = window.innerWidth;
    const H = window.innerHeight;
    const o = applyPeelFromClient(drag.mode, e.clientX, e.clientY);
    const px = o.px;
    const py = o.py;
    const mode = drag.mode;
    const from = { px: drag.lastPx ?? px, py: drag.lastPy ?? py };
    const vx = drag.vx || 0;

    try {
      (mode === 'forward' ? btnForward : btnBack).releasePointerCapture(e.pointerId);
    } catch (_) {}

    detachGlobalPointerListeners();
    book.classList.remove('is-peeling');
    drag = null;
    updatePeelBusyClass();

    const commit = shouldCommitPeel(mode, e.clientX, e.clientY, vx);
    const dur = isTouchLike ? ANIM_MS_MOBILE : ANIM_MS;
    const durRevert = isTouchLike ? ANIM_MS_REVERT_MOBILE : ANIM_MS_REVERT;

    if (mode === 'forward') {
      if (commit) {
        const end = { px: -W * 1.5, py: H * 0.92 };
        startAnim(from, end, 'forward', () => {
          finishForward();
        }, dur);
      } else {
        const corner = { px: W - PEEL_CORNER_PX, py: PEEL_CORNER_PX };
        startAnim(from, corner, 'forward', () => {
          applyDefaultPeel();
        }, durRevert);
      }
    } else if (commit) {
      const end = { px: -W * 1.5, py: H * 0.92 };
      startAnim(from, end, 'back', () => {
        finishBack();
      }, dur);
    } else {
      const corner = { px: W - PEEL_CORNER_PX, py: PEEL_CORNER_PX };
      startAnim(from, corner, 'back', () => {
        applyDefaultPeel();
      }, durRevert);
    }
  }

  function onPointerDown(e, mode) {
    if (reducedMotion) return;
    e.preventDefault();
    activePointerId = e.pointerId;
    book.classList.add('is-peeling');
    attachGlobalPointerListeners();
    const o = applyPeelFromClient(mode, e.clientX, e.clientY);
    drag = {
      mode,
      lastPx: o.px,
      lastPy: o.py,
      lastClientX: e.clientX,
      lastTime: performance.now(),
      vx: 0,
      pendingClientX: e.clientX,
      pendingClientY: e.clientY,
      peelRaf: null
    };
    updatePeelBusyClass();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) {}
  }

  function onResizeFoldSvg() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    foldSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    if (!drag && !animating) {
      applyDefaultPeel();
    }
  }

  setStack();
  onResizeFoldSvg();
  window.addEventListener('resize', onResizeFoldSvg);

  btnForward.addEventListener('pointerdown', (e) => {
    if (state !== 'home') return;
    onPointerDown(e, 'forward');
  });

  btnBack.addEventListener('pointerdown', (e) => {
    if (state !== 'projects') return;
    onPointerDown(e, 'back');
  });

  if (reducedMotion) {
    btnForward.hidden = true;
    btnBack.hidden = true;
    const bar = document.createElement('div');
    bar.id = 'rm-nav';
    bar.style.cssText =
      'position:fixed;top:0.65rem;left:50%;transform:translateX(-50%);z-index:30;font-size:0.9rem;color:var(--color-text-muted)';
    bar.innerHTML =
      '<a href="#" id="rm-show-home">Home</a> · <a href="#" id="rm-show-projects">Projects</a>';
    book.prepend(bar);
    document.getElementById('rm-show-home').addEventListener('click', (ev) => {
      ev.preventDefault();
      state = 'home';
      setStack();
    });
    document.getElementById('rm-show-projects').addEventListener('click', (ev) => {
      ev.preventDefault();
      state = 'projects';
      setStack();
    });
  }

  return {
    getAnimating: () => animating,
    getState: () => state
  };
}
