#!/usr/bin/env node
// Run every starter town once and print what each worker did.
//
//   node scripts/try-city.mjs                         # rehearsal, live tools
//   node scripts/try-city.mjs ollama llama3.2         # a real local model
//   node scripts/try-city.mjs gemini gemini-2.5-flash # needs GEMINI_API_KEY
//   node scripts/try-city.mjs ollama llama3.2 "Math Tutor,Writing Studio"
//
// The quickest way to see whether a model is good enough to run agents: small
// models fumble tool requests and approval words in instructive ways.

import { CityRuntime, createCityTools, createBrain, TOWNS } from '../src/city/index.mjs';

const [provider = 'rehearsal', model, only] = process.argv.slice(2);
const keyEnv = { gemini: 'GEMINI_API_KEY', groq: 'GROQ_API_KEY', openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', openrouter: 'OPENROUTER_API_KEY' }[provider];
const brain = { provider, model, apiKey: keyEnv ? process.env[keyEnv] : undefined };
const towns = only ? TOWNS.filter((t) => only.split(',').includes(t.name)) : TOWNS;

for (const town of towns) {
  const rt = new CityRuntime({ city: town, invoker: createBrain(brain), tools: createCityTools(), approve: async () => ({ decision: 'approve' }) });
  rt.on((e) => {
    if (e.type === 'think:end') console.log(`  [${e.agent}] ${e.toolRequest ? `asks for ${JSON.stringify(e.toolRequest)}` : e.text.slice(0, 160).replace(/\n/g, ' ')}`);
    if (e.type === 'tool:end') console.log(`  <${e.tool}> ${(e.error || e.output).slice(0, 120).replace(/\n/g, ' ')}`);
    if (e.type === 'decision') console.log(`  signpost: ${e.passed ? 'yes' : 'no'} -> ${e.next}`);
  });
  const t0 = Date.now();
  try {
    const r = await rt.run(town.example);
    const out = typeof r.output === 'string' ? r.output : JSON.stringify(r.output);
    console.log(`=== ${town.emoji} ${town.name}: ok in ${((Date.now() - t0) / 1000).toFixed(1)}s\n${out.slice(0, 500)}\n`);
  } catch (e) {
    console.log(`=== ${town.emoji} ${town.name}: FAILED — ${e.message}\n`);
  }
}
