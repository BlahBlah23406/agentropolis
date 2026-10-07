// Agentropolis — the city app.
//
// Wires the real runtime (src/city) to the city you see. The rules this file
// keeps: nothing on screen moves unless the runtime reported a real event;
// every city word can be shown with its real name; and the first minute must
// work with no account, no key and no install.

import {
  CityRuntime, createCityTools, createBrain, PROVIDERS, TOWNS, townByName, TOOL_PLACES, TOOL_NAMES,
  normalizeCity, validateCity, agentOrder, PATTERNS, graphSteps, conditionWord, containsCondition,
  draftCity, planCityWithBrain, suggestWorker, TOWN_HALL,
} from '../../src/city/index.mjs';
import yaml from '../vendor/js-yaml.mjs';
import { layoutCity } from './layout.js';
import { CityRenderer } from './renderer.js';
import { Director } from './director.js';
import { GLOSSARY, makeNamer, describeBuilding } from './explain.js';
import { BROWSER_MODELS, browserBrainSupported, createBrowserBrain } from './webllm.js';

// ------------------------------------------------------------------ storage ---

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(`agentropolis.${key}`); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`agentropolis.${key}`, JSON.stringify(value)); } catch { /* private mode: fine */ }
  },
  del(key) { try { localStorage.removeItem(`agentropolis.${key}`); } catch { /* ignore */ } },
};

// -------------------------------------------------------------------- state ---

const $ = (sel) => document.querySelector(sel);
const state = {
  city: null,
  world: null,
  brain: store.get('brain', { provider: 'rehearsal' }),
  running: null, // { controller, runtime }
  hub: store.get('hub', []),
  coins: 0,
  selection: null,
  ledger: [],
  localServer: false,
  lastResult: null,
};

const renderer = new CityRenderer($('#city'));
// Panels sit just under the top bar, however many rows it wraps to.
new ResizeObserver(() => {
  const bottom = $('#topbar').getBoundingClientRect().bottom;
  document.documentElement.style.setProperty('--top-offset', `${Math.max(62, Math.ceil(bottom) + 8)}px`);
}).observe($('#topbar'));
// Keep the city in the space the panels leave free.
renderer.getInsets = () => {
  const narrow = innerWidth <= 700;
  const top = ($('#topbar')?.getBoundingClientRect().bottom || 50) + 8;
  const bar = $('#buildbar')?.getBoundingClientRect();
  const news = $('#news');
  const newsBox = news && !news.hidden ? news.getBoundingClientRect() : null;
  const bottom = innerHeight - Math.min(bar?.top || innerHeight, narrow && newsBox ? newsBox.top : innerHeight) + 8;
  return { top, bottom, left: !narrow && newsBox ? newsBox.right + 8 : 0, right: 0 };
};
const director = new Director(renderer, {
  onNews: (line, e) => addNews(line, e),
  onRecord: (agent) => { if (state.selection?.id === agent) refreshPanelSoft(); },
  onCoins: (n) => { state.coins += n; $('#coins').textContent = `🪙 ${state.coins.toLocaleString('en-US')}`; },
});

// ------------------------------------------------------------------ helpers ---

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const realTag = (t) => `<span class="realtag">${esc(t)}</span>`;
const person = (id) => makeNamer(state.city)(id);

/** Tiny, safe markdown: headings, bold, lists, paragraphs. */
function md(text) {
  const lines = esc(text).split('\n');
  let html = ''; let list = null;
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\W)\*(.+?)\*(?=\W|$)/g, '$1<i>$2</i>').replace(/`(.+?)`/g, '<code>$1</code>');
  for (const raw of lines) {
    const l = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)/.exec(l);
    const li = /^\s*(?:[-*•]|\d+[.)])\s+(.*)/.exec(l);
    if (li) { if (!list) { list = /^\s*\d/.test(l) ? 'ol' : 'ul'; html += `<${list}>`; } html += `<li>${inline(li[1])}</li>`; continue; }
    if (list) { html += `</${list}>`; list = null; }
    if (h) html += `<h3>${inline(h[2])}</h3>`;
    else if (l.trim()) html += `<p>${inline(l)}</p>`;
  }
  if (list) html += `</${list}>`;
  return html;
}

function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const b64 = {
  enc: (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))),
};

// --------------------------------------------------------------------- city ---

function setCity(raw, { keepSelection = false, quiet = false } = {}) {
  const city = normalizeCity(raw);
  state.city = city;
  state.world = layoutCity(city);
  renderer.setWorld(state.world, city);
  director.reset(city);
  store.set('city', city);
  $('#townBtn').textContent = `${city.emoji} ${city.name} ▾`;
  $('#ask').placeholder = `Ask ${city.name} something…`;
  const ex = city.example || '';
  $('#exampleBtn').textContent = ex ? `Try: “${ex}”` : '';
  $('#exampleBtn').hidden = !ex;
  if (keepSelection && state.selection) openPanel(state.selection); else closePanel();
  if (!quiet) {
    addDivider(`${city.emoji} ${city.name}`);
    const check = validateCity(city);
    for (const w of check.warnings) addNews({ icon: '⚠️', plain: w, tech: 'validation warning', tone: 'warn' });
  }
}

function saveCity() { store.set('city', state.city); }

/** Re-lay the city after a change that moves buildings (tools, workers, route). */
function rebuild() { setCity(state.city, { keepSelection: true, quiet: true }); }

// -------------------------------------------------------------------- brain ---

function brainLabel() {
  const b = state.brain;
  if (b.provider === 'browser') return `🧠 In-tab AI · ${BROWSER_MODELS.find((m) => m.id === b.model)?.label.split(' — ')[1] || 'local'}`;
  if (b.provider === 'rehearsal') return '🎭 Rehearsal (no AI)';
  return `🧠 ${PROVIDERS[b.provider]?.label || b.provider}${b.model ? ` · ${b.model}` : ''}`;
}

function updateBrainChip() {
  const el = $('#brainBtn');
  el.textContent = brainLabel();
  el.classList.toggle('rehearsal', state.brain.provider === 'rehearsal');
  el.classList.toggle('real', state.brain.provider !== 'rehearsal');
}

function makeInvoker(config = state.brain) {
  if (config.provider === 'browser') {
    return createBrowserBrain(config.model || BROWSER_MODELS[0].id, (p) => {
      if (p.progress < 1) toast(`Loading the in-tab AI… ${Math.round(p.progress * 100)}%`, 4000);
    });
  }
  const cfg = { ...config };
  if (cfg.provider === 'ollama' && !cfg.baseUrl && state.localServer) cfg.baseUrl = `${location.origin}/ollama`;
  return createBrain(cfg, { wait: (ms) => renderer.wait(ms) });
}

function defaultDesk() {
  const p = state.brain.provider;
  if (p === 'rehearsal') return 4000;
  if (p === 'browser') return 3500;
  if (p === 'ollama') return 4000;
  return 32000;
}

// ---------------------------------------------------------------------- run ---

const memoryStore = {
  get: () => store.get('memory', {}),
  set: (d) => store.set('memory', d),
};

async function runCity(input) {
  if (state.running) return;
  const text = String(input || '').trim();
  if (!text) { $('#ask').focus(); return; }
  const check = validateCity(state.city);
  if (!check.ok) { openErrors('This city cannot run yet', check.errors); return; }

  let invoker;
  try { invoker = makeInvoker(); } catch (e) { toast(e.message, 5000); openBrain(); return; }

  const controller = new AbortController();
  const runtime = new CityRuntime({
    city: state.city,
    invoker,
    tools: createCityTools({ memory: memoryStore, askMayor: (q) => askMayorModal(q) }),
    approve: (req) => approvalModal(req),
    deskSize: (name) => state.city.agents.find((a) => a.name === name)?.city?.desk || defaultDesk(),
  });
  state.running = { controller, runtime };
  state.ledger = [];
  runtime.on((e) => { if (e.type !== 'think:token') { state.ledger.push(e); renderXrayItem(e); } });
  runtime.on(director.handle);
  setRunning(true);
  director.reset(state.city);
  $('#xrayList').innerHTML = '';
  addDivider(`Run · ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${state.brain.provider === 'rehearsal' ? ' · 🎭 rehearsal' : ''}`);
  if (state.brain.provider === 'rehearsal' && !store.get('rehearsalNoted', false)) {
    addNews({ icon: '🎭', plain: 'This is a rehearsal: workers follow a script instead of thinking. The mail, errands, tools and data are all real. Click the brain button at the top to give them a real AI.', tech: 'mock model invoker', tone: 'warn' });
    store.set('rehearsalNoted', true);
  }

  try {
    const result = await runtime.run(text, { signal: controller.signal });
    const entry = {
      id: Date.now(), at: new Date().toISOString(), city: state.city.name, input: text, output: result.output,
      totals: result.totals, ms: result.durationMs, rehearsal: state.brain.provider === 'rehearsal', brain: brainLabel(),
    };
    state.hub = [entry, ...state.hub].slice(0, 25);
    store.set('hub', state.hub);
    state.lastResult = entry;
    openPanel({ type: 'building', id: TOWN_HALL, tab: 'hub' });
    tourNext('ran');
  } catch (e) {
    if (controller.signal.aborted) addNews({ icon: '⏹️', plain: 'You stopped the job.', tech: 'AbortController.abort()', tone: 'warn' });
    else if (/brain|key|reach|model|rate|HTTP/i.test(e.message)) toast(e.message, 7000);
  } finally {
    state.running = null;
    setRunning(false);
  }
}

