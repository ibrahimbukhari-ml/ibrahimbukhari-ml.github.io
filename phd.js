// PhD page: a particle map of Spain -> the camera descends on Bilbao -> the research chapter.
// Bilbao sits at the origin, so the beacon of light over the city turns straight into the signing hand.
import { runStory, THREE, smooth, lerpStages } from './story-engine.js';
import { loadAtlas, projector, gridCells, projectCells, borderSegments, CITIES } from './atlas.js';
import { buildCityStage } from './city-stage.js';
import { buildResearch, RESEARCH_KEYS } from './research-chapter.js';

const MAP_Y = -0.86;         // the map lies just under the hand's wrist
const BEACON = 0.7;          // height of the column of light over Bilbao
const PROLOGUE = 3;          // map stages before the research chapter
const project = projector(CITIES.bilbao, 0.32, MAP_Y);
const spain = project(-3.6, 40.2);

runStory({
  count: [7200, 4200],
  load: loadAtlas,
  overview: { dir: [0, 1.8, 1], look: [spain[0], MAP_Y, spain[2] - 0.6], r: 3.4 }, // arrive from high above Europe
  keys: [
    { dir: [0, 1.5, 1], look: [spain[0], MAP_Y, spain[2]], r: 1.75 }, // Spain from above
    { dir: [0.1, 0.8, 1], look: [0, MAP_Y + 0.32, 0], r: 0.8 },       // descending on Bilbao
    { dir: [0.7, 0.38, 1], look: [0, MAP_Y + 0.36, 0], r: 0.85 },     // low orbit around the beacon
    ...RESEARCH_KEYS
  ],
  build(ctx) {
    const { world, reduce, data: atlas } = ctx;
    const BOX = [-12, 34, 24, 58];

    // Static backdrop: dot-matrix land and thin coastlines/borders
    const land = ctx.dots(projectCells(gridCells(atlas.land, BOX), project), 'ink', 11);
    const borderMat = ctx.material('line', 'ink');
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(borderSegments(atlas, project, BOX), 3));
    world.add(new THREE.LineSegments(borderGeo, borderMat));

    // Particles fill Spain; then a share gathers into a ring and a column of light over Bilbao
    const city = buildCityStage(ctx, {
      grid: atlas.focus.ESP, project, mapY: MAP_Y, height: BEACON, pinEl: document.getElementById('pin-bilbao')
    });

    const research = buildResearch(ctx);
    let born = -1;

    return {
      stages: [
        city.country,
        city.beacon,
        city.beacon,
        ...research.stages
      ],
      sizeAt: (v) => (v < PROLOGUE
        ? lerpStages(v, [0.9, 0.45, 0.5, 1]) * (ctx.narrow.matches ? lerpStages(v, [1, 0.65, 0.65, 1]) : 1)
        : research.sizeAt(v - PROLOGUE)),
      yaw: (v, t) => research.yaw(v - PROLOGUE, t) * smooth(2.5, 3, v),
      update(v, t) {
        if (born < 0) born = t;
        const mapIn = (1 - smooth(2.2, 2.9, v)) * (reduce ? 1 : smooth(born, born + 1.4, t));
        land.setOpacity((ctx.dark ? 0.32 : 0.3) * mapIn);
        borderMat.opacity = (ctx.dark ? 0.28 : 0.4) * mapIn;

        city.update(smooth(0.4, 1, v) * (1 - smooth(2.2, 2.7, v)), t, smooth(0.6, 1, v) * (1 - smooth(2.2, 2.55, v)));

        research.update(v - PROLOGUE, t);
      }
    };
  }
});
