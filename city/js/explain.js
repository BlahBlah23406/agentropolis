// Building descriptions for the city UI. The narrator and dictionary live in
// src/city/narrate.mjs so the CLI tells the same story.

import { TOOL_PLACES, PATTERNS } from '../../src/city/index.mjs';

export { GLOSSARY, term, makeNamer, narrate } from '../../src/city/narrate.mjs';

/** What a building is, in both vocabularies. */
export function describeBuilding(b, city) {
  if (b.kind === 'townhall') {
    const p = PATTERNS[city.workflow.type];
    return { title: 'Town Hall', real: 'Entry point (you)', text: `Requests start here and finished work comes back here. This city works as: ${p.emoji} ${p.city} — ${p.plain}` };
  }
  if (b.kind === 'plaza') return { title: 'Plaza', real: 'Shared conversation transcript', text: 'Where workers meet for a town meeting. Everyone hears everything said, in order.' };
  if (b.kind === 'tool') {
    const meta = TOOL_PLACES[b.tool];
    return { title: meta.place, real: `Tool: ${b.tool}`, text: meta.plain };
  }
  return { title: b.label, real: `Agent: ${b.id}`, text: '' };
}
