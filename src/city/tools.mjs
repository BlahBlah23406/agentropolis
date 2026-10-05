// agentropolis/city — built-in tools
//
// Every tool here is real: it runs the same way in a browser tab and under
// Node 18+ (both have `fetch`), needs no API key, and talks only to free public
// services that allow cross-origin requests (Wikipedia, Open-Meteo).
//
// Each tool also has a *place* in the city — the building a worker walks to
// when they use it. The place metadata is what lets a non-programmer see a
// "tool call" as an errand: Rosa walks to the Library, looks something up, and
// comes back with a page for her desk.

import { ToolRegistry } from '../framework/Tool.mjs';

/** Where each tool lives in the city, in plain words. */
export const TOOL_PLACES = Object.freeze({
  wikipedia_search: {
    place: 'Library', emoji: '📚', color: '#8b6fd6', roof: 'dome',
    plain: 'Looks things up in Wikipedia and brings back the facts.',
  },
  weather: {
    place: 'Weather Station', emoji: '🌦️', color: '#3fa7d6', roof: 'tower',
    plain: 'Checks the real weather forecast for any town in the world.',
  },
  calculator: {
    place: 'Counting House', emoji: '🧮', color: '#d6a33f', roof: 'flat',
    plain: 'Does exact math, so the worker never has to guess at numbers.',
  },
  clock: {
    place: 'Clock Tower', emoji: '🕰️', color: '#c9784a', roof: 'tower',
    plain: 'Tells the worker today\'s date and the time.',
  },
  remember: {
    place: 'Records Office', emoji: '🗄️', color: '#6b8f71', roof: 'pitched',
    plain: 'Files a note away so the city still knows it tomorrow.',
  },
  recall: {
    place: 'Records Office', emoji: '🗄️', color: '#6b8f71', roof: 'pitched',
    plain: 'Pulls notes back out of the filing cabinet.',
  },
  ask_mayor: {
    place: 'Town Hall', emoji: '🏛️', color: '#e0b84a', roof: 'dome',
    plain: 'Stops and asks you (the Mayor) a question, then waits for your answer.',
  },
});

/** Tools a person can hire, in the order the builder shows them. */
export const TOOL_NAMES = Object.freeze(Object.keys(TOOL_PLACES));

// ------------------------------------------------------------- calculator ---

/**
 * Evaluate an arithmetic expression without `eval`.
 * Supports + - * / % ^, parentheses, unary minus, and a few functions.
 * @param {string} expression
 * @returns {number}
 */
export function calculate(expression) {
  const src = String(expression).replace(/×/g, '*').replace(/÷/g, '/').replace(/,(?=\d{3})/g, '');
  let i = 0;
  const FUNCS = {
    sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
    sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log, exp: Math.exp,
  };
  const CONSTS = { pi: Math.PI, e: Math.E };

  const peek = () => { while (src[i] === ' ') i++; return src[i]; };
  const expect = (ch) => {
    if (peek() !== ch) throw new Error(`expected "${ch}" at position ${i}`);
    i++;
  };

  function primary() {
    const ch = peek();
    if (ch === '(') { i++; const v = expr(); expect(')'); return v; }
    if (ch === '-') { i++; return -primary(); }
    if (ch === '+') { i++; return primary(); }
    const num = /^\d*\.?\d+(?:e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) { i += num[0].length; return parseFloat(num[0]); }
    const word = /^[a-z]+/i.exec(src.slice(i));
    if (word) {
      const name = word[0].toLowerCase();
      i += word[0].length;
      if (name in CONSTS) return CONSTS[name];
      if (name in FUNCS) { expect('('); const v = expr(); expect(')'); return FUNCS[name](v); }
      throw new Error(`unknown name "${word[0]}"`);
    }
    throw new Error(`unexpected "${ch ?? 'end of input'}" at position ${i}`);
  }
  function power() {
    let base = primary();
    if (peek() === '^') { i++; base = Math.pow(base, unary()); }
    return base;
  }
  function unary() { return power(); }
  function term() {
    let v = power();
    for (;;) {
      const ch = peek();
      if (ch === '*') { i++; v *= power(); }
      else if (ch === '/') { i++; v /= power(); }
      else if (ch === '%') { i++; v %= power(); }
      else return v;
    }
  }
  function expr() {
    let v = term();
    for (;;) {
      const ch = peek();
      if (ch === '+') { i++; v += term(); }
      else if (ch === '-') { i++; v -= term(); }
      else return v;
    }
  }

  const value = expr();
  if (peek() !== undefined) throw new Error(`unexpected "${src[i]}" at position ${i}`);
  if (!Number.isFinite(value)) throw new Error('result is not a finite number');
  return Math.round(value * 1e10) / 1e10;
}

// ---------------------------------------------------------------- weather ---

const WEATHER_CODES = {
  0: 'clear sky', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'freezing fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain',
  66: 'freezing rain', 67: 'heavy freezing rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow',
  77: 'snow grains', 80: 'rain showers', 81: 'heavy rain showers', 82: 'violent rain showers',
  85: 'snow showers', 86: 'heavy snow showers', 95: 'thunderstorm', 96: 'thunderstorm with hail',
  99: 'severe thunderstorm with hail',
};

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}

// ------------------------------------------------------------- the registry ---

/**
 * Build a ToolRegistry holding every built-in tool.
 *
 * @param {Object} [options]
 * @param {typeof fetch} [options.fetch] - injectable for tests
 * @param {{get(): Object, set(data: Object): void}} [options.memory] - where the
 *   Records Office keeps its files (browser: localStorage; CLI: a JSON file)
 * @param {(question: string) => Promise<string>} [options.askMayor] - how to ask
 *   the human; without one the tool answers that nobody is at the desk
 * @param {() => Date} [options.now]
 * @returns {ToolRegistry}
 */
