// agentropolis/city — the City Planner
//
// "Describe what you want, get a working city." Two planners share one output
// format (a city file):
//
//   draftCity(text)            — instant, offline, rule-based. Always works.
//   planCityWithBrain(text, …) — asks the connected model to design the city,
//                                validates its answer, and falls back to the
//                                rule-based draft if the answer is unusable.

import { normalizeCity, validateCity, slugify, PATTERNS } from './plan.mjs';
import { TOOL_PLACES, TOOL_NAMES } from './tools.mjs';

/** Jobs the offline planner knows, with the words that summon them. */
const JOBS = [
  {
    id: 'researcher', role: 'Researcher', emoji: '🔎', color: '#7c5cff', people: ['Rosa', 'Iris', 'Nadia'],
    words: /research|look ?up|find out|facts?|learn about|investigat|wikipedia|history of|who was|what is/i,
    tools: ['wikipedia_search'],
    prompt: 'You are a careful researcher. Use the wikipedia_search tool to look up the topic — do not rely on memory. Reply with the most important facts in plain sentences.',
  },
  {
    id: 'weather-watcher', role: 'Weather Watcher', emoji: '🌦️', color: '#3fa7d6', people: ['Wren', 'Storm'],
    words: /weather|forecast|rain|trip|travel|outdoor|picnic|hike|vacation|holiday/i,
    tools: ['weather'],
    prompt: 'You check the weather. Use the weather tool for the place in the request and summarise the forecast in two sentences with one practical tip.',
  },
  {
    id: 'budget-keeper', role: 'Budget Keeper', emoji: '💰', color: '#d6a33f', people: ['Bea', 'Penny'],
    words: /budget|cost|price|money|expens|afford|save|saving|\$|€|£/i,
    tools: ['calculator'],
    prompt: 'You keep the budget. Use the calculator for every sum — never do math in your head. List each cost and the total.',
  },
  {
    id: 'math-tutor', role: 'Math Tutor', emoji: '🧮', color: '#d6a33f', people: ['Ann', 'Euler'],
    words: /\bmath|calculat|arithmetic|equation|percent|fraction|homework problem/i,
    tools: ['calculator'],
    prompt: 'You are a patient math tutor. Use the calculator tool for every calculation, explain the steps simply, and finish with "Answer: <value>".',
  },
  {
    id: 'archivist', role: 'Archivist', emoji: '🗄️', color: '#6b8f71', people: ['Archie', 'Mabel'],
    words: /remember|memory|notes?|diary|journal|keep track|log\b|reminder/i,
    tools: ['remember', 'recall', 'clock'],
    prompt: 'You are an archivist. Save things with the remember tool, look them up with recall before answering, and never claim to remember something you did not look up.',
  },
  {
    id: 'planner', role: 'Planner', emoji: '📋', color: '#2fbf71', people: ['Pia', 'June'],
    words: /\bplan|schedul|itinerar|organi[sz]|agenda|to-?do|steps/i,
    tools: ['clock'],
    prompt: 'You are an organised planner. Turn what you are given into a clear, numbered plan with realistic steps. Use the clock tool if dates matter.',
  },
  {
    id: 'translator', role: 'Translator', emoji: '🌐', color: '#3fa7d6', people: ['Lin', 'Marco'],
    words: /translat|spanish|french|german|japanese|chinese|language/i,
    tools: [],
    prompt: 'You are a translator. Translate the text you are given faithfully into the language requested, keeping the tone. If no language is named, translate into Spanish.',
  },
  {
    id: 'summarizer', role: 'Summarizer', emoji: '📝', color: '#8b6fd6', people: ['Sam', 'Tess'],
    words: /summar|tl;?dr|shorten|condense|key points|digest/i,
    tools: [],
    prompt: 'You summarise. Reduce what you are given to its three most important points, one short line each.',
  },
  {
    id: 'writer', role: 'Writer', emoji: '✍️', color: '#ff8a3d', people: ['Wendy', 'Quill'],
    words: /writ|draft|blog|newsletter|email|letter|story|poem|essay|post|article|caption|speech|script/i,
    tools: [],
    prompt: 'You are a writer. Write what is asked for, clearly and warmly, using any notes you are given. Reply with the writing only.',
  },
  {
    id: 'explainer', role: 'Explainer', emoji: '🧑‍🏫', color: '#ff8a3d', people: ['Theo', 'Ms. Ray'],
    words: /explain|teach|kids?|child|beginner|simple terms|eli5|understand/i,
    tools: [],
    prompt: 'You explain things simply for a beginner. Use one everyday comparison and keep it under 150 words. Only use facts you were given.',
  },
  {
    id: 'editor', role: 'Editor', emoji: '🧐', color: '#5b6ee1', people: ['Ed', 'Vera'],
    words: /edit|review|proofread|check|critique|feedback|improve|polish|quality/i,
    tools: [],
    prompt: 'You are a demanding but fair editor. If the work fully meets the request, reply with APPROVED and one sentence of praise. Otherwise give two or three specific notes and do not use the word approved.',
  },
  {
    id: 'comedian', role: 'Comedian', emoji: '🎭', color: '#e0559b', people: ['Jojo', 'Rudy'],
    words: /joke|funny|humou?r|pun|laugh|roast/i,
    tools: [],
    prompt: 'You are a kind, clever comedian. Make what you are given funny without being mean. Keep it short.',
  },
];

