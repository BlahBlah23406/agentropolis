// agentropolis/city — the narrator and the dictionary.
//
// Shared by the browser city and the CLI, so a run reads the same everywhere.
//
// The dictionary between the city and the real thing.
//
// Every city word maps to the term an engineer would use, with a sentence
// explaining why the metaphor is faithful. The "real names" switch shows both,
// so people learn the vocabulary of agent systems while watching the city.

import { TOOL_PLACES } from './tools.mjs';
import { describeCondition } from './plan.mjs';

export const GLOSSARY = [
  { city: 'Worker', emoji: '🧑‍💼', real: 'Agent',
    why: 'An agent is an AI model given a role and some tools. In the city, that is a worker with a job, an office and errands they can run.' },
  { city: 'Job description', emoji: '📋', real: 'System prompt',
    why: 'The instructions pinned to an agent before every task. Change them and the same AI behaves like a different worker.' },
  { city: 'Brain', emoji: '🧠', real: 'Language model (LLM)',
    why: 'The AI that does the thinking. Every worker borrows the same brain; their job descriptions make them act differently.' },
  { city: 'Letter', emoji: '✉️', real: 'Message / prompt',
    why: 'Agents only know what they are sent. A mail van carrying a letter is one agent\'s output becoming another\'s input.' },
  { city: 'Desk', emoji: '🗂️', real: 'Context window',
    why: 'Everything the AI can see at once — its job description, the letter, errand results — has to fit on one desk. When the desk is full, old pages fall off and the AI cannot see them.' },
  { city: 'Coins', emoji: '🪙', real: 'Tokens',
    why: 'AI models read and write in small chunks called tokens, and providers charge per token. Every page on a desk costs coins to read.' },
  { city: 'Errand', emoji: '🚶', real: 'Tool call',
    why: 'The AI cannot browse or calculate by itself. It writes a request slip (a JSON tool call), the city runs the real tool, and the result comes back as a new page on the desk.' },
  { city: 'Request slip', emoji: '📝', real: 'Tool-call JSON',
    why: 'When an AI wants a tool, it replies with a small structured note like {"tool": "weather", "input": {"place": "Lisbon"}} instead of an answer.' },
  { city: 'Work route', emoji: '🛣️', real: 'Workflow / orchestration',
    why: 'Who gets the mail first, who goes next, and who decides. Roads are drawn only where mail can really travel.' },
  { city: 'Signpost', emoji: '🚦', real: 'Conditional routing (graph edge)',
    why: 'A rule that reads a worker\'s answer and decides where the mail goes next — which is how agents loop until work is good enough.' },
  { city: 'Town meeting', emoji: '🗣️', real: 'Multi-agent conversation',
    why: 'Agents take turns over a shared transcript. Each one hears everything said before them.' },
  { city: 'Records Office', emoji: '🗄️', real: 'Long-term memory',
    why: 'Agents forget everything between tasks. Memory is a tool that files notes somewhere permanent and looks them up later.' },
  { city: 'Mayor\'s stamp', emoji: '✋', real: 'Human-in-the-loop approval',
    why: 'Some steps should not happen without a person saying yes. The city stops the mail at your desk until you approve, edit or reject it.' },
  { city: 'Safety inspector', emoji: '🛡️', real: 'Guardrail / output filter',
    why: 'A check that runs on every answer before it leaves the building — here, blacking out email addresses, phone and card numbers.' },
  { city: 'Fire', emoji: '🔥', real: 'Error / exception',
    why: 'Something failed — the brain was unreachable, or a tool broke. The city retries once before giving up.' },
  { city: 'Rehearsal', emoji: '🎭', real: 'Mock model (test double)',
    why: 'Engineers test agent systems with a fake model that follows a script. The wiring, tools and mail are real; only the thinking is pretend.' },
];

export const term = (cityWord) => GLOSSARY.find((g) => g.city === cityWord);

/** "Rosa" for an agent id, "Town Hall" for townhall, etc. */
export function makeNamer(city) {
  const people = new Map(city.agents.map((a) => [a.name, a.city?.person || a.name]));
  return (id) => {
    if (id === 'townhall') return 'Town Hall';
    if (id === 'plaza') return 'The town meeting';
    return people.get(id) || id;
  };
}

const short = (s, n = 70) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const fmt = (n) => Number(n || 0).toLocaleString('en-US');

/**
 * Narrate one runtime event.
 * @returns {{icon: string, plain: string, tech: string, tone?: string}|null}
 */