export function createCityTools(options = {}) {
  const fetchImpl = options.fetch || ((...a) => globalThis.fetch(...a));
  const memory = options.memory || inMemoryStore();
  const now = options.now || (() => new Date());
  const registry = new ToolRegistry();

  registry.define(
    'calculator',
    'Evaluate an arithmetic expression exactly. Use it for every calculation.',
    {
      type: 'object',
      properties: { expression: { type: 'string', description: 'e.g. "(12.5 * 4) + 3^2"' } },
      required: ['expression'],
    },
    async ({ expression }) => `${expression} = ${calculate(expression)}`,
  );

  registry.define(
    'clock',
    'Get the current date, weekday and time.',
    { type: 'object', properties: {} },
    async () => {
      const d = now();
      return `It is ${d.toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.`;
    },
  );

  registry.define(
    'wikipedia_search',
    'Search English Wikipedia and return a short factual summary of the best matches.',
    {
      type: 'object',
      properties: { query: { type: 'string', description: 'what to look up, e.g. "Rayleigh scattering"' } },
      required: ['query'],
    },
    async ({ query }) => {
      const q = encodeURIComponent(String(query).slice(0, 200));
      const search = await getJson(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&srlimit=3&format=json&origin=*`,
        fetchImpl,
      );
      const hits = search?.query?.search || [];
      if (!hits.length) return `Wikipedia has no article matching "${query}".`;
      const top = hits[0].title;
      let summary = '';
      try {
        const page = await getJson(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(top.replace(/ /g, '_'))}`,
          fetchImpl,
        );
        summary = page.extract || '';
      } catch { /* the search snippet is still useful on its own */ }
      const others = hits.slice(1).map((h) => h.title).join('; ');
      return [
        `Wikipedia — "${top}": ${summary || stripHtml(hits[0].snippet)}`,
        others ? `Related articles: ${others}.` : '',
      ].filter(Boolean).join('\n');
    },
  );

  registry.define(
    'weather',
    'Get the current weather and a 3-day forecast for a named place.',
    {
      type: 'object',
      properties: { place: { type: 'string', description: 'a town or city, e.g. "Lisbon"' } },
      required: ['place'],
    },
    async ({ place }) => {
      const geo = await getJson(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&format=json`,
        fetchImpl,
      );
      const loc = geo?.results?.[0];
      if (!loc) return `I could not find a place called "${place}".`;
      const f = await getJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
        '&current=temperature_2m,weather_code,wind_speed_10m' +
        '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code' +
        '&forecast_days=3&timezone=auto',
        fetchImpl,
      );
      const c = f.current || {};
      const lines = [
        `${loc.name}${loc.country ? `, ${loc.country}` : ''}: now ${c.temperature_2m}°C, ` +
        `${WEATHER_CODES[c.weather_code] || 'unknown sky'}, wind ${c.wind_speed_10m} km/h.`,
      ];
      const d = f.daily || {};
      (d.time || []).forEach((day, k) => {
        lines.push(
          `${day}: ${d.temperature_2m_min?.[k]}–${d.temperature_2m_max?.[k]}°C, ` +
          `${WEATHER_CODES[d.weather_code?.[k]] || '?'}, ${d.precipitation_probability_max?.[k] ?? '?'}% chance of rain.`,
        );
      });
      return lines.join('\n');
    },
  );

  registry.define(
    'remember',
    'Save a note to long-term memory under a topic so it can be recalled in a later run.',
    {
      type: 'object',
      properties: {
        topic: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['topic', 'note'],
    },
    async ({ topic, note }) => {
      const data = memory.get();
      const key = String(topic).toLowerCase().trim();
      data[key] = [...(data[key] || []), { note: String(note), at: now().toISOString() }].slice(-20);
      memory.set(data);
      return `Filed under "${key}". The cabinet now holds ${data[key].length} note(s) on it.`;
    },
  );

  registry.define(
    'recall',
    'Look up notes saved earlier in long-term memory. Leave topic empty to list every topic.',
    {
      type: 'object',
      properties: { topic: { type: 'string' } },
    },
    async ({ topic } = {}) => {
      const data = memory.get();
      const keys = Object.keys(data);
      if (!keys.length) return 'The filing cabinet is empty — nothing has been remembered yet.';
      if (!topic) return `Topics on file: ${keys.join(', ')}.`;
      const key = String(topic).toLowerCase().trim();
      const match = data[key] || data[keys.find((k) => k.includes(key) || key.includes(k))];
      if (!match) return `Nothing on file about "${topic}". Topics on file: ${keys.join(', ')}.`;
      return match.map((m) => `- ${m.note} (${m.at.slice(0, 10)})`).join('\n');
    },
  );

  registry.define(
    'ask_mayor',
    'Ask the human in charge a question and wait for their answer. Use it when you need a decision or a missing detail.',
    {
      type: 'object',
      properties: { question: { type: 'string' } },
      required: ['question'],
    },
    async ({ question }) => {
      if (!options.askMayor) return 'Nobody is at the Mayor\'s desk right now. Make a sensible assumption and say what it was.';
      const answer = await options.askMayor(String(question));
      return answer ? `The Mayor answered: ${answer}` : 'The Mayor did not answer. Make a sensible assumption and say what it was.';
    },
  );

  return registry;
}

/** A memory store that lives only as long as the process or tab. */
export function inMemoryStore(initial = {}) {
  let data = structuredClone(initial);
  return { get: () => structuredClone(data), set: (d) => { data = structuredClone(d); } };
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}
