// Experience page: one tab per job. Every job sits at its city on a shared particle map of Europe;
// switching tabs flies the particles and the camera from one city to the next.
import { runStory, THREE, smooth, lerpStages } from './story-engine.js';
import { loadAtlas, projector, gridCells, projectCells, borderSegments, CITIES } from './atlas.js';
import { buildCityStage } from './city-stage.js';
import { buildCitation, CITATION_KEYS } from './citation-chapter.js';
import { buildVicomtech, VICOMTECH_KEYS } from './vicomtech-chapter.js';

const MAP_Y = -0.86, U = 0.32, REF_LAT = 46;
const ORIGIN = { lon: 2, lat: 46 };
const place = projector(ORIGIN, U, 0, REF_LAT);                  // chapter offsets in the shared world
const local = (c, y = MAP_Y) => projector(c, U, y, REF_LAT);     // map coordinates around one city
const offsetOf = (c) => place(c.lon, c.lat);

const CITY_KEY = { dir: [0.35, 0.75, 1], look: [0, MAP_Y + 0.32, 0], r: 0.8 };

// ---------- Tabs ----------
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const tabs = [...document.querySelectorAll('.xp-tab')];
const ids = tabs.map((t) => t.dataset.chapter);
const panel = (id) => document.getElementById(`panel-${id}`);
let current = ids.includes(location.hash.slice(1)) ? location.hash.slice(1) : ids[0];

function markTabs(id) {
  tabs.forEach((t) => {
    const on = t.dataset.chapter === id;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  });
}
markTabs(current);
ids.forEach((id) => { panel(id).hidden = id !== current; });

const story = runStory({
  count: [7200, 4200],
  load: loadAtlas,
  initial: current,
  steps: () => [...document.querySelectorAll('.xp-panel:not([hidden]) .step')],
  overview: { dir: [0, 1.6, 1], look: [0, MAP_Y, 0], r: 2.4 },
  shared(ctx) {
    const atlas = ctx.data, project = local(ORIGIN), BOX = [-13, 35, 22, 58];
    const land = ctx.dots(projectCells(gridCells(atlas.land, BOX), project), 'ink', 11);
    const borderMat = ctx.material('line', 'ink');
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(borderSegments(atlas, project, BOX), 3));
    ctx.world.add(new THREE.LineSegments(geo, borderMat));
    let born = -1;
    return {
      // the map stays under the city views and fades once a story is under way
      update({ id, v, flight, t }) {
        if (born < 0) born = t;
        const level = (flight < 1 ? 1 : 1 - smooth(0.3, 0.9, v)) * (reduce ? 1 : smooth(born, born + 1.2, t));
        land.setOpacity((ctx.dark ? 0.32 : 0.3) * level);
        borderMat.opacity = (ctx.dark ? 0.28 : 0.4) * level;
      }
    };
  },
  chapters: {
    ohvaillm: {
      offset: offsetOf(CITIES.paris),
      rail: [['Paris', 'OHVaiLLM'], ['01', 'Sources'], ['02', 'Agents'], ['03', 'Dataset'], ['04', 'Training'], ['05', 'Results']],
      keys: [CITY_KEY, ...CITATION_KEYS],
      build(ctx) {
        const city = buildCityStage(ctx, {
          grid: ctx.data.focus.FRA, project: local(CITIES.paris), mapY: MAP_Y, pinEl: document.getElementById('pin-paris')
        });
        const cite = buildCitation(ctx);
        return {
          stages: [city.beacon, ...cite.stages],
          sizeAt: (v) => lerpStages(v, [ctx.narrow.matches ? 0.35 : 0.5, 1]),
          yaw: (v, t) => cite.yaw(v - 1, t) * smooth(0.5, 1, v),
          update(v, t) {
            const lit = 1 - smooth(0.3, 0.8, v);
            city.update(lit, t, lit);
            cite.update(v - 1, t);
          }
        };
      }
    },
    vicomtech: {
      offset: offsetOf(CITIES.donostia),
      rail: [['Donostia', 'Vicomtech'], ['01', 'Seeds'], ['02', 'Variants'], ['03', 'Filter'], ['04', 'Evaluation'], ['05', 'Results']],
      keys: [CITY_KEY, ...VICOMTECH_KEYS],
      build(ctx) {
        const city = buildCityStage(ctx, {
          grid: ctx.data.focus.ESP, project: local(CITIES.donostia), mapY: MAP_Y, pinEl: document.getElementById('pin-donostia')
        });
        const vic = buildVicomtech(ctx, { mapY: MAP_Y });
        return {
          stages: [city.beacon, ...vic.stages],
          sizeAt: (v) => lerpStages(v, [ctx.narrow.matches ? 0.35 : 0.5, 1]),
          update(v, t) {
            const lit = 1 - smooth(0.3, 0.8, v);
            city.update(lit, t, lit);
            vic.update(v - 1, t);
          }
        };
      }
    }
  }
});

function select(id) {
  if (id === current || !ids.includes(id)) return;
  const old = panel(current), next = panel(id);
  current = id;
  markTabs(id);
  old.classList.add('is-leaving');
  setTimeout(() => {
    ids.forEach((k) => { const p = panel(k); p.classList.remove('is-leaving', 'is-entering'); p.hidden = k !== current; });
    if (current !== id) return; // superseded by a quicker click
    void next.offsetWidth;
    next.classList.add('is-entering');
    const top = document.getElementById('story').getBoundingClientRect().top + scrollY - 64;
    if (scrollY > top) window.scrollTo({ top, behavior: 'instant' });
    story.select(id);
    history.replaceState(null, '', `#${id}`);
  }, reduce ? 0 : 180);
}

tabs.forEach((t, i) => {
  t.addEventListener('click', () => select(t.dataset.chapter));
  t.addEventListener('keydown', (e) => {
    const n = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (n === undefined) return;
    e.preventDefault();
    const target = tabs[(n + tabs.length) % tabs.length];
    target.focus();
    select(target.dataset.chapter);
  });
});