const ADVISORS = [
  { id: 'optimist', role: 'Optimist', emoji: '🌞', color: '#f2b600', person: 'Olive', prompt: 'Give the strongest honest case FOR the idea in three sentences.' },
  { id: 'skeptic', role: 'Skeptic', emoji: '🧐', color: '#6c7a89', person: 'Sid', prompt: 'Give the strongest honest case AGAINST the idea, or its biggest risks, in three sentences.' },
  { id: 'practical', role: 'Practical Planner', emoji: '🛠️', color: '#2fbf71', person: 'Penny', prompt: 'Say the very first concrete step and what it costs in time and money, in three sentences.' },
];

const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Draft a city from a sentence, offline and instantly.
 * @param {string} text - e.g. "research a topic and write a kid-friendly newsletter"
 * @returns {Object} a valid city file
 */
export function draftCity(text) {
  const request = String(text || '').trim();
  const name = cityName(request);

  // Weighing a decision -> several advisors at once.
  if (/should i|pros and cons|opinions?|perspectives?|advice|brainstorm|ideas for|decide/i.test(request)) {
    return normalizeCity({
      name, emoji: '🔀', description: `Advisors weigh in on: ${request}`, example: request,
      agents: ADVISORS.map((a) => ({
        name: a.id, role: a.role, description: a.prompt, tools: [],
        system_prompt: `You are the ${a.role.toLowerCase()} on an advisory board. ${a.prompt}`,
        city: { person: a.person, emoji: a.emoji, color: a.color },
      })),
      workflow: { name: slugify(name), type: 'parallel', parallel: { agents: ADVISORS.map((a) => a.id) } },
    });
  }

  // Debates -> a town meeting.
  if (/debate|discuss|argue|talk it through|town meeting|for and against/i.test(request)) {
    const voices = [
      { id: 'dreamer', role: 'Dreamer', emoji: '💭', color: '#9b6bff', person: 'Dana', prompt: 'You are the dreamer at a town meeting. In two sentences, build on the discussion with a bold, hopeful idea.' },
      { id: 'critic', role: 'Critic', emoji: '🧐', color: '#e5484d', person: 'Cal', prompt: 'You are the critic at a town meeting. In two sentences, name the most important problem with what was just said, kindly.' },
      { id: 'mediator', role: 'Mediator', emoji: '🤝', color: '#2fbf71', person: 'Max', prompt: 'You are the mediator. In two sentences propose a middle ground. If the group has reached a sensible compromise, start with AGREED.' },
    ];
    return normalizeCity({
      name, emoji: '🗣️', description: `A town meeting about: ${request}`, example: request,
      agents: voices.map((v) => ({ name: v.id, role: v.role, description: v.prompt.split('. ')[1] || v.prompt, system_prompt: v.prompt, tools: [], city: { person: v.person, emoji: v.emoji, color: v.color } })),
      workflow: { name: slugify(name), type: 'conversation', agents: voices.map((v) => v.id), conversation: { maxRounds: 2, stopWhen: 'output.startsWith("AGREED")' } },
    });
  }

  // Which jobs the sentence asks for. Gatherers fetch facts, makers produce
  // the result, an editor checks it — and they line up in that order.
  const found = JOBS.filter((j) => j.words.test(request));
  const ids = new Set(found.map((j) => j.id));
  if (ids.has('budget-keeper')) ids.delete('math-tutor');
  let jobs = JOBS.filter((j) => ids.has(j.id));
  const GATHER = ['researcher', 'weather-watcher', 'budget-keeper', 'math-tutor', 'archivist'];
  let gatherers = jobs.filter((j) => GATHER.includes(j.id));
  let makers = jobs.filter((j) => !GATHER.includes(j.id) && j.id !== 'editor');
  const hasEditor = ids.has('editor');
  if (!gatherers.length && !makers.length) {
    gatherers = [JOBS.find((j) => j.id === 'researcher')];
    makers = [JOBS.find((j) => j.id === 'writer')];
  }
  if (hasEditor && !makers.length) makers = [JOBS.find((j) => j.id === 'writer')];
  // Two or more gatherers need someone to pull their notes together.
  if (gatherers.length > 1 && !makers.length) makers = [JOBS.find((j) => j.id === 'planner')];
  gatherers = gatherers.slice(0, 3);
  makers = makers.slice(0, 2);
  jobs = [...gatherers, ...makers, ...(hasEditor ? [JOBS.find((j) => j.id === 'editor')] : [])];

  const agents = jobs.map((j, i) => ({
    name: j.id, role: j.role, description: j.prompt.split('. ')[0] + '.',
    system_prompt: j.prompt, tools: [...j.tools],
    city: { person: j.people[i % j.people.length], emoji: j.emoji, color: j.color },
  }));
  const noteVar = (id) => `${id.replace(/-/g, '_')}_notes`;
  const notesBlock = gatherers.map((g) => `${g.role} notes:\n{{${noteVar(g.id)}}}`).join('\n\n');
  const gatherSteps = gatherers.map((g) => ({ id: g.id, agent: g.id, input: '$INPUT', output: noteVar(g.id) }));

  // One worker, or one gatherer feeding one maker, is a plain assembly line.
  if (!hasEditor) {
    const steps = [
      ...gatherSteps,
      ...makers.map((m, i) => ({
        agent: m.id,
        input: i === 0 ? (gatherers.length ? `Request: {{INPUT}}\n\n${notesBlock}` : '$INPUT') : undefined,
        output: i === makers.length - 1 ? 'result' : `${m.id.replace(/-/g, '_')}_draft`,
      })),
    ].map(({ id: _id, ...st }) => Object.fromEntries(Object.entries(st).filter(([, v]) => v !== undefined)));
    return normalizeCity({
      name, emoji: '🏙️', description: `An assembly line for: ${request}`, example: request, agents,
      workflow: { name: slugify(name), type: 'sequential', steps },
    });
  }

  // A maker followed by an editor -> a review loop.
  const maker = makers[0];
  const after = makers.slice(1);
  const steps = [
    ...gatherSteps.map((st, i) => ({ ...st, next: gatherSteps[i + 1]?.id || 'make' })),
    {
      id: 'make', agent: maker.id, output: 'draft', next: 'review',
      input: `Request: {{INPUT}}\n\n${notesBlock ? `${notesBlock}\n\n` : ''}Editor's notes on your last draft: {{review_notes}}\n\nYour last draft: {{draft}}`,
    },
    {
      id: 'review', agent: 'editor', output: 'review_notes',
      input: 'Request: {{INPUT}}\n\nDraft to review:\n{{draft}}',
      condition: { if: 'output.includes("APPROVED")', then: after[0]?.id || 'END', else: 'make' },
    },
    ...after.map((m, i) => ({ id: m.id, agent: m.id, input: '{{draft}}', output: 'result', next: after[i + 1]?.id || 'END' })),
  ];
  return normalizeCity({
    name, emoji: '🔁', description: `Made, reviewed and improved until approved: ${request}`, example: request, agents,
    workflow: { name: slugify(name), type: 'graph', graph: { entry: steps[0].id, maxSteps: 4 + steps.length * 2, steps } },
    state: { review_notes: '(none yet — this is the first draft)', draft: '(none yet)' },
  });
}

