// Education page: one journey on one map. Islamabad -> Erasmus Mundus scholarship -> Donostia (year 1)
// -> Nancy (year 2) -> where it led (Paris, Bilbao). Courses float above each city as a constellation;
// pointing at a course in the text lights up its point in the scene.
import { runStory, THREE, smooth, bump, lerpStages } from './story-engine.js';
import { loadAtlas, projector, gridCells, projectCells, borderSegments, CITIES } from './atlas.js';
import { buildCityStage } from './city-stage.js';

const MAP_Y = -0.86, U = 0.32;
const project = projector({ lon: 2, lat: 44 }, U, MAP_Y, 42);
const at = (c) => project(c.lon, c.lat);
const ISB = at(CITIES.islamabad), DON = at(CITIES.donostia), NAN = at(CITIES.nancy), PAR = at(CITIES.paris), BIL = at(CITIES.bilbao);
const NODES_Y = MAP_Y + 0.2;            // centre of each course constellation
const RING = [(ISB[0] + DON[0]) / 2, MAP_Y + 2.4, (ISB[2] + DON[2]) / 2];

const cityKey = (c) => ({ dir: [0.35, 0.75, 1], look: [c[0], MAP_Y + 0.32, c[2]], r: 0.85 });
const nodesKey = (c) => ({ dir: [0.1, 0.16, 1], look: [c[0], NODES_Y + 0.42, c[2]], r: 0.95 });

// Courses come from the page: <button class="course" data-group="upv-t1|upv-t2|upv-proj|lor|lor-proj">
const buttons = [...document.querySelectorAll('.course')];
let highlight = () => {};

