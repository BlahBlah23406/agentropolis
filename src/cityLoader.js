// Agentropolis City Builder — city config loader and building resolver.
// Zero dependencies. ES module.

import { readFile } from 'node:fs/promises';
import { BUILDING_TEMPLATES } from './buildings.js';
import { getConnectionType, validateConnection } from './connections.js';

const COL_X = [24, 260, 496, 732, 968];
const TOP_ROW_Y = 78;
const BOTTOM_ROW_Y = 430;

const INFRA_IDS = ['command', 'dispatch', 'archive'];

const INFRA_TEMPLATES = {
  command: {
    id: 'command', name: 'R2-D2 Command Dome', emoji: '\u{1F916}', category: 'utility',
    defaultRole: null, defaultModel: 'gemma4:e2b', workers: 1, duration: 0,
    description: 'Missions launch from here and finished work beeps back.',
  },
  dispatch: {
    id: 'dispatch', name: 'War Room', emoji: '\u{1F9ED}', category: 'utility',
    defaultRole: null, defaultModel: 'gemma4:e2b', workers: 1, duration: 0.5,
    description: 'Reads every mission and plans which bays handle it.',
  },
  archive: {
    id: 'archive', name: 'Memory Vault', emoji: '\u{1F5C4}\u{FE0F}', category: 'memory',
    defaultRole: 'You are the Memory Vault. Summarize the finished mission into a single durable sentence. Reply in under 60 words.',
    defaultModel: 'gemma4:e2b', workers: 1, duration: 0.5,
    description: 'Every finished mission is etched here.',
  },
};

/**
 * Resolve a raw city config into a DEPARTMENTS-shaped map.
 * @param {Object} cityConfig
 * @param {Object} [templates=BUILDING_TEMPLATES]
 * @returns {{departments: Object.<string,Object>, warnings: string[], errors: string[]}}
 */
export function resolveBuildings(cityConfig, templates = BUILDING_TEMPLATES) {
  const departments = {};
  const warnings = [];
  const errors = [];

  if (!cityConfig || !Array.isArray(cityConfig.buildings)) {
    errors.push('cityConfig.buildings must be an array.');
    return { departments, warnings, errors };
  }

  const seenIds = new Set();

  // Inject required infrastructure buildings if the user did not define them.
  for (const infraId of INFRA_IDS) {
    if (cityConfig.buildings.some(b => (b.id || b.template) === infraId)) continue;
    const t = INFRA_TEMPLATES[infraId];
    const built = {
      template: infraId,
      id: t.id,
      name: t.name,
      emoji: t.emoji,
      description: t.description,
      category: t.category,
      role: t.defaultRole,
      defaultModel: t.defaultModel,
      workers: t.workers,
      duration: t.duration,
      row: infraId === 'command' ? 0 : infraId === 'dispatch' ? 0 : 1,
      col: infraId === 'command' ? 0 : infraId === 'dispatch' ? 1 : 4,
      connections: {},
      templateOrigin: 'infrastructure',
    };
    const layoutBuilt = { ...built, row: built.row, col: built.col };
    const d = layoutCity([layoutBuilt])[0];
    departments[d.id] = d;
    seenIds.add(d.id);
  }

  for (const b of cityConfig.buildings) {
    const templateId = b.template || b.id;
    const template = templates[templateId];
    if (!template) {
      errors.push(`Unknown building template "${templateId}".`);
      continue;
    }

    const id = b.id || template.id;
    if (seenIds.has(id)) {
      errors.push(`Duplicate building id "${id}".`);
      continue;
    }
    seenIds.add(id);

    const dept = {
      id,
      name: b.name || template.name,
      emoji: template.emoji,
      description: template.description,
      category: template.category,
      role: b.role || template.defaultRole,
      defaultModel: b.model || cityConfig.model || template.defaultModel,
      workers: b.workers ?? template.workers,
      duration: b.duration ?? template.duration,
      row: b.row ?? 0,
      col: b.col ?? 0,
      connections: b.connections || {},
      template: template.id,
    };

    departments[id] = dept;

    for (const [connType, config] of Object.entries(dept.connections)) {
      const ct = getConnectionType(connType);
      if (!ct) {
        warnings.push(`Building "${id}" references unknown connection type "${connType}".`);
        continue;
      }
      if (config && config.enabled === false) continue;
      const v = validateConnection(connType, config);
      if (!v.ok) {
        warnings.push(`Building "${id}" connection "${connType}": ${v.message}`);
      }
    }
  }

  return { departments, warnings, errors };
}

/**
 * Auto-assign row/col positions to buildings in a grid.
 * @param {Object[]} buildings
 * @param {number} [cols=5]
 * @returns {Object[]}
 */
export function layoutCity(buildings, cols = 5) {
  if (!Array.isArray(buildings)) return [];
  return buildings.map((b, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    return { ...b, row: b.row ?? row, col: b.col ?? col };
  });
}

/**
 * Compute the pixel rectangle for a building in the city grid.
 * @param {Object} dept
 * @returns {{x:number, y:number, w:number, h:number}}
 */
export function buildingRectFor(dept) {
  const x = COL_X[Math.min(dept.col || 0, COL_X.length - 1)];
  const y = (dept.row || 0) === 0 ? TOP_ROW_Y : BOTTOM_ROW_Y;
  return { x, y, w: 180, h: 112 };
}

/**
 * Compute the door point for a building.
 * @param {Object} dept
 * @returns {{x:number, y:number}}
 */
export function doorPointFor(dept) {
  const r = buildingRectFor(dept);
  return (dept.row || 0) === 0
    ? { x: r.x + r.w / 2, y: r.y + r.h }
    : { x: r.x + r.w / 2, y: r.y };
}

/**
 * Load and resolve a city.json file from disk.
 * @param {string} path
 * @returns {Promise<{config: Object, departments: Object, warnings: string[], errors: string[]}>}
 */
export async function loadCity(path) {
  const raw = await readFile(path, 'utf8');
  const config = JSON.parse(raw);
  const layout = config.buildings ? layoutCity(config.buildings) : [];
  const configWithLayout = { ...config, buildings: layout };
  const { departments, warnings, errors } = resolveBuildings(configWithLayout);
  return { config: configWithLayout, departments, warnings, errors };
}
