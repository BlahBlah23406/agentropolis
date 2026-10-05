// agentropolis/city — the rehearsal brain
//
// A city with no AI connected still has to *work*, or a newcomer's first
// minute is a settings page. The rehearsal brain stands in for a language
// model: it is a small deterministic script that decides when to use a tool
// and how to word an answer from the worker's job title.
//
// It is honest about what it is. The mail, the errands, the tools and the
// data they bring back are all real — Wikipedia really is searched, the
// forecast really is fetched — only the "thinking" is a script. The UI labels
// every rehearsal answer with a mask so nobody mistakes it for an AI.

const STOP = new Set(('a an the of to in on for and or is are was were be what who whom why how when ' +
  'where which do does did can could should would will tell me about explain please give write make ' +
  'i you we my our your it its this that these those with from by as at into than then so if').split(' '));

/**
 * Pull the most likely topic out of a request ("Why is the sky blue?" -> "sky blue").
 * @param {string} text
 * @returns {string}
 */
export function topicOf(text) {
  const firstLine = (String(text).split('\n').find((l) => l.trim()) || '').replace(/^Here is what I found about /, '');
  const words = firstLine
    .replace(/^[A-Za-z_ ]{1,20}:\s*/, '') // conversation transcripts prefix "user: "
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w.toLowerCase()));
  return words.slice(0, 6).join(' ') || firstLine.slice(0, 60);
}

