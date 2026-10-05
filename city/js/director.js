// The director turns runtime events into city scenes.
//
// It is the only place where the city "acts", and it never acts on its own:
// each method below runs because the runtime reported a real event, and the
// runtime waits for the method's promise before doing the next real thing.

import { TOOL_PLACES, TOWN_HALL, PLAZA } from '../../src/city/index.mjs';
import { placeId } from './layout.js';
import { narrate, makeNamer } from './explain.js';

export class Director {
  /**
   * @param {import('./renderer.js').CityRenderer} renderer
   * @param {{onNews: Function, onRecord: Function, onCoins: Function}} hooks
   */
  constructor(renderer, hooks) {
    this.r = renderer;
    this.hooks = hooks;
    this.records = new Map(); // agent -> { desk, log: [] }
  }

  reset(city) {
    this.city = city;
    this.name = makeNamer(city);
    this.records = new Map(city.agents.map((a) => [a.name, { desk: null, log: [], thinking: '' }]));
    this.speakers = new Set();
  }

  record(agent, entry) {
    const rec = this.records.get(agent);
    if (!rec) return;
    rec.log.push({ ...entry, at: Date.now() });
    this.hooks.onRecord?.(agent, rec);
  }

  /** The runtime listener. Returns a promise the runtime waits on. */
  handle = async (e) => {
    if (e.type !== 'think:token') {
      const line = narrate(e, this.name);
      if (line) this.hooks.onNews?.(line, e);
    }
    const fn = this[`on_${e.type.replace(':', '_')}`];
    if (fn) await fn.call(this, e);
  };

  colorOf(id) {
    return this.city.agents.find((a) => a.name === id)?.city?.color || '#ffffff';
  }

  async on_run_start() {
    this.r.setStatus(TOWN_HALL, { thinking: true });
    this.r.float(TOWN_HALL, '📮 New request', '#ffd166');
    await this.r.wait(500);
    this.r.setStatus(TOWN_HALL, { thinking: false });
  }

  async on_mail(e) {
    const from = e.from; const to = e.to;
    if (e.to !== TOWN_HALL) this.record(e.to, { kind: 'mail-in', from, text: e.text });
    if (e.from !== TOWN_HALL && e.from !== PLAZA) this.record(e.from, { kind: 'mail-out', to, text: e.text });
    if (e.kind === 'result' && from === PLAZA) {
      await this.r.sendVan(PLAZA, TOWN_HALL, { kind: 'result', letter: e.text });
    } else {
      await this.r.sendVan(from, to, { color: from === TOWN_HALL ? '#ffffff' : this.colorOf(from), letter: e.text, kind: e.kind });
    }
    if (e.kind === 'result') {
      this.r.sparkle(TOWN_HALL, 14);
    } else {
      this.r.float(to, '✉️ Mail!', '#ffffff', { life: 1100 });
      await this.r.wait(250);
    }
  }

  async on_think_start(e) {
    const rec = this.records.get(e.agent);
    if (rec) { rec.desk = e.desk; rec.thinking = ''; }
    this.hooks.onRecord?.(e.agent, rec);
    this.r.setStatus(e.agent, { thinking: true, fire: false });
    this.r.bubble(e.agent, '💭 reading the desk…', this.speakers.has(e.agent) ? 'say' : 'think');
    if (e.desk.fallen.length) {
      this.r.dropPapers(e.agent, e.desk.fallen.length);
      this.r.float(e.agent, `📄 ${e.desk.fallen.length} page(s) fell off the desk`, '#ffb4a2', { life: 2600 });
      await this.r.wait(900);
    }
    await this.r.wait(350);
  }

  on_think_token(e) {
    const rec = this.records.get(e.agent);
    if (rec) rec.thinking += e.token;
    this.r.appendBubble(e.agent, e.token);
  }

  async on_think_end(e) {
    this.r.setStatus(e.agent, { thinking: false });
    const coins = e.usage.input + e.usage.output;
    this.r.float(e.agent, `🪙 −${coins.toLocaleString('en-US')}`, '#ffd166');
    this.hooks.onCoins?.(coins);
    this.record(e.agent, { kind: e.toolRequest ? 'slip' : 'answer', text: e.text, usage: e.usage, ms: e.ms });
    if (e.toolRequest) {
      const place = TOOL_PLACES[e.toolRequest.tool]?.place || e.toolRequest.tool;
      this.r.bubble(e.agent, `📝 I need the ${place}: ${JSON.stringify(e.toolRequest.input)}`, 'tool');
    } else {
      this.r.bubble(e.agent, e.text, this.speakers.has(e.agent) ? 'say' : 'think');
    }
    await this.r.wait(700);
    if (!this.speakers.has(e.agent)) this.r.bubble(e.agent, null);
  }