function setRunning(on) {
  $('#sendBtn').hidden = on;
  $('#stopBtn').hidden = !on;
  $('#ask').disabled = on;
  for (const id of ['#hireBtn', '#routeBtn', '#newBtn', '#importBtn', '#townBtn']) $(id).disabled = on;
}

// --------------------------------------------------------------------- news ---

function addNews(line, e) {
  const list = $('#newsList');
  list.querySelector('.empty')?.remove();
  const li = document.createElement('li');
  if (line.tone) li.classList.add(line.tone);
  li.innerHTML = `<span>${line.icon}</span><div>${esc(line.plain)}<div class="tech">${esc(line.tech || '')}</div></div>`;
  if (e?.agent || e?.to) {
    li.style.cursor = 'pointer';
    li.title = 'Show this worker';
    li.addEventListener('click', () => {
      const id = e.agent || (e.to !== TOWN_HALL ? e.to : e.from);
      if (state.world.byId.get(id)) openPanel({ type: 'building', id, tab: e.type === 'think:start' ? 'desk' : 'mail' });
    });
  }
  list.appendChild(li);
  while (list.children.length > 250) list.firstChild.remove();
  list.scrollTop = list.scrollHeight;
}

function addDivider(text) {
  const li = document.createElement('li');
  li.className = 'divider';
  li.textContent = `— ${text} —`;
  $('#newsList').appendChild(li);
  $('#newsList').scrollTop = 1e9;
}

function renderXrayItem(e) {
  const d = document.createElement('details');
  const { at, ...rest } = e;
  const brief = e.type + (e.agent ? ` · ${e.agent}` : '') + (e.tool ? ` · ${e.tool}` : '') + (e.from ? ` · ${e.from}→${e.to}` : '');
  d.innerHTML = `<summary>${new Date(at).toLocaleTimeString()} ${esc(brief)}</summary><pre>${esc(JSON.stringify(rest, (k, v) => (k === 'result' ? undefined : v), 2).slice(0, 6000))}</pre>`;
  $('#xrayList').appendChild(d);
}

// -------------------------------------------------------------------- panel ---

function openPanel(sel) {
  if (!sel) { closePanel(); return; }
  if (sel.type === 'person') sel = { type: 'building', id: sel.id, tab: sel.tab };
  state.selection = sel;
  renderer.selected = sel.type === 'building' ? sel.id : null;
  const p = $('#panel');
  p.hidden = false;
  p.innerHTML = '<button class="close" title="Close">✕</button>' + panelHtml(sel);
  p.querySelector('.close').onclick = closePanel;
  wirePanel(sel);
}

function refreshPanelSoft() {
  const sel = state.selection;
  if (!sel || $('#panel').hidden) return;
  const active = document.activeElement;
  if (active && $('#panel').contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName)) return; // don't clobber typing
  const scroll = $('#panel').scrollTop;
  openPanel(sel);
  $('#panel').scrollTop = scroll;
}

function closePanel() {
  state.selection = null;
  renderer.selected = null;
  $('#panel').hidden = true;
}

function panelHtml(sel) {
  if (sel.type === 'van') {
    const v = sel.van;
    return `<h2>✉️ A letter</h2><p class="sub">From <b>${esc(person(v.from))}</b> to <b>${esc(person(v.to))}</b>${realTag('message between agents')}</p>
      <p class="hint">This is exactly what the next worker will read — nothing more. Agents only know what they are sent.</p>
      <div class="answer">${md(v.letter || '(empty)')}</div>`;
  }
  const b = state.world.byId.get(sel.id);
  if (!b) return '<p>That building is gone.</p>';
  if (b.kind === 'townhall') return townHallHtml(sel);
  if (b.kind === 'office') return officeHtml(b, sel);
  if (b.kind === 'plaza') return plazaHtml();
  return toolHtml(b);
}

function townHallHtml(sel) {
  const c = state.city;
  const p = PATTERNS[c.workflow.type];
  const tab = sel.tab || 'hub';
  const hub = state.hub.filter((h) => h.city === c.name);
  const tabs = `<div class="ptabs">
    <button data-tab="hub" class="${tab === 'hub' ? 'on' : ''}">📬 Results</button>
    <button data-tab="about" class="${tab === 'about' ? 'on' : ''}">🏛️ About this city</button>
    <button data-tab="safety" class="${tab === 'safety' ? 'on' : ''}">🛡️ Safety</button></div>`;
  let body = '';
  if (tab === 'hub') {
    body = hub.length ? hub.map((h, i) => resultHtml(h, i === 0)).join('') : '<p class="hint">Finished work lands here. Send the city a request below to get started.</p>';
  } else if (tab === 'about') {
    body = `<label class="field"><span>City name</span><input type="text" id="cityName" value="${esc(c.name)}"></label>
      <label class="field"><span>What this city is for</span><textarea id="cityDesc" style="min-height:70px">${esc(c.description)}</textarea></label>
      <label class="field"><span>Example request</span><input type="text" id="cityExample" value="${esc(c.example)}"></label>
      <h3>How it works ${realTag(`workflow type: ${c.workflow.type}`)}</h3>
      <p>${p.emoji} <b>${p.city}</b> — ${esc(p.plain)}</p>
      <p>${agentOrder(c).map((n) => `${esc(c.agents.find((a) => a.name === n)?.city?.emoji || '🙂')} ${esc(person(n))}`).join(' → ')}</p>
      <button class="btn" id="editRoute">🛣️ Change the work route</button>
      ${c.description ? '' : ''}`;
  } else {
    body = `<p class="hint">Rules the city follows on every job, no matter which brain is thinking.</p>
      <label class="toolopt"><input type="checkbox" id="inspectorToggle" ${c.safety.inspector ? 'checked' : ''}><span>🛡️</span>
        <span><b>Safety inspector ${realTag('guardrail / output filter')}</b><small>Blacks out email addresses, phone and card numbers in every answer before it leaves a building.</small></span></label>
      <h3>Mayor's approval ${realTag('human-in-the-loop')}</h3>
      <p class="hint">Mail for these workers stops at your desk until you approve, edit or reject it.</p>
      ${c.agents.map((a) => `<label class="toolopt"><input type="checkbox" data-approve="${esc(a.name)}" ${c.safety.approve_before.includes(a.name) ? 'checked' : ''}><span>${esc(a.city?.emoji || '🙂')}</span><span><b>${esc(a.city?.person || a.name)}</b><small>${esc(a.role)}</small></span></label>`).join('')}`;
  }
  return `<h2>🏛️ Town Hall</h2><p class="sub">You are the Mayor. Requests start here and finished work comes back here. ${realTag('entry point + output')}</p>${tabs}${body}`;
}

function resultHtml(h, open) {
  const out = h.output;
  let body;
  if (out && typeof out === 'object') {
    body = Object.entries(out).map(([k, v]) => {
      const a = state.city.agents.find((x) => x.name === k);
      return `<div class="answer"><b>${esc(a?.city?.emoji || '🙂')} ${esc(a?.city?.person || k)}</b>${md(String(v))}</div>`;
    }).join('');
  } else body = `<div class="answer">${md(String(out ?? ''))}</div>`;
  const t = h.totals || {};
  return `<details ${open ? 'open' : ''} style="margin:8px 0"><summary><b>${esc(h.input.slice(0, 70))}</b> ${h.rehearsal ? '<span class="badge mask">🎭 rehearsal</span>' : ''}<br><small class="hint">${new Date(h.at).toLocaleString()} · ${(h.ms / 1000).toFixed(1)}s · ${t.modelCalls ?? 0} thinking · ${t.errands ?? 0} errands · 🪙 ${fmt((t.tokensIn || 0) + (t.tokensOut || 0))}</small></summary>
    ${body}<div class="row"><button class="btn small" data-copy="${h.id}">📋 Copy</button><button class="btn small" data-dl="${h.id}">⬇️ Save</button></div></details>`;
}

