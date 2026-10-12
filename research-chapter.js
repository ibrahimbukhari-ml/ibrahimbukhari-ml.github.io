// Research chapter: signing hand -> keypoint skeleton -> frames over time -> tokens enter the LLM -> grounded words.
// Built around the origin, with the hand standing on y = -0.84. Used by phd.html after the map prologue.
import { THREE, smooth, bump } from './story-engine.js';

export const RESEARCH_KEYS = [
  { dir: [0, 0.05, 1], look: [0, 0.24, 0], r: 1.3 },
  { dir: [0.32, 0.1, 1], look: [0, 0.2, 0], r: 1.3 },
  { dir: [0.75, 0.42, 1], look: [0.3, 0.05, 0], r: 2.9 },
  { dir: [0, 0.85, 1], look: [0, 0.12, 0], r: 2.0 },
  { dir: [0, 0.08, 1], look: [0, 0.1, 0], r: 1.9 }
];

// v passed to update/sizeAt/yaw is local to this chapter: 0 = hand ... 4 = grounded words
export function buildResearch(ctx) {
  const { N, rand, jit, reduce, world } = ctx;

  // ---------- Hand model: palm ellipsoid + five bendable finger tubes ----------
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // Built with the palm facing -z, then z is flipped so it faces the camera.
  const fingers = [
    { base: [-0.46, -0.42, -0.04], dir: [-0.72, 0.69, 0], len: 0.62, r: 0.11, bendTo: [0.65, 0.15, -0.75] }, // thumb
    { base: [-0.36, 0.30, 0], dir: [-0.10, 1, 0], len: 0.86, r: 0.095 }, // index
    { base: [-0.12, 0.34, 0], dir: [-0.02, 1, 0], len: 0.96, r: 0.097 }, // middle
    { base: [0.13, 0.31, 0], dir: [0.06, 1, 0], len: 0.88, r: 0.092 },   // ring
    { base: [0.36, 0.24, 0], dir: [0.16, 1, 0], len: 0.68, r: 0.082 }    // pinky
  ];
  fingers.forEach((f) => {
    f.u = norm(f.dir);
    const b = f.bendTo || [0, 0, -1];
    const d = b[0] * f.u[0] + b[1] * f.u[1] + b[2] * f.u[2];
    f.b = norm([b[0] - d * f.u[0], b[1] - d * f.u[1], b[2] - d * f.u[2]]);
    f.side = cross(f.u, f.b);
  });
  // Curl per finger [thumb, index, middle, ring, pinky]
  const POSES = [
    [0.0, 0.0, 0.0, 0.0, 0.0],  // open hand
    [0.15, 1, 1, 1, 1],         // A
    [0.85, 0.0, 0.0, 1, 1],     // V
    [0.0, 0.0, 1, 1, 0.0],      // I-L-Y
    [0.0, 0.0, 1, 1, 1],        // L
    [0.0, 1, 1, 1, 0.0]         // Y
  ];
  function poseAt(t, out) {
    const seg = 2.4, idx = Math.floor(t / seg), f = (t % seg) / seg;
    const a = POSES[idx % POSES.length], b = POSES[(idx + 1) % POSES.length];
    let e = f < 0.55 ? 0 : (f - 0.55) / 0.45; e = e * e * (3 - 2 * e);
    for (let q = 0; q < 5; q++) out[q] = a[q] + (b[q] - a[q]) * e;
    return out;
  }
  // Point on finger fi at length s (0 base .. 1 tip); radial 0 gives the bone centre line
  function fingerPoint(fi, s, ang, radial, curl, o) {
    const f = fingers[fi], L = f.len, bend = curl[fi] * (fi === 0 ? 1.4 : 2.7), al = s * L;
    let along, out, sa, ca;
    if (bend < 0.02) { along = al; out = 0; sa = 0; ca = 1; }
    else { const kk = bend / L, A = kk * al; sa = Math.sin(A); ca = Math.cos(A); along = sa / kk; out = (1 - ca) / kk; }
    const rr = radial * f.r * (1 - 0.3 * s), cr = Math.cos(ang) * rr, sr = Math.sin(ang) * rr;
    for (let d = 0; d < 3; d++) {
      o[d] = f.base[d] + f.u[d] * along + f.b[d] * out + cr * (-f.u[d] * sa + f.b[d] * ca) + sr * f.side[d];
    }
    o[2] = -o[2];
    return o;
  }

  // 21 keypoints: wrist + 4 per finger. 20 bones.
  const J = 21;
  const BONES = [];
  for (let fi = 0; fi < 5; fi++) {
    BONES.push([0, 1 + fi * 4]);
    for (let j = 0; j < 3; j++) BONES.push([1 + fi * 4 + j, 2 + fi * 4 + j]);
  }
  const tmp = [0, 0, 0];
  function computeJoints(curl, scale, ox, oy, oz, out) {
    out[0] = ox; out[1] = -0.78 * scale + oy; out[2] = oz;
    for (let fi = 0; fi < 5; fi++) {
      for (let j = 0; j < 4; j++) {
        fingerPoint(fi, j / 3, 0, 0, curl, tmp);
        const o = (1 + fi * 4 + j) * 3;
        out[o] = tmp[0] * scale + ox; out[o + 1] = tmp[1] * scale + oy; out[o + 2] = tmp[2] * scale + oz;
      }
    }
    return out;
  }

  // ---------- Particles ----------
  const T = 8; // frames / visual tokens
  const PALM = Math.floor(N * 0.3);
  const part = new Int8Array(N), hs = new Float32Array(N), ha = new Float32Array(N);
  const palm = new Float32Array(N * 3), cube = new Float32Array(N * 3);
  const boneA = new Uint8Array(N), boneB = new Uint8Array(N), bt = new Float32Array(N);
  const isJoint = new Uint8Array(N), jointIdx = new Uint8Array(N);

  for (let i = 0; i < N; i++) {
    // a point on the surface of a token cube
    const face = Math.floor(Math.random() * 6), ax = face >> 1, sign = face & 1 ? 1 : -1, h = 0.13;
    for (let d = 0; d < 3; d++) cube[i * 3 + d] = d === ax ? sign * h : (Math.random() * 2 - 1) * h;
  }
  const weights = fingers.map((f) => f.len * f.r), wsum = weights.reduce((a, b) => a + b, 0);
  let k = PALM;
  fingers.forEach((f, fi) => {
    const count = fi === 4 ? N - k : Math.round((N - PALM) * weights[fi] / wsum);
    for (let j = 0; j < count; j++, k++) { part[k] = fi; hs[k] = Math.random(); ha[k] = Math.random() * Math.PI * 2; }
  });
  for (let i = 0; i < PALM; i++) {
    part[i] = -1;
    const z = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, rr = Math.sqrt(1 - z * z);
    palm[i * 3] = Math.cos(a) * rr * 0.56;
    palm[i * 3 + 1] = Math.sin(a) * rr * 0.62 - 0.22;
    palm[i * 3 + 2] = -z * 0.16;
  }
  // Each particle belongs to one bone, so the hand collapses onto its own skeleton
  for (let i = 0; i < N; i++) {
    isJoint[i] = Math.random() < 0.3 ? 1 : 0;
    if (part[i] < 0) {
      const fi = Math.floor(Math.random() * 5);
      boneA[i] = 0; boneB[i] = 1 + fi * 4; bt[i] = Math.random();
      jointIdx[i] = Math.random() < 0.4 ? 0 : 1 + fi * 4;
    } else {
      const fi = part[i], s = hs[i], seg = Math.min(2, Math.floor(s * 3));
      boneA[i] = 1 + fi * 4 + seg; boneB[i] = boneA[i] + 1; bt[i] = s * 3 - seg;
      jointIdx[i] = 1 + fi * 4 + Math.round(s * 3);
    }
  }
  function skeletonTarget(i, Jt, spread, out) {
    const o = i * 3;
    if (isJoint[i]) {
      const j = jointIdx[i] * 3, r = 0.03 * spread;
      out[o] = Jt[j] + jit[o] * r; out[o + 1] = Jt[j + 1] + jit[o + 1] * r; out[o + 2] = Jt[j + 2] + jit[o + 2] * r;
    } else {
      const a = boneA[i] * 3, b = boneB[i] * 3, t = bt[i], r = (part[i] < 0 ? 0.02 : 0.013) * spread;
      for (let d = 0; d < 3; d++) out[o + d] = Jt[a + d] + (Jt[b + d] - Jt[a + d]) * t + jit[o + d] * r;
    }
  }

  // Layout of the later stages
  const FRAME_SCALE = 0.42, FRAME_GAP = 0.8;
  const frameJoints = [];
  for (let fr = 0; fr < T; fr++) {
    const c = poseAt(fr * 1.3 + 0.5, [0, 0, 0, 0, 0]);
    frameJoints.push(computeJoints(c, FRAME_SCALE, (fr - (T - 1) / 2) * FRAME_GAP, 0, 0, new Float32Array(J * 3)));
  }
  const TOKEN_Y = 0.95, WORDS_Y = -0.74, LAYERS = [0.55, 0.3, 0.05, -0.2];
  const tokens = [];
  for (let fr = 0; fr < T; fr++) tokens.push([(fr - (T - 1) / 2) * 0.44, TOKEN_Y, 0]);

  const stage2 = new Float32Array(N * 3), stage3 = new Float32Array(N * 3), stage4 = new Float32Array(N * 3);
  const flow = [];
  for (let i = 0; i < N; i++) {
    const fr = i % T, tk = tokens[fr], o = i * 3;
    skeletonTarget(i, frameJoints[fr], 0.6, stage2);
    const shell = i % 3 === 1 ? 0.8 : 1;
    for (let d = 0; d < 3; d++) stage3[o + d] = tk[d] + cube[o + d] * shell;
    stage4[o] = stage3[o]; stage4[o + 1] = stage3[o + 1]; stage4[o + 2] = stage3[o + 2];
    if (i % 3 === 2) flow.push(i);
  }

  const curlNow = [0, 0, 0, 0, 0];
  const jointsNow = new Float32Array(J * 3);
  const stages = [
    (out) => {
      for (let i = 0; i < N; i++) {
        const o = i * 3;
        if (part[i] < 0) { out[o] = palm[o]; out[o + 1] = palm[o + 1]; out[o + 2] = palm[o + 2]; }
        else { fingerPoint(part[i], hs[i], ha[i], 1, curlNow, tmp); out[o] = tmp[0]; out[o + 1] = tmp[1]; out[o + 2] = tmp[2]; }
      }
    },
    (out) => { for (let i = 0; i < N; i++) skeletonTarget(i, jointsNow, 1, out); },
    (out) => out.set(stage2),
    (out, t) => {
      out.set(stage3);
      // a third of the particles stream down from the tokens through the layers
      for (const i of flow) {
        const o = i * 3, tk = tokens[i % T];
        const phase = reduce ? rand[i] : (t * 0.28 + rand[i]) % 1;
        out[o] = tk[0] + cube[o] * 0.5;
        out[o + 1] = TOKEN_Y - 0.17 - phase * 1.55;
        out[o + 2] = cube[o + 2] * 1.6;
      }
    },
    (out) => out.set(stage4)
  ];

  // ---------- Overlays ----------
  const skelMat = ctx.material('line', 'accent'), stripMat = ctx.material('line', 'accent');
  const trajMat = ctx.material('line', 'accent2'), boxMat = ctx.material('line', 'ink'), attnMat = ctx.material('line', 'accent2');

  const skelPos = new Float32Array(BONES.length * 6);
  const skelGeom = new THREE.BufferGeometry();
  skelGeom.setAttribute('position', new THREE.BufferAttribute(skelPos, 3).setUsage(THREE.DynamicDrawUsage));
  const skel = new THREE.LineSegments(skelGeom, skelMat);
  skel.frustumCulled = false;
  world.add(skel);
  function updateSkeleton(Jt, out) {
    BONES.forEach(([a, b], n) => {
      for (let d = 0; d < 3; d++) { out[n * 6 + d] = Jt[a * 3 + d]; out[n * 6 + 3 + d] = Jt[b * 3 + d]; }
    });
  }

  const stripPos = new Float32Array(T * BONES.length * 6);
  frameJoints.forEach((Jt, fr) => updateSkeleton(Jt, stripPos.subarray(fr * BONES.length * 6)));
  const stripGeom = new THREE.BufferGeometry();
  stripGeom.setAttribute('position', new THREE.BufferAttribute(stripPos, 3));
  world.add(new THREE.LineSegments(stripGeom, stripMat));

  // fingertip paths across the frames (index and thumb)
  [8, 4].forEach((tip) => {
    const pts = frameJoints.map((Jt) => new THREE.Vector3(Jt[tip * 3], Jt[tip * 3 + 1], Jt[tip * 3 + 2]));
    const curve = new THREE.CatmullRomCurve3(pts);
    world.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(120)), trajMat));
  });

  const boxGeom = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.29, 0.29, 0.29));
  const boxes = tokens.map(() => { const b = new THREE.LineSegments(boxGeom, boxMat); world.add(b); return b; });

  const setStack = ctx.layerStack(LAYERS, 3.8, 1.2);
  const attn = new THREE.LineSegments(new THREE.BufferGeometry(), attnMat);
  world.add(attn);

  // Words, and the attention threads from each word to the tokens it draws on
  ctx.sampleText('nice to meet you', 3.1).then(({ pts, words }) => {
    for (let i = 0; i < N; i++) {
      if (i % 3 === 0) continue;
      const p = pts[Math.floor(Math.random() * pts.length)];
      stage4[i * 3] = p[0]; stage4[i * 3 + 1] = p[1] + WORDS_Y; stage4[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
    }
    const list = [];
    words.forEach((w, wi) => {
      const centre = ((wi + 0.5) / words.length) * T - 0.5;
      new Set([Math.floor(centre), Math.ceil(centre), (Math.round(centre) + 3 + wi) % T]).forEach((ti) => {
        list.push({ a: [w.cx, WORDS_Y + 0.22, 0], b: [tokens[ti][0], TOKEN_Y - 0.16, 0], bow: [0, 0, 0.45] });
      });
    });
    attn.geometry = ctx.threads(list, 28);
  });

  return {
    stages,
    sizeAt: (v) => 1 + 0.9 * bump(v, 2, 1),
    yaw: (v, t) => 0.28 * Math.sin(t * 0.5) * bump(v, 0, 1.2),
    update(v, t) {
      if (v < 2) {
        if (reduce) curlNow.splice(0, 5, ...POSES[3]); else poseAt(t, curlNow);
        computeJoints(curlNow, 1, 0, 0, 0, jointsNow);
      }
      skelMat.opacity = 0.75 * bump(v, 1, 0.9);
      skel.visible = skelMat.opacity > 0.005;
      if (skel.visible) { updateSkeleton(jointsNow, skelPos); skelGeom.attributes.position.needsUpdate = true; }
      stripMat.opacity = 0.5 * bump(v, 2, 0.8);
      trajMat.opacity = 0.9 * bump(v, 2, 0.8);
      const boxIn = smooth(2.3, 3, v);
      boxMat.opacity = 0.7 * smooth(2.5, 3, v);
      boxes.forEach((b, fr) => {
        const fx = (fr - (T - 1) / 2) * FRAME_GAP;
        b.position.set(fx + (tokens[fr][0] - fx) * boxIn, 0.05 + (TOKEN_Y - 0.05) * boxIn, 0);
        b.visible = boxMat.opacity > 0.005;
      });
      setStack(smooth(2.4, 3, v) * (1 - 0.65 * smooth(3.2, 3.9, v)));
      attnMat.opacity = smooth(3.4, 4, v) * (reduce ? 0.6 : 0.45 + 0.15 * Math.sin(t * 2)) * (ctx.dark ? 1 : 1.5);
    }
  };
}
