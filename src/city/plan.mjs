// agentropolis/city — the city file
//
// A city file IS an agent system. It is the framework's own agent and workflow
// definitions, plus a little `city:` metadata (a person's name, an emoji) that
// the framework ignores. Nothing is translated on the way out: the file the
// browser exports is the file `agentropolis run my-city.yaml` executes.
//
//   agentropolis: city/1
//   name: Homework Helper
//   agents:   [ { name, role, system_prompt, tools, city: { person, emoji } } ]
//   workflow: { name, type: sequential|parallel|conversation|graph, ... }
//   safety:   { approve_before: [agent], inspector: true }
//   state:    { initial workflow state, for templates like {{review_notes}} }

import { WORKFLOW_TYPES } from '../framework/Workflow.mjs';
import { TOOL_NAMES } from './tools.mjs';

export const CITY_FORMAT = 'city/1';
export const TOWN_HALL = 'townhall';
export const PLAZA = 'plaza';

/** Plain-English names for the four ways a city can be organised. */
export const PATTERNS = Object.freeze({
  sequential: {
    city: 'Assembly line', emoji: '➡️',
    plain: 'Workers take turns in order. Each one gets the previous worker\'s mail, adds their part, and passes it on.',
  },
  parallel: {
    city: 'Everyone at once', emoji: '🔀',
    plain: 'Town Hall sends the same letter to every worker at the same time. They work side by side and all their answers come back.',
  },
  conversation: {
    city: 'Town meeting', emoji: '🗣️',
    plain: 'Workers meet in the plaza and talk in turns, each hearing everything said so far.',
  },
  graph: {
    city: 'Flowchart with decisions', emoji: '🔁',
    plain: 'Mail follows signposts. A worker\'s answer decides where it goes next — so work can loop back until it is good enough.',
  },
});

export function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '')
    .trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'worker';
}

/**
 * Bring a parsed city file to its canonical shape. Accepts camelCase or
 * snake_case keys (the Loader camelCases YAML; people hand-write snake_case).
 * @param {Object} raw
 * @returns {Object}
 */
export function normalizeCity(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('A city file must be an object');
  const agents = (raw.agents || []).map((a) => ({
    name: a.name,
    role: a.role || a.name,
    description: a.description || '',
    system_prompt: a.system_prompt ?? a.systemPrompt ?? '',
    tools: [...(a.tools || [])],
    ...(a.model ? { model: a.model } : {}),
    ...(a.max_tokens ?? a.maxTokens ? { max_tokens: a.max_tokens ?? a.maxTokens } : {}),
    ...(a.temperature !== undefined ? { temperature: a.temperature } : {}),
    ...(a.max_tool_iterations ?? a.maxToolIterations
      ? { max_tool_iterations: a.max_tool_iterations ?? a.maxToolIterations } : {}),
    city: { ...(a.city || {}) },
  }));
  const safety = raw.safety || {};
  return {
    agentropolis: CITY_FORMAT,
    name: raw.name || 'My City',
    emoji: raw.emoji || '🏙️',
    description: raw.description || '',
    example: raw.example || '',
    agents,
    workflow: structuredClone(raw.workflow || { name: slugify(raw.name), type: 'sequential', agents: agents.map((a) => a.name) }),
    safety: {
      approve_before: [...(safety.approve_before || safety.approveBefore || [])],
      inspector: Boolean(safety.inspector),
    },
    state: { ...(raw.state || {}) },
    ...(raw.layout ? { layout: structuredClone(raw.layout) } : {}),
  };
}

/** Agent names in the order the workflow first uses them. */
export function agentOrder(city) {
  const wf = city.workflow || {};
  let names;
  switch (wf.type) {
    case 'sequential': names = (wf.steps?.length ? wf.steps.map((s) => s.agent) : wf.agents) || []; break;
    case 'parallel': names = wf.parallel?.agents || wf.agents || []; break;
    case 'conversation': names = wf.agents || []; break;
    case 'graph': names = (wf.graph?.steps || wf.steps || []).map((s) => s.agent); break;
    default: names = [];
  }
  const seen = [...new Set(names)];
  for (const a of city.agents) if (!seen.includes(a.name)) seen.push(a.name);
  return seen;
}

/** Graph steps, wherever the definition put them. */
export function graphSteps(wf) {
  return wf.graph?.steps || wf.steps || [];
}

/**
 * The roads a city needs: every path mail can travel, at building level.
 * @returns {{from: string, to: string, kind: string, label?: string}[]}
 */
