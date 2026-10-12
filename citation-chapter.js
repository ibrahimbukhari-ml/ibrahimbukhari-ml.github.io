// Citation chapter (OHVaiLLM): source reports -> agent pipeline -> 40k cited samples -> post-training -> results.
// Built around the origin, standing on y = -0.86. Used by experience.html after the Paris map stage.
import { THREE, smooth, bump, lerpStages } from './story-engine.js';

export const CITATION_KEYS = [
  { dir: [0.3, 0.12, 1], look: [0.05, 0.05, 0], r: 1.25 },
  { dir: [0, 0.1, 1], look: [0, 0, 0], r: 2.45 },
  { dir: [0.4, 0.28, 1], look: [-0.25, 0, 0], r: 2.3 },
  { dir: [0, 0.85, 1], look: [0, 0.1, 0], r: 2.0 },
  { dir: [0, 0.04, 1], look: [0, 0.36, 0], r: 1.75 }
];

// v passed to update/yaw is local to this chapter: 0 = sources ... 4 = results
export function buildCitation(ctx) {
  const { N, rand, jit, tint, reduce, world } = ctx;
  const tmp = [0, 0, 0];

  // ---------- Source documents: a fan of report pages with lines of "text" ----------
  const P = 5, LINES = 13, PW = 1.5, PH = 1.95;
  const pages = [];
  for (let k = 0; k < P; k++) {
    const lines = [];
    for (let l = 0; l < LINES; l++) lines.push(l === 0 ? 0.5 : l % 4 === 3 ? 0.3 + Math.random() * 0.35 : 0.82 + Math.random() * 0.18);
    pages.push({ x: 0.36 - k * 0.2, y: 0.22 - k * 0.07, z: -k * 0.22, rot: (k - 2) * 0.035, lines });
  }
  const pg = new Uint8Array(N), ln = new Uint8Array(N), lu = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pg[i] = Math.random() < 0.4 ? 0 : 1 + Math.floor(Math.random() * (P - 1)); // the front page is densest
    ln[i] = Math.floor(Math.random() * LINES);
    lu[i] = Math.random();
  }
  const lineY = (l) => PH / 2 - 0.25 - l * 0.125;
  const lineX = (k, l, u) => -PW / 2 + 0.15 + u * pages[k].lines[l] * (PW - 0.3);
  // page-local point -> world, for the stack scaled by s and moved to (ox, oy)
  function pageXY(k, lx, ly, s, ox, oy, o3) {
    const p = pages[k], c = Math.cos(p.rot), sn = Math.sin(p.rot);
    o3[0] = (p.x + lx * c - ly * sn) * s + ox; o3[1] = (p.y + lx * sn + ly * c) * s + oy; o3[2] = p.z * s;
    return o3;
  }
  function pagePoint(i, s, ox, oy, out) {
    const o = i * 3, l = ln[i];
    pageXY(pg[i], lineX(pg[i], l, lu[i]), lineY(l) + jit[o + 1] * (l === 0 ? 0.03 : 0.012), s, ox, oy, tmp);
    out[o] = tmp[0]; out[o + 1] = tmp[1]; out[o + 2] = tmp[2] + jit[o + 2] * 0.008;
  }
  // Where the page stack sits in each stage: [scale, x, y]
  const STACK = [[1, 0, 0], [0.5, -2.05, 0.1], [0.6, -1.75, 0]];

  const stage0 = new Float32Array(N * 3), src = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pagePoint(i, 1, 0, 0, stage0); pagePoint(i, ...STACK[1], src); }

  // ---------- Agents: samples flow page -> agent -> agent -> agent -> dataset; some are rejected ----------
  const AG = [[-0.75, 0.5, 0], [0.15, -0.42, 0], [1.0, 0.45, 0]], OUT = [2.0, 0, 0];
  const PATH_OK = [null, AG[0], AG[1], AG[2], OUT];
  const PATH_REJECT = [null, AG[0], AG[1], [AG[1][0] + 0.35, -2.4, 0]];
  function stage1(out, t) {
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      if (i % 3 === 0) { out[o] = src[o]; out[o + 1] = src[o + 1]; out[o + 2] = src[o + 2]; continue; }
      const path = i % 5 === 1 ? PATH_REJECT : PATH_OK;
      const segs = path.length - 1;
      const phase = reduce ? rand[i] : (t * 0.1 + rand[i]) % 1;
      const u = phase * segs, s = Math.min(segs - 1, Math.floor(u));
      let f = u - s; f = f * f * (3 - 2 * f); // ease, so samples gather at each agent
      const b = path[s + 1];
      const spread = s + 1 === segs && path === PATH_OK ? 0.16 * f + 0.06 : 0.07;
      for (let d = 0; d < 3; d++) {
        const a = s === 0 ? src[o + d] : path[s][d];
        out[o + d] = a + (b[d] - a) * f + jit[o + d] * spread;
      }
    }
  }

  // ---------- Dataset: a dense lattice of samples next to the source pages ----------
  const BLOCK = { x: 1.15, w: 1.5, h: 1.3, d: 0.6 };
  const data = [];
  for (let i = 0; i < N; i++) if (i % 3 !== 0) data.push(i);
  const GZ = 6, perLayer = Math.ceil(data.length / GZ);
  const GX = Math.ceil(Math.sqrt(perLayer * BLOCK.w / BLOCK.h)), GY = Math.ceil(perLayer / GX);
  const lat = new Float32Array(N * 3); // normalised lattice coords in [-0.5, 0.5]
  for (let i = 0; i < N; i++) { lat[i * 3] = Math.random() - 0.5; lat[i * 3 + 1] = Math.random() - 0.5; lat[i * 3 + 2] = Math.random() - 0.5; }
  data.forEach((i, r) => {
    const gx = r % GX, gy = Math.floor(r / GX) % GY, gz = Math.floor(r / (GX * GY));
    lat[i * 3] = gx / (GX - 1) - 0.5; lat[i * 3 + 1] = gy / (GY - 1) - 0.5; lat[i * 3 + 2] = gz / (GZ - 1) - 0.5;
  });
  const stage2 = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const o = i * 3;
    if (i % 3 === 0) pagePoint(i, ...STACK[2], stage2);
    else { stage2[o] = BLOCK.x + lat[o] * BLOCK.w; stage2[o + 1] = lat[o + 1] * BLOCK.h; stage2[o + 2] = lat[o + 2] * BLOCK.d; }
  }

  // ---------- Training: the dataset streams through the model onto a grid of GPUs ----------
  const DATA_Y = 0.95, LAYERS = [0.55, 0.3, 0.05, -0.2], GPU_Y = -0.95;
  const stage3 = new Float32Array(N * 3), sx = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const o = i * 3;
    stage3[o] = lat[o] * 3.2; stage3[o + 1] = DATA_Y + lat[o + 1] * 0.22; stage3[o + 2] = lat[o + 2] * 0.6;
    sx[i] = (Math.random() - 0.5) * 3.0;
  }
  function stage3Fill(out, t) {
    out.set(stage3);
    for (let i = 2; i < N; i += 3) {
      const o = i * 3, phase = reduce ? rand[i] : (t * 0.3 + rand[i]) % 1;
      out[o] = sx[i]; out[o + 1] = DATA_Y - 0.15 - phase * 1.65; out[o + 2] = jit[o + 2] * 0.2;
    }
  }

  // ---------- Results: two bars drawn to scale (-17 and +48 points) with particle labels ----------
  const SC = 1.5 / 48, HB = 17 * SC, CB = 48 * SC, BW = 0.55, BD = 0.3, X0 = -0.62, X1 = 0.62;
  const stage4 = new Float32Array(N * 3), label = [[], []];
  for (let i = 0; i < N; i++) {
    const o = i * 3;
    const bar = i % 6 === 0 ? Math.floor(i / 6) % 2 : Math.random() < 17 / 65 ? 0 : 1;
    if (i % 6 === 0) label[bar].push(i);
    let px = (Math.random() - 0.5) * BW, py = Math.random(), pz = (Math.random() - 0.5) * BD;
    if (Math.random() < 0.65) { // most points on the bar's surface so its edges read crisply
      const ax = Math.floor(Math.random() * 3);
      if (ax === 0) px = (px < 0 ? -0.5 : 0.5) * BW; else if (ax === 1) py = Math.random() < 0.5 ? 0 : 1; else pz = (pz < 0 ? -0.5 : 0.5) * BD;
    }
    stage4[o] = (bar ? X1 : X0) + px; stage4[o + 1] = bar ? py * CB : -py * HB; stage4[o + 2] = pz;
    tint[i] = bar ? 0.05 : 0.95; // accent for citation accuracy, accent-2 for hallucination
  }
  [['−17', X0, -HB - 0.28, label[0]], ['+48', X1, CB + 0.28, label[1]]].forEach(([text, x, y, ids]) => {
    ctx.sampleText(text, 0.62).then(({ pts }) => {
      ids.forEach((i) => {
        const p = pts[Math.floor(Math.random() * pts.length)];
        stage4[i * 3] = x + p[0]; stage4[i * 3 + 1] = y + p[1]; stage4[i * 3 + 2] = (Math.random() - 0.5) * 0.04;
      });
    });
  });

  // ---------- Overlays ----------
  const pageFill = ctx.material('fill', 'ink'), pageEdge = ctx.material('line', 'ink');
  const pageGroup = new THREE.Group();
  const pageGeo = new THREE.PlaneGeometry(PW, PH), pageEdges = new THREE.EdgesGeometry(pageGeo);
  pages.forEach((p) => {
    [new THREE.Mesh(pageGeo, pageFill), new THREE.LineSegments(pageEdges, pageEdge)].forEach((o) => {
      o.position.set(p.x, p.y, p.z - 0.01); o.rotation.z = p.rot; pageGroup.add(o);
    });
  });
  world.add(pageGroup);

  const agentMat = ctx.material('line', 'accent'), pathMat = ctx.material('line', 'ink');
  const agentGeo = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.2, 1));
  const agents = AG.map((a) => { const m = new THREE.LineSegments(agentGeo, agentMat); m.position.set(...a); world.add(m); return m; });
  const pathPts = [[-2.05 + 0.18, 0.1, 0], ...AG, OUT].map((p) => new THREE.Vector3(...p));
  world.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(new THREE.CatmullRomCurve3(pathPts).getPoints(120)), pathMat));

  // citation threads: from samples on the front of the dataset to exact sentences on the front page
  const threadMat = ctx.material('line', 'accent2'), threadList = [];
  for (let n = 0; n < 34; n++) {
    const l = 1 + Math.floor(Math.random() * (LINES - 1)), u = 0.2 + Math.random() * 0.6;
    const b = pageXY(0, lineX(0, l, u), lineY(l), ...STACK[2], [0, 0, 0]);
    const a = [BLOCK.x + (Math.random() - 0.5) * BLOCK.w * 0.9, (Math.random() - 0.5) * BLOCK.h * 0.9, BLOCK.d / 2];
    threadList.push({ a, b, bow: [0, 0.12, 0.55] });
  }
  world.add(new THREE.LineSegments(ctx.threads(threadList), threadMat));

  const setStack = ctx.layerStack(LAYERS, 3.8, 1.2);
  const gpuEdge = ctx.material('line', 'accent'), gpuFills = [];
  const gpuGeo = new THREE.BoxGeometry(0.3, 0.07, 0.2), gpuEdges = new THREE.EdgesGeometry(gpuGeo);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) {
    const m = ctx.material('fill', 'accent');
    gpuFills.push(m);
    [new THREE.Mesh(gpuGeo, m), new THREE.LineSegments(gpuEdges, gpuEdge)].forEach((o) => {
      o.position.set((c - 3.5) * 0.42, GPU_Y, (r - 1) * 0.3); world.add(o);
    });
  }

  const baseMat = ctx.material('line', 'ink');
  world.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1.25, 0, 0), new THREE.Vector3(1.25, 0, 0)]), baseMat));

  return {
    stages: [(out) => out.set(stage0), stage1, (out) => out.set(stage2), stage3Fill, (out) => out.set(stage4)],
    yaw: (v, t) => 0.15 * Math.sin(t * 0.4) * bump(v, 0, 1.2),
    update(v, t) {
      const lineBoost = ctx.dark ? 1 : 1.5;
      const s = lerpStages(v, [1, 0.5, 0.6, 0.6, 0.6]);
      pageGroup.scale.setScalar(s);
      pageGroup.position.set(lerpStages(v, [0, -2.05, -1.75, -1.75, -1.75]), lerpStages(v, [0, 0.1, 0, 0, 0]), 0);
      const pagesIn = smooth(-0.7, 0, v) * (1 - smooth(2.2, 2.9, v)); // fades in as the chapter starts
      pageFill.opacity = 0.05 * pagesIn; pageEdge.opacity = 0.3 * pagesIn * lineBoost;
      pageGroup.visible = pagesIn > 0.003;

      agentMat.opacity = 0.8 * bump(v, 1, 0.9);
      pathMat.opacity = 0.18 * bump(v, 1, 0.9) * lineBoost;
      agents.forEach((m, n) => { m.rotation.set(t * 0.4 + n, t * 0.6 + n * 2, 0); m.visible = agentMat.opacity > 0.005; });

      threadMat.opacity = bump(v, 2, 0.85) * (reduce ? 0.6 : 0.45 + 0.15 * Math.sin(t * 2)) * lineBoost;

      setStack(smooth(2.4, 3, v) * (1 - smooth(3.3, 3.9, v)));
      const gpuIn = bump(v, 3, 0.9);
      gpuEdge.opacity = 0.5 * gpuIn;
      gpuFills.forEach((m, n) => { m.opacity = gpuIn * (reduce ? 0.25 : 0.08 + 0.35 * Math.max(0, Math.sin(t * 3 + n * 1.7))); });

      baseMat.opacity = 0.5 * bump(v, 4, 0.9) * lineBoost;
      ctx.uniforms.uTintMix.value = smooth(3.3, 4, v);
    }
  };
}
