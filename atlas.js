// Particle-map helpers for the story pages: projection, cities and the baked dot grids in assets/atlas.json.

export const CITIES = {
  islamabad: { lon: 73.05, lat: 33.68 },
  donostia: { lon: -1.98, lat: 43.32 },
  nancy: { lon: 6.18, lat: 48.69 },
  paris: { lon: 2.35, lat: 48.86 },
  bilbao: { lon: -2.93, lat: 43.26 }
};

export async function loadAtlas(url = 'assets/atlas.json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`atlas: ${res.status}`);
  return res.json();
}

// Equirectangular projection onto the ground plane (x east, z south) at height y, centred on `origin`.
// Projections that share refLat line up exactly, so chapters centred on different cities fit one map.
export function projector(origin, unitsPerDeg, y = 0, refLat = origin.lat) {
  const kx = Math.cos(refLat * Math.PI / 180) * unitsPerDeg;
  return (lon, lat, out = [0, 0, 0]) => {
    out[0] = (lon - origin.lon) * kx; out[1] = y; out[2] = -(lat - origin.lat) * unitsPerDeg;
    return out;
  };
}

// Centres of the cells of a run grid, optionally inside box [lon0, lat0, lon1, lat1], as flat [lon, lat, ...]
export function gridCells(g, box) {
  const out = [];
  g.runs.forEach((r, j) => {
    const lat = g.lat0 + (j + 0.5) * g.step;
    if (box && (lat < box[1] || lat > box[3])) return;
    for (let i = 0; i < r.length; i += 2) {
      for (let c = r[i]; c <= r[i + 1]; c++) {
        const lon = g.lon0 + (c + 0.5) * g.step;
        if (!box || (lon >= box[0] && lon <= box[2])) out.push(lon, lat);
      }
    }
  });
  return out;
}

// Flat [lon, lat, ...] -> Float32Array of projected xyz
export function projectCells(cells, project) {
  const out = new Float32Array((cells.length / 2) * 3), p = [0, 0, 0];
  for (let i = 0, n = 0; i < cells.length; i += 2, n += 3) {
    project(cells[i], cells[i + 1], p);
    out[n] = p[0]; out[n + 1] = p[1]; out[n + 2] = p[2];
  }
  return out;
}

// Coastlines and borders inside box as LineSegments positions
export function borderSegments(atlas, project, box) {
  const out = [], a = [0, 0, 0], b = [0, 0, 0];
  const inside = (lon, lat) => !box || (lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3]);
  for (const line of atlas.borders) {
    for (let i = 0; i + 3 < line.length; i += 2) {
      if (!inside(line[i], line[i + 1]) && !inside(line[i + 2], line[i + 3])) continue;
      project(line[i], line[i + 1], a); project(line[i + 2], line[i + 3], b);
      out.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
  }
  return new Float32Array(out);
}

// n random points inside a focus country, jittered within its cells, written as xyz into out (or a new array)
export function sampleCountry(g, n, project, out = new Float32Array(n * 3)) {
  const cells = gridCells(g), count = cells.length / 2, p = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const c = Math.floor(Math.random() * count) * 2;
    project(cells[c] + (Math.random() - 0.5) * g.step, cells[c + 1] + (Math.random() - 0.5) * g.step, p);
    out[i * 3] = p[0]; out[i * 3 + 1] = p[1]; out[i * 3 + 2] = p[2];
  }
  return out;
}