/** The place name in a request like "plan a weekend in Lisbon". */
export function placeOf(text) {
  const m = /\b(?:in|to|for|at|visit(?:ing)?)\s+([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)?)/u.exec(String(text));
  if (m) return m[1];
  const caps = String(text).match(/\b[A-Z][\p{L}'-]{2,}\b/gu) || [];
  return caps.find((w) => !/^(What|Why|How|When|Where|Who|Plan|Tell|Give|Make|Write|Is|Are|Can|Should|The|I)$/.test(w)) || 'London';
}

const KNOWN_JOB = /review|editor|critic|checker|inspector|judge|proofread|optimist|skeptic|mediat|publish|writ|explain|teach|tutor|summar|translat|comedian|plan|organi|research|weather|budget|archiv|guide/;

/** Split prose into sentences without breaking "18.8" or "e.g.". */
const sentences = (s) => {
  const text = String(s).replace(/\s+/g, ' ').trim();
  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).filter(Boolean);
  return parts.length ? parts : [text];
};

/**
 * Create a rehearsal model invoker with the framework's invoker signature.
 *
 * @param {Object} [options]
 * @param {(ms: number) => Promise<void>} [options.wait] - paces token streaming
 * @returns {(agent: Object, prompt: string, opts: Object) => Promise<string>}
 */
export function createRehearsalBrain(options = {}) {
  const wait = options.wait || (() => Promise.resolve());
  /** per-agent call counts, so a reviewer can approve on its second look */
  const calls = new Map();

  return async function rehearsalInvoker(agent, prompt, opts = {}) {
    const n = (calls.get(agent.name) || 0) + 1;
    calls.set(agent.name, n);
    const text = script(agent, String(prompt), n);
    if (typeof opts.onToken === 'function') {
      for (const piece of text.match(/\S+\s*/g) || [text]) {
        opts.onToken(piece);
        await wait(28);
      }
    }
    return text;
  };
}

/** Decide what the worker "says". Pure, so it is easy to test. */
export function script(agent, prompt, callNumber = 1) {
  const tools = agent.tools || [];
  // Classify by job title first; the description only breaks ties.
  const title = `${agent.role || ''} ${agent.name || ''}`.toLowerCase();
  const role = KNOWN_JOB.test(title) ? title : `${title} ${agent.description || ''}`.toLowerCase();
  const results = [...prompt.matchAll(/Tool result: ([\s\S]*?)(?:\n\nUse this result|$)/g)].map((m) => m[1].trim());
  const task = prompt.split('\n\nYou called the tool')[0];
  const used = new Set([...prompt.matchAll(/You called the tool "([\w]+)"/g)].map((m) => m[1]));

  // 1. Run an errand first, if the job calls for one and it has not been run.
  const errand = pickErrand(tools, task, used, role);
  if (errand) return JSON.stringify(errand);

  const letter = parseLetter(task);
  const topic = topicOf(letter.request || lastSpeech(task));
  const notes = letter.sections.filter((x) => !/^\(none yet/.test(x.text) && !/draft|notes on your last/i.test(x.label));
  const facts = (results.length ? sentences(results.join(' ').replace(/Wikipedia — "[^"]+": /g, '')).slice(0, 4) : []).join(' ').trim();
  const lastDraft = letter.sections.find((x) => /^(your last (draft|version)|draft to review|work to review)$/i.test(x.label) && !/^\(none yet/.test(x.text));
  const editorNotes = letter.sections.find((x) => /notes on your last/i.test(x.label) && !/^\(none yet/.test(x.text));
  const speaker = speakerOf(task);

  // 2. Reviewers send work back once, then approve. (In a meeting, a critic talks instead.)
  if (!speaker && /review|editor|critic|checker|inspector|judge|proofread|\bqa\b/.test(role)) {
    if (callNumber % 2 === 1) {
      return `Needs another pass. The draft about "${topic}" should lead with the main point, ` +
        'use shorter sentences, and end with one clear takeaway. Please revise.';
    }
    return `APPROVED. This version about "${topic}" is clear, true to its sources, and easy to follow.`;
  }

  // 3. Conversation turns respond to whoever spoke last.
  if (speaker && speaker !== agent.name) {
    if (/mediat/.test(role) && /\n\n(critic|skeptic)[\w-]*: /.test(task)) {
      return `AGREED, if we meet in the middle: try "${topic}" as a small pilot first, and keep what works.`;
    }
    const stance = /skeptic|critic|devil|against|caution/.test(role) ? 'I see a risk' : 'I would build on that';
    return `${stance}, ${speaker}. On "${topic}": ${opinion(role, topic)}`;
  }

  // 4. Everyone else answers in the voice of their job.
  if (/optimist|cheer|champion/.test(role)) return `The bright side of "${topic}": ${opinion(role, topic)}`;
  if (/skeptic|devil|risk|caution/.test(role)) return `Before we commit to "${topic}", consider the risks: ${opinion(role, topic)}`;
  if (/publish|format|polish/.test(role)) return `# ${capitalize(topic)}\n\n${stripScaffolding(task).trim()}`;
  if (/tutor|math|quant/.test(role) && facts) {
    const answer = /=\s*(-?[\d.,]+)/.exec(facts)?.[1];
    return `Let's work it out step by step.\n${facts}${answer ? `\n\nAnswer: ${answer}` : ''}`;
  }
  if (/writ|explain|teach|tutor|summar|translat|comedian/.test(role)) {
    if (editorNotes && lastDraft) {
      return `${lastDraft.text.replace(/\n\n\(Revised[^)]*\)$/, '')}\n\n(Revised: now leads with the main point and ends with a clear takeaway.)`;
    }
    const plain = letter.sections.length || letter.request ? '' : sentences(stripScaffolding(task)).slice(0, 4).join(' ');
    const source = (facts || notes.map((x) => sentences(x.text).slice(0, 2).join(' ')).join(' ').trim() || plain)
      .replace(/Here is what I found about "[^"]*":\s*/g, '').trim();
    const gist = sentences(source);
    if (source) return `# ${capitalize(topic)}\n\n${source}${gist.length > 1 ? `\n\nIn short: ${gist[0].trim()}` : ''}`;
    return `A first draft about ${topic}:\n\n${capitalize(topic)} — where it begins,\nwhat makes it matter,\nwhy people care,\nand what comes next.`;
  }
  if (/\bplan|organi|coordinat|manager/.test(role)) {
    const source = facts || notes.map((x) => x.text).join(' ');
    return `Plan for "${topic}":\n1. Gather the key facts.\n2. Decide what matters most to you.\n3. Act on the top choice and review it after.` +
      (source ? `\n\nWhat we know so far: ${sentences(source).slice(0, 3).join(' ').trim()}` : '');
  }
  if (facts) return `Here is what I found about "${topic}":\n${facts}`;
  return `My notes on "${topic}": ${opinion(role, topic)}`;
}

/** Split a letter into its request line and labelled sections ("Weather notes:" ...). */
function parseLetter(task) {
  const out = { request: '', sections: [] };
  let current = null;
  for (const block of String(task).split(/\n\n+/)) {
    const m = /^([A-Z][\w' -]{1,40}):\s*([\s\S]*)$/.exec(block.trim());
    if (m && /^(assignment|request|task)$/i.test(m[1])) { out.request = m[2].trim(); current = null; }
    else if (m) { current = { label: m[1], text: m[2].trim() }; out.sections.push(current); }
    else if (current) current.text += `\n\n${block.trim()}`; // a section's own paragraphs
  }
  return out;
}

/** In a meeting transcript, the id of whoever spoke last (not the user). */
function speakerOf(task) {
  const text = String(task).trim();
  if (!/^user: /.test(text)) return null;
  const m = /(?:^|\n\n)([\w-]+): [^\n]*$/.exec(text);
  return m && m[1] !== 'user' ? m[1] : null;
}

function pickErrand(tools, task, used, role) {
  const has = (t) => tools.includes(t) && !used.has(t);
  if (has('weather') && /weather|trip|travel|visit|weekend|forecast|rain|pack|outdoor|holiday|vacation/i.test(task)) {
    return { tool: 'weather', input: { place: placeOf(task) } };
  }
  const math = /(-?\d+(?:\.\d+)?\s*[-+*/x×÷^%]\s*)+-?\d+(?:\.\d+)?/.exec(task);
  if (has('calculator') && math) {
    return { tool: 'calculator', input: { expression: math[0].replace(/x/g, '*') } };
  }
  if (has('clock') && /today|date|time|day is|deadline|when/i.test(task)) return { tool: 'clock', input: {} };
  const save = /^\s*(?:please\s+)?(?:remember|note|save|write down)\s+(?:that\s+)?([\s\S]+)/i.exec(task);
  if (save && has('remember')) {
    return { tool: 'remember', input: { topic: topicOf(save[1]).split(' ').slice(0, 2).join(' '), note: save[1].trim() } };
  }
  if (has('recall') && !save && /remember|last time|before|previous|again|recall|what do you know/i.test(task)) {
    return { tool: 'recall', input: { topic: '' } };
  }
  if (has('wikipedia_search') && !/review|editor|critic/.test(role)) {
    // A short question searches better whole ("Why is the sky blue" finds the
    // physics article; "sky blue" finds the colour).
    if (/guide|travel|tour/.test(role)) return { tool: 'wikipedia_search', input: { query: placeOf(task) } };
    const ask = lastSpeech(task).split('\n')[0].replace(/[?!.]+$/, '').trim();
    return { tool: 'wikipedia_search', input: { query: ask.length <= 80 ? ask : topicOf(ask) } };
  }
  if (has('remember') && used.size > 0) {
    return { tool: 'remember', input: { topic: topicOf(task), note: 'Looked into this topic.' } };
  }
  return null;
}

/** In a transcript, the original request is the first "user:" line. */
function lastSpeech(task) {
  const user = /(?:^|\n)user: ([^\n]+)/.exec(task);
  return user ? user[1] : stripScaffolding(task);
}

function stripScaffolding(text) {
  return String(text).replace(/^[\w-]+: /gm, '').replace(/\{\{[^}]+\}\}/g, '');
}

function opinion(role, topic) {
  if (/skeptic|devil|risk|caution|critic/.test(role)) {
    return `it could cost more time than expected, and we have not checked what could go wrong with ${topic}.`;
  }
  if (/budget|money|cost|finance/.test(role)) return `keep a firm budget for ${topic} and track every expense.`;
  return `${topic} is worth doing if we start small, learn quickly, and keep what works.`;
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