runStory({
  count: [7200, 4200],
  load: loadAtlas,
  overview: { dir: [0, 0.6, 1], look: [RING[0], MAP_Y + 0.6, RING[2]], r: 9 }, // arrive over the whole route
  keys: [
    cityKey(ISB),                                                         // 0 Islamabad
    { dir: [0, 0.5, 1], look: [RING[0], MAP_Y + 0.9, RING[2]], r: 9.2 },  // 1 scholarship, the whole route
    cityKey(DON),                                                         // 2 Donostia
    nodesKey(DON),                                                        // 3 year 1 courses
    cityKey(NAN),                                                         // 4 Nancy
    nodesKey(NAN),                                                        // 5 year 2 highlights
    { dir: [0, 1.1, 1], look: [-0.1, MAP_Y, -0.6], r: 1.75 }             // 6 where it led
  ],
  build(ctx) {
    const { N, rand, jit, tint, reduce, world, data: atlas } = ctx;

    // ---------- Map: the whole route, from the Atlantic to Pakistan ----------
    const BOX = [-12, 20, 78, 60];
    const land = ctx.dots(projectCells(gridCells(atlas.land, BOX), project), 'ink', 11);
    const borderMat = ctx.material('line', 'ink');
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(borderSegments(atlas, project, BOX), 3));
    world.add(new THREE.LineSegments(borderGeo, borderMat));

    // ---------- Cities ----------
    const city = (grid, c, pin) => buildCityStage(ctx, {
      grid, project, mapY: MAP_Y, center: [c[0], c[2]], pinEl: document.getElementById(pin)
    });
    const isb = city(atlas.focus.PAK, ISB, 'pin-islamabad');
    const don = city(atlas.focus.ESP, DON, 'pin-donostia');
    const nan = city(atlas.focus.FRA, NAN, 'pin-nancy');

    // A warm subset of particles draws the stars, the second term and the project; the rest stay cool
    const warm = new Uint8Array(N);
    for (let i = 0; i < N; i++) { warm[i] = (i * 7919) % 100 < 35 ? 1 : 0; tint[i] = warm[i] ? 0.95 : 0.05; }
    ctx.markTint();

    // ---------- The route: raised arcs between consecutive stops ----------
    const legs = [[ISB, DON], [DON, NAN], [NAN, PAR], [PAR, BIL]].map(([a, b]) => {
      const lift = Math.max(0.35, Math.hypot(a[0] - b[0], a[2] - b[2]) * 0.22);
      return { a, b, c: [(a[0] + b[0]) / 2, Math.max(a[1], b[1]) + lift * 2, (a[2] + b[2]) / 2] };
    });
    const legAt = (leg, e, out, o) => {
      for (let d = 0; d < 3; d++) out[o + d] = (1 - e) * (1 - e) * leg.a[d] + 2 * (1 - e) * e * leg.c[d] + e * e * leg.b[d];
    };
    const legMat = ctx.material('line', 'accent2');
    const legLines = legs.map((leg) => {
      const pts = [];
      for (let n = 0; n <= 120; n++) { const p = [0, 0, 0]; legAt(leg, n / 120, p, 0); pts.push(new THREE.Vector3(...p)); }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), legMat);
      world.add(line);
      return line;
    });

    // ---------- Scholarship: a ring of twelve stars over the route ----------
    const stars = new Float32Array(N * 3);
    const star = (k, s, out, o) => { // a point on the outline of a five-point star, s in [0, 1)
      const seg = s * 10, j = Math.floor(seg), f = seg - j;
      const rad = (n) => (n % 2 ? 0.4 : 1) * 0.3;
      const ang = (n) => Math.PI / 2 + n * Math.PI / 5;
      const ax = Math.cos(ang(j)) * rad(j), ay = Math.sin(ang(j)) * rad(j);
      const bx = Math.cos(ang(j + 1)) * rad(j + 1), by = Math.sin(ang(j + 1)) * rad(j + 1);
      const a = (k / 12) * Math.PI * 2;
      out[o] = RING[0] + Math.cos(a) * 2.3 + ax + (bx - ax) * f;
      out[o + 1] = RING[1] + Math.sin(a) * 2.3 + ay + (by - ay) * f;
      out[o + 2] = RING[2];
    };
    for (let i = 0; i < N; i++) if (warm[i]) star(i % 12, Math.random(), stars, i * 3);
    function scholarship(out, t) {
      out.set(stars);
      // everything else already travels the first leg, from Islamabad towards Donostia
      for (let i = 0; i < N; i++) {
        if (warm[i]) continue;
        legAt(legs[0], reduce ? rand[i] : (t * 0.08 + rand[i]) % 1, out, i * 3);
        out[i * 3] += jit[i * 3] * 0.12; out[i * 3 + 2] += jit[i * 3 + 2] * 0.12;
      }
    }

    // ---------- Courses: points on arcs above each city ----------
    const groups = {};
    buttons.forEach((b) => { (groups[b.dataset.group] = groups[b.dataset.group] || []).push(b); });
    const nodePos = new Map(); // button -> [x, y, z]
    const arc = (list, c, r) => list.forEach((b, n) => {
      const a = Math.PI * (0.9 - 0.8 * (list.length > 1 ? n / (list.length - 1) : 0.5));
      nodePos.set(b, [c[0] + Math.cos(a) * r, NODES_Y + Math.sin(a) * r, c[2]]);
    });
    arc(groups['upv-t1'] || [], DON, 0.82);
    arc(groups['upv-t2'] || [], DON, 0.5);
    arc(groups.lor || [], NAN, 0.72);
    (groups['upv-proj'] || []).forEach((b) => nodePos.set(b, [DON[0], NODES_Y + 0.14, DON[2]]));
    (groups['lor-proj'] || []).forEach((b) => nodePos.set(b, [NAN[0], NODES_Y + 0.3, NAN[2]]));

    const projectNodes = new Set();
    buttons.forEach((b) => { if (b.dataset.group.endsWith('proj') && nodePos.has(b)) projectNodes.add(nodePos.get(b)); });
    const isProject = (p) => projectNodes.has(p);

    // particles on node clusters (a quarter stay on the country below)
    function constellation(cool, hot, ground) {
      const out = new Float32Array(N * 3);
      const coolNodes = cool.map((b) => nodePos.get(b)), hotNodes = hot.map((b) => nodePos.get(b));
      for (let i = 0; i < N; i++) {
        const o = i * 3;
        if (i % 4 === 0 || !(warm[i] ? hotNodes : coolNodes).length) {
          out[o] = ground[o]; out[o + 1] = ground[o + 1]; out[o + 2] = ground[o + 2];
          continue;
        }
        const list = warm[i] ? hotNodes : coolNodes, p = list[Math.floor(i / 4) % list.length]; // i % 4 is taken by the ground
        const big = isProject(p) ? (hot.length === 1 ? 0.085 : 0.07) : 0.045;
        const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, q = Math.sqrt(1 - u * u);
        const rr = big * (0.75 + 0.25 * Math.random());
        out[o] = p[0] + Math.cos(a) * q * rr; out[o + 1] = p[1] + u * rr; out[o + 2] = p[2] + Math.sin(a) * q * rr;
      }
      return out;
    }
    const groundOf = (c) => { const pts = new Float32Array(N * 3); c.country(pts); return pts; };
    const year1 = constellation(groups['upv-t1'] || [], [...(groups['upv-t2'] || []), ...(groups['upv-proj'] || [])], groundOf(don));
    const year2 = constellation(groups.lor || [], groups['lor-proj'] || [], groundOf(nan));

    // faint lines joining the courses of each group
    const linkMat = ctx.material('line', 'accent');
    ['upv-t1', 'upv-t2', 'lor'].forEach((g) => {
      const pts = (groups[g] || []).map((b) => new THREE.Vector3(...nodePos.get(b)));
      if (pts.length > 1) world.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), linkMat));
    });

    // pointing at a course: a ring around its point and its name pinned above it
    const hiMat = ctx.material('line', 'ink');
    const hiPts = [];
    for (let a = 0; a <= 48; a++) hiPts.push(new THREE.Vector3(Math.cos(a / 24 * Math.PI) * 0.085, Math.sin(a / 24 * Math.PI) * 0.085, 0));
    const hiRing = new THREE.Line(new THREE.BufferGeometry().setFromPoints(hiPts), hiMat);
    hiRing.visible = false;
    world.add(hiRing);
    const coursePinEl = document.getElementById('pin-course');
    const coursePin = coursePinEl ? ctx.pin(coursePinEl, [0, 0, 0]) : null;
    let hot = null;
    highlight = (b) => {
      hot = b && nodePos.has(b) ? b : null;
      if (!hot || !coursePin) return;
      const p = nodePos.get(hot);
      hiRing.position.set(...p);
      hiRing.scale.setScalar(hot.dataset.group.endsWith('proj') ? 1.6 : 1);
      coursePin.point.set(p[0], p[1] + 0.1, p[2]);
      coursePinEl.querySelector('b').textContent = hot.dataset.short || hot.textContent.trim();
    };

    // ---------- Where it led: the whole route flowing, with a glow at every stop ----------
    const stops = [ISB, DON, NAN, PAR, BIL];
    function journey(out, t) {
      for (let i = 0; i < N; i++) {
        const o = i * 3;
        if (i % 5 === 0) {
          const s = stops[(i / 5) % stops.length];
          out[o] = s[0] + jit[o] * 0.05; out[o + 1] = MAP_Y + 0.02 + Math.abs(jit[o + 1]) * 0.04; out[o + 2] = s[2] + jit[o + 2] * 0.05;
        } else {
          legAt(legs[i % legs.length], reduce ? rand[i] : (t * 0.12 + rand[i]) % 1, out, o);
          out[o] += jit[o] * 0.01; out[o + 1] += jit[o + 1] * 0.01; out[o + 2] += jit[o + 2] * 0.01;
        }
      }
    }
    const smallPins = ['pin-j-basque', 'pin-j-nancy', 'pin-j-paris'].map((id) => document.getElementById(id));
    [[(DON[0] + BIL[0]) / 2, (DON[2] + BIL[2]) / 2], [NAN[0], NAN[2]], [PAR[0], PAR[2]]].forEach(([x, z], n) => {
      if (smallPins[n]) ctx.pin(smallPins[n], [x, MAP_Y + 0.08, z]);
    });

    return {
      stages: [isb.beacon, scholarship, don.beacon, (out) => out.set(year1), nan.beacon, (out) => out.set(year2), journey],
      sizeAt: (v) => lerpStages(v, [0.5, 3.2, 0.5, 0.75, 0.5, 0.75, 0.9]) * (ctx.narrow.matches ? 0.8 : 1),
      update(v, t) {
        const lineBoost = ctx.dark ? 1 : 1.5;
        const dim = 1 - 0.55 * (bump(v, 3, 0.8) + bump(v, 5, 0.8));
        land.setOpacity((ctx.dark ? 0.3 : 0.28) * dim);
        borderMat.opacity = (ctx.dark ? 0.26 : 0.38) * dim;

        isb.update(bump(v, 0, 0.7), t, bump(v, 0, 0.6));
        don.update(bump(v, 2, 0.7), t, bump(v, 2, 0.6));
        nan.update(bump(v, 4, 0.7), t, bump(v, 4, 0.6));

        // the route draws itself as the story reaches each stop
        const drawn = [smooth(0.3, 2, v), smooth(3.3, 4, v), smooth(5.2, 5.8, v), smooth(5.6, 6, v)];
        legLines.forEach((line, n) => { line.geometry.setDrawRange(0, Math.round(drawn[n] * 121)); line.visible = drawn[n] > 0.005; });
        legMat.opacity = 0.75 * lineBoost * (1 - 0.6 * (bump(v, 3, 0.8) + bump(v, 5, 0.8)));

        ctx.uniforms.uTintMix.value = Math.max(bump(v, 1, 0.8), bump(v, 3, 0.8), bump(v, 5, 0.8));
        linkMat.opacity = 0.35 * Math.max(bump(v, 3, 0.7), bump(v, 5, 0.7)) * lineBoost;

        // a highlight only makes sense while its city's courses are on screen
        const group = hot && hot.dataset.group, onScreen = hot && (group.startsWith('upv') ? bump(v, 3, 0.45) : bump(v, 5, 0.45));
        hiRing.visible = !!onScreen && onScreen > 0.01;
        hiMat.opacity = 0.9 * (onScreen || 0);
        if (hiRing.visible && !reduce) hiRing.scale.setScalar((group.endsWith('proj') ? 1.6 : 1) * (1 + 0.08 * Math.sin(t * 4)));
        if (coursePinEl) coursePinEl.style.opacity = String(onScreen || 0);

        const led = smooth(5.5, 6, v);
        smallPins.forEach((el) => { if (el) el.style.opacity = String(led); });
      }
    };
  }
});

// Courses in the text drive the highlight in the scene (hover, keyboard focus or tap)
buttons.forEach((b) => {
  b.addEventListener('mouseenter', () => highlight(b));
  b.addEventListener('focus', () => highlight(b));
  b.addEventListener('click', () => highlight(b));
  b.addEventListener('mouseleave', () => { if (document.activeElement !== b) highlight(null); });
  b.addEventListener('blur', () => highlight(null));
});
