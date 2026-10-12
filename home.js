// Home page: the atlas. One map of the whole route, with a column of light and a label for each chapter
// (PhD Research in Bilbao, Research Labs in Paris and Donostia, the double master's in Donostia and Nancy).
// Scrolling visits each chapter in turn, then pulls back for contact. The labels link to the chapters.
import { runStory, THREE, bump, lerpStages } from './story-engine.js';
import { loadAtlas, projector, gridCells, projectCells, borderSegments, CITIES } from './atlas.js';
import { buildCityStage } from './city-stage.js';

const MAP_Y = -0.86, U = 0.32, BEACON = 0.7, TALL = 1.15; // Nancy's column is taller so its label clears Paris's
const project = projector({ lon: 2, lat: 44 }, U, MAP_Y, 42);
const at = (c) => project(c.lon, c.lat);
const ISB = at(CITIES.islamabad), DON = at(CITIES.donostia), NAN = at(CITIES.nancy), PAR = at(CITIES.paris), BIL = at(CITIES.bilbao);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[2] + b[2]) / 2];

// chapter labels on the map: data-pin is the chapter (0 PhD, 1 Research Labs, 2 Education);
// data-secondary marks a second place of a chapter, shown only while that chapter is in view
const pins = [...document.querySelectorAll('.pin--chapter')];

const story = runStory({
  count: [7200, 4200],
  load: loadAtlas,
  overview: { dir: [0, 1.3, 1], look: [-0.1, MAP_Y, -0.55], r: 2.1 },
  keys: [
    { dir: [0.35, 0.7, 1], look: [BIL[0], MAP_Y + 0.3, BIL[2]], r: 0.85 },                                    // 1 PhD
    { dir: [0.15, 0.85, 1], look: [mid(PAR, DON)[0], MAP_Y + 0.25, mid(PAR, DON)[1]], r: 1.3 },               // 2 Research Labs
    { dir: [0.1, 0.7, 1], look: [mid(DON, NAN)[0] + 0.35, MAP_Y + 0.45, mid(DON, NAN)[1]], r: 1.65 },           // 3 Education
    { dir: [0, 1.15, 1], look: [-0.1, MAP_Y, -0.6], r: 1.95 }                                                 // contact: all of it
  ],
  build(ctx) {
    const { N, rand, jit, reduce, world, data: atlas } = ctx;

    // ---------- Map ----------
    const BOX = [-12, 20, 78, 60];
    const land = ctx.dots(projectCells(gridCells(atlas.land, BOX), project), 'ink', 11);
    const borderMat = ctx.material('line', 'ink');
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(borderSegments(atlas, project, BOX), 3));
    world.add(new THREE.LineSegments(borderGeo, borderMat));

    // ---------- Places: each a lit country with a column of light ----------
    const place = (grid, c, height = BEACON) => {
      const stage = buildCityStage(ctx, { grid, project, mapY: MAP_Y, height, center: [c[0], c[2]] });
      const pts = new Float32Array(N * 3);
      stage.beacon(pts);
      return { stage, pts };
    };
    const bil = place(atlas.focus.ESP, BIL), don = place(atlas.focus.ESP, DON);
    const par = place(atlas.focus.FRA, PAR), nan = place(atlas.focus.FRA, NAN, TALL);

    // ---------- The route, from Islamabad to Bilbao ----------
    const legs = [[ISB, DON], [DON, NAN], [NAN, PAR], [PAR, BIL]].map(([a, b]) => {
      const lift = Math.max(0.35, Math.hypot(a[0] - b[0], a[2] - b[2]) * 0.22);
      return { a, b, c: [(a[0] + b[0]) / 2, Math.max(a[1], b[1]) + lift * 2, (a[2] + b[2]) / 2] };
    });
    const legAt = (leg, e, out, o) => {
      for (let d = 0; d < 3; d++) out[o + d] = (1 - e) * (1 - e) * leg.a[d] + 2 * (1 - e) * e * leg.c[d] + e * e * leg.b[d];
    };
    const legMat = ctx.material('line', 'accent2');
    legs.forEach((leg) => {
      const pts = [];
      for (let n = 0; n <= 120; n++) { const p = [0, 0, 0]; legAt(leg, n / 120, p, 0); pts.push(new THREE.Vector3(...p)); }
      world.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), legMat));
    });
    const copy = (src, out, i) => { const o = i * 3; out[o] = src[o]; out[o + 1] = src[o + 1]; out[o + 2] = src[o + 2]; };
    const flow = (out, i, t, legIdx) => {
      legAt(legs[legIdx], reduce ? rand[i] : (t * 0.1 + rand[i]) % 1, out, i * 3);
      out[i * 3] += jit[i * 3] * 0.02; out[i * 3 + 2] += jit[i * 3 + 2] * 0.02;
    };

    // ---------- Chapter labels above their columns ----------
    const anchor = (el) => (el.dataset.pin === '0' ? BIL : el.dataset.pin === '2' ? NAN : el.hasAttribute('data-secondary') ? DON : PAR);
    pins.forEach((el) => { const c = anchor(el); ctx.pin(el, [c[0], MAP_Y + (c === NAN ? TALL : BEACON) + 0.05, c[2]]); });

    const labs = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) copy(i % 2 ? par.pts : don.pts, labs, i);

    return {
      stages: [
        (out) => out.set(bil.pts),
        (out) => out.set(labs),
        (out, t) => { // the double master's: the route in from Islamabad, Donostia and Nancy lit
          for (let i = 0; i < N; i++) {
            const k = i % 3;
            if (k === 0) copy(nan.pts, out, i); else if (k === 1) copy(don.pts, out, i); else flow(out, i, t, i % 2);
          }
        },
        (out, t) => { // everything: the three chapters and the whole route
          for (let i = 0; i < N; i++) {
            const k = i % 4;
            if (k === 0) copy(bil.pts, out, i); else if (k === 1) copy(par.pts, out, i);
            else if (k === 2) copy(nan.pts, out, i); else flow(out, i, t, i % legs.length);
          }
        }
      ],
      sizeAt: (v) => lerpStages(v, [0.5, 0.6, 0.7, 0.75]) * (ctx.narrow.matches ? 0.8 : 1),
      update(v, t) {
        const lineBoost = ctx.dark ? 1 : 1.5;
        land.setOpacity(ctx.dark ? 0.3 : 0.28);
        borderMat.opacity = ctx.dark ? 0.26 : 0.38;
        legMat.opacity = (0.3 + 0.5 * Math.max(bump(v, 2, 0.9), bump(v, 3, 0.9))) * lineBoost;

        const all = bump(v, 3, 0.9) * 0.7;
        bil.stage.update(Math.max(bump(v, 0, 0.8), all), t, 0);
        par.stage.update(Math.max(bump(v, 1, 0.8), all), t, 0);
        don.stage.update(Math.max(bump(v, 1, 0.8), bump(v, 2, 0.8)), t, 0);
        nan.stage.update(Math.max(bump(v, 2, 0.8), all), t, 0);

        // each step labels only its own chapter (neighbouring places would otherwise read as the wrong one);
        // the final overview labels all three
        pins.forEach((el) => {
          const k = Number(el.dataset.pin), main = !el.hasAttribute('data-secondary');
          const on = Math.max(bump(v, k, 0.75), main ? bump(v, 3, 0.75) : 0);
          el.style.opacity = String(on);
          el.style.pointerEvents = on > 0.5 ? 'auto' : 'none';
          el.classList.toggle('is-current', on > 0.5);
        });
      }
    };
  }
});

