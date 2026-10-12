"""Bake assets/atlas.json for the story pages from Natural Earth (world-atlas countries-50m TopoJSON).

    curl -sSfL -o countries-50m.json https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json
    python3 -I tools/bake-atlas.py countries-50m.json assets/atlas.json

Output (all coordinates are lon/lat degrees):
  land     dot grid of the whole region, as per-row runs [c0, c1, c0, c1, ...] of land cells
  focus    finer grids for the highlighted countries (Spain, France, Pakistan), same run format
  borders  simplified coastlines and borders as flat [lon, lat, lon, lat, ...] polylines
"""
import json
import math
import sys

REGION = (-12.0, 18.0, 78.0, 62.0)  # lon0, lat0, lon1, lat1: Atlantic coast to Pakistan
LAND_STEP = 0.2
FOCUS = {
    'ESP': ('724', (-9.6, 35.9, 4.5, 44.0), 0.04),   # mainland Spain + Balearics (no Canaries)
    'FRA': ('250', (-5.2, 41.3, 9.7, 51.2), 0.05),   # metropolitan France + Corsica
    'PAK': ('586', (60.8, 23.6, 77.9, 37.1), 0.08),
}


def decode(tj):
    sx, sy = tj['transform']['scale']
    tx, ty = tj['transform']['translate']
    arcs = []
    for arc in tj['arcs']:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)
    return arcs


def ring(arcs, idxs):
    pts = []
    for i in idxs:
        a = arcs[i] if i >= 0 else arcs[~i][::-1]
        pts.extend(a if not pts else a[1:])
    return pts


def rings_of(arcs, geom):
    polys = [geom['arcs']] if geom['type'] == 'Polygon' else geom['arcs'] if geom['type'] == 'MultiPolygon' else []
    return [ring(arcs, r) for p in polys for r in p]


def scan(rings, box, step):
    """Even-odd scanline fill: per row, the [first, last] columns of each land interval."""
    lon0, lat0, lon1, lat1 = box
    cols, rows = round((lon1 - lon0) / step), round((lat1 - lat0) / step)
    edges = []
    for r in rings:
        for (x1, y1), (x2, y2) in zip(r, r[1:] + r[:1]):
            if y1 != y2 and max(y1, y2) >= lat0 and min(y1, y2) <= lat1:
                edges.append((x1, y1, x2, y2))
    out = []
    for j in range(rows):
        lat = lat0 + (j + 0.5) * step
        xs = sorted(x1 + (lat - y1) * (x2 - x1) / (y2 - y1) for x1, y1, x2, y2 in edges if (y1 <= lat) != (y2 <= lat))
        row = []
        for a, b in zip(xs[0::2], xs[1::2]):
            c0 = max(0, math.ceil((a - lon0) / step - 0.5))
            c1 = min(cols - 1, math.floor((b - lon0) / step - 0.5))
            if c1 >= c0:
                row += [c0, c1]
        out.append(row)
    return {'lon0': lon0, 'lat0': lat0, 'step': step, 'cols': cols, 'rows': rows, 'runs': out}


def simplify(pts, tol):
    """Radial-distance simplification, keeping the end points."""
    out = [pts[0]]
    for p in pts[1:-1]:
        if math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) >= tol:
            out.append(p)
    out.append(pts[-1])
    return out


def main(src, dst):
    tj = json.load(open(src))
    arcs = decode(tj)
    lon0, lat0, lon1, lat1 = REGION

    land = []
    for g in tj['objects']['land']['geometries']:
        land += rings_of(arcs, g)

    by_id = {g.get('id'): g for g in tj['objects']['countries']['geometries']}
    focus = {}
    for key, (cid, box, step) in FOCUS.items():
        focus[key] = scan(rings_of(arcs, by_id[cid]), box, step)

    borders = []
    for a in arcs:
        if not any(lon0 - 1 <= x <= lon1 + 1 and lat0 - 1 <= y <= lat1 + 1 for x, y in a):
            continue
        # finer detail around Western Europe, where the camera gets close
        near = any(-11 <= x <= 12 and 35 <= y <= 52 for x, y in a)
        pts = simplify(a, 0.03 if near else 0.12)
        if len(pts) >= 2:
            borders.append([round(v, 2) for p in pts for v in p])

    out = {'land': scan(land, REGION, LAND_STEP), 'focus': focus, 'borders': borders,
           'source': 'Natural Earth via world-atlas@2.0.2 countries-50m (public domain)'}
    with open(dst, 'w') as f:
        json.dump(out, f, separators=(',', ':'))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