const NAME_SKIP = new Set(('research write plan check have make create find help someone could would should about ' +
  'them they their with from into that this then also short long small quick editor review edit draft explain ' +
  'summarize summarise translate team city please want need some each every what when where which while ' +
  'kid-friendly friendly simple good great').split(' '));

/** "Research owls, write a poem…" -> "Owls Poem City". */
function cityName(request) {
  const words = request.replace(/[^\p{L}\s-]/gu, ' ').split(/\s+/)
    .filter((w) => w.length > 3 && !NAME_SKIP.has(w.toLowerCase())).slice(0, 2);
  return words.length ? `${titleCase(words.join(' ').toLowerCase())} City` : 'New City';
}

// ------------------------------------------------------------ with a brain ---

/** The instructions the model gets when it designs a city. */
export function plannerPrompt(request) {
  const tools = TOOL_NAMES.map((t) => `- ${t}: ${TOOL_PLACES[t].plain}`).join('\n');
  const patterns = Object.entries(PATTERNS).map(([k, p]) => `- ${k} (${p.city}): ${p.plain}`).join('\n');
  return [
    'Design a small team of AI workers (2 to 5) for the request below, as JSON only — no prose, no code fences.',
    '',
    'Available tools:', tools, '',
    'Ways the team can work:', patterns, '',
    'JSON shape:',
    '{"name": "<short city name>", "description": "<one sentence>", "example": "<a sample request>",',
    ' "pattern": "sequential|parallel|conversation|graph",',
    ' "workers": [{"id": "<kebab-case>", "person": "<first name>", "emoji": "<one emoji>", "role": "<job title>",',
    '   "job": "<2-3 sentence instructions written to the worker as You ...>", "tools": ["<tool>", ...]}],',
    ' "review": {"maker": "<worker id>", "reviewer": "<worker id>"}  // only for graph: reviewer replies APPROVED or sends back',
    '}',
    '',
    `Request: ${request}`,
  ].join('\n');
}

