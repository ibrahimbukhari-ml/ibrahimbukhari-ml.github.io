// A country lit up in particles, with a column of light and a pulsing ring over a city and its pinned label.
// The city sits at `center` ([x, z] on the map, default the origin) and the map lies at y = mapY.
import { THREE } from './story-engine.js';
import { sampleCountry } from './atlas.js';

export function buildCityStage(ctx, { grid, project, mapY, height = 0.7, pinEl, center = [0, 0] }) {
  const { N, jit, world, reduce } = ctx;
  const [cx, cz] = center;

  const country = sampleCountry(grid, N, project);
  const lit = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const o = i * 3, k = i % 10;
    if (k === 0) { // ring at the foot of the column
      const a = Math.random() * Math.PI * 2, r = 0.07 + jit[o] * 0.006;
      lit[o] = cx + Math.cos(a) * r; lit[o + 1] = mapY + 0.004; lit[o + 2] = cz + Math.sin(a) * r;
    } else if (k <= 2) { // the column of light
      const h = Math.pow(Math.random(), 0.7) * height, rad = 0.014 * (1 - 0.6 * h / height);
      lit[o] = cx + jit[o] * rad; lit[o + 1] = mapY + h; lit[o + 2] = cz + jit[o + 2] * rad;
    } else {
      lit[o] = country[o]; lit[o + 1] = country[o + 1]; lit[o + 2] = country[o + 2];
    }
  }

  // A pulsing ring drawn on the map
  const ringMat = ctx.material('line', 'accent');
  const ringPts = [];
  for (let a = 0; a <= 64; a++) ringPts.push(new THREE.Vector3(Math.cos(a / 32 * Math.PI) * 0.11, 0, Math.sin(a / 32 * Math.PI) * 0.11));
  const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), ringMat);
  ring.position.set(cx, mapY, cz);
  world.add(ring);

  if (pinEl) ctx.pin(pinEl, [cx, mapY + height + 0.05, cz]);

  return {
    country: (out) => out.set(country),
    beacon: (out) => out.set(lit),
    // level: how present the ring is (0..1); pin: how visible the label is
    update(level, t, pin = level) {
      const pulse = reduce ? 0.5 : (t * 0.6) % 1;
      ring.scale.setScalar(0.6 + pulse * 1.2);
      ringMat.opacity = 0.9 * level * (1 - pulse);
      ring.visible = ringMat.opacity > 0.003;
      if (pinEl) pinEl.style.opacity = String(pin);
    }
  };
}
