/**
 * Horizontal strip: viewport center drives target scale and side margins.
 * Targets are linear in distance from center; displayed values ease toward targets
 * each frame (lerp) so layout and scale don’t snap when the focused card changes.
 */

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

/** Side inset for the centered card; tighter on narrow viewports. */
function getPresentSideMarginPx() {
  const w = window.innerWidth;
  if (w <= 480) return 20;
  if (w <= 640) return 28;
  if (w <= 900) return 44;
  return 72;
}

export function initProjectGallery() {
  const root = document.getElementById('page-projects');
  const gallery = root?.querySelector('.project-gallery');
  const track = gallery?.querySelector('.project-gallery-track');
  if (!gallery || !track) return;

  const SCALE_SELECTED = 1.4;
  const SCALE_OTHER = 0.85;
  /** Per-frame smoothing; ~0.2 ≈ responsive without feeling mushy */
  const LERP = 0.22;
  const EPS_SCALE = 0.002;
  const EPS_MARGIN_PX = 0.6;
  const EPS_Z = 0.08;
  const CAPTION_EXIT_MS = 240;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const smoothed = new WeakMap();

  function getSmoothed(card) {
    let s = smoothed.get(card);
    if (!s) {
      s = { scale: SCALE_OTHER, margin: 0, zMix: 0 };
      smoothed.set(card, s);
    }
    return s;
  }

  let rafId = null;
  /** Request another frame after this one (scroll/resize during rAF, or lerp not settled). */
  let stale = false;
  let needsPadding = true;
  let lastFocusedCard = null;
  const captionsExitingTimers = new WeakMap();

  function clearCaptionsExitingTimer(card) {
    const t = captionsExitingTimers.get(card);
    if (t != null) {
      clearTimeout(t);
      captionsExitingTimers.delete(card);
    }
  }

  function updateCenterPadding() {
    const card = track.querySelector('.project-card');
    if (!card) return;
    const gw = gallery.clientWidth;
    const cw = card.offsetWidth;
    if (cw <= 0) return;

    const presentMargin = getPresentSideMarginPx();
    const pad = Math.max(0, (gw - cw) / 2 - presentMargin);
    track.style.paddingLeft = `${pad}px`;
    track.style.paddingRight = `${pad}px`;
  }

  function scheduleCaptionsFor(card) {
    if (!card) return;
    clearCaptionsExitingTimer(card);
    card.classList.remove('project-card--captions-exiting');
    card.classList.add('project-card--captions-visible');
  }

  /**
   * @returns {boolean} true if another animation frame is needed for lerp to settle
   */
  function tickTargets() {
    const cards = [...track.querySelectorAll('.project-card')];
    if (cards.length === 0) return false;

    const gr = gallery.getBoundingClientRect();
    const centerX = gr.left + gr.width * 0.5;
    const falloff = Math.max(gr.width * 0.58, 220);

    let best = cards[0];
    let bestDist = Infinity;

    for (const card of cards) {
      const r = card.getBoundingClientRect();
      const cx = r.left + r.width * 0.5;
      const dist = Math.abs(cx - centerX);
      if (dist < bestDist) {
        bestDist = dist;
        best = card;
      }
    }

    const presentMargin = getPresentSideMarginPx();
    let needsContinue = false;

    for (const card of cards) {
      const thumb = card.querySelector('.project-card__image');
      if (!thumb) continue;

      const r = card.getBoundingClientRect();
      const cx = r.left + r.width * 0.5;
      const dist = Math.abs(cx - centerX);
      const t = clamp01(dist / falloff);
      const targetScale = SCALE_SELECTED - t * (SCALE_SELECTED - SCALE_OTHER);
      const targetMargin = presentMargin * (1 - t);
      const targetZMix = 1 - t;

      const s = getSmoothed(card);

      if (reducedMotion) {
        s.scale = targetScale;
        s.margin = targetMargin;
        s.zMix = targetZMix;
      } else {
        s.scale += (targetScale - s.scale) * LERP;
        s.margin += (targetMargin - s.margin) * LERP;
        s.zMix += (targetZMix - s.zMix) * LERP;
        if (
          Math.abs(targetScale - s.scale) > EPS_SCALE ||
          Math.abs(targetMargin - s.margin) > EPS_MARGIN_PX ||
          Math.abs(targetZMix - s.zMix) > EPS_Z
        ) {
          needsContinue = true;
        }
      }

      thumb.style.transform = `scale(${s.scale})`;
      card.style.marginLeft = `${s.margin}px`;
      card.style.marginRight = `${s.margin}px`;
      card.style.zIndex = String(Math.round(38 + s.zMix * 22));

      const isPresent = card === best;
      card.classList.toggle('project-card--focused', isPresent);
      if (isPresent) {
        card.setAttribute('aria-current', 'true');
      } else {
        card.removeAttribute('aria-current');
      }
    }

    if (best !== lastFocusedCard) {
      const prev = lastFocusedCard;
      if (prev) {
        if (reducedMotion) {
          clearCaptionsExitingTimer(prev);
          prev.classList.remove('project-card--captions-exiting');
          prev.classList.remove('project-card--captions-visible');
        } else {
          prev.classList.remove('project-card--captions-visible');
          prev.classList.add('project-card--captions-exiting');
          clearCaptionsExitingTimer(prev);
          const tid = setTimeout(() => {
            captionsExitingTimers.delete(prev);
            prev.classList.remove('project-card--captions-exiting');
          }, CAPTION_EXIT_MS + 25);
          captionsExitingTimers.set(prev, tid);
        }
      }
      for (const c of cards) {
        if (c !== prev) {
          clearCaptionsExitingTimer(c);
          c.classList.remove('project-card--captions-visible');
          c.classList.remove('project-card--captions-exiting');
        }
      }
      lastFocusedCard = best;
      scheduleCaptionsFor(best);
    }

    return !reducedMotion && needsContinue;
  }

  function layoutGallery() {
    if (needsPadding) {
      updateCenterPadding();
      needsPadding = false;
    }
    return tickTargets();
  }

  function frame() {
    rafId = null;
    const continueLerp = layoutGallery();
    if (continueLerp) {
      rafId = requestAnimationFrame(frame);
      return;
    }
    if (stale) {
      stale = false;
      rafId = requestAnimationFrame(frame);
    }
  }

  function schedule(padding = false) {
    if (padding) needsPadding = true;
    stale = true;
    if (rafId === null) {
      rafId = requestAnimationFrame(frame);
    }
  }

  gallery.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) {
        schedule(false);
        return;
      }
      gallery.scrollLeft += e.deltaY;
      e.preventDefault();
      schedule(false);
    },
    { passive: false }
  );

  gallery.addEventListener('keydown', (e) => {
    const step = Math.min(gallery.clientWidth * 0.55, 360);
    if (e.key === 'ArrowRight') {
      gallery.scrollBy({ left: step, behavior: 'auto' });
      e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
      gallery.scrollBy({ left: -step, behavior: 'auto' });
      e.preventDefault();
    }
  });

  gallery.addEventListener('scroll', () => schedule(false), { passive: true });

  window.addEventListener('resize', () => schedule(true));

  const ro = new ResizeObserver(() => schedule(true));
  ro.observe(gallery);
  ro.observe(track);

  for (const img of track.querySelectorAll('img')) {
    if (!img.complete) {
      img.addEventListener('load', () => schedule(true), { once: true });
    }
  }

  needsPadding = true;
  schedule(false);
}