/**
 * Ask a model to design the city. Never throws for a bad answer — it falls
 * back to the offline draft and says so.
 *
 * @param {string} request
 * @param {(agent: Object, prompt: string, opts: Object) => Promise<any>} invoker
 * @returns {Promise<{city: Object, source: 'brain'|'rules', note?: string}>}
 */
export async function planCityWithBrain(request, invoker) {
  const planner = {
    name: 'city-planner', role: 'City Planner', maxTokens: 1200, temperature: 0.4, tools: [],
    systemPrompt: 'You design small teams of AI workers. You reply with JSON only.',
    buildSystemMessage() { return this.systemPrompt; },
  };
  try {
    const reply = await invoker(planner, plannerPrompt(request), {});
    const text = typeof reply === 'string' ? reply : reply?.text;
    const city = cityFromDesign(extractJson(text), request);
    const check = validateCity(city);
    if (!check.ok) throw new Error(check.errors.join('; '));
    return { city, source: 'brain' };
  } catch (error) {
    return { city: draftCity(request), source: 'rules', note: `The planner's design could not be used (${error.message}), so a simpler draft was made.` };
  }
}

/** Turn the model's compact design into a full city file. */
export function cityFromDesign(design, request) {
  if (!design || !Array.isArray(design.workers) || !design.workers.length) throw new Error('no workers in the design');
  const used = new Set();
  const agents = design.workers.slice(0, 6).map((w, i) => {
    let id = slugify(w.id || w.role || `worker-${i + 1}`);
    while (used.has(id)) id += '-2';
    used.add(id);
    return {
      name: id, role: w.role || titleCase(id.replace(/-/g, ' ')),
      description: String(w.job || '').split('. ')[0],
      system_prompt: String(w.job || `You are the ${w.role || id}. Do your part of the request well.`),
      tools: (w.tools || []).filter((t) => TOOL_NAMES.includes(t)),
      city: { person: w.person || titleCase(id.split('-')[0]), emoji: w.emoji || '🙂' },
    };
  });
  const ids = agents.map((a) => a.name);
  const name = design.name || cityName(request);
  let workflow;
  let state = {};
  const pattern = design.pattern in PATTERNS ? design.pattern : 'sequential';
  if (pattern === 'parallel') workflow = { name: slugify(name), type: 'parallel', parallel: { agents: ids } };
  else if (pattern === 'conversation') workflow = { name: slugify(name), type: 'conversation', agents: ids, conversation: { maxRounds: 2 } };
  else if (pattern === 'graph' && design.review && ids.includes(slugify(design.review.maker)) && ids.includes(slugify(design.review.reviewer))) {
    const maker = slugify(design.review.maker);
    const reviewer = slugify(design.review.reviewer);
    const rest = ids.filter((x) => x !== maker && x !== reviewer);
    const reviewerAgent = agents.find((a) => a.name === reviewer);
    if (!/APPROVED/.test(reviewerAgent.system_prompt)) {
      reviewerAgent.system_prompt += ' If the work is good enough, reply with APPROVED; otherwise give specific notes and do not use that word.';
    }
    workflow = {
      name: slugify(name), type: 'graph',
      graph: {
        entry: 'make', maxSteps: 9,
        steps: [
          { id: 'make', agent: maker, output: 'draft', next: 'review', input: 'Request: {{INPUT}}\n\nReviewer notes on your last version: {{review_notes}}\n\nYour last version: {{draft}}' },
          { id: 'review', agent: reviewer, output: 'review_notes', input: 'Request: {{INPUT}}\n\nWork to review:\n{{draft}}', condition: { if: 'output.includes("APPROVED")', then: rest[0] || 'END', else: 'make' } },
          ...rest.map((r, i) => ({ id: r, agent: r, input: i === 0 ? '{{draft}}' : undefined, next: rest[i + 1] || 'END' })),
        ].map((s) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined))),
      },
    };
    state = { review_notes: '(none yet)', draft: '(none yet)' };
  } else workflow = { name: slugify(name), type: 'sequential', agents: ids };

  return normalizeCity({
    name, emoji: design.emoji || PATTERNS[workflow.type].emoji,
    description: design.description || request, example: design.example || request,
    agents, workflow, state,
  });
}

