// Agentropolis City Builder — AI-powered building creator and planner.
// Zero dependencies. ES module.

import { BUILDING_TEMPLATES } from './buildings.js';
import { listConnectionTypes } from './connections.js';

/**
 * Parse a JSON object out of an LLM response, tolerating markdown fences.
 * @param {string} text
 * @returns {Object|null}
 */
export function extractJson(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const clean = fence ? fence[1].trim() : text.trim();
  try {
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

const GENERATION_SYSTEM = `You are the Agentropolis City Builder AI. Given a user's description of a task, design a building (department) for an AI-powered city.

Reply with ONLY a JSON object (no prose outside the JSON) using this exact schema:
{
  "name": "Short descriptive building name",
  "emoji": "a single emoji",
  "description": "One sentence describing what the building does",
  "category": "one of: research, engineering, communication, scheduling, security, memory, utility",
  "role": "A concise system prompt for the LLM agent working in this building",
  "model": "gemma4:e2b",
  "workers": 1-3,
  "duration": 0.5-3.0 (simulated work duration in seconds),
  "connections": [ "connection_type_id", ... ],
  "explanation": "One sentence explaining why this building fits the request"
}

Pick connection_type_id values only from the known types the user provides. If none are needed, use an empty array. Keep the role under 160 words.`;

/**
 * Ask an LLM to design a custom building from a natural language description.
 * @param {Object} options
 * @param {string} options.description
 * @param {string} [options.url='http://127.0.0.1:11434']
 * @param {string} [options.model='gemma4:e2b']
 * @param {Function} [options.fetchFn]
 * @returns {Promise<{building: Object, connections: Object[], explanation: string}>}
 */
export async function generateBuilding({ description, url = 'http://127.0.0.1:11434', model = 'gemma4:e2b', fetchFn } = {}) {
  const doFetch = fetchFn || fetch;
  const knownTypes = listConnectionTypes().map(c => `\n- ${c.type}: ${c.description}`).join('');
  const prompt = `User request: ${description}\n\nKnown connection types:${knownTypes}\n\nDesign a building as JSON.`;

  const res = await doFetch(`${url}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, system: GENERATION_SYSTEM, prompt, stream: false }),
  });
  if (!res.ok) throw new Error(`AI builder call failed: ${res.status}`);
  const data = await res.json();
  const parsed = extractJson(data.response || '');
  if (!parsed) throw new Error(`AI builder returned unparseable JSON: ${data.response}`);

  const id = parsed.name ? parsed.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') : 'custom_building';
  const building = {
    id,
    name: parsed.name || 'Custom Building',
    emoji: parsed.emoji || '\u{1F3DB}\u{FE0F}',
    description: parsed.description || '',
    category: parsed.category || 'utility',
    defaultRole: parsed.role || 'You are a helpful assistant.',
    defaultModel: parsed.model || 'gemma4:e2b',
    workers: Math.max(1, Math.min(10, Number(parsed.workers) || 1)),
    duration: Math.max(0.1, Number(parsed.duration) || 1.0),
    template: id,
  };

  const connections = [];
  if (Array.isArray(parsed.connections)) {
    for (const ct of parsed.connections) {
      connections.push({ type: ct, enabled: true });
    }
  }

  return {
    building,
    connections,
    explanation: parsed.explanation || 'AI-generated building from user description.',
  };
}

const PLANNER_SYSTEM_TEMPLATE = `You are the War Room of Agentropolis. You route incoming missions to the right buildings in the right order.

Available buildings:
{{buildings}}

Reply with ONLY a JSON array of building ids (1 to 3 ids) in processing order. Example: ["research_lab", "writing_studio"]. No other words.`;

/** @deprecated Use llmPlanner from ./engine.js for live city routing. */
export function aiPlanner({ url = 'http://127.0.0.1:11434', model = 'gemma4:e2b', fetchFn } = {}) {
  const doFetch = fetchFn || fetch;
  return async (missionText, buildingMap = BUILDING_TEMPLATES) => {
    const buildings = Object.values(buildingMap).map(d => `- ${d.id}: ${d.description || d.name}`).join('\n');
    const system = PLANNER_SYSTEM_TEMPLATE.replace('{{buildings}}', buildings || '(none)');

    const res = await doFetch(`${url}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, system, prompt: `Mission: ${missionText}`, stream: false }),
    });
    if (!res.ok) throw new Error(`AI planner call failed: ${res.status}`);
    const data = await res.json();
    const parsed = extractJson(data.response || '');
    if (Array.isArray(parsed)) {
      return parsed
        .map(p => String(p).trim().toLowerCase())
        .filter(p => buildingMap[p] && Object.keys(buildingMap[p]).length > 0)
        .slice(0, 3);
    }
    // fallback to plain comma/space separated text
    const text = (data.response || '').trim();
    const parts = text.split(/[\s,\-|/>]+/).map(p => p.trim().toLowerCase()).filter(Boolean);
    const plan = [];
    for (const p of parts) {
      if (buildingMap[p] && !plan.includes(p)) plan.push(p);
    }
    return plan.slice(0, 3);
  };
}