  async on_think_retry(e) {
    this.r.float(e.agent, '💨 retrying', '#ffb4a2');
    await this.r.wait(600);
  }

  async on_tool_start(e) {
    const target = e.tool === 'ask_mayor' ? TOWN_HALL : placeId(e.tool);
    const b = this.r.world.byId.get(target);
    this.record(e.agent, { kind: 'errand', tool: e.tool, input: e.input });
    if (!b) return;
    this.r.bubble(e.agent, null);
    await this.r.walk(e.agent, b);
    this.r.setStatus(target, { thinking: true });
    this.r.float(target, `${TOOL_PLACES[e.tool]?.emoji || '🔧'} working…`, '#bde0fe', { life: 1200 });
  }

  async on_tool_end(e) {
    const target = e.tool === 'ask_mayor' ? TOWN_HALL : placeId(e.tool);
    await this.r.wait(450);
    this.r.setStatus(target, { thinking: false });
    this.record(e.agent, { kind: 'errand-result', tool: e.tool, text: e.error ? `ERROR: ${e.error}` : e.output });
    const p = this.r.people.get(e.agent);
    if (!p) return;
    p.carrying = e.error ? '❌' : '📄';
    await this.r.walk(e.agent, p.home);
    p.carrying = null;
  }

  async on_decision(e) {
    const nextAgent = this.stepAgent(e.next);
    this.r.float(e.agent, e.passed ? `✅ → ${nextAgent ? this.name(nextAgent) : 'done'}` : `↩️ back to ${nextAgent ? this.name(nextAgent) : e.next}`,
      e.passed ? '#95f2b6' : '#ffd6a5', { life: 2400, big: true });
    await this.r.wait(1100);
  }

  stepAgent(stepId) {
    if (!stepId || stepId === 'END') return null;
    const steps = this.city.workflow.graph?.steps || this.city.workflow.steps || [];
    return steps.find((s) => (s.id || s.agent) === stepId)?.agent || null;
  }

  async on_meeting_start(e) {
    const plaza = this.r.world.byId.get(PLAZA);
    if (!plaza) return;
    const spots = [{ x: 0.1, y: -0.9 }, { x: 1.1, y: -1.6 }, { x: -0.9, y: -1.6 }, { x: 0.1, y: -2.4 }, { x: 1.2, y: -2.6 }, { x: -1.0, y: -2.6 }];
    await Promise.all(e.agents.map((a, i) => {
      this.speakers.add(a);
      return this.r.walk(a, { door: plaza.door, offset: spots[i % spots.length] });
    }));
  }

  async on_turn(e) {
    for (const a of this.speakers) if (a !== e.agent) { const p = this.r.people.get(a); if (p?.bubble) p.bubble.kind = 'idle'; }
    this.record(e.agent, { kind: 'mail-in', from: 'plaza', text: e.text });
    this.r.float(e.agent, '🎤', '#ffffff', { life: 900 });
    await this.r.wait(300);
  }

  async on_meeting_end(e) {
    await this.r.wait(900);
    for (const a of e.agents) this.r.bubble(a, null);
    this.speakers.clear();
    await Promise.all(e.agents.map((a) => {
      const p = this.r.people.get(a);
      return p ? this.r.walk(a, p.home) : null;
    }));
  }

  async on_approval_ask(e) {
    this.r.setStatus(e.agent, { waiting: true });
    this.r.setStatus(TOWN_HALL, { waiting: true });
  }

  async on_approval_answer(e) {
    this.r.setStatus(e.agent, { waiting: false });
    this.r.setStatus(TOWN_HALL, { waiting: false });
    this.r.float(e.agent, e.decision === 'reject' ? '⛔ STOPPED' : '🖋️ APPROVED', e.decision === 'reject' ? '#ffadad' : '#95f2b6', { big: true });
    await this.r.wait(700);
  }

  async on_inspector(e) {
    this.r.setStatus(e.agent, { inspected: true });
    this.r.float(e.agent, e.findings.length ? `🛡️ removed ${e.findings.length}` : '🛡️ checked', e.findings.length ? '#ffd6a5' : '#95f2b6', { life: 1400 });
    await this.r.wait(500);
    this.r.setStatus(e.agent, { inspected: false });
  }

  on_step_error(e) {
    this.r.setStatus(e.agent, { fire: true, thinking: false });
    this.r.bubble(e.agent, `🔥 ${e.message}`, 'error');
    this.record(e.agent, { kind: 'error', text: e.message });
  }

  async on_run_complete() {
    this.r.sparkle(TOWN_HALL, 36);
    this.r.float(TOWN_HALL, '🎉 Finished!', '#95f2b6', { big: true, life: 2600 });
  }

  on_run_error() {
    this.r.float(TOWN_HALL, '🚨 Could not finish', '#ffadad', { big: true, life: 3000 });
  }
}
