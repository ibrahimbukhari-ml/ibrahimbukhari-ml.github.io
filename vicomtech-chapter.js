// Vicomtech chapter: seed utterances -> entity-preserving variants -> DistilBERT filter -> JointBERT evaluation -> results.
// Built around the origin, above the map at y = mapY. Used by experience.html after the Donostia map stage.
// Utterances are rows of token blocks; the entity token is highlighted and stays aligned while its context changes.
import { THREE, smooth, bump } from './story-engine.js';

export const VICOMTECH_KEYS = [
  { dir: [0, 0.08, 1], look: [0, 0.16, 0], r: 0.95 },   // seeds
  { dir: [0.3, 0.22, 1], look: [0, 0.22, 0], r: 1.55 },  // variants
  { dir: [0.65, 0.3, 1], look: [0, 0.05, 0], r: 1.75 },  // filter
  { dir: [0, 0.75, 1], look: [0, 0.14, 0], r: 1.75 },    // evaluation
  { dir: [0, 0.04, 1], look: [0, 0.68, 0], r: 1.3 }      // results
];

// v passed to update is local to this chapter: 0 = seeds ... 4 = results
export function buildVicomtech(ctx, { mapY }) {
  const { N, rand, jit, tint, reduce, world } = ctx;
  const G = 6, V = 8;                 // intents, and utterances per intent (the first is the seed)
  const ROW_H = 0.045, GAP = 0.025, DEPTH = 0.012;
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ---------- Utterances ----------
  const rows = [];
  for (let g = 0; g < G; g++) {
    const ew = rnd(0.16, 0.24);
    for (let v = 0; v < V; v++) {
      const tokens = [{ x: -ew / 2, w: ew, entity: true }];
      let x = -ew / 2;
      for (let k = 0, n = 1 + Math.floor(rnd(0, 3)); k < n; k++) { const w = rnd(0.06, 0.13); x -= GAP + w; tokens.unshift({ x, w, entity: false }); }
      x = ew / 2;
      for (let k = 0, n = 1 + Math.floor(rnd(0, 3)); k < n; k++) { const w = rnd(0.06, 0.13); x += GAP; tokens.push({ x, w, entity: false }); x += w; }
      rows.push({ g, v, tokens, mislabeled: false, dropped: false, x0: tokens[0].x, x1: x });
    }
  }
  // 10 generated utterances no longer fit their intent; the filter catches 4 of them (40% less mislabeling)
  const candidates = rows.filter((r) => r.v > 0).sort(() => Math.random() - 0.5).slice(0, 10);
  candidates.forEach((r, n) => { r.mislabeled = true; r.dropped = n < 4; });

  const seedPos = (g) => [0, 0.72 - g * 0.24, 0];
  const groupPos = (g, v) => [((g % 3) - 1) * 0.95, 0.72 - Math.floor(g / 3) * 0.92 - v * 0.088, -v * 0.02];
  const floorPos = rows.map(() => [rnd(-1.2, 1.2), mapY + 0.012, rnd(0.35, 0.8)]);

  // ---------- Particles: each belongs to one token of one row ----------
  const tokenList = [];
  rows.forEach((r, ri) => r.tokens.forEach((tk, ti) => tokenList.push({ ri, ti, w: tk.w })));
  const cum = [];
  tokenList.reduce((s, tk) => { cum.push(s + tk.w); return s + tk.w; }, 0);
  const total = cum[cum.length - 1];
  const pRow = new Uint16Array(N), pTok = new Uint8Array(N), pu = new Float32Array(N), pv = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = Math.random() * total;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < x) lo = mid + 1; else hi = mid; }
    pRow[i] = tokenList[lo].ri; pTok[i] = tokenList[lo].ti;
    // most points on the block's outline so tokens read as crisp shapes
    let u = Math.random(), w = Math.random();
    if (Math.random() < 0.6) { if (Math.random() < 0.5) u = u < 0.5 ? 0 : 1; else w = w < 0.5 ? 0 : 1; }
    pu[i] = u; pv[i] = w;
    tint[i] = rows[pRow[i]].tokens[pTok[i]].entity ? 0.95 : 0.05;
  }
  const entityTint = tint.slice();
  ctx.markTint();

  // position of particle i on token tk placed with its row origin at p
  function onToken(i, tk, p, out) {
    const o = i * 3;
    out[o] = p[0] + tk.x + pu[i] * tk.w;
    out[o + 1] = p[1] + (pv[i] - 0.5) * ROW_H;
    out[o + 2] = p[2] + jit[o + 2] * DEPTH;
  }
  function onFloor(i, r, out) {
    const o = i * 3, tk = r.tokens[pTok[i]], f = floorPos[pRow[i]];
    out[o] = f[0] + tk.x + pu[i] * tk.w; out[o + 1] = f[1]; out[o + 2] = f[2] + (pv[i] - 0.5) * ROW_H;
  }

  const seeds = new Float32Array(N * 3), variants = new Float32Array(N * 3), filtered = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = rows[pRow[i]], tk = r.tokens[pTok[i]];
    // seeds: every particle gathers on its intent's seed utterance (entity on entity, context on context)
    const seed = rows[r.g * V];
    const ctxTokens = seed.tokens.filter((t) => !t.entity);
    onToken(i, tk.entity ? seed.tokens.find((t) => t.entity) : ctxTokens[pTok[i] % ctxTokens.length], seedPos(r.g), seeds);
    onToken(i, tk, groupPos(r.g, r.v), variants);
    if (r.dropped) onFloor(i, r, filtered); else onToken(i, tk, groupPos(r.g, r.v), filtered);
  }

  // ---------- Evaluation: kept data streams through the model into two heads (intent, entities) ----------
  const DATA_Y = 0.95, HEAD_Y = -0.56, HEAD_X = 0.7, LABEL_Y = -0.78;
  const evalPos = new Float32Array(N * 3), bx = new Float32Array(N), labelOf = new Int8Array(N).fill(-1);
  for (let i = 0; i < N; i++) {
    const o = i * 3, r = rows[pRow[i]];
    bx[i] = Math.round(rnd(-1.4, 1.4) * 30) / 30;
    if (r.dropped) { evalPos[o] = filtered[o]; evalPos[o + 1] = filtered[o + 1]; evalPos[o + 2] = filtered[o + 2]; continue; }
    evalPos[o] = bx[i]; evalPos[o + 1] = DATA_Y + Math.round(rnd(-0.1, 0.1) * 40) / 40; evalPos[o + 2] = Math.round(rnd(-0.25, 0.25) * 20) / 20;
    if (i % 9 === 0) labelOf[i] = (i / 9) % 2;
  }
  ['intent', 'entities'].forEach((word, h) => {
    ctx.sampleText(word, 0.46).then(({ pts }) => {
      for (let i = 0; i < N; i++) {
        if (labelOf[i] !== h) continue;
        const p = pts[Math.floor(Math.random() * pts.length)];
        evalPos[i * 3] = (h ? HEAD_X : -HEAD_X) + p[0]; evalPos[i * 3 + 1] = LABEL_Y + p[1]; evalPos[i * 3 + 2] = 0;
      }
    });
  });
  function evaluation(out, t) {
    out.set(evalPos);
    for (let i = 2; i < N; i += 3) {
      if (rows[pRow[i]].dropped || labelOf[i] >= 0) continue;
      const o = i * 3, phase = reduce ? rand[i] : (t * 0.3 + rand[i]) % 1;
      const hx = (i & 4 ? HEAD_X : -HEAD_X) + jit[o] * 0.12;
      out[o] = bx[i] + (hx - bx[i]) * smooth(0.15, 1, phase);
      out[o + 1] = DATA_Y - 0.15 - phase * (DATA_Y - 0.15 - HEAD_Y);
      out[o + 2] = jit[o + 2] * 0.15;
    }
  }

  // ---------- Results: entity F1 +30 points, accuracy +3 points, drawn to scale ----------
  const SC = 1.5 / 30, BW = 0.5, BD = 0.28, XA = -0.45, XB = 0.45;
  const results = new Float32Array(N * 3), barTint = new Float32Array(N), resLabel = [[], []];
  for (let i = 0; i < N; i++) {
    const o = i * 3;
    const bar = i % 6 === 0 ? Math.floor(i / 6) % 2 : Math.random() < 3 / 33 ? 1 : 0;
    if (i % 6 === 0) resLabel[bar].push(i);
    let px = (Math.random() - 0.5) * BW, py = Math.random(), pz = (Math.random() - 0.5) * BD;
    if (Math.random() < 0.65) {
      const ax = Math.floor(Math.random() * 3);
      if (ax === 0) px = (px < 0 ? -0.5 : 0.5) * BW; else if (ax === 1) py = Math.random() < 0.5 ? 0 : 1; else pz = (pz < 0 ? -0.5 : 0.5) * BD;
    }
    results[o] = (bar ? XB : XA) + px; results[o + 1] = py * (bar ? 3 : 30) * SC; results[o + 2] = pz;
    barTint[i] = bar ? 0.95 : 0.05;
  }
  [['+30', XA, 30 * SC + 0.26, resLabel[0]], ['+3', XB, 3 * SC + 0.26, resLabel[1]]].forEach(([text, x, y, ids]) => {
    ctx.sampleText(text, text.length > 2 ? 0.5 : 0.36).then(({ pts }) => {
      ids.forEach((i) => {
        const p = pts[Math.floor(Math.random() * pts.length)];
        results[i * 3] = x + p[0]; results[i * 3 + 1] = y + p[1]; results[i * 3 + 2] = (Math.random() - 0.5) * 0.04;
      });
    });
  });

  // ---------- Overlays ----------
  // outlines around the mislabeled utterances the filter did not catch
  const flagMat = ctx.material('line', 'accent2'), flagVerts = [];
  rows.filter((r) => r.mislabeled && !r.dropped).forEach((r) => {
    const p = groupPos(r.g, r.v), x0 = p[0] + r.x0 - 0.02, x1 = p[0] + r.x1 + 0.02, y0 = p[1] - ROW_H * 0.85, y1 = p[1] + ROW_H * 0.85, z = p[2];
    flagVerts.push(x0, y0, z, x1, y0, z, x1, y0, z, x1, y1, z, x1, y1, z, x0, y1, z, x0, y1, z, x0, y0, z);
  });
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute('position', new THREE.Float32BufferAttribute(flagVerts, 3));
  world.add(new THREE.LineSegments(flagGeo, flagMat));

  // the DistilBERT filter: a sheet sweeping across the utterances
  const sheetFill = ctx.material('fill', 'accent'), sheetEdge = ctx.material('line', 'accent');
  const sheetGeo = new THREE.PlaneGeometry(0.9, 1.75);
  const sheet = new THREE.Group();
  sheet.add(new THREE.Mesh(sheetGeo, sheetFill), new THREE.LineSegments(new THREE.EdgesGeometry(sheetGeo), sheetEdge));
  sheet.rotation.y = Math.PI / 2;
  sheet.position.set(0, 0.25, -0.1);
  world.add(sheet);

  // the JointBERT model (shared layer motif) and its two output heads
  const setStack = ctx.layerStack([0.55, 0.3, 0.05, -0.2], 3.4, 0.9);
  const headMat = ctx.material('line', 'accent');
  const headGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.5, 0.12, 0.3));
  const heads = [-HEAD_X, HEAD_X].map((x) => { const m = new THREE.LineSegments(headGeo, headMat); m.position.set(x, HEAD_Y, 0); world.add(m); return m; });

  const baseMat = ctx.material('line', 'ink');
  world.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1.1, 0, 0), new THREE.Vector3(1.1, 0, 0)]), baseMat));

  let tintMode = 'entity';
  return {
    stages: [
      (out) => out.set(seeds),
      (out) => out.set(variants),
      (out) => out.set(filtered),
      evaluation,
      (out) => out.set(results)
    ],
    update(v, t) {
      const lineBoost = ctx.dark ? 1 : 1.5;
      // entity highlight from the seeds on; switch to bar colours while the colour mix is at zero
      const want = v > 3.5 ? 'bars' : 'entity';
      if (want !== tintMode) { tint.set(want === 'bars' ? barTint : entityTint); ctx.markTint(); tintMode = want; }
      ctx.uniforms.uTintMix.value = smooth(-0.6, 0, v) * (1 - bump(v, 3.5, 0.4));

      flagMat.opacity = 0.85 * bump(v, 2, 0.8) * lineBoost;
      const sheetIn = bump(v, 2, 0.8);
      sheetFill.opacity = (ctx.dark ? 0.08 : 0.07) * sheetIn;
      sheetEdge.opacity = 0.6 * sheetIn;
      sheet.visible = sheetIn > 0.003;
      sheet.position.x = reduce ? 0 : Math.sin(t * 0.9) * 1.45;

      setStack(bump(v, 3, 0.8));
      headMat.opacity = 0.7 * bump(v, 3, 0.8);
      heads.forEach((h) => { h.visible = headMat.opacity > 0.003; });

      baseMat.opacity = 0.5 * bump(v, 4, 0.9) * lineBoost;
    }
  };
}
