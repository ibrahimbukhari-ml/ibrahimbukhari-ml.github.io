// Shared engine for the scroll-driven 3D stories.
// A story supplies particle layouts per stage, camera keyframes and overlays; the engine handles
// scroll -> stage, blending between stages, camera framing, theme, input and the render loop.
// A page can hold several chapters (e.g. one per job) on one canvas; switching flies the particles
// and the camera from one chapter to the next.
// Text lives in its own column and never moves; only the scene and camera do.
import * as THREE from 'three';

export { THREE };
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const bump = (v, c, w) => smooth(0, 1, 1 - Math.abs(v - c) / w);
// Piecewise-linear value per stage, e.g. lerpStages(v, [1, 0.5, 0.6, 0, 0])
export function lerpStages(v, vals) {
  const k = clamp(Math.floor(v), 0, vals.length - 2), f = clamp(v - k, 0, 1);
  return vals[k] + (vals[k + 1] - vals[k]) * f;
}

const root = document.documentElement;
const FLIGHT = 1.8; // seconds for a chapter switch

/**
 * A chapter: { keys, build, offset?, rail? }
 *   keys    one camera keyframe per stage {dir, look, r}; r = radius to keep in frame
 *   build   (ctx) => { stages: ((out, t) => void)[], update?(v, t), sizeAt?(v), yaw?(v, t) }
 *           ctx.tint is the chapter's own per-particle colour (0 accent .. 1 accent-2); call ctx.markTint() after changing it
 *           stages write positions local to the chapter; overlays go in ctx.world (the chapter's group)
 *   offset  where the chapter sits in the shared world (default origin)
 *   rail    optional [[label, sublabel], ...] to render into .rail when the chapter is shown
 *
 * @param {object} def
 * @param {[number, number]} def.count  particle count [desktop, phone]
 * @param {() => Promise<any>} [def.load]  optional async data, handed to builders as ctx.data
 * @param {object} [def.chapters]  {id: chapter}; or give keys + build for a single-chapter page
 * @param {string} [def.initial]  first chapter id
 * @param {() => Element[]} [def.steps]  the active chapter's .step elements (default: all .step)
 * @param {(ctx) => {update(state)}} [def.shared]  layers shared by all chapters (e.g. a map)
 * @param {{dir, look, r}} [def.overview]  if set, the first view flies in from this camera
 * @returns {{select(id: string): void}}
 */