/** Find the first JSON object in a model reply (fenced, bare, or in prose). */
export function extractJson(text) {
  const s = String(text || '');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
  const candidates = [fenced?.[1], s];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.indexOf('{');
    if (start < 0) continue;
    let depth = 0; let inStr = false; let esc = false;
    for (let i = start; i < c.length; i++) {
      const ch = c[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        try { return JSON.parse(c.slice(start, i + 1).replace(/\/\/[^\n"]*\n/g, '\n')); } catch { break; }
      }
    }
  }
  throw new Error('no JSON in the reply');
}

/**
 * Suggest one worker from a sentence ("someone who checks the weather").
 * Known jobs get a tuned job description; anything else gets a sensible one
 * built from the person's own words, plus whatever tools the words imply.
 * @param {string} text
 * @param {Object} [city] - to keep the new worker's id unique
 */
export function suggestWorker(text, city = { agents: [] }) {
  const request = String(text || '').trim();
  const job = JOBS.find((j) => j.words.test(request));
  const taken = new Set(city.agents.map((a) => a.name));
  const unique = (base) => { let id = slugify(base); for (let i = 2; taken.has(id); i++) id = `${slugify(base)}-${i}`; return id; };
  const usedPeople = new Set(city.agents.map((a) => a.city?.person));
  if (job) {
    return {
      name: unique(job.id), role: job.role, description: job.prompt.split('. ')[0] + '.',
      system_prompt: request.length > 25 ? `${job.prompt} Your particular job: ${request}` : job.prompt,
      tools: [...job.tools],
      city: { person: job.people.find((p) => !usedPeople.has(p)) || job.people[0], emoji: job.emoji, color: job.color },
    };
  }
  const tools = [];
  if (/weather|forecast/i.test(request)) tools.push('weather');
  if (/look ?up|research|facts?|wikipedia/i.test(request)) tools.push('wikipedia_search');
  if (/math|calculat|sum|total|cost/i.test(request)) tools.push('calculator');
  if (/date|time|today|deadline/i.test(request)) tools.push('clock');
  if (/remember|memory|notes/i.test(request)) tools.push('remember', 'recall');
  if (/ask me|check with me|confirm with/i.test(request)) tools.push('ask_mayor');
  const words = request.replace(/^(someone|a person|an? (ai|agent|worker|helper|assistant))\s+(who|that|to)\s+/i, '').split(/\s+/);
  const role = titleCase(words.slice(0, 3).join(' ').replace(/[^\p{L}\s]/gu, '')) || 'Helper';
  const names = ['Kai', 'Lena', 'Omar', 'Ruth', 'Ivo', 'Zara', 'Noor', 'Felix'];
  return {
    name: unique(role), role, description: request,
    system_prompt: `You are a helpful worker in a small team. Your job: ${request}. Do your part well, keep answers short, and say plainly when you do not know something.`,
    tools,
    city: { person: names.find((p) => !usedPeople.has(p)) || 'Kai', emoji: '🙂', color: '#7c8cff' },
  };
}
