import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBuilding, aiPlanner, extractJson } from '../src/aiBuilder.js';
import { BUILDING_TEMPLATES } from '../src/buildings.js';

test('extractJson pulls JSON from markdown fences', () => {
  const out = extractJson('```json\n{"a":1}\n```');
  assert.deepEqual(out, { a: 1 });
});

test('extractJson returns null for invalid JSON', () => {
  assert.equal(extractJson('not json'), null);
});

test('generateBuilding calls the LLM and returns a building', async () => {
  const fakeResponse = {
    name: 'Expense Tracker',
    emoji: '\u{1F4B8}',
    description: 'Tracks expenses and alerts on overspending.',
    category: 'utility',
    role: 'You are an expense tracker.',
    model: 'gemma4:e2b',
    workers: 2,
    duration: 1.5,
    connections: ['gmail'],
    explanation: 'This building needs mail for alerts.',
  };
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({ response: '```json\n' + JSON.stringify(fakeResponse) + '\n```' }) };
  };

  const result = await generateBuilding({
    description: 'I need something that tracks my expenses and alerts me when I overspend',
    url: 'http://fake:11434',
    model: 'm',
    fetchFn: fakeFetch,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://fake:11434/api/generate');
  assert.equal(calls[0].body.model, 'm');
  assert.ok(calls[0].body.system.includes('Agentropolis City Builder AI'));
  assert.equal(result.building.name, 'Expense Tracker');
  assert.equal(result.building.category, 'utility');
  assert.equal(result.building.workers, 2);
  assert.equal(result.connections.length, 1);
  assert.equal(result.connections[0].type, 'gmail');
  assert.ok(result.explanation);
});

test('generateBuilding throws on unparseable LLM output', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ response: 'plain text' }) });
  await assert.rejects(
    generateBuilding({ description: 'x', fetchFn: fakeFetch }),
    /unparseable JSON/
  );
});

test('generateBuilding throws on failed HTTP call', async () => {
  const fakeFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(
    generateBuilding({ description: 'x', fetchFn: fakeFetch }),
    /AI builder call failed/
  );
});

test('aiPlanner returns a function that routes to custom buildings', async () => {
  const customBuildings = {
    expense_tracker: {
      id: 'expense_tracker', name: 'Expense Tracker', emoji: '\u{1F4B8}',
      description: 'Tracks expenses and alerts on overspending.', category: 'utility',
    },
    budget_core: {
      id: 'budget_core', name: 'Budget Core', emoji: '\u{1F4B0}',
      description: 'Calculates monthly budgets and forecasts.', category: 'utility',
    },
  };

  const fakeFetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    assert.ok(body.system.includes('expense_tracker'));
    return { ok: true, json: async () => ({ response: '["expense_tracker", "budget_core"]' }) };
  };

  const planner = aiPlanner({ url: 'http://fake:11434', model: 'm', fetchFn: fakeFetch });
  const plan = await planner('Track my expenses', customBuildings);
  assert.deepEqual(plan, ['expense_tracker', 'budget_core']);
});

test('aiPlanner tolerates plain text answers', async () => {
  const customBuildings = {
    research_lab: BUILDING_TEMPLATES.research_lab,
    writing_studio: BUILDING_TEMPLATES.writing_studio,
  };
  const fakeFetch = async () => ({ ok: true, json: async () => ({ response: 'research_lab, writing_studio' }) });
  const planner = aiPlanner({ fetchFn: fakeFetch });
  const plan = await planner('Write a report', customBuildings);
  assert.deepEqual(plan, ['research_lab', 'writing_studio']);
});

test('aiPlanner filters out unknown building ids', async () => {
  const customBuildings = { research_lab: BUILDING_TEMPLATES.research_lab };
  const fakeFetch = async () => ({ ok: true, json: async () => ({ response: '["research_lab", "ghost_tower"]' }) });
  const planner = aiPlanner({ fetchFn: fakeFetch });
  const plan = await planner('Find facts', customBuildings);
  assert.deepEqual(plan, ['research_lab']);
});

test('aiPlanner defaults to BUILDING_TEMPLATES when no map given', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ response: '["research_lab", "writing_studio"]' }) });
  const planner = aiPlanner({ fetchFn: fakeFetch });
  const plan = await planner('Research owls',);
  assert.deepEqual(plan, ['research_lab', 'writing_studio']);
});