function officeHtml(b, sel) {
  const a = state.city.agents.find((x) => x.name === b.id);
  const rec = director.records.get(b.id) || { log: [] };
  const tab = sel.tab || 'job';
  const tabs = `<div class="ptabs">
    <button data-tab="job" class="${tab === 'job' ? 'on' : ''}">📋 Job</button>
    <button data-tab="desk" class="${tab === 'desk' ? 'on' : ''}">🗂️ Desk</button>
    <button data-tab="mail" class="${tab === 'mail' ? 'on' : ''}">✉️ Mail & thoughts</button></div>`;
  let body = '';
  if (tab === 'job') {
    body = `<div class="row"><label class="field" style="flex:1"><span>Name</span><input type="text" id="aPerson" value="${esc(a.city?.person || '')}"></label>
      <label class="field" style="width:70px"><span>Look</span><input type="text" id="aEmoji" value="${esc(a.city?.emoji || '🙂')}" maxlength="4"></label></div>
      <label class="field"><span>Job title ${realTag('role')}</span><input type="text" id="aRole" value="${esc(a.role)}"></label>
      <label class="field"><span>Job description ${realTag('system prompt')}</span>
        <small>The instructions the AI reads before every task. This is the most powerful thing you can change.</small>
        <textarea id="aPrompt" rows="7">${esc(a.system_prompt)}</textarea></label>
      <h3>Errands this worker may run ${realTag('tools')}</h3>
      <div class="tools-grid">${TOOL_NAMES.map((t) => `<label class="toolopt"><input type="checkbox" data-tool="${t}" ${a.tools.includes(t) ? 'checked' : ''}><span>${TOOL_PLACES[t].emoji}</span><span><b>${esc(TOOL_PLACES[t].place)} ${realTag(t)}</b><small>${esc(TOOL_PLACES[t].plain)}</small></span></label>`).join('')}</div>
      <h3>Safety</h3>
      <label class="toolopt"><input type="checkbox" id="aApprove" ${state.city.safety.approve_before.includes(a.name) ? 'checked' : ''}><span>✋</span><span><b>Mayor must approve first ${realTag('human-in-the-loop')}</b><small>Mail for ${esc(a.city?.person || a.name)} waits on your desk until you say yes.</small></span></label>
      <div class="row" style="margin-top:16px"><span class="spacer"></span><button class="btn small danger" id="fireWorker">Remove ${esc(a.city?.person || a.name)}</button></div>`;
  } else if (tab === 'desk') {
    const desk = rec.desk;
    const size = a.city?.desk || defaultDesk();
    body = `<p class="hint">The desk is everything the AI can see at once ${realTag('context window')}. Each page costs coins to read ${realTag('tokens')}. If the pages don't fit, the oldest ones fall off — and the AI simply can't see them.</p>
      <label class="field"><span>Desk size: <b id="deskVal">${fmt(size)}</b> coins</span>
        <input type="range" id="deskSize" min="150" max="32000" step="50" value="${size}" style="width:100%">
        <small>Try making it tiny (a few hundred) and run again: watch pages fall off and the answers get worse. Real models have desks from about 4,000 to over 200,000 coins.</small></label>
      ${desk ? `<div class="desk"><div class="deskcap"><span>On the desk at the last thinking session</span><b>${fmt(desk.used)} / ${fmt(desk.limit)}</b></div>
        <div class="meter"><i style="width:${Math.min(100, desk.used / desk.limit * 100)}%"></i></div>
        ${desk.papers.map((p) => `<div class="paper"><header>${p.kind === 'job' ? '📋' : p.kind === 'letter' ? '✉️' : '📄'} ${esc(p.title)}${p.trimmed ? ' (torn)' : ''}<small>🪙 ${fmt(p.tokens)}</small></header><pre>${esc(p.text.slice(0, 1500))}</pre></div>`).join('')}
        ${desk.fallen.map((p) => `<div class="paper fallen"><header>🍂 Fell off: ${esc(p.title)}<small>🪙 ${fmt(p.tokens)}</small></header><pre>The AI did not see this page.</pre></div>`).join('')}
      </div>` : '<p class="hint">Nothing on the desk yet. Send the city a request and come back.</p>'}`;
  } else {
    const items = rec.log.slice().reverse();
    body = items.length ? `<ul class="log">${items.map(logItem).join('')}</ul>` : '<p class="hint">No mail yet this run.</p>';
    if (rec.thinking && state.running) body = `<div class="answer"><b>💭 Thinking right now…</b><pre style="white-space:pre-wrap">${esc(rec.thinking.slice(-1200))}</pre></div>` + body;
  }
  return `<h2>${esc(a.city?.emoji || '🙂')} ${esc(a.city?.person || a.name)}</h2>
    <p class="sub">${esc(a.role)} ${realTag(`agent: ${a.name}`)}<br>${esc(a.description || '')}</p>${tabs}${body}`;
}

function logItem(l) {
  const when = new Date(l.at).toLocaleTimeString();
  switch (l.kind) {
    case 'mail-in': return `<li><b>✉️ Letter from ${esc(person(l.from))}</b><small class="hint">${when}</small><pre>${esc(l.text)}</pre></li>`;
    case 'mail-out': return `<li><b>📤 Sent to ${esc(person(l.to))}</b><small class="hint">${when}</small><pre>${esc(l.text)}</pre></li>`;
    case 'slip': return `<li><b>📝 Wrote a request slip ${realTag('tool call')}</b><pre>${esc(l.text)}</pre></li>`;
    case 'answer': return `<li><b>💬 Answer</b> <small class="hint">🪙 ${fmt(l.usage.input)} read · ${fmt(l.usage.output)} written${l.usage.estimated ? ' (estimated)' : ''} · ${(l.ms / 1000).toFixed(1)}s</small><pre>${esc(l.text)}</pre></li>`;
    case 'errand': return `<li><b>🚶 Errand: ${esc(TOOL_PLACES[l.tool]?.place || l.tool)}</b><pre>${esc(JSON.stringify(l.input))}</pre></li>`;
    case 'errand-result': return `<li><b>📄 Came back with</b><pre>${esc(l.text)}</pre></li>`;
    case 'error': return `<li><b>🔥 Problem</b><pre>${esc(l.text)}</pre></li>`;
    default: return '';
  }
}

function toolHtml(b) {
  const meta = TOOL_PLACES[b.tool];
  const tool = createCityTools().get(b.tool);
  const visitors = state.city.agents.filter((a) => a.tools.includes(b.tool));
  const visits = [];
  for (const [agent, rec] of director.records) for (const l of rec.log) if ((l.kind === 'errand' || l.kind === 'errand-result') && l.tool === b.tool) visits.push({ agent, ...l });
  return `<h2>${meta.emoji} ${esc(meta.place)}</h2><p class="sub">${esc(meta.plain)} ${realTag(`tool: ${b.tool}`)}</p>
    <p class="hint">This errand is real: when a worker comes here, the city actually runs it and hands back the result as a new page for their desk.</p>
    <h3>Who comes here</h3><p>${visitors.map((a) => `${esc(a.city?.emoji)} ${esc(a.city?.person || a.name)}`).join(', ') || 'Nobody yet'}</p>
    <h3>What the AI is told about it ${realTag('tool description + JSON schema')}</h3>
    <div class="codebox">${esc(`${tool.name}: ${tool.description}\nInput: ${JSON.stringify(tool.schema)}`)}</div>
    <h3>Visits this run</h3>${visits.length ? `<ul class="log">${visits.reverse().map((v) => `<li><b>${esc(person(v.agent))} — ${v.kind === 'errand' ? 'asked' : 'got back'}</b><pre>${esc(v.kind === 'errand' ? JSON.stringify(v.input) : v.text)}</pre></li>`).join('')}</ul>` : '<p class="hint">No visits yet.</p>'}`;
}

function plazaHtml() {
  const turns = state.ledger.filter((e) => e.type === 'think:end' && !e.toolRequest);
  return `<h2>⛲ The Plaza</h2><p class="sub">Town meetings happen here. ${realTag('conversation workflow · shared transcript')}</p>
    <p class="hint">Every speaker hears the whole meeting so far — that is why each turn's letter gets longer (and costs more coins).</p>
    ${turns.length ? `<ul class="log">${turns.map((t) => `<li><b>${esc(person(t.agent))}</b><pre>${esc(t.text)}</pre></li>`).join('')}</ul>` : '<p class="hint">No meeting yet.</p>'}`;
}