// Hovering a chapter card (or focusing it) lights up its label on the map
document.querySelectorAll('[data-chapter]').forEach((el) => {
  const mine = pins.filter((p) => p.dataset.pin === el.dataset.chapter);
  const on = () => mine.forEach((p) => p.classList.add('is-hot')), off = () => mine.forEach((p) => p.classList.remove('is-hot'));
  el.addEventListener('mouseenter', on); el.addEventListener('mouseleave', off);
  el.addEventListener('focusin', on); el.addEventListener('focusout', off);
});
// Leaving for a chapter: dive the camera into that chapter's column of light, then open the page
// (the page change itself cross-fades where the browser supports view transitions)
const CHAPTER_OF = { 'phd.html': 0, 'experience.html': 1, 'education.html': 2 };
const diveKey = (c, height) => ({ dir: [0.25, 0.42, 1], look: [c[0], MAP_Y + height * 0.55, c[2]], r: 0.3 });
let leaving = false;
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || leaving || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target) return;
  const url = new URL(a.href, location.href);
  const k = url.origin === location.origin ? CHAPTER_OF[url.pathname.split('/').pop()] : undefined;
  if (k === undefined) return;
  e.preventDefault();
  leaving = true;
  const place = k === 0 ? BIL : k === 2 ? NAN : url.hash === '#vicomtech' ? DON : PAR;
  // never wait longer than the dive should take (animation frames pause in background tabs)
  const timeout = new Promise((r) => setTimeout(r, 1100));
  Promise.race([story.dive(k, diveKey(place, k === 2 ? TALL : BEACON), 750), timeout]).then(() => { location.href = a.href; });
});
addEventListener('pageshow', () => { leaving = false; });

