/**
 * Three.js embed: matches index.html materials, camera, mixer, fold lerp.
 * Transparent canvas. Fold scrub only over the widget; band math uses the same
 * coefficients as index.html (0.2, 0.1) for X / top margin; Y span is widened here
 * so fold progress stays behind the cursor slightly (less gain per pixel).
 */

const THREE_URL = 'https://unpkg.com/three@0.160.0/build/three.module.js';
const GLTF_LOADER_URL = 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

const PAPER_COLOR = 0xeeeeee;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clipDurationFromTracks(clip) {
  let max = 0;
  for (let i = 0; i < clip.tracks.length; i++) {
    const tr = clip.tracks[i];
    if (tr.times && tr.times.length > 0) {
      const end = tr.times[tr.times.length - 1];
      if (end > max) max = end;
    }
  }
  return max;
}

/**
 * @param {HTMLElement} container
 */
export async function initHomeOrigami(container) {
  if (!container) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const glbUrl = new URL('../assets/origami.glb', import.meta.url).href;

  if (reducedMotion) {
    container.classList.add('is-reduced');
    container.textContent =
      'Fold animation is off when reduced motion is requested.';
    return;
  }

  const THREE = await import(THREE_URL);
  const { GLTFLoader } = await import(GLTF_LOADER_URL);

  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 3);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  const light = new THREE.DirectionalLight(0xffffff, 0.5);
  light.position.set(2, 2, 2);
  scene.add(light);
  light.castShadow = true;

  let mixer = null;
  let clipAction = null;
  let clipDuration = 0;
  const clock = new THREE.Clock();

  let currentT = 0;
  /** Lerp toward pointer while interacting */
  const lerpFactorActive = 0.08;
  /** Ease back to flat after the idle delay (end of ramp) */
  const lerpFactorReset = 0.014;
  /** First frames of return: very gentle so motion eases in, then ramps to lerpFactorReset */
  const returnLerpStart = 0.0022;
  const returnLerpRampMs = 1100;
  const centerBandX = 0.2;

  /** Top inset and vertical span for mapping pointer Y → fold t (larger span = less progress per px) */
  const marginYTopFrac = 0.1;
  const yBandHeightFrac = 0.55;
  /** Extra damp on mapped t so the model does not read “ahead” of the cursor */
  const pointerProgressGain = 0.88;

  const RESET_DELAY_MIN_MS = 500;
  const RESET_DELAY_MAX_MS = 1000;

  let pointerInBand = false;
  let lastInteractiveT = 0;
  let wasInBand = false;

  /** @type {null | 'hold' | 'return'} */
  let resetPhase = null;
  let resetHoldUntil = 0;
  let resetHoldT = 0;
  let resetReturnStartedAt = 0;

  function scheduleResetHold(holdT) {
    resetPhase = 'hold';
    resetHoldT = holdT;
    const span = RESET_DELAY_MAX_MS - RESET_DELAY_MIN_MS;
    resetHoldUntil = performance.now() + RESET_DELAY_MIN_MS + Math.random() * span;
  }

  function cancelDelayedReset() {
    resetPhase = null;
  }

  function updatePointerFoldTarget(clientX, clientY) {
    const r = container.getBoundingClientRect();
    const outside =
      clientX < r.left ||
      clientX > r.right ||
      clientY < r.top ||
      clientY > r.bottom;

    let inBand = false;
    let t = 0;

    if (!outside) {
      const marginX = (r.width * (1 - centerBandX)) / 2;
      const innerLeft = r.left + marginX;
      const innerRight = r.right - marginX;
      if (clientX >= innerLeft && clientX <= innerRight) {
        const marginYStart = r.top + r.height * marginYTopFrac;
        const yInBand =
          ((clientY - marginYStart) / (r.height * yBandHeightFrac)) * pointerProgressGain;
        t = Math.max(0, Math.min(1, yInBand));
        inBand = true;
      }
    }

    if (inBand) {
      lastInteractiveT = t;
      pointerInBand = true;
      if (!wasInBand) {
        cancelDelayedReset();
      }
      wasInBand = true;
    } else {
      if (wasInBand) {
        scheduleResetHold(lastInteractiveT);
      }
      wasInBand = false;
      pointerInBand = false;
    }
  }

  document.addEventListener(
    'mousemove',
    (e) => {
      updatePointerFoldTarget(e.clientX, e.clientY);
    },
    { passive: true }
  );

  container.addEventListener('pointerleave', () => {
    if (wasInBand) {
      scheduleResetHold(lastInteractiveT);
    }
    wasInBand = false;
    pointerInBand = false;
  });

  function resizeRenderer() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  const ro = new ResizeObserver(resizeRenderer);
  ro.observe(container);
  requestAnimationFrame(() => {
    resizeRenderer();
    requestAnimationFrame(resizeRenderer);
  });

  const loader = new GLTFLoader();
  loader.load(
    glbUrl,
    (gltf) => {
      gltf.scene.traverse((child) => {
        if (child.isMesh) {
          const mat = new THREE.MeshStandardMaterial({
            color: PAPER_COLOR,
            roughness: 1,
            metalness: 0
          });
          if (child.isSkinnedMesh) {
            mat.skinning = true;
          }
          if (child.morphTargetDictionary && Object.keys(child.morphTargetDictionary).length > 0) {
            mat.morphTargets = true;
            mat.morphNormals = true;
          }
          child.material = mat;
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      scene.add(gltf.scene);

      if (gltf.animations && gltf.animations.length > 0) {
        const clip = gltf.animations[0];
        clipDuration = clip.duration;
        if (!clipDuration || clipDuration <= 0) {
          clipDuration = clipDurationFromTracks(clip) || 1;
        }
        mixer = new THREE.AnimationMixer(gltf.scene);
        clipAction = mixer.clipAction(clip);
        clipAction.setLoop(THREE.LoopOnce, 1);
        clipAction.clampWhenFinished = true;
        clipAction.play();
        clipAction.paused = true;
      }

      const box = new THREE.Box3().setFromObject(gltf.scene);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      gltf.scene.position.sub(center);
      gltf.scene.rotation.y = -Math.PI / 2;
      const maxDim = Math.max(size.x, size.y, size.z);
      const distance = Math.max(maxDim * 2, 2);
      camera.position.set(0, distance, 0);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      resizeRenderer();
    },
    undefined,
    (err) => {
      console.error(err);
      container.classList.add('is-reduced');
      container.innerHTML = '';
      container.textContent =
        'Could not load origami preview. Serve the site from the repo root (e.g. python3 -m http.server) so origami.glb resolves.';
    }
  );

  function onWindowResize() {
    resizeRenderer();
  }
  window.addEventListener('resize', onWindowResize);

  function animate() {
    requestAnimationFrame(animate);
    clock.getDelta();
    if (mixer && clipAction && clipDuration > 0) {
      let foldTarget = 0;
      let factor = lerpFactorActive;

      if (pointerInBand) {
        foldTarget = lastInteractiveT;
        factor = lerpFactorActive;
      } else if (resetPhase === 'hold') {
        if (performance.now() < resetHoldUntil) {
          foldTarget = resetHoldT;
          factor = lerpFactorActive;
        } else {
          resetPhase = 'return';
          resetReturnStartedAt = performance.now();
        }
      }

      if (!pointerInBand && resetPhase === 'return') {
        foldTarget = 0;
        const rampU = Math.min(
          1,
          (performance.now() - resetReturnStartedAt) / returnLerpRampMs
        );
        const smoothRamp = rampU * rampU * (3 - 2 * rampU);
        factor = lerp(returnLerpStart, lerpFactorReset, smoothRamp);
        if (currentT < 0.004) {
          currentT = 0;
          resetPhase = null;
        }
      } else if (!pointerInBand && resetPhase === null) {
        foldTarget = 0;
        factor = lerpFactorReset;
      }

      currentT = lerp(currentT, foldTarget, factor);
      clipAction.time = currentT * clipDuration;
      mixer.update(0);
    }
    renderer.render(scene, camera);
  }
  animate();
}
