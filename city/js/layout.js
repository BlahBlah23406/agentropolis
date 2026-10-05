// City layout: where every building stands, and where the roads run.
//
// Roads are not decoration. Each one is laid along a path that mail or a
// worker can actually travel in this city's workflow (a handoff, an errand,
// a meeting), so the street map is a picture of the agent system's wiring.

import { agentOrder, cityEdges, TOWN_HALL, PLAZA, TOOL_PLACES } from '../../src/city/index.mjs';

const CELL = 4; // a 2x2 building plus a 2-tile street on each side

/** Seeded random numbers, so the same city always grows the same trees. */
function rng(seed) {
  let s = 0;
  for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export const placeId = (tool) => `tool:${TOOL_PLACES[tool]?.place || tool}`;

/**
 * Lay a city out on a grid.
 * @param {Object} city - a normalized city file
 * @returns {{size: {w: number, h: number}, buildings: Object[], roads: Set<string>, trees: Object[], byId: Map}}
 */
export function layoutCity(city) {
  const offices = agentOrder(city);
  const toolSet = [];
  for (const a of city.agents) {
    for (const t of a.tools || []) {
      if (t === 'ask_mayor' || !TOOL_PLACES[t]) continue;
      const id = placeId(t);
      if (!toolSet.some((x) => x.id === id)) toolSet.push({ id, tool: t, meta: TOOL_PLACES[t] });
    }
  }
  const conversation = city.workflow?.type === 'conversation';

  const perRow = Math.min(4, Math.max(1, offices.length));
  const officeRows = [];
  for (let i = 0; i < offices.length; i += perRow) officeRows.push(offices.slice(i, i + perRow));
  const colsWide = Math.max(3, perRow, toolSet.length);

  const rows = [];
  if (toolSet.length) rows.push({ kind: 'tools', items: toolSet });
  for (const r of officeRows) rows.push({ kind: 'offices', items: r });
  if (conversation) rows.push({ kind: 'plaza', items: [PLAZA] });
  rows.push({ kind: 'townhall', items: [TOWN_HALL] });

  const w = colsWide * CELL + 2;
  const h = rows.length * CELL + 2;
  const buildings = [];
  const byAgent = new Map(city.agents.map((a) => [a.name, a]));

  rows.forEach((row, r) => {
    const n = row.items.length;
    const offset = (colsWide - n) / 2; // centre short rows
    row.items.forEach((item, c) => {
      const cx = Math.round((offset + c) * CELL) + 2;
      const cy = r * CELL + 2;
      if (row.kind === 'tools') {
        buildings.push(building({
          id: item.id, kind: 'tool', tool: item.tool, x: cx, y: cy, w: 2, h: 2,
          color: item.meta.color, roof: item.meta.roof, emoji: item.meta.emoji,
          label: item.meta.place, height: 34,
        }));
      } else if (row.kind === 'offices') {
        const a = byAgent.get(item) || { name: item, city: {} };
        buildings.push(building({
          id: item, kind: 'office', x: cx, y: cy, w: 2, h: 2,
          color: a.city?.color || '#7c8cff', roof: 'pitched', emoji: a.city?.emoji || '🙂',
          label: a.city?.person || item, sublabel: a.role || '', height: 30,
        }));
      } else if (row.kind === 'plaza') {
        buildings.push(building({
          id: PLAZA, kind: 'plaza', x: cx - 1 + Math.floor((CELL - 3) / 2), y: cy, w: 3, h: 3,
          color: '#d9cfb8', roof: 'plaza', emoji: '⛲', label: 'Plaza', sublabel: 'meetings', height: 0,
        }));
      } else {
        buildings.push(building({
          id: TOWN_HALL, kind: 'townhall', x: cx - 1 + Math.floor((CELL - 3) / 2), y: cy, w: 3, h: 2,
          color: '#e9c46a', roof: 'dome', emoji: '🏛️', label: 'Town Hall', sublabel: 'you, the Mayor', height: 40,
        }));
      }
    });
  });

  const byId = new Map(buildings.map((b) => [b.id, b]));
  const blocked = new Set();
  for (const b of buildings) {
    for (let x = b.x; x < b.x + b.w; x++) for (let y = b.y; y < b.y + b.h; y++) blocked.add(`${x},${y}`);
  }

  // Lay roads along every route the city really uses.
  const roads = new Set();
  const routes = cityEdges(city).map((e) => [e.from, e.to]);
  for (const a of city.agents) {
    if (!routes.some(([f, t]) => (f === TOWN_HALL && t === a.name) || (t === TOWN_HALL && f === a.name))) {
      routes.push([TOWN_HALL, a.name]); // town hall can always reach every worker
    }
    for (const t of a.tools || []) {
      if (t === 'ask_mayor') routes.push([a.name, TOWN_HALL]);
      else if (TOOL_PLACES[t]) routes.push([a.name, placeId(t)]);
    }
  }
  for (const [from, to] of routes) {
    const A = byId.get(from); const B = byId.get(to);
    if (!A || !B) continue;
    const path = findPath(A.door, B.door, { w, h, blocked, roads, roadCost: 0.35 });
    for (const p of path) roads.add(`${p.x},${p.y}`);
  }

  const rand = rng(city.name);
  const doorNear = new Set(buildings.flatMap((b) => [`${b.door.x},${b.door.y}`]));
  const trees = [];
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const k = `${x},${y}`;
      if (blocked.has(k) || roads.has(k) || doorNear.has(k)) continue;
      if (rand() < 0.16) trees.push({ x: x + 0.5, y: y + 0.5, size: 0.7 + rand() * 0.5, hue: rand() });
    }
  }

  return { size: { w, h }, buildings, byId, roads, trees, blocked };
}

function building(b) {
  // The door is the tile just in front of the building's front-left wall.
  return { ...b, door: { x: b.x + Math.floor(b.w / 2), y: b.y + b.h } };
}

/**
 * A* over the grid. Buildings block; existing roads are cheap, so new routes
 * merge into the street network instead of carving parallel lanes.
 * @returns {{x: number, y: number}[]}
 */
export function findPath(start, goal, { w, h, blocked, roads, roadCost = 0.35 }) {
  const key = (x, y) => `${x},${y}`;
  const open = [{ x: start.x, y: start.y, g: 0, f: 0 }];
  const came = new Map();
  const g = new Map([[key(start.x, start.y), 0]]);
  const goalKey = key(goal.x, goal.y);
  let guard = 0;
  while (open.length && guard++ < 20000) {
    open.sort((a, b) => a.f - b.f);
    const cur = open.shift();
    const ck = key(cur.x, cur.y);
    if (ck === goalKey) {
      const path = [{ x: cur.x, y: cur.y }];
      let k = ck;
      while (came.has(k)) { const p = came.get(k); path.unshift(p); k = key(p.x, p.y); }
      return path;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx; const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nk = key(nx, ny);
      if (blocked.has(nk) && nk !== goalKey) continue;
      const step = roads?.has(nk) ? roadCost : 1;
      const ng = g.get(ck) + step;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        came.set(nk, { x: cur.x, y: cur.y });
        open.push({ x: nx, y: ny, g: ng, f: ng + Math.abs(nx - goal.x) + Math.abs(ny - goal.y) * 1.0 });
      }
    }
  }
  return [start, goal];
}