export function runStory(def) {
  root.classList.add('js');

  // ---------- Theme (same storage key as the main site) ----------
  const darkMQ = matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : darkMQ.matches);
  const themeBtn = document.getElementById('themeToggle');
  let applyTheme = () => {};
  if (themeBtn) {
    themeBtn.setAttribute('aria-pressed', String(isDark()));
    themeBtn.addEventListener('click', () => {
      root.dataset.theme = isDark() ? 'light' : 'dark';
      try { localStorage.setItem('theme', root.dataset.theme); } catch (e) {}
      themeBtn.setAttribute('aria-pressed', String(isDark()));
      applyTheme();
    });
  }
  darkMQ.addEventListener('change', () => applyTheme());

  const chapterDefs = def.chapters || { main: { keys: def.keys, build: def.build } };
  let current = def.initial || Object.keys(chapterDefs)[0];
  const getSteps = def.steps || (() => [...document.querySelectorAll('.step')]);
  const narrow = matchMedia('(max-width: 900px)');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Scroll -> stage (works even without WebGL) ----------
  let steps = getSteps(), railItems = [], railRange = [], active = -1;
  const railEl = document.querySelector('.rail');
  function setRail(spec) {
    if (spec && railEl) {
      railEl.innerHTML = spec.map(([a, b]) => `<li>${a}${b ? `<span>${b}</span>` : ''}</li>`).join('');
    }
    railItems = [...document.querySelectorAll('.rail li')];
    // a rail item covers one step, or a range given as data-steps="0-2"
    railRange = railItems.map((el, i) => {
      const [a, b] = (el.dataset.steps || String(i)).split('-').map(Number);
      return [a, Number.isNaN(b) || b === undefined ? a : b];
    });
    active = -1;
  }
  setRail(chapterDefs[current].rail);

  // 0..last; reaches k exactly when step k sits at the reading line
  function rawStage() {
    const vh = innerHeight, line = narrow.matches ? vh * 0.88 : vh * 0.5;
    let s = 0;
    for (const el of steps) {
      const r = el.getBoundingClientRect();
      s += clamp((line - r.top) / r.height, 0, 1);
    }
    return clamp(s - 0.5, 0, Math.max(0, steps.length - 1));
  }
  function syncSteps(raw) {
    const a = Math.round(raw);
    if (a === active) return;
    active = a;
    steps.forEach((el, i) => el.classList.toggle('is-active', i === a));
    railItems.forEach((el, i) => el.classList.toggle('is-active', a >= railRange[i][0] && a <= railRange[i][1]));
  }
  syncSteps(rawStage());
  addEventListener('scroll', () => syncSteps(rawStage()), { passive: true });

  let sceneApi = null;
  const api = {
    get current() { return current; },
    // Show another chapter. Call after the new chapter's steps are visible in the page.
    select(id) {
      if (id === current || !chapterDefs[id]) return;
      const prev = current;
      current = id;
      steps = getSteps();
      setRail(chapterDefs[id].rail);
      syncSteps(rawStage());
      if (sceneApi) sceneApi.switchChapter(prev, id);
    },
    // Fly the camera into a point of the current chapter and hold there (e.g. before leaving the page).
    // stage: whose particle layout to gather into; key: {dir, look, r} in world space. Resolves when done,
    // or at once when the scene is off screen, missing, or motion is reduced.
    dive(stage, key, ms = 800) {
      return sceneApi && !reduce ? sceneApi.dive(stage, key, ms) : Promise.resolve();
    }
  };

  const noScene = () => document.querySelector('.story__stage').classList.add('no-webgl');
  Promise.resolve(def.load ? def.load() : null)
    .then((data) => { sceneApi = initScene(data); if (!sceneApi) noScene(); })
    .catch((e) => { console.error(e); noScene(); });
  return api;

  function initScene(data) {
    const canvas = document.getElementById('story-canvas');
    const frameEl = canvas.parentElement;

    THREE.ColorManagement.enabled = false; // pass CSS colours straight through
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (e) { return null; }
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    const world = new THREE.Group();
    scene.add(world);

    // ---------- Per-particle randomness shared by every chapter ----------
    const N = narrow.matches ? def.count[1] : def.count[0];
    const rand = new Float32Array(N), jit = new Float32Array(N * 3), scatter = new Float32Array(N * 3);
    const g = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
    for (let i = 0; i < N; i++) {
      rand[i] = Math.random();
      jit[i * 3] = g(); jit[i * 3 + 1] = g(); jit[i * 3 + 2] = g();
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = 4 + Math.random() * 4, q = Math.sqrt(1 - u * u);
      scatter[i * 3] = Math.cos(th) * q * r; scatter[i * 3 + 1] = u * r; scatter[i * 3 + 2] = Math.sin(th) * q * r;
    }

    const pMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false,
      uniforms: {
        uColA: { value: new THREE.Color() }, uColB: { value: new THREE.Color() },
        uSize: { value: 12 }, uPR: { value: renderer.getPixelRatio() }, uAlpha: { value: 0.9 },
        uCore: { value: 0.08 }, uTintMix: { value: 0 }
      },
      vertexShader: `
        attribute float aRand, aTint;
        uniform float uSize, uPR, uTintMix;
        varying float vMix;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize * uPR * (0.55 + aRand * 0.9) / -mv.z;
          vMix = mix(aRand, aTint, uTintMix);
        }`,
      fragmentShader: `
        uniform vec3 uColA, uColB;
        uniform float uAlpha, uCore;
        varying float vMix;
        void main() {
          float a = smoothstep(0.5, uCore, length(gl_PointCoord - 0.5)) * uAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(mix(uColA, uColB, vMix), a);
        }`
    });

    // ---------- Helpers handed to builders (each chapter gets its own group) ----------
    const mats = [], pins = [], ctxs = [];
    let tintAttr = null;
    function makeCtx(group, chapterId) {
      // each chapter has its own colour override per particle, blended in with uniforms.uTintMix
      const tint = Float32Array.from(rand);
      const ctx = {
        THREE, world: group, N, rand, jit, tint, reduce, narrow, data, uniforms: pMat.uniforms, dark: isDark(),
        // call after changing ctx.tint while the chapter is showing
        markTint() {
          if (tintAttr && chapterId === current) { tintAttr.copyArray(tint); tintAttr.needsUpdate = true; }
        },
        // A theme-aware material; role is 'accent' | 'accent2' | 'ink'
        material(kind, role) {
          const opts = { transparent: true, depthWrite: false, depthTest: false, opacity: 0 };
          const m = kind === 'fill'
            ? new THREE.MeshBasicMaterial({ ...opts, side: THREE.DoubleSide })
            : new THREE.LineBasicMaterial(opts);
          m.userData.role = role;
          mats.push(m);
          return m;
        },
        // The "model" motif shared by every story: stacked translucent layers. Returns a setter for its opacity.
        layerStack(ys = [0.55, 0.3, 0.05, -0.2], w = 3.8, d = 1.2) {
          const fill = ctx.material('fill', 'accent'), edge = ctx.material('line', 'accent');
          const geo = new THREE.PlaneGeometry(w, d), edges = new THREE.EdgesGeometry(geo);
          ys.forEach((y) => {
            [new THREE.Mesh(geo, fill), new THREE.LineSegments(edges, edge)].forEach((o) => {
              o.rotation.x = -Math.PI / 2; o.position.y = y; group.add(o);
            });
          });
          return (o) => {
            fill.opacity = (ctx.dark ? 0.07 : 0.06) * o; edge.opacity = 0.45 * o;
            fill.visible = edge.visible = o > 0.003;
          };
        },
        // Curved threads between point pairs: [{a:[x,y,z], b:[x,y,z], bow:[x,y,z]}] -> LineSegments geometry
        threads(list, seg = 24) {
          const verts = [];
          list.forEach(({ a, b, bow }) => {
            const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
            const C = A.clone().add(B).multiplyScalar(0.5).add(new THREE.Vector3(...bow));
            const pts = new THREE.QuadraticBezierCurve3(A, C, B).getPoints(seg);
            for (let n = 0; n < seg; n++) verts.push(pts[n].x, pts[n].y, pts[n].z, pts[n + 1].x, pts[n + 1].y, pts[n + 1].z);
          });
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
          return geo;
        },
        // A static layer of round dots (e.g. a map). Returns the Points; set its opacity with .setOpacity(o).
        dots(positions, role, size = 6) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          const m = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, depthTest: false,
            uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 0 }, uSize: { value: size }, uPR: pMat.uniforms.uPR },
            vertexShader: `
              uniform float uSize, uPR;
              void main() {
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mv;
                gl_PointSize = max(1.0, uSize * uPR / -mv.z);
              }`,
            fragmentShader: `
              uniform vec3 uColor;
              uniform float uOpacity;
              void main() {
                float a = smoothstep(0.5, 0.2, length(gl_PointCoord - 0.5)) * uOpacity;
                if (a < 0.01) discard;
                gl_FragColor = vec4(uColor, a);
              }`
          });
          m.userData.role = role;
          mats.push(m);
          const pts = new THREE.Points(geo, m);
          pts.frustumCulled = false;
          pts.setOpacity = (o) => { m.uniforms.uOpacity.value = o; pts.visible = o > 0.003; };
          group.add(pts);
          return pts;
        },
        // Pin an HTML element (inside the stage frame) to a point in this group; it follows the camera
        pin(el, point) {
          const p = { el, point: new THREE.Vector3(...point), group, chapterId };
          pins.push(p);
          return p;
        },
        // Sample filled pixels of text in the display font. Resolves to points centred on (0,0), `width` wide.
        async sampleText(text, width, step = 2) {
          try { await document.fonts.load('700 120px "Space Grotesk"'); } catch (e) {}
          const fs = 120, cv = document.createElement('canvas'), c2 = cv.getContext('2d');
          const font = `700 ${fs}px "Space Grotesk", sans-serif`;
          c2.font = font;
          const W = Math.ceil(c2.measureText(text).width) + 20, H = Math.ceil(fs * 1.4);
          cv.width = W; cv.height = H;
          c2.font = font; c2.textBaseline = 'middle'; c2.fillStyle = '#fff';
          c2.fillText(text, 10, H / 2);
          const px = c2.getImageData(0, 0, W, H).data, pts = [];
          const s = width / W;
          for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
            if (px[(y * W + x) * 4 + 3] > 140) pts.push([(x - W / 2) * s, (H / 2 - y) * s]);
          }
          let x = 10;
          const space = c2.measureText(' ').width;
          const words = text.split(' ').map((w) => {
            const ww = c2.measureText(w).width, cx = (x + ww / 2 - W / 2) * s;
            x += ww + space;
            return { text: w, cx };
          });
          return { pts, words, height: fs * s };
        }
      };
      ctxs.push(ctx);
      return ctx;
    }

    const shared = def.shared ? def.shared(makeCtx(world, null)) : null;

    // Chapters are built the first time they are shown
    const chapters = {};
    function chapter(id) {
      if (chapters[id]) return chapters[id];
      const d = chapterDefs[id], off = d.offset || [0, 0, 0];
      const group = new THREE.Group();
      group.position.set(...off);
      group.visible = id === current;
      world.add(group);
      const ctx = makeCtx(group, id);
      const built = d.build(ctx);
      const keys = d.keys.map((kf) => ({
        dir: new THREE.Vector3(...kf.dir).normalize(),
        look: new THREE.Vector3(kf.look[0] + off[0], kf.look[1] + off[1], kf.look[2] + off[2]),
        r: kf.r
      }));
      chapters[id] = { ...built, id, keys, group, off, tint: ctx.tint };
      return chapters[id];
    }

    const geom = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geom.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
    tintAttr = new THREE.BufferAttribute(new Float32Array(N), 1);
    geom.setAttribute('aTint', tintAttr);
    const points = new THREE.Points(geom, pMat);
    points.frustumCulled = false;
    points.renderOrder = 1; // always drawn over the overlays
    world.add(points);
    tintAttr.copyArray(chapter(current).tint);
    // build the other chapters soon after, so their data (e.g. sampled text) is ready before a switch
    setTimeout(() => Object.keys(chapterDefs).forEach(chapter), 400);

    // ---------- Theme colours ----------
    let sizeBoost = 1;
    applyTheme = () => {
      const cs = getComputedStyle(root);
      const col = {
        accent: new THREE.Color(cs.getPropertyValue('--accent').trim()),
        accent2: new THREE.Color(cs.getPropertyValue('--accent-2').trim()),
        ink: new THREE.Color(cs.getPropertyValue('--ink').trim())
      };
      const dark = isDark();
      ctxs.forEach((c) => { c.dark = dark; });
      const blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
      pMat.uniforms.uColA.value.copy(col.accent);
      pMat.uniforms.uColB.value.copy(col.accent2);
      pMat.uniforms.uAlpha.value = dark ? 0.85 : 1;
      pMat.uniforms.uCore.value = dark ? 0.08 : 0.32; // soft glow on dark, crisp dots on light
      sizeBoost = dark ? 1 : 1.15;
      [pMat, ...mats].forEach((m) => { m.blending = blending; m.needsUpdate = true; });
      mats.forEach((m) => (m.uniforms ? m.uniforms.uColor.value : m.color).copy(col[m.userData.role]));
    };
    applyTheme();

    // ---------- Camera ----------
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const camDir = new THREE.Vector3(), camLook = new THREE.Vector3(), camPos = new THREE.Vector3();
    const fitDist = (r) => (r / tanHalf / Math.min(camera.aspect, 1)) * 1.12;
    function cameraAt(keys, v, outPos, outLook) {
      const last = keys.length - 1;
      const k = clamp(Math.floor(v), 0, Math.max(0, last - 1)), f = last < 1 ? 0 : clamp(v - k, 0, 1);
      const a = keys[k], b = keys[Math.min(k + 1, last)];
      camDir.copy(a.dir).lerp(b.dir, f).normalize();
      outLook.copy(a.look).lerp(b.look, f);
      outPos.copy(camDir).multiplyScalar(fitDist(a.r + (b.r - a.r) * f)).add(outLook);
    }
    const toKey = (kf) => ({ dir: new THREE.Vector3(...kf.dir).normalize(), look: new THREE.Vector3(...kf.look), r: kf.r });

    // ---------- Input: pointer parallax + drag to rotate (opt-in) ----------
    const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
    let dragging = false, lastX = 0, userYaw = 0;
    canvas.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') {
        const r = canvas.getBoundingClientRect();
        ptr.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
        ptr.ty = 1 - ((e.clientY - r.top) / r.height) * 2;
      }
      if (dragging) { userYaw = clamp(userYaw + (e.clientX - lastX) * 0.008, -1.6, 1.6); lastX = e.clientX; }
    });
    ['pointerup', 'pointercancel'].forEach((t) => canvas.addEventListener(t, () => { dragging = false; }));
    canvas.addEventListener('pointerleave', () => { ptr.tx = 0; ptr.ty = 0; });

    function resize() {
      const w = frameEl.clientWidth, h = frameEl.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      pMat.uniforms.uPR.value = renderer.getPixelRatio();
    }
    new ResizeObserver(resize).observe(frameEl);
    resize();

    // ---------- Chapter switch: particles and camera fly along an arc to the new chapter ----------
    const tgtA = new Float32Array(N * 3), tgtB = new Float32Array(N * 3);
    let trans = null;
    // opts: stage (default 0), key (camera target, default the stage's keyframe), duration (s),
    //       lift (arc the camera up, default true), hold (keep the final frame), done (callback)
    function beginFlight(id, fromPos, fromLook, startPositions, opts = {}) {
      const ch = chapter(id), stage = opts.stage || 0;
      const T = new Float32Array(N * 3), C = new Float32Array(N * 3), S = startPositions.slice();
      ch.stages[stage](T, 0);
      for (let i = 0; i < N * 3; i += 3) {
        T[i] += ch.off[0]; T[i + 1] += ch.off[1]; T[i + 2] += ch.off[2];
      }
      // control points: halfway between, lifted into a loose cloud (or straight across when not lifting)
      const arc = opts.lift !== false;
      for (let i = 0; i < N; i++) {
        const o = i * 3, lift = arc ? 0.9 + rand[i] * 0.9 : 0;
        const spread = arc ? 0.5 : 0;
        C[o] = (S[o] + T[o]) / 2 + jit[o] * spread;
        C[o + 1] = arc ? Math.max(S[o + 1], T[o + 1]) + lift : (S[o + 1] + T[o + 1]) / 2;
        C[o + 2] = (S[o + 2] + T[o + 2]) / 2 + jit[o + 2] * spread;
      }
      const camB = new THREE.Vector3(), lookB = new THREE.Vector3();
      if (opts.key) cameraAt([toKey(opts.key)], 0, camB, lookB); else cameraAt(ch.keys, stage, camB, lookB);
      const camA = fromPos.clone(), lookA = fromLook.clone();
      const camC = camA.clone().add(camB).multiplyScalar(0.5);
      if (opts.lift !== false) camC.y += Math.max(1.2, camA.distanceTo(camB) * 0.45);
      const dur = (opts.duration || FLIGHT) * 1000;
      trans = { id, stage, dur, hold: !!opts.hold, done: opts.done, start: performance.now(), S, C, camA, camB, camC, lookA, lookB, shown: false };
      if (reduce) trans.start -= dur;
    }
    function switchChapter(prevId, id) {
      const prev = chapters[prevId];
      if (prev) prev.group.visible = false;
      pins.forEach((p) => { if (p.chapterId === prevId) p.el.style.opacity = '0'; });
      pMat.uniforms.uTintMix.value = 0;
      userYaw = 0;
      chapter(id).group.visible = false;
      tintAttr.copyArray(chapter(id).tint);
      tintAttr.needsUpdate = true;
      beginFlight(id, camera.position, camLook, pos);
      v = 0;
      startLoop();
    }

    // ---------- Loop (only while the story is on screen) ----------
    let v = rawStage(), introStart = 0, raf = 0, visible = false;
    const pinV = new THREE.Vector3(), bez = (a, c, b, e) => (1 - e) * (1 - e) * a + 2 * (1 - e) * e * c + e * e * b;

    function flightFrame(now, t) {
      const ch = chapter(trans.id);
      const u = clamp((now - trans.start) / trans.dur, 0, 1);
      const ec = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; // ease in-out
      camera.position.set(
        bez(trans.camA.x, trans.camC.x, trans.camB.x, ec),
        bez(trans.camA.y, trans.camC.y, trans.camB.y, ec),
        bez(trans.camA.z, trans.camC.z, trans.camB.z, ec));
      camLook.copy(trans.lookA).lerp(trans.lookB, ec);
      camera.lookAt(camLook);
      // the destination is re-read every frame, so it can still be loading or moving
      const { S, C } = trans, T = tgtB, off = ch.off;
      ch.stages[trans.stage](T, t);
      for (let i = 0; i < N * 3; i += 3) { T[i] += off[0]; T[i + 1] += off[1]; T[i + 2] += off[2]; }
      for (let i = 0; i < N; i++) {
        const e = smooth(0, 1, u * 1.45 - rand[i] * 0.45);
        for (let d = 0; d < 3; d++) { const o = i * 3 + d; pos[o] = bez(S[o], C[o], T[o], e); }
      }
      geom.attributes.position.needsUpdate = true;
      if (u > 0.6 && !trans.shown) { ch.group.visible = true; trans.shown = true; }
      if (trans.shown && ch.update) ch.update(trans.stage, t);
      if (shared) shared.update({ id: trans.id, v: trans.stage, flight: u, t });
      pMat.uniforms.uSize.value = (narrow.matches ? 11 : 12) * sizeBoost * (ch.sizeAt ? ch.sizeAt(trans.stage) : 1);
      world.rotation.y = userYaw;
      if (u >= 1) {
        const done = trans.done;
        if (trans.hold) trans.done = null; else trans = null;
        if (done) done();
      }
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      const t = now / 1000;
      const ch = chapter(current);

      if (trans) {
        flightFrame(now, t);
      } else {
        const raw = rawStage();
        syncSteps(raw);
        const last = ch.stages.length - 1;
        const k0 = Math.min(Math.floor(raw), Math.max(0, last - 1));
        const vt = last < 1 ? 0 : reduce ? Math.round(raw) : k0 + smooth(0.15, 0.85, raw - k0); // hold each stage, then move
        v += (vt - v) * (reduce ? 1 : 0.09);

        // overlays first, so stages can use anything they compute (e.g. an animated skeleton)
        if (ch.update) ch.update(v, t);
        if (shared) shared.update({ id: current, v, flight: 1, t });

        // particles: blend between the two neighbouring stages, slightly staggered per point
        const k = clamp(Math.floor(v), 0, Math.max(0, last - 1)), f = last < 1 ? 0 : v - k;
        const needA = f < 0.999, needB = f > 0.001;
        if (needA) ch.stages[k](tgtA, t);
        if (needB) ch.stages[k + 1](tgtB, t);
        const intro = reduce ? 1 : clamp((now - introStart) / 1800, 0, 1);
        const wob = reduce ? 0 : 0.007, off = ch.off;
        for (let i = 0; i < N; i++) {
          const r = rand[i];
          const e = needA && needB ? smooth(0, 1, f * 1.3 - r * 0.3) : needB ? 1 : 0;
          const ie = intro < 1 ? smooth(0, 1, intro * 1.4 - r * 0.4) : 1;
          for (let d = 0; d < 3; d++) {
            const o = i * 3 + d;
            let p = !needA ? tgtB[o] : !needB ? tgtA[o] : tgtA[o] + (tgtB[o] - tgtA[o]) * e;
            p += off[d] + Math.sin(t * 1.3 + r * 40 + d * 2.1) * wob;
            pos[o] = ie < 1 ? scatter[o] + (p - scatter[o]) * ie : p;
          }
        }
        geom.attributes.position.needsUpdate = true;
        pMat.uniforms.uSize.value = (narrow.matches ? 11 : 12) * sizeBoost * (ch.sizeAt ? ch.sizeAt(v) : 1);

        cameraAt(ch.keys, v, camPos, camLook);
        ptr.x += (ptr.tx - ptr.x) * 0.05; ptr.y += (ptr.ty - ptr.y) * 0.05;
        camera.position.copy(camPos);
        camera.position.x += ptr.x * 0.3; camera.position.y += ptr.y * 0.2;
        camera.lookAt(camLook);

        if (!dragging) userYaw *= 0.96; // springs back after a drag
        world.rotation.y = userYaw + (!reduce && ch.yaw ? ch.yaw(v, t) : 0);
      }

      renderer.render(scene, camera);

      // pinned labels follow their scene point
      if (pins.length) {
        const w = frameEl.clientWidth, h = frameEl.clientHeight;
        for (const p of pins) {
          if (p.chapterId !== current) continue;
          pinV.copy(p.point).applyMatrix4(p.group.matrixWorld).project(camera);
          const off = pinV.z > 1 || Math.abs(pinV.x) > 1.2 || Math.abs(pinV.y) > 1.2;
          p.el.style.visibility = off ? 'hidden' : '';
          p.el.style.transform = `translate(${((pinV.x + 1) / 2) * w}px, ${((1 - pinV.y) / 2) * h}px) translate(-50%, -100%)`;
        }
      }
    }
    const startLoop = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame); };
    const stopLoop = () => { cancelAnimationFrame(raf); raf = 0; };
    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !introStart) {
        introStart = performance.now();
        // optional opening flight from an overview camera, instead of the scatter-in
        if (def.overview) {
          introStart -= 1e6;
          const o = toKey(def.overview), oPos = new THREE.Vector3(), oLook = new THREE.Vector3();
          cameraAt([o], 0, oPos, oLook);
          beginFlight(current, oPos, oLook, scatter);
        }
      }
      visible ? startLoop() : stopLoop();
    }).observe(document.querySelector('.story'));
    document.addEventListener('visibilitychange', () => (document.hidden ? stopLoop() : startLoop()));
    function dive(stage, key, ms) {
      if (!visible || document.hidden) return Promise.resolve();
      return new Promise((resolve) => {
        beginFlight(current, camera.position, camLook, pos, { stage, key, duration: ms / 1000, lift: false, hold: true, done: resolve });
        startLoop();
      });
    }
    // coming back to a page restored from the back/forward cache: let go of a held dive
    addEventListener('pageshow', (e) => { if (e.persisted && trans && trans.hold) { trans = null; v = rawStage(); } });
    return { switchChapter, dive };
  }
}