export function cityEdges(city) {
  const wf = city.workflow || {};
  const edges = [];
  const add = (from, to, kind, label) => {
    if (from && to && from !== to && !edges.some((e) => e.from === from && e.to === to)) {
      edges.push({ from, to, kind, ...(label ? { label } : {}) });
    }
  };
  if (wf.type === 'sequential') {
    const order = (wf.steps?.length ? wf.steps.map((s) => s.agent) : wf.agents) || [];
    [TOWN_HALL, ...order, TOWN_HALL].forEach((n, i, arr) => { if (i) add(arr[i - 1], n, 'handoff'); });
  } else if (wf.type === 'parallel') {
    for (const a of wf.parallel?.agents || wf.agents || []) {
      add(TOWN_HALL, a, 'handoff');
      add(a, TOWN_HALL, 'result');
    }
  } else if (wf.type === 'conversation') {
    add(TOWN_HALL, PLAZA, 'handoff');
    for (const a of wf.agents || []) { add(a, PLAZA, 'meeting'); add(PLAZA, a, 'meeting'); }
    add(PLAZA, TOWN_HALL, 'result');
  } else if (wf.type === 'graph') {
    const steps = graphSteps(wf);
    const byId = new Map(steps.map((s) => [s.id || s.agent, s]));
    const entry = byId.get(wf.graph?.entry) || steps[0];
    if (entry) add(TOWN_HALL, entry.agent, 'handoff');
    steps.forEach((s, i) => {
      const targets = s.condition
        ? [[s.condition.then, 'yes'], [s.condition.else, 'no']]
        : [[s.next ?? (steps[i + 1] ? (steps[i + 1].id || steps[i + 1].agent) : 'END'), '']];
      for (const [t, label] of targets) {
        const target = !t || t === 'END' ? TOWN_HALL : byId.get(t)?.agent;
        add(s.agent, target, label ? 'decision' : 'handoff', label);
      }
    });
  }
  return edges;
}

// ------------------------------------------------------------- conditions ---

const CONTAINS = /^\s*output\s*\.\s*includes\(\s*(["'])((?:\\.|(?!\1).)*)\1\s*\)\s*$/;

/** `output.includes("APPROVED")` -> "APPROVED"; anything else -> null. */
export function conditionWord(expr) {
  const m = CONTAINS.exec(String(expr || ''));
  if (!m) return null;
  try { return JSON.parse(`"${m[2].replace(/"/g, '\\"')}"`); } catch { return m[2]; }
}

/** The routing expression for "if the answer contains <word>". */
export function containsCondition(word) {
  return `output.includes(${JSON.stringify(String(word))})`;
}

/** Explain a routing condition in plain words. */
export function describeCondition(expr) {
  const w = conditionWord(expr);
  return w ? `the answer contains "${w}"` : `this rule is true: ${expr}`;
}

// ------------------------------------------------------------- validation ---

/**
 * Check a city file. Errors make it unrunnable; warnings are worth showing.
 * @returns {{ok: boolean, errors: string[], warnings: string[]}}
 */
export function validateCity(raw) {
  const errors = [];
  const warnings = [];
  let city;
  try { city = normalizeCity(raw); } catch (e) { return { ok: false, errors: [e.message], warnings }; }

  if (!city.agents.length) errors.push('The city has no workers yet — hire at least one.');
  const names = new Set();
  for (const a of city.agents) {
    const who = a.city?.person || a.name || '(unnamed)';
    if (!a.name || !/^[\w-]+$/.test(a.name)) errors.push(`Worker "${who}" needs a simple id (letters, numbers, dashes).`);
    if (names.has(a.name)) errors.push(`Two workers share the id "${a.name}".`);
    names.add(a.name);
    if (!String(a.system_prompt).trim()) errors.push(`${who} has no job description.`);
    for (const t of a.tools) if (!TOOL_NAMES.includes(t)) warnings.push(`${who} uses a tool this city does not have: "${t}".`);
  }

  const wf = city.workflow;
  if (!WORKFLOW_TYPES.includes(wf.type)) {
    errors.push(`Unknown way of working "${wf.type}". Use one of: ${WORKFLOW_TYPES.join(', ')}.`);
  } else {
    const used = agentOrder({ ...city, agents: [] });
    if (!used.length) errors.push('Nobody is on the work route yet — add a worker to it.');
    for (const n of used) if (!names.has(n)) errors.push(`The work route mentions "${n}", but no worker has that id.`);
    if (wf.type === 'graph') {
      const steps = graphSteps(wf);
      const ids = new Set(steps.map((s) => s.id || s.agent));
      for (const s of steps) {
        for (const t of [s.next, s.condition?.then, s.condition?.else]) {
          if (t && t !== 'END' && !ids.has(t)) errors.push(`Step "${s.id || s.agent}" points to "${t}", which is not a step.`);
        }
      }
      if (wf.graph?.entry && !ids.has(wf.graph.entry)) errors.push(`The first step "${wf.graph.entry}" does not exist.`);
    }
  }
  for (const n of city.safety.approve_before) {
    if (!names.has(n)) warnings.push(`The Mayor's approval is set for "${n}", but there is no such worker.`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Split a city into the framework's definitions.
 * @returns {{agents: Object[], workflow: Object, state: Object}}
 */
export function compileCity(raw) {
  const city = normalizeCity(raw);
  const check = validateCity(city);
  if (!check.ok) throw new Error(`This city cannot run yet:\n- ${check.errors.join('\n- ')}`);
  const agents = city.agents.map(({ city: _meta, ...def }) => def);
  return { agents, workflow: city.workflow, state: city.state };
}

/** Make an id unique among the city's workers. */
export function uniqueAgentName(city, base) {
  const taken = new Set(city.agents.map((a) => a.name));
  let name = slugify(base);
  for (let i = 2; taken.has(name); i++) name = `${slugify(base)}-${i}`;
  return name;
}