export function narrate(event, name) {
  const e = event;
  switch (e.type) {
    case 'run:start':
      return { icon: '📮', plain: `You sent a request to Town Hall: “${short(e.input, 90)}”`, tech: `workflow.run(input) · pattern=${e.pattern}` };
    case 'mail':
      if (e.kind === 'task') return { icon: '✉️', plain: `Town Hall mailed ${name(e.to)} the request.`, tech: `step:start ${e.to} · input = $INPUT` };
      if (e.kind === 'result') return { icon: '📦', plain: `${name(e.from)} delivered the finished work to Town Hall.`, tech: `workflow:complete · output from ${e.from}` };
      return { icon: '✉️', plain: `${name(e.from)} mailed their work to ${name(e.to)}.`, tech: `handoff ${e.from} → ${e.to} (${fmt(Math.ceil(e.text.length / 4))} tokens)` };
    case 'think:start': {
      const d = e.desk;
      const fallen = d.fallen.length;
      return {
        icon: '🧠',
        plain: `${name(e.agent)} sat down to think. Their desk holds ${fmt(d.used)} of ${fmt(d.limit)} coins' worth of pages.` +
          (fallen ? ` ${fallen} page${fallen > 1 ? 's' : ''} fell off — they can no longer see ${fallen > 1 ? 'them' : 'it'}.` : ''),
        tech: `LLM call #${e.call} · context ${fmt(d.used)}/${fmt(d.limit)} tokens${fallen ? ` · truncated ${fallen} segment(s)` : ''}`,
        tone: fallen ? 'warn' : undefined,
      };
    }
    case 'think:end':
      if (e.toolRequest) {
        const place = TOOL_PLACES[e.toolRequest.tool]?.place || e.toolRequest.tool;
        return { icon: '📝', plain: `${name(e.agent)} wrote a request slip: a trip to the ${place} (${short(JSON.stringify(e.toolRequest.input), 50)}).`, tech: `tool_call ${e.toolRequest.tool}(${short(JSON.stringify(e.toolRequest.input), 60)}) · ${fmt(e.usage.input)} in / ${fmt(e.usage.output)} out` };
      }
      return { icon: '💬', plain: `${name(e.agent)} finished: “${short(e.text)}” (spent ${fmt(e.usage.input + e.usage.output)} coins)`, tech: `completion · ${fmt(e.usage.input)} in / ${fmt(e.usage.output)} out tokens${e.usage.estimated ? ' (estimated)' : ''} · ${(e.ms / 1000).toFixed(1)}s` };
    case 'think:retry':
      return { icon: '💨', plain: `${name(e.agent)}'s brain didn't answer (${short(e.message, 80)}). Trying again…`, tech: `retry ${e.attempt} after error`, tone: 'warn' };
    case 'tool:start': {
      const place = TOOL_PLACES[e.tool]?.place || e.tool;
      return { icon: '🚶', plain: `${name(e.agent)} walked to the ${place}.`, tech: `tool.execute("${e.tool}", ${short(JSON.stringify(e.input), 60)})` };
    }
    case 'tool:end': {
      const place = TOOL_PLACES[e.tool]?.place || e.tool;
      if (e.error) return { icon: '🔥', plain: `The ${place} couldn't help ${name(e.agent)}: ${short(e.error, 90)}`, tech: `tool error · ${e.error}`, tone: 'bad' };
      return { icon: '📄', plain: `${name(e.agent)} came back from the ${place} with a page: “${short(e.output, 80)}”`, tech: `tool result · ${fmt(Math.ceil(e.output.length / 4))} tokens · ${e.ms}ms` };
    }
    case 'decision':
      return {
        icon: e.passed ? '✅' : '↩️',
        plain: e.passed
          ? `Signpost at ${name(e.agent)}'s: ${describeCondition(e.condition)} → mail goes on to the “${e.next}” step.`
          : `Signpost at ${name(e.agent)}'s: not yet (${describeCondition(e.condition)} is false) → back to the “${e.next}” step.`,
        tech: `condition ${e.condition} = ${e.passed} → ${e.next}`,
      };
    case 'meeting:start':
      return { icon: '🗣️', plain: `${e.agents.map(name).join(', ')} walked to the plaza for a town meeting.`, tech: `conversation start · ${e.agents.length} participants` };
    case 'turn':
      return { icon: '🎤', plain: `${name(e.agent)} has the floor (round ${e.round + 1}). They hear everything said so far.`, tech: `turn ${e.agent} · round ${e.round} · transcript ${fmt(Math.ceil(e.text.length / 4))} tokens` };
    case 'meeting:end':
      return { icon: '🏠', plain: 'The meeting ended and everyone walked home.', tech: 'conversation complete' };
    case 'approval:ask':
      return { icon: '✋', plain: `The mail for ${name(e.agent)} is waiting on your desk. Nothing happens until you decide.`, tech: `beforeStep middleware · human approval for ${e.agent}`, tone: 'warn' };
    case 'approval:answer':
      return { icon: e.decision === 'reject' ? '⛔' : '🖋️', plain: e.decision === 'reject' ? `You stopped ${name(e.agent)}'s step.` : e.decision === 'edit' ? `You edited the letter and sent it to ${name(e.agent)}.` : `You stamped it. ${name(e.agent)} can start.`, tech: `approval = ${e.decision}` };
    case 'inspector':
      return e.findings.length
        ? { icon: '🛡️', plain: `The safety inspector blacked out ${e.findings.length} private detail(s) in ${name(e.agent)}'s work (${[...new Set(e.findings.map((f) => f.kind))].join(', ')}).`, tech: `afterStep guardrail · redacted ${e.findings.length}`, tone: 'warn' }
        : { icon: '🛡️', plain: `The safety inspector checked ${name(e.agent)}'s work — nothing private found.`, tech: 'afterStep guardrail · pass' };
    case 'step:error':
      return { icon: '🔥', plain: `${name(e.agent)}'s office is on fire: ${short(e.message, 110)}`, tech: `step:error ${e.agent}`, tone: 'bad' };
    case 'run:complete': {
      const t = e.totals;
      return { icon: '🎉', plain: `Done in ${(e.durationMs / 1000).toFixed(1)}s — ${t.modelCalls} thinking session${t.modelCalls === 1 ? '' : 's'}, ${t.errands} errand${t.errands === 1 ? '' : 's'}, about ${fmt(t.tokensIn + t.tokensOut)} coins.`, tech: `workflow:complete · ${t.modelCalls} LLM calls · ${t.errands} tool calls · ${fmt(t.tokensIn)} in / ${fmt(t.tokensOut)} out tokens`, tone: 'good' };
    }
    case 'run:error':
      return { icon: '🚨', plain: `The job could not be finished: ${short(e.message, 140)}`, tech: 'workflow:error', tone: 'bad' };
    default:
      return null;
  }
}