function wirePanel(sel) {
  const p = $('#panel');
  p.querySelectorAll('.ptabs button').forEach((btn) => { btn.onclick = () => openPanel({ ...sel, tab: btn.dataset.tab }); });
  const c = state.city;
  const b = sel.id && state.world.byId.get(sel.id);

  if (b?.kind === 'townhall') {
    const bindText = (id, key) => { const el = p.querySelector(id); if (el) el.oninput = () => { c[key] = el.value; saveCity(); if (key === 'name') $('#townBtn').textContent = `${c.emoji} ${c.name} ▾`; if (key === 'example') { $('#exampleBtn').textContent = `Try: “${c.example}”`; $('#exampleBtn').hidden = !c.example; } }; };
    bindText('#cityName', 'name'); bindText('#cityDesc', 'description'); bindText('#cityExample', 'example');
    p.querySelector('#editRoute')?.addEventListener('click', openRoute);
    const insp = p.querySelector('#inspectorToggle');
    if (insp) insp.onchange = () => { c.safety.inspector = insp.checked; saveCity(); };
    p.querySelectorAll('[data-approve]').forEach((el) => { el.onchange = () => setApproval(el.dataset.approve, el.checked); });
    p.querySelectorAll('[data-copy]').forEach((el) => { el.onclick = () => { const h = state.hub.find((x) => String(x.id) === el.dataset.copy); navigator.clipboard?.writeText(typeof h.output === 'string' ? h.output : JSON.stringify(h.output, null, 2)); toast('Copied.'); }; });
    p.querySelectorAll('[data-dl]').forEach((el) => { el.onclick = () => { const h = state.hub.find((x) => String(x.id) === el.dataset.dl); download(`${c.name.replace(/\W+/g, '-')}-result.md`, `# ${h.input}\n\n${typeof h.output === 'string' ? h.output : Object.entries(h.output).map(([k, v]) => `## ${k}\n\n${v}`).join('\n\n')}\n`, 'text/markdown'); }; });
  }

  if (b?.kind === 'office') {
    const a = c.agents.find((x) => x.name === b.id);
    const on = (id, fn, ev = 'input') => { const el = p.querySelector(id); if (el) el.addEventListener(ev, () => fn(el)); };
    on('#aPerson', (el) => { a.city.person = el.value || a.name; saveCity(); });
    on('#aPerson', () => rebuild(), 'change');
    on('#aEmoji', (el) => { a.city.emoji = el.value || '🙂'; saveCity(); });
    on('#aEmoji', () => rebuild(), 'change');
    on('#aRole', (el) => { a.role = el.value; saveCity(); });
    on('#aRole', () => rebuild(), 'change');
    on('#aPrompt', (el) => { a.system_prompt = el.value; saveCity(); });
    on('#aApprove', (el) => setApproval(a.name, el.checked), 'change');
    p.querySelectorAll('[data-tool]').forEach((el) => {
      el.onchange = () => {
        a.tools = el.checked ? [...new Set([...a.tools, el.dataset.tool])] : a.tools.filter((t) => t !== el.dataset.tool);
        rebuild();
        addNews({ icon: el.checked ? '🔧' : '🚫', plain: el.checked ? `${a.city.person} can now run errands to the ${TOOL_PLACES[el.dataset.tool].place}. A road was built to it.` : `${a.city.person} will no longer go to the ${TOOL_PLACES[el.dataset.tool].place}.`, tech: `agent.tools = [${a.tools.join(', ')}]` });
      };
    });
    on('#deskSize', (el) => { a.city.desk = Number(el.value); p.querySelector('#deskVal').textContent = fmt(el.value); saveCity(); });
    on('#fireWorker', () => {
      if (c.agents.length <= 1) { toast('A city needs at least one worker.'); return; }
      if (!confirm(`Remove ${a.city.person} from the city?`)) return;
      removeAgent(a.name);
      closePanel();
      rebuild();
    }, 'click');
  }
}

function setApproval(name, on) {
  const s = state.city.safety;
  s.approve_before = on ? [...new Set([...s.approve_before, name])] : s.approve_before.filter((n) => n !== name);
  saveCity();
  addNews({ icon: '✋', plain: on ? `From now on, mail for ${person(name)} waits for your approval.` : `${person(name)} no longer needs your approval.`, tech: `safety.approve_before = [${s.approve_before.join(', ')}]` });
}

// ----------------------------------------------------------- city editing ---

function addToWorkflow(name) {
  const wf = state.city.workflow;
  if (wf.type === 'sequential') {
    if (wf.steps?.length) wf.steps.push({ agent: name }); else wf.agents = [...(wf.agents || []), name];
  } else if (wf.type === 'parallel') {
    wf.parallel = { ...(wf.parallel || {}), agents: [...(wf.parallel?.agents || wf.agents || []), name] };
  } else if (wf.type === 'conversation') {
    wf.agents = [...(wf.agents || []), name];
  } else {
    const steps = graphSteps(wf);
    const id = steps.some((s) => (s.id || s.agent) === name) ? `${name}-step` : name;
    for (const s of steps) {
      if (s.condition) { if (s.condition.then === 'END') s.condition.then = id; else if (s.condition.else === 'END') s.condition.else = id; }
      else if (s.next === 'END' || (!s.next && s === steps[steps.length - 1])) s.next = id;
    }
    steps.push({ id, agent: name, next: 'END' });
    if (!wf.graph) wf.graph = { steps }; else wf.graph.steps = steps;
  }
}

function removeAgent(name) {
  const c = state.city;
  c.agents = c.agents.filter((a) => a.name !== name);
  c.safety.approve_before = c.safety.approve_before.filter((n) => n !== name);
  const wf = c.workflow;
  if (wf.type === 'sequential') {
    if (wf.steps) wf.steps = wf.steps.filter((s) => s.agent !== name);
    if (wf.agents) wf.agents = wf.agents.filter((n) => n !== name);
  } else if (wf.type === 'parallel') {
    if (wf.parallel?.agents) wf.parallel.agents = wf.parallel.agents.filter((n) => n !== name);
    if (wf.agents) wf.agents = wf.agents.filter((n) => n !== name);
  } else if (wf.type === 'conversation') {
    wf.agents = (wf.agents || []).filter((n) => n !== name);
  } else {
    const steps = graphSteps(wf);
    const gone = steps.filter((s) => s.agent === name);
    const keep = steps.filter((s) => s.agent !== name);
    const redirect = (t) => { const g = gone.find((s) => (s.id || s.agent) === t); return g ? (g.next || 'END') : t; };
    for (const s of keep) {
      if (s.next) s.next = redirect(s.next);
      if (s.condition) { s.condition.then = redirect(s.condition.then); s.condition.else = redirect(s.condition.else); }
    }
    if (wf.graph) { wf.graph.steps = keep; if (gone.some((s) => (s.id || s.agent) === wf.graph.entry)) wf.graph.entry = keep[0]?.id || keep[0]?.agent; } else wf.steps = keep;
  }
  saveCity();
}

// -------------------------------------------------------------------- modals ---

function openModal(html, { wide = false, onClose } = {}) {
  const m = $('#modal');
  const sheet = m.querySelector('.sheet');
  sheet.style.width = wide ? 'min(900px, 100%)' : '';
  sheet.innerHTML = `<button class="close" title="Close">✕</button>${html}`;
  m.hidden = false;
  const close = () => { m.hidden = true; onClose?.(); };
  sheet.querySelector('.close').onclick = close;
  m.onclick = (e) => { if (e.target === m) close(); };
  return { sheet, close };
}
const closeModal = () => { $('#modal').hidden = true; };

function openErrors(title, errors) {
  openModal(`<h2>${esc(title)}</h2><ul class="errors">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`);
}

/** The Mayor's stamp. Resolves when the person decides. */
function approvalModal({ agent, person: who, input }) {
  return new Promise((resolve) => {
    const { sheet } = openModal(`<h2>✋ Your approval is needed</h2>
      <p class="lead">This letter is about to go to <b>${esc(who)}</b>. Nothing happens until you decide. ${realTag('human-in-the-loop · beforeStep')}</p>
      <label class="field"><span>The letter</span><small>You can change it before it goes.</small><textarea id="apText" rows="9">${esc(input)}</textarea></label>
      <div class="row wrap"><button class="btn primary" id="apYes">🖋️ Approve</button><button class="btn" id="apEdit">✏️ Send my edited version</button><span class="spacer"></span><button class="btn danger" id="apNo">⛔ Stop this step</button></div>`,
    { onClose: () => resolve({ decision: 'reject' }) });
    const done = (r) => { closeModal(); resolve(r); };
    sheet.querySelector('#apYes').onclick = () => done({ decision: 'approve' });
    sheet.querySelector('#apEdit').onclick = () => done({ decision: 'edit', input: sheet.querySelector('#apText').value });
    sheet.querySelector('#apNo').onclick = () => done({ decision: 'reject' });
  });
}

function askMayorModal(question) {
  return new Promise((resolve) => {
    const { sheet } = openModal(`<h2>🏛️ A worker has a question for you</h2>
      <p class="lead">${esc(question)} ${realTag('tool: ask_mayor')}</p>
      <label class="field"><span>Your answer</span><textarea id="amText" rows="3"></textarea></label>
      <div class="row"><button class="btn primary" id="amSend">Answer</button><button class="btn" id="amSkip">I don't know</button></div>`, { onClose: () => resolve('') });
    sheet.querySelector('#amText').focus();
    sheet.querySelector('#amSend').onclick = () => { const v = sheet.querySelector('#amText').value; closeModal(); resolve(v); };
    sheet.querySelector('#amSkip').onclick = () => { closeModal(); resolve(''); };
  });
}

function openBrain() {
  const cur = state.brain;
  let pick = cur.provider;
  const browserOk = browserBrainSupported();
  const order = ['browser', 'gemini', 'groq', 'openrouter', 'ollama', 'openai', 'anthropic', 'custom', 'rehearsal'];
  const card = (id) => {
    if (id === 'browser') return `<button class="card-btn ${pick === id ? 'on' : ''}" data-p="browser" ${browserOk ? '' : 'disabled title="This browser has no WebGPU"'}><span class="big">💻</span><b>AI in this tab</b><span class="tag">FREE · NO KEY</span><small>${browserOk ? 'Downloads a small open model once, then runs on your own computer. Private.' : 'Needs Chrome or Edge with WebGPU.'}</small></button>`;
    const m = PROVIDERS[id];
    return `<button class="card-btn ${pick === id ? 'on' : ''}" data-p="${id}"><span class="big">${id === 'rehearsal' ? '🎭' : id === 'ollama' ? '🦙' : '🧠'}</span><b>${esc(m.label)}</b>${m.free ? '<span class="tag">FREE KEY</span>' : ''}<small>${esc(m.plain)}</small></button>`;
  };
  const { sheet } = openModal(`<h2>🧠 Choose the city's brain</h2>
    <p class="lead">The brain is the AI model that does the thinking ${realTag('LLM provider')}. Every worker borrows it; their job descriptions make them act differently. Keys stay in this browser and go only to the company you pick.</p>
    <div class="cards">${order.map(card).join('')}</div><div id="brainForm" style="margin-top:16px"></div>`, { wide: true });

  const form = () => {
    const f = sheet.querySelector('#brainForm');
    sheet.querySelectorAll('.card-btn').forEach((b) => b.classList.toggle('on', b.dataset.p === pick));
    const same = cur.provider === pick;
    if (pick === 'rehearsal') {
      f.innerHTML = `<p>${esc(PROVIDERS.rehearsal.plain)}</p><button class="btn primary" id="useBrain">Use rehearsal</button>`;
    } else if (pick === 'browser') {
      f.innerHTML = `<label class="field"><span>Model</span><select id="bModel">${BROWSER_MODELS.map((m) => `<option value="${m.id}" ${(same ? cur.model : BROWSER_MODELS[0].id) === m.id ? 'selected' : ''}>${esc(m.label)} (${m.size}) — ${esc(m.note)}</option>`).join('')}</select></label>
        <p class="hint">The first run downloads the model (once — it is cached). Small models are honest demonstrations of how agents work, but they make more mistakes than big cloud models.</p>
        <div class="progress" hidden id="bProg"><i></i></div><p class="hint" id="bProgText"></p>
        <div class="row"><button class="btn" id="testBrain">Download & test</button><button class="btn primary" id="useBrain">Use this brain</button></div><p id="testOut" class="hint"></p>`;
    } else {
      const m = PROVIDERS[pick];
      f.innerHTML = `${m.needsKey ? `<label class="field"><span>Key <a href="${m.keyUrl}" target="_blank" rel="noopener">Get one here ↗</a></span><input type="password" id="bKey" value="${esc(same ? cur.apiKey || '' : '')}" placeholder="Paste your key"></label>` : ''}
        <label class="field"><span>Model</span><input type="text" id="bModel" value="${esc(same && cur.model ? cur.model : m.model)}"></label>
        ${pick === 'custom' || pick === 'ollama' ? `<label class="field"><span>Address</span><input type="text" id="bUrl" value="${esc(same && cur.baseUrl ? cur.baseUrl : (pick === 'ollama' && state.localServer ? `${location.origin}/ollama` : m.baseUrl))}"></label>` : ''}
        ${pick === 'ollama' ? `<p class="hint">Install Ollama, then run <code>ollama pull ${esc(m.model)}</code>. ${state.localServer ? 'The local city server connects to it for you.' : 'A web page can only reach it if Ollama allows it: set OLLAMA_ORIGINS=* or start the city with npm start.'}</p>` : ''}
        ${m.needsKey ? `<label class="row" style="gap:6px"><input type="checkbox" id="bRemember" ${cur.remember !== false ? 'checked' : ''}> Remember my key on this device</label>` : ''}
        <div class="row" style="margin-top:10px"><button class="btn" id="testBrain">Test</button><button class="btn primary" id="useBrain">Use this brain</button></div><p id="testOut" class="hint"></p>`;
    }
    const read = () => {
      const cfg = { provider: pick };
      const model = f.querySelector('#bModel'); if (model) cfg.model = model.value.trim();
      const key = f.querySelector('#bKey'); if (key) cfg.apiKey = key.value.trim();
      const url = f.querySelector('#bUrl'); if (url) cfg.baseUrl = url.value.trim();
      const rem = f.querySelector('#bRemember'); cfg.remember = rem ? rem.checked : true;
      return cfg;
    };
    f.querySelector('#testBrain')?.addEventListener('click', async () => {
      const out = f.querySelector('#testOut');
      out.textContent = 'Asking the brain to say hello…';
      try {
        const cfg = read();
        const invoker = cfg.provider === 'browser'
          ? createBrowserBrain(cfg.model, (p) => { const bar = f.querySelector('#bProg'); bar.hidden = false; bar.firstElementChild.style.width = `${Math.round(p.progress * 100)}%`; f.querySelector('#bProgText').textContent = p.text; })
          : makeInvoker(cfg);
        const fake = { name: 'test', maxTokens: 30, temperature: 0, tools: [], buildSystemMessage: () => 'You are a friendly city worker.', availableTools: () => [] };
        const reply = await invoker(fake, 'Say hello to the Mayor in five words or fewer.', {});
        out.textContent = `✅ It works! The brain said: “${(typeof reply === 'string' ? reply : reply.text).trim().slice(0, 120)}”`;
      } catch (e) { out.textContent = `❌ ${e.message}`; }
    });
    f.querySelector('#useBrain').onclick = () => {
      const cfg = read();
      state.brain = cfg;
      store.set('brain', cfg.remember === false ? { ...cfg, apiKey: '' } : cfg);
      updateBrainChip();
      closeModal();
      addNews({ icon: '🧠', plain: cfg.provider === 'rehearsal' ? 'The city is back to rehearsing with a script.' : `The city now thinks with ${brainLabel().replace('🧠 ', '')}. Every worker uses this brain.`, tech: `invoker = ${cfg.provider}${cfg.model ? `:${cfg.model}` : ''}` });
      tourNext('brain');
    };
  };
  sheet.querySelectorAll('.card-btn').forEach((b) => { b.onclick = () => { if (b.disabled) return; pick = b.dataset.p; form(); }; });
  form();
}

function openNewCity() {
  const real = state.brain.provider !== 'rehearsal';
  const { sheet } = openModal(`<h2>✨ Make a new city</h2>
    <p class="lead">Describe what you want help with, in your own words. The City Planner will hire the workers, give them jobs and lay the roads.</p>
    <textarea id="ncText" rows="3" placeholder="e.g. Research a topic, write a kid-friendly newsletter about it, and have an editor check it"></textarea>
    <div class="row" style="margin-top:8px"><button class="btn primary" id="ncGo">🏗️ Build my city</button><span class="hint">${real ? 'The planner will ask your AI brain to design it.' : 'In rehearsal the planner uses simple rules. With a real brain it designs the city itself.'}</span></div>
    <h3 style="margin-top:22px">…or start from a starter town</h3>
    <div class="cards">${TOWNS.map((t) => `<button class="card-btn" data-town="${esc(t.name)}"><span class="big">${t.emoji}</span><b>${esc(t.name)}</b><small>${esc(t.lesson)}</small></button>`).join('')}</div>`, { wide: true });
  sheet.querySelectorAll('[data-town]').forEach((b) => { b.onclick = () => { setCity(townByName(b.dataset.town)); closeModal(); tourNext('town'); }; });
  sheet.querySelector('#ncGo').onclick = async () => {
    const text = sheet.querySelector('#ncText').value.trim();
    if (!text) { sheet.querySelector('#ncText').focus(); return; }
    const btn = sheet.querySelector('#ncGo');
    btn.disabled = true; btn.textContent = '📐 Planning…';
    let result;
    if (real) {
      try { result = await planCityWithBrain(text, makeInvoker()); } catch (e) { result = { city: draftCity(text), source: 'rules', note: e.message }; }
    } else result = { city: draftCity(text), source: 'rules' };
    setCity(result.city);
    closeModal();
    addNews({ icon: '🏗️', plain: `The City Planner built “${result.city.name}” with ${result.city.agents.length} workers working as: ${PATTERNS[result.city.workflow.type].city}.${result.note ? ` (${result.note})` : ''}`, tech: `planner=${result.source} · workflow=${result.city.workflow.type}` });
    openPanel({ type: 'building', id: TOWN_HALL, tab: 'about' });
  };
}

function openHire() {
  const { sheet } = openModal(`<h2>➕ Hire a worker</h2>
    <p class="lead">Describe the job in a sentence. You can fine-tune their job description afterwards by clicking their office. ${realTag('new agent')}</p>
    <textarea id="hText" rows="3" placeholder="e.g. someone who checks the weather before we plan anything outside"></textarea>
    <div class="row" style="margin-top:10px"><button class="btn primary" id="hGo">Hire</button></div>`);
  sheet.querySelector('#hText').focus();
  sheet.querySelector('#hGo').onclick = () => {
    const text = sheet.querySelector('#hText').value.trim();
    if (!text) return;
    const agent = suggestWorker(text, state.city);
    state.city.agents.push(agent);
    addToWorkflow(agent.name);
    closeModal();
    rebuild();
    renderer.sparkle(agent.name, 30);
    addNews({ icon: '🎉', plain: `${agent.city.person} the ${agent.role} joined the city${agent.tools.length ? ` and can run errands to the ${agent.tools.map((t) => TOOL_PLACES[t].place).join(' and ')}` : ''}. They were added to the end of the work route.`, tech: `agents.push(${agent.name}) · tools=[${agent.tools.join(', ')}]` });
    openPanel({ type: 'building', id: agent.name, tab: 'job' });
  };
}

function defaultWorkflow(type, names, name) {
  if (type === 'sequential') return { name, type, agents: names };
  if (type === 'parallel') return { name, type, parallel: { agents: names } };
  if (type === 'conversation') return { name, type, agents: names, conversation: { maxRounds: 2 } };
  return { name, type, graph: { entry: names[0], maxSteps: 10, steps: names.map((n, i) => ({ id: n, agent: n, next: names[i + 1] || 'END' })) } };
}

function openRoute() {
  const c = state.city;
  let draft = structuredClone(c.workflow);
  const workers = c.agents.map((a) => ({ id: a.name, label: `${a.city?.emoji || '🙂'} ${a.city?.person || a.name} (${a.role})` }));
  const agentSelect = (val, attrs = '') => `<select ${attrs}>${workers.map((w) => `<option value="${esc(w.id)}" ${w.id === val ? 'selected' : ''}>${esc(w.label)}</option>`).join('')}</select>`;
  const { sheet } = openModal('<div id="rt"></div>', { wide: true });

  const render = () => {
    const type = draft.type;
    let body = '';
    if (type === 'sequential') {
      if (!draft.steps?.length) draft.steps = (draft.agents || []).map((a) => ({ agent: a }));
      body = `<p class="hint">Mail goes down this list. Each worker gets the previous worker's answer — or the original request, if you choose.</p>
        <ol class="steps-list">${draft.steps.map((s, i) => `<li><span class="num">${i + 1}</span>${agentSelect(s.agent, `data-i="${i}" data-f="agent"`)}
          <select data-i="${i}" data-f="input"><option value="prev" ${!s.input || s.input === '$PREVIOUS' ? 'selected' : ''}>gets the previous answer</option><option value="orig" ${s.input === '$INPUT' ? 'selected' : ''}>gets the original request</option>${s.input && !['$INPUT', '$PREVIOUS'].includes(s.input) ? '<option value="keep" selected>gets a custom letter (kept)</option>' : ''}</select>
          <button class="btn small ghost" data-up="${i}">↑</button><button class="btn small ghost" data-down="${i}">↓</button><button class="btn small ghost" data-del="${i}">✕</button></li>`).join('')}</ol>
        <button class="btn small" id="addStep">+ Add a stop</button>`;
    } else if (type === 'parallel') {
      const on = new Set(draft.parallel?.agents || draft.agents || []);
      body = `<p class="hint">Town Hall sends the same letter to everyone ticked, all at once.</p>${workers.map((w) => `<label class="toolopt"><input type="checkbox" data-par="${esc(w.id)}" ${on.has(w.id) ? 'checked' : ''}><span></span><span><b>${esc(w.label)}</b></span></label>`).join('')}`;
    } else if (type === 'conversation') {
      draft.agents ||= [];
      draft.conversation ||= { maxRounds: 2 };
      const stopWord = conditionWord(draft.conversation.stopWhen);
      body = `<p class="hint">Speakers take turns in this order, for a number of rounds. Each one hears everything said before them.</p>
        <ol class="steps-list">${draft.agents.map((a, i) => `<li><span class="num">${i + 1}</span>${agentSelect(a, `data-ci="${i}"`)}<button class="btn small ghost" data-cup="${i}">↑</button><button class="btn small ghost" data-cdel="${i}">✕</button></li>`).join('')}</ol>
        <button class="btn small" id="addSpeaker">+ Add a speaker</button>
        <div class="row wrap" style="margin-top:12px"><label class="field" style="width:140px"><span>Rounds</span><input type="number" id="rounds" min="1" max="6" value="${draft.conversation.maxRounds ?? 2}"></label>
        <label class="field" style="flex:1"><span>End early when someone says… <small>(optional)</small></span><input type="text" id="stopWord" value="${esc(stopWord ?? '')}" placeholder="${draft.conversation.stopWhen && !stopWord ? esc(draft.conversation.stopWhen) : 'e.g. AGREED'}"></label></div>`;
    } else {
      const steps = graphSteps(draft);
      if (!draft.graph) draft.graph = { steps };
      const ids = steps.map((s) => s.id || s.agent);
      const target = (val, attrs) => `<select ${attrs}>${[...ids, 'END'].map((t) => `<option value="${esc(t)}" ${t === val ? 'selected' : ''}>${t === 'END' ? '🏛️ finish (send to Town Hall)' : `step “${esc(t)}”`}</option>`).join('')}</select>`;
      body = `<p class="hint">Each step names a worker and where the mail goes next. A step can <b>decide</b>: if the answer contains a word, go one way; otherwise go another. That's how work loops back until it's good. The first step starts.</p>
        <ol class="steps-list">${steps.map((s, i) => {
          const word = s.condition ? conditionWord(s.condition.if) : null;
          return `<li><span class="num">${i + 1}</span><input type="text" value="${esc(s.id || s.agent)}" data-gi="${i}" data-gf="id" title="Step name" style="max-width:110px">${agentSelect(s.agent, `data-gi="${i}" data-gf="agent"`)}
          <select data-gi="${i}" data-gf="mode"><option value="next" ${!s.condition ? 'selected' : ''}>then always go to</option><option value="decide" ${s.condition ? 'selected' : ''}>decides</option></select>
          ${s.condition
            ? `if the answer contains <input type="text" data-gi="${i}" data-gf="word" value="${esc(word ?? '')}" placeholder="${word === null ? esc(s.condition.if) : 'APPROVED'}" style="max-width:110px"> → ${target(s.condition.then, `data-gi="${i}" data-gf="then"`)} otherwise → ${target(s.condition.else, `data-gi="${i}" data-gf="else"`)}`
            : target(s.next || ids[i + 1] || 'END', `data-gi="${i}" data-gf="next"`)}
          <button class="btn small ghost" data-gdel="${i}">✕</button></li>`;
        }).join('')}</ol><button class="btn small" id="addG">+ Add a step</button>`;
    }
    sheet.querySelector('#rt').innerHTML = `<h2>🛣️ Work route</h2><p class="lead">How mail moves between workers ${realTag('workflow / orchestration pattern')}. Roads are rebuilt to match.</p>
      <div class="cards">${Object.entries(PATTERNS).map(([k, p]) => `<button class="card-btn ${k === type ? 'on' : ''}" data-type="${k}"><span class="big">${p.emoji}</span><b>${esc(p.city)}</b> ${realTag(k)}<small>${esc(p.plain)}</small></button>`).join('')}</div>
      <div style="margin-top:14px">${body}</div><div id="rtErr" class="errors"></div>
      <div class="row" style="margin-top:14px"><span class="spacer"></span><button class="btn" id="rtCancel">Cancel</button><button class="btn primary" id="rtSave">Save route</button></div>`;
    wire();
  };

  const wire = () => {
    const q = (s) => sheet.querySelectorAll(s);
    q('[data-type]').forEach((b) => { b.onclick = () => { if (b.dataset.type !== draft.type) { draft = defaultWorkflow(b.dataset.type, agentOrder(c).filter((n) => c.agents.some((a) => a.name === n)), c.workflow.name); render(); } }; });
    // sequential
    q('[data-f]').forEach((el) => { el.onchange = () => { const s = draft.steps[+el.dataset.i]; if (el.dataset.f === 'agent') s.agent = el.value; else if (el.value === 'orig') s.input = '$INPUT'; else if (el.value === 'prev') delete s.input; }; });
    const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; render(); };
    q('[data-up]').forEach((b) => { b.onclick = () => move(draft.steps, +b.dataset.up, -1); });
    q('[data-down]').forEach((b) => { b.onclick = () => move(draft.steps, +b.dataset.down, 1); });
    q('[data-del]').forEach((b) => { b.onclick = () => { draft.steps.splice(+b.dataset.del, 1); render(); }; });
    sheet.querySelector('#addStep')?.addEventListener('click', () => { draft.steps.push({ agent: workers[0].id }); render(); });
    // parallel
    q('[data-par]').forEach((el) => { el.onchange = () => { const set = new Set(draft.parallel?.agents || []); if (el.checked) set.add(el.dataset.par); else set.delete(el.dataset.par); draft.parallel = { ...(draft.parallel || {}), agents: workers.map((w) => w.id).filter((id) => set.has(id)) }; delete draft.agents; }; });
    // conversation
    q('[data-ci]').forEach((el) => { el.onchange = () => { draft.agents[+el.dataset.ci] = el.value; }; });
    q('[data-cup]').forEach((b) => { b.onclick = () => move(draft.agents, +b.dataset.cup, -1); });
    q('[data-cdel]').forEach((b) => { b.onclick = () => { draft.agents.splice(+b.dataset.cdel, 1); render(); }; });
    sheet.querySelector('#addSpeaker')?.addEventListener('click', () => { draft.agents.push(workers[0].id); render(); });
    const rounds = sheet.querySelector('#rounds'); if (rounds) rounds.onchange = () => { draft.conversation.maxRounds = Math.max(1, Math.min(6, +rounds.value || 2)); };
    const stop = sheet.querySelector('#stopWord'); if (stop) stop.onchange = () => { if (stop.value.trim()) draft.conversation.stopWhen = containsCondition(stop.value.trim()); else delete draft.conversation.stopWhen; };
    // graph
    const steps = draft.type === 'graph' ? graphSteps(draft) : [];
    q('[data-gf]').forEach((el) => {
      el.onchange = () => {
        const s = steps[+el.dataset.gi];
        const f = el.dataset.gf;
        if (f === 'id') {
          const old = s.id || s.agent; const nu = el.value.trim().replace(/\s+/g, '-') || s.agent;
          s.id = nu;
          for (const o of steps) { if (o.next === old) o.next = nu; if (o.condition) { if (o.condition.then === old) o.condition.then = nu; if (o.condition.else === old) o.condition.else = nu; } }
          if (draft.graph.entry === old) draft.graph.entry = nu;
          render();
        } else if (f === 'agent') s.agent = el.value;
        else if (f === 'mode') {
          if (el.value === 'decide') { const nx = s.next || 'END'; delete s.next; s.condition = { if: containsCondition('APPROVED'), then: nx, else: s.id || s.agent }; } else { s.next = s.condition?.then || 'END'; delete s.condition; }
          render();
        } else if (f === 'word') s.condition.if = containsCondition(el.value.trim() || 'APPROVED');
        else if (f === 'then' || f === 'else') s.condition[f] = el.value;
        else if (f === 'next') s.next = el.value;
      };
    });
    q('[data-gdel]').forEach((b) => { b.onclick = () => { steps.splice(+b.dataset.gdel, 1); draft.graph.entry = steps[0]?.id || steps[0]?.agent; render(); }; });
    sheet.querySelector('#addG')?.addEventListener('click', () => { const w = workers[0].id; let id = w; for (let i = 2; steps.some((s) => (s.id || s.agent) === id); i++) id = `${w}-${i}`; steps.push({ id, agent: w, next: 'END' }); render(); });
    sheet.querySelector('#rtCancel').onclick = closeModal;
    sheet.querySelector('#rtSave').onclick = () => {
      if (draft.type === 'graph') draft.graph.entry = steps[0]?.id || steps[0]?.agent;
      if (draft.type === 'sequential' && draft.steps?.length) delete draft.agents;
      const next = { ...c, workflow: draft };
      const check = validateCity(next);
      if (!check.ok) { sheet.querySelector('#rtErr').innerHTML = check.errors.map(esc).join('<br>'); return; }
      state.city.workflow = draft;
      closeModal();
      rebuild();
      addNews({ icon: '🛣️', plain: `New work route: ${PATTERNS[draft.type].city}. The roads were rebuilt to match.`, tech: `workflow.type = ${draft.type}` });
    };
  };
  render();
}

function openDictionary() {
  openModal(`<h2>📖 City ↔ real world dictionary</h2>
    <p class="lead">Every part of this city is a real part of an AI agent system. Turn on <b>Real names</b> at the top to see the technical words everywhere.</p>
    <div class="dict">${GLOSSARY.map((g) => `<div><span class="e">${g.emoji}</span><span><b>${esc(g.city)}</b> = <code>${esc(g.real)}</code><br><small>${esc(g.why)}</small></span></div>`).join('')}</div>`, { wide: true });
}

function cityYaml() {
  return `# ${state.city.name} — an Agentropolis city.\n# This file is a complete, runnable agent system. Run it from a terminal:\n#   npx github:BlahBlah23406/agentropolis run this-file.yaml --input "your request"\n` + yaml.dump(state.city, { lineWidth: 100, noRefs: true });
}

function openExport() {
  const text = cityYaml();
  const file = `${state.city.name.replace(/\W+/g, '-').toLowerCase()}.yaml`;
  const { sheet } = openModal(`<h2>⬇️ Take your city with you</h2>
    <p class="lead">Your city <b>is</b> an agent system. This file holds every worker's job description, their tools and the work route — in the open Agentropolis format any developer can read. ${realTag('agents + workflow as YAML')}</p>
    <div class="codebox">${esc(text)}</div>
    <div class="row wrap" style="margin-top:10px"><button class="btn primary" id="exDl">⬇️ Download ${esc(file)}</button><button class="btn" id="exCopy">📋 Copy</button></div>
    <h3 style="margin-top:18px">Run it without the city</h3>
    <p class="hint">On any computer with Node.js, this runs the exact same agents in a terminal (add an API key, or it rehearses):</p>
    <div class="codebox">npx github:BlahBlah23406/agentropolis run ${esc(file)} --input "${esc(state.city.example || 'your request')}"</div>`, { wide: true });
  sheet.querySelector('#exDl').onclick = () => download(file, text, 'text/yaml');
  sheet.querySelector('#exCopy').onclick = () => { navigator.clipboard?.writeText(text); toast('Copied.'); };
}

function importText(text, label = 'file') {
  let raw;
  try { raw = yaml.load(text); } catch (e) { openErrors(`Could not read that ${label}`, [e.message]); return; }
  const check = validateCity(raw || {});
  if (!check.ok) { openErrors(`That ${label} is not a runnable city`, check.errors); return; }
  setCity(raw);
  toast(`Welcome to ${state.city.name}!`);
}

function share() {
  const url = `${location.origin}${location.pathname}#city=${b64.enc(JSON.stringify(state.city))}`;
  navigator.clipboard?.writeText(url).then(() => toast('Link copied! Anyone who opens it gets this exact city (but not your key).'), () => prompt('Copy this link:', url));
}

// --------------------------------------------------------------------- tour ---

const TOUR = [
  { title: 'Welcome to Agentropolis 👋', text: 'This little town is a real AI agent system. Every building is a worker, every road is a route their mail can take. You are the Mayor.', target: null },
  { title: 'Workers are AI agents', text: 'Each office is one worker — an AI “agent” with a job description. Click one any time to read or change it.', target: () => firstOffice() },
  { title: 'Errands are real tools', text: 'Workers can walk to places like the Library to run errands. These are real: the Library really searches Wikipedia, the Weather Station really checks the forecast.', target: () => firstTool(), skipIfMissing: true },
  { title: 'Send the city a job', text: 'Type a request here (or tap the example). Watch the mail vans: each one carries a real message from one worker to the next.', target: () => $('#askbar'), action: 'Try the example', waitFor: 'ran' },
  { title: 'Look at a worker\'s desk', text: 'Done! Click any worker, then “Desk”: that is everything the AI could see when it answered — its context window. Desks have limited room, just like real AI.', target: () => firstOffice() },
  { title: 'Give it a real brain', text: 'Right now workers follow a rehearsal script. Pick a real AI here — there are free options, including one that runs right in this tab.', target: () => $('#brainBtn') },
  { title: 'Make it yours', text: 'Hire workers, change the work route, or describe a whole new city in one sentence. When you\'re happy, Export it: your city is a real agent system you can run anywhere.', target: () => $('#buildbar') },
];
let tourStep = -1;

const firstOffice = () => { const b = state.world.buildings.find((x) => x.kind === 'office'); return b && renderer.anchorOf(b.id); };
const firstTool = () => { const b = state.world.buildings.find((x) => x.kind === 'tool'); return b && renderer.anchorOf(b.id); };

function startTour() {
  if (state.city.name !== 'Homework Helper') setCity(townByName('Homework Helper'));
  tourStep = 0;
  showTour();
}

function showTour() {
  const step = TOUR[tourStep];
  const box = $('#tour');
  if (!step) { box.hidden = true; tourStep = -1; store.set('toured', true); return; }
  let target = step.target?.();
  if (!target && step.skipIfMissing) { tourStep++; showTour(); return; }
  box.hidden = false;
  const spot = box.querySelector('.spot'); const card = box.querySelector('.card');
  let rect;
  if (target instanceof Element) rect = target.getBoundingClientRect();
  else if (target) rect = { left: target.x - 70, top: target.y - 70, width: 140, height: 120 };
  if (rect) Object.assign(spot.style, { left: `${rect.left - 6}px`, top: `${rect.top - 6}px`, width: `${rect.width + 12}px`, height: `${rect.height + 12}px`, display: 'block' });
  else Object.assign(spot.style, { left: '50%', top: '45%', width: '0px', height: '0px' });
  card.innerHTML = `<h3>${esc(step.title)}</h3><p>${esc(step.text)}</p>
    <div class="row"><span class="dots">${tourStep + 1} / ${TOUR.length}</span><span class="spacer"></span>
    <button class="btn small ghost" id="tourSkip">Skip tour</button>
    <button class="btn small primary" id="tourNext">${step.action || (tourStep === TOUR.length - 1 ? 'Let\'s go' : 'Next')}</button></div>`;
  const cw = Math.min(360, innerWidth - 24);
  let left = rect ? rect.left + rect.width / 2 - cw / 2 : innerWidth / 2 - cw / 2;
  left = Math.max(12, Math.min(innerWidth - cw - 12, left));
  let top = rect ? (rect.top > innerHeight / 2 ? rect.top - 190 : rect.top + rect.height + 18) : innerHeight / 2 - 90;
  top = Math.max(70, Math.min(innerHeight - 200, top));
  Object.assign(card.style, { left: `${left}px`, top: `${top}px` });
  card.querySelector('#tourSkip').onclick = () => { tourStep = TOUR.length; showTour(); };
  card.querySelector('#tourNext').onclick = () => {
    if (step.waitFor === 'ran') {
      box.hidden = true;
      runCity(state.city.example);
      return; // resumes on tourNext('ran')
    }
    tourStep++; showTour();
  };
}

function tourNext(event) {
  if (tourStep < 0) return;
  if (TOUR[tourStep]?.waitFor === event) { tourStep++; setTimeout(showTour, 600); }
}

// --------------------------------------------------------------------- boot ---

function bindUi() {
  $('#askbar').addEventListener('submit', (e) => { e.preventDefault(); runCity($('#ask').value); });
  $('#exampleBtn').onclick = () => { $('#ask').value = state.city.example; runCity(state.city.example); };
  $('#stopBtn').onclick = () => state.running?.controller.abort();
  $('#brainBtn').onclick = openBrain;
  $('#townBtn').onclick = openNewCity;
  $('#newBtn').onclick = openNewCity;
  $('#hireBtn').onclick = openHire;
  $('#routeBtn').onclick = openRoute;
  $('#dictBtn').onclick = openDictionary;
  $('#exportBtn').onclick = openExport;
  $('#importBtn').onclick = () => $('#importFile').click();
  $('#importFile').onchange = async (e) => { const f = e.target.files[0]; if (f) importText(await f.text(), 'file'); e.target.value = ''; };
  $('#shareBtn').onclick = share;
  $('#helpBtn').onclick = startTour;
  $('#realNames').checked = store.get('realNames', false);
  document.body.classList.toggle('real-names', $('#realNames').checked);
  $('#realNames').onchange = (e) => { document.body.classList.toggle('real-names', e.target.checked); store.set('realNames', e.target.checked); };
  document.querySelectorAll('.speed button').forEach((b) => {
    b.onclick = () => {
      const s = Number(b.dataset.speed);
      renderer.paused = s === 0;
      if (s) renderer.speed = s;
      document.querySelectorAll('.speed button').forEach((x) => x.classList.toggle('on', x === b));
    };
  });
  document.querySelectorAll('#news .tab[data-tab]').forEach((t) => {
    t.onclick = () => {
      document.querySelectorAll('#news .tab[data-tab]').forEach((x) => x.classList.toggle('on', x === t));
      $('#newsList').hidden = t.dataset.tab !== 'news';
      $('#xray').hidden = t.dataset.tab !== 'xray';
      $('#news').classList.remove('collapsed');
    };
  });
  $('#newsToggle').onclick = () => { $('#news').classList.toggle('collapsed'); $('#newsToggle').textContent = $('#news').classList.contains('collapsed') ? '+' : '–'; };
  $('#receiptBtn').onclick = () => download('agentropolis-receipt.json', JSON.stringify(state.ledger, null, 2), 'application/json');

  renderer.onSelect = (hit) => {
    if (!hit) { closePanel(); return; }
    if (hit.type === 'van') { openPanel({ type: 'van', van: hit.van }); return; }
    openPanel({ type: 'building', id: hit.id });
  };
  const tip = $('#tip');
  renderer.onHover = (hit, e) => {
    if (!hit || hit.type === 'van') { tip.hidden = !hit; if (hit) { tip.textContent = `✉️ Mail from ${person(hit.van.from)} to ${person(hit.van.to)} — click to read it`; Object.assign(tip.style, { left: `${e.clientX + 14}px`, top: `${e.clientY + 14}px` }); } return; }
    const b = state.world.byId.get(hit.id);
    if (!b) { tip.hidden = true; return; }
    const d = describeBuilding(b, state.city);
    const a = state.city.agents.find((x) => x.name === hit.id);
    tip.innerHTML = `<b>${esc(b.emoji)} ${esc(d.title)}</b>${document.body.classList.contains('real-names') ? ` · <code>${esc(d.real)}</code>` : ''}<br>${esc(a ? a.description || a.role : d.text)}<br><small>Click for details</small>`;
    Object.assign(tip.style, { left: `${Math.min(e.clientX + 14, innerWidth - 270)}px`, top: `${e.clientY + 14}px` });
    tip.hidden = false;
  };
  $('#city').addEventListener('pointerleave', () => { tip.hidden = true; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (!$('#modal').hidden) closeModal(); else closePanel(); }
  });
}

async function boot() {
  bindUi();
  updateBrainChip();
  try { state.localServer = (await fetch('/__agentropolis', { cache: 'no-store' })).ok; } catch { state.localServer = false; }

  let initial = null;
  const m = /#city=([\w-]+)/.exec(location.hash);
  if (m) {
    try { initial = JSON.parse(b64.dec(m[1])); history.replaceState(null, '', location.pathname); toast('Opened a shared city.'); } catch { toast('That shared link is damaged.'); }
  }
  if (!initial) initial = store.get('city', null);
  if (!initial || !validateCity(initial).ok) initial = townByName('Homework Helper');
  setCity(initial);
  $('#newsList').innerHTML = '<li class="empty">News from the city appears here as it happens — every line is something your AI workers really did.</li>';
  if (innerWidth <= 700) { $('#news').classList.add('collapsed'); $('#newsToggle').textContent = '+'; }
  renderer.fit();
  if (!store.get('toured', false)) setTimeout(startTour, 500);
}

boot();

// Exposed for automated checks and curious developers.
window.agentropolis = { state, renderer, director, runCity, setCity, TOWNS };
