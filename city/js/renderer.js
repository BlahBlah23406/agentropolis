// Isometric canvas renderer.
//
// The renderer owns a world clock that advances by real time × speed. Every
// animation (a van driving, a worker walking, a pause at a desk) is measured
// on that clock and exposes a promise, which the director awaits — so the
// speed slider and the pause button control the agents themselves, not just
// the drawing.

import { findPath } from './layout.js';

const TW = 64;
const TH = 32;

export class CityRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = null;
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.clock = 0;
    this.speed = 1;
    this.paused = false;
    this.timers = [];
    this.people = new Map();
    this.vans = [];
    this.floaters = [];
    this.particles = [];
    this.papers = [];
    this.status = new Map(); // building id -> { thinking, fire, waiting, glow }
    this.hover = null;
    this.selected = null;
    this.onSelect = () => {};
    this.onHover = () => {};
    this._last = performance.now();
    this._bindInput();
    this._resize();
    window.addEventListener('resize', () => this._resize());
    requestAnimationFrame((t) => this._frame(t));
  }

  // ------------------------------------------------------------- world ---

  setWorld(world, city) {
    this.world = world;
    this.city = city;
    this.people.clear();
    this.vans = [];
    this.floaters = [];
    this.particles = [];
    this.papers = [];
    this.status.clear();
    for (const a of city.agents) {
      const b = world.byId.get(a.name);
      if (!b) continue;
      this.people.set(a.name, {
        id: a.name, x: b.door.x + 0.5, y: b.door.y + 0.5, home: b,
        color: a.city?.color || '#7c8cff', emoji: a.city?.emoji || '🙂', name: a.city?.person || a.name,
        path: null, bubble: null, carrying: null, facing: 1, bob: Math.random() * 6,
      });
    }
    this.fit();
  }

  fit() {
    if (!this.world) return;
    const { w, h } = this.world.size;
    const cw = this.canvas.clientWidth; const ch = this.canvas.clientHeight;
    // Fit into the part of the screen the panels leave free.
    const inset = { top: 60, bottom: 160, left: 0, right: 0, ...(this.getInsets?.() || {}) };
    const freeW = Math.max(200, cw - inset.left - inset.right);
    const freeH = Math.max(200, ch - inset.top - inset.bottom);
    // Frame the buildings (plus a little grass), not the whole island.
    const bs = this.world.buildings;
    const x0 = Math.max(0, Math.min(...bs.map((b) => b.x)) - 1); const y0 = Math.max(0, Math.min(...bs.map((b) => b.y)) - 1);
    const x1 = Math.min(w, Math.max(...bs.map((b) => b.x + b.w)) + 1); const y1 = Math.min(h, Math.max(...bs.map((b) => b.y + b.h)) + 2);
    const pts = [this.iso(x0, y0), this.iso(x1, y0), this.iso(x1, y1), this.iso(x0, y1)];
    const minX = Math.min(...pts.map((p) => p.x)); const maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y)) - 70; const maxY = Math.max(...pts.map((p) => p.y)) + 10;
    const zoom = Math.max(0.3, Math.min(1.5, Math.min((freeW - 16) / (maxX - minX), (freeH - 10) / (maxY - minY))));
    this.camera.zoom = zoom;
    this.camera.x = inset.left + freeW / 2 - ((minX + maxX) / 2) * zoom;
    this.camera.y = inset.top + freeH / 2 - ((minY + maxY) / 2) * zoom;
  }

  iso(gx, gy) { return { x: (gx - gy) * TW / 2, y: (gx + gy) * TH / 2 }; }
  toScreen(gx, gy, lift = 0) {
    const p = this.iso(gx, gy);
    return { x: p.x * this.camera.zoom + this.camera.x, y: (p.y - lift) * this.camera.zoom + this.camera.y };
  }
  toGrid(sx, sy) {
    const x = (sx - this.camera.x) / this.camera.zoom;
    const y = (sy - this.camera.y) / this.camera.zoom;
    return { gx: (x / (TW / 2) + y / (TH / 2)) / 2, gy: (y / (TH / 2) - x / (TW / 2)) / 2 };
  }

  // ---------------------------------------------------------- the clock ---

  /** Resolve after `ms` of world time (respects speed and pause). */
  wait(ms) {
    return new Promise((resolve) => this.timers.push({ at: this.clock + ms, resolve }));
  }

  setStatus(id, patch) {
    this.status.set(id, { ...(this.status.get(id) || {}), ...patch });
  }

  // ------------------------------------------------------------ actors ---

  pathBetween(fromDoor, toDoor) {
    const w = this.world;
    return findPath(fromDoor, toDoor, { w: w.size.w, h: w.size.h, blocked: w.blocked, roads: w.roads, roadCost: 0.3 })
      .map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 }));
  }

  /** Drive a mail van from one building to another. Resolves on arrival. */
  sendVan(fromId, toId, { color = '#ffffff', letter = '', kind = 'handoff' } = {}) {
    const A = this.world.byId.get(fromId); const B = this.world.byId.get(toId);
    if (!A || !B) return Promise.resolve();
    const path = this.pathBetween(A.door, B.door);
    return new Promise((resolve) => {
      this.vans.push({ path, i: 0, t: 0, x: path[0].x, y: path[0].y, color, letter, kind, from: fromId, to: toId, speed: 4.2, resolve });
    });
  }

  /** Walk a worker to a building's door (or a spot). Resolves on arrival. */
  walk(personId, target) {
    const p = this.people.get(personId);
    if (!p) return Promise.resolve();
    const door = target.door || target;
    const start = { x: Math.floor(p.x), y: Math.floor(p.y) };
    const path = this.pathBetween(start, { x: Math.floor(door.x), y: Math.floor(door.y) });
    if (target.offset) path.push({ x: door.x + target.offset.x, y: door.y + target.offset.y });
    return new Promise((resolve) => { p.path = { pts: path, i: 0, resolve }; p.speed = 2.6; });
  }

  bubble(personId, text, kind = 'think') {
    const p = this.people.get(personId);
    if (!p) return;
    p.bubble = text == null ? null : { text, kind, born: this.clock };
  }

  appendBubble(personId, token) {
    const p = this.people.get(personId);
    if (!p) return;
    if (!p.bubble || p.bubble.kind === 'idle') p.bubble = { text: '', kind: 'think', born: this.clock };
    p.bubble.text = (p.bubble.text + token).slice(-160);
  }

  float(id, text, color = '#ffd166', opts = {}) {
    const b = this.world?.byId.get(id) || this.people.get(id);
    if (!b) return;
    const x = b.door ? b.x + b.w / 2 : b.x; const y = b.door ? b.y + b.h / 2 : b.y;
    this.floaters.push({ x, y, lift: (b.height || 20) + 30, text, color, born: this.clock, life: opts.life || 2200, big: opts.big });
  }

  sparkle(id, n = 24, colors = ['#ffd166', '#06d6a0', '#ef476f', '#118ab2']) {
    const b = this.world?.byId.get(id);
    if (!b) return;
    for (let i = 0; i < n; i++) {
      this.particles.push({
        kind: 'spark', x: b.x + b.w / 2, y: b.y + b.h / 2, lift: b.height + 10,
        vx: (Math.random() - 0.5) * 2.4, vy: (Math.random() - 0.5) * 2.4, vl: 40 + Math.random() * 60,
        color: colors[i % colors.length], born: this.clock, life: 900 + Math.random() * 500,
      });
    }
  }

  /** Pages slipping off a desk: the context window overflowing. */
  dropPapers(id, n) {
    const b = this.world?.byId.get(id);
    if (!b) return;
    for (let i = 0; i < Math.min(n, 6); i++) {
      this.papers.push({ x: b.door.x + 0.5, y: b.door.y + 0.5, lift: b.height + 12, vx: (Math.random() - 0.5) * 0.9, vy: 0.4 + Math.random() * 0.5, spin: Math.random() * 6, born: this.clock + i * 120, life: 1800 });
    }
  }

  // ------------------------------------------------------------- loop ---

  _frame(now) {
    const dtReal = Math.min(64, now - this._last);
    this._last = now;
    const dt = this.paused ? 0 : dtReal * this.speed;
    this.clock += dt;
    this.timers = this.timers.filter((t) => (t.at <= this.clock ? (t.resolve(), false) : true));
    this._update(dt / 1000);
    this._draw(now);
    requestAnimationFrame((t) => this._frame(t));
  }

  _update(dt) {
    for (const v of this.vans) {
      let move = v.speed * dt;
      while (move > 0 && v.i < v.path.length - 1) {
        const a = v.path[v.i]; const b = v.path[v.i + 1];
        const seg = Math.hypot(b.x - a.x, b.y - a.y) || 0.0001;
        const left = seg * (1 - v.t);
        if (move >= left) { move -= left; v.i++; v.t = 0; } else { v.t += move / seg; move = 0; }
        const c = v.path[v.i]; const d = v.path[Math.min(v.i + 1, v.path.length - 1)];
        v.x = c.x + (d.x - c.x) * v.t; v.y = c.y + (d.y - c.y) * v.t;
        v.dir = { x: d.x - c.x, y: d.y - c.y };
      }
      if (v.i >= v.path.length - 1 && !v.done) { v.done = true; v.doneAt = this.clock; v.resolve(); }
    }
    this.vans = this.vans.filter((v) => !v.done || this.clock - v.doneAt < 250);

    for (const p of this.people.values()) {
      if (!p.path) continue;
      let move = p.speed * dt;
      while (move > 0 && p.path.i < p.path.pts.length - 1) {
        const a = { x: p.x, y: p.y }; const b = p.path.pts[p.path.i + 1];
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d <= move) { p.x = b.x; p.y = b.y; p.path.i++; move -= d; } else {
          p.x += (b.x - a.x) / d * move; p.y += (b.y - a.y) / d * move; move = 0;
          p.facing = (b.x - a.x) - (b.y - a.y) >= 0 ? 1 : -1;
        }
      }
      if (p.path.i >= p.path.pts.length - 1) { const r = p.path.resolve; p.path = null; r(); }
    }

    for (const s of this.particles) { s.x += s.vx * dt; s.y += s.vy * dt; s.lift += s.vl * dt; s.vl -= 160 * dt; }
    this.particles = this.particles.filter((s) => this.clock - s.born < s.life);
    for (const pg of this.papers) { if (this.clock < pg.born) continue; pg.x += pg.vx * dt; pg.y += pg.vy * dt; pg.lift = Math.max(0, pg.lift - 30 * dt); pg.spin += dt * 4; }
    this.papers = this.papers.filter((pg) => this.clock - pg.born < pg.life);
    this.floaters = this.floaters.filter((f) => this.clock - f.born < f.life);

    for (const [id, st] of this.status) {
      if (st.fire && Math.random() < dt * 14) {
        const b = this.world.byId.get(id);
        if (b) this.particles.push({ kind: Math.random() < 0.5 ? 'flame' : 'smoke', x: b.x + 0.4 + Math.random() * (b.w - 0.8), y: b.y + 0.4 + Math.random() * (b.h - 0.8), lift: b.height, vx: 0, vy: 0, vl: 30 + Math.random() * 30, born: this.clock, life: 900, color: '#ff7b00' });
      }
    }
  }

  // ------------------------------------------------------------- draw ---

  _draw(now) {
    const { ctx, canvas } = this;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    ctx.fillStyle = css.getPropertyValue('--sky').trim() || '#bde4f4';
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    if (!this.world) return;
    const { w, h } = this.world.size;
    const z = this.camera.zoom;

    ctx.save();
    ctx.translate(this.camera.x, this.camera.y);
    ctx.scale(z, z);

    // island edge
    const corners = [this.iso(0, 0), this.iso(w, 0), this.iso(w, h), this.iso(0, h)];
    ctx.fillStyle = '#8d6e4f';
    poly(ctx, [corners[3], corners[2], { x: corners[2].x, y: corners[2].y + 14 }, { x: corners[3].x, y: corners[3].y + 14 }]); ctx.fill();
    ctx.fillStyle = '#6f553b';
    poly(ctx, [corners[2], corners[1], { x: corners[1].x, y: corners[1].y + 14 }, { x: corners[2].x, y: corners[2].y + 14 }]); ctx.fill();

    // tiles
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        const road = this.world.roads.has(`${x},${y}`);
        const p = [this.iso(x, y), this.iso(x + 1, y), this.iso(x + 1, y + 1), this.iso(x, y + 1)];
        ctx.fillStyle = road ? '#8a8f98' : ((x + y) % 2 ? '#7cc576' : '#74bd6e');
        poly(ctx, p); ctx.fill();
        if (road) {
          ctx.fillStyle = '#9aa0a8';
          const c = this.iso(x + 0.5, y + 0.5);
          ctx.beginPath(); ctx.ellipse(c.x, c.y, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    // depth-sorted objects
    const items = [];
    for (const b of this.world.buildings) items.push({ d: b.x + b.w + b.y + b.h - 0.01, draw: () => this._building(b, now) });
    for (const t of this.world.trees) items.push({ d: t.x + t.y, draw: () => this._tree(t) });
    for (const p of this.people.values()) items.push({ d: p.x + p.y + 0.02, draw: () => this._person(p, now) });
    for (const v of this.vans) items.push({ d: v.x + v.y + 0.03, draw: () => this._van(v) });
    items.sort((a, b) => a.d - b.d);
    for (const it of items) it.draw();

    for (const s of this.particles) this._particle(s);
    for (const pg of this.papers) if (this.clock >= pg.born) this._paper(pg);
    for (const p of this.people.values()) this._personTag(p);
    for (const p of this.people.values()) if (p.bubble) this._bubble(p);
    for (const f of this.floaters) this._floater(f);
    for (const b of this.world.buildings) this._label(b);

    ctx.restore();
  }

  _building(b, now) {
    const { ctx } = this;
    const st = this.status.get(b.id) || {};
    const T = this.iso(b.x, b.y); const R = this.iso(b.x + b.w, b.y);
    const B = this.iso(b.x + b.w, b.y + b.h); const L = this.iso(b.x, b.y + b.h);
    const H = b.height;
    const up = (p, d = H) => ({ x: p.x, y: p.y - d });
    const sel = this.selected === b.id; const hov = this.hover === b.id;

    if (b.kind === 'plaza') {
      ctx.fillStyle = '#e6dcc4'; poly(ctx, [T, R, B, L]); ctx.fill();
      ctx.strokeStyle = '#c9bb98'; ctx.lineWidth = 1.5; poly(ctx, [T, R, B, L]); ctx.stroke();
      const c = this.iso(b.x + b.w / 2, b.y + b.h / 2);
      ctx.fillStyle = '#b9ad90'; ctx.beginPath(); ctx.ellipse(c.x, c.y, 26, 13, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5fb8e8'; ctx.beginPath(); ctx.ellipse(c.x, c.y - 2, 20, 10, 0, 0, Math.PI * 2); ctx.fill();
      const jet = 10 + Math.sin(now / 200) * 2;
      ctx.strokeStyle = '#d8f1ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(c.x, c.y - 2); ctx.lineTo(c.x, c.y - 2 - jet); ctx.stroke();
      if (sel || hov) { ctx.strokeStyle = sel ? '#ffd166' : '#ffffffaa'; ctx.lineWidth = 3; poly(ctx, [T, R, B, L]); ctx.stroke(); }
      return;
    }

    // shadow + glow
    if (st.thinking || sel || hov || st.waiting) {
      ctx.save();
      ctx.fillStyle = st.thinking ? 'rgba(255,214,102,0.35)' : st.waiting ? 'rgba(255,120,80,0.35)' : 'rgba(255,255,255,0.25)';
      const pad = 0.35 + (st.thinking ? Math.sin(now / 180) * 0.08 : 0);
      poly(ctx, [this.iso(b.x - pad, b.y - pad), this.iso(b.x + b.w + pad, b.y - pad), this.iso(b.x + b.w + pad, b.y + b.h + pad), this.iso(b.x - pad, b.y + b.h + pad)]);
      ctx.fill(); ctx.restore();
    }

    const base = b.color;
    ctx.fillStyle = shade(base, -0.18); poly(ctx, [L, B, up(B), up(L)]); ctx.fill();     // front-left wall
    ctx.fillStyle = shade(base, -0.34); poly(ctx, [B, R, up(R), up(B)]); ctx.fill();     // front-right wall

    // windows (lit while the worker inside is thinking)
    const lit = st.thinking ? (Math.floor(now / 250) % 2 ? '#ffe08a' : '#fff1b8') : 'rgba(30,40,60,0.55)';
    ctx.fillStyle = lit;
    const rows = Math.max(1, Math.floor(H / 14));
    for (const [P, Q] of [[L, B], [B, R]]) {
      for (let r = 0; r < rows; r++) {
        for (let k = 1; k <= 2; k++) {
          const t = k / 3; const lift = 8 + r * 13;
          const cx = P.x + (Q.x - P.x) * t; const cy = P.y + (Q.y - P.y) * t - lift;
          const dx = (Q.x - P.x) * 0.09; const dy = (Q.y - P.y) * 0.09;
          poly(ctx, [{ x: cx - dx, y: cy - dy }, { x: cx + dx, y: cy + dy }, { x: cx + dx, y: cy + dy - 6 }, { x: cx - dx, y: cy - dy - 6 }]); ctx.fill();
        }
      }
    }
    // door
    const dm = { x: (L.x + B.x) / 2, y: (L.y + B.y) / 2 };
    ctx.fillStyle = '#4a3426';
    poly(ctx, [{ x: dm.x - 5, y: dm.y - 2.5 }, { x: dm.x + 5, y: dm.y + 2.5 }, { x: dm.x + 5, y: dm.y - 9.5 }, { x: dm.x - 5, y: dm.y - 14.5 }]); ctx.fill();

    // roof
    const rT = up(T); const rR = up(R); const rB = up(B); const rL = up(L);
    if (b.roof === 'pitched') {
      const ridge = 16;
      const P1 = { x: (rT.x + rL.x) / 2, y: (rT.y + rL.y) / 2 - ridge };
      const P2 = { x: (rR.x + rB.x) / 2, y: (rR.y + rB.y) / 2 - ridge };
      ctx.fillStyle = shade(base, 0.05); poly(ctx, [rT, rR, P2, P1]); ctx.fill();
      ctx.fillStyle = shade('#c0563f', 0); poly(ctx, [rL, rB, P2, P1]); ctx.fill();
      ctx.fillStyle = shade(base, -0.3); poly(ctx, [rB, rR, P2]); ctx.fill();
    } else {
      ctx.fillStyle = shade(base, 0.12); poly(ctx, [rT, rR, rB, rL]); ctx.fill();
      const c = { x: (rT.x + rB.x) / 2, y: (rT.y + rB.y) / 2 };
      if (b.roof === 'dome') {
        ctx.fillStyle = shade(base, 0.25);
        ctx.beginPath(); ctx.ellipse(c.x, c.y, 18 * b.w / 2, 9 * b.w / 2, 0, Math.PI, 0); ctx.ellipse(c.x, c.y, 18 * b.w / 2, 9 * b.w / 2, 0, 0, Math.PI); ctx.fill();
        ctx.beginPath(); ctx.ellipse(c.x, c.y - 2, 14 * b.w / 2, 18 * b.w / 2, 0, Math.PI, 0); ctx.fill();
        ctx.fillStyle = shade(base, -0.1); ctx.fillRect(c.x - 1, c.y - 20 * b.w / 2 - 12, 2, 12);
      } else if (b.roof === 'tower') {
        const tw = 10;
        ctx.fillStyle = shade(base, -0.05); ctx.fillRect(c.x - tw, c.y - 26, tw * 2, 26);
        ctx.fillStyle = shade(base, -0.25); ctx.fillRect(c.x, c.y - 26, tw, 26);
        ctx.fillStyle = '#7a3e2d'; ctx.beginPath(); ctx.moveTo(c.x - tw - 3, c.y - 26); ctx.lineTo(c.x + tw + 3, c.y - 26); ctx.lineTo(c.x, c.y - 44); ctx.fill();
      }
    }

    if (sel || hov) {
      ctx.strokeStyle = sel ? '#ffd166' : 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2.5;
      poly(ctx, [L, B, R, up(R), up(T), up(L)]); ctx.stroke();
    }
  }

  _label(b) {
    const { ctx } = this;
    const st = this.status.get(b.id) || {};
    const c = this.iso(b.x + b.w / 2, b.y + b.h / 2);
    const top = c.y - b.height - (b.roof === 'tower' ? 50 : b.roof === 'dome' ? 34 : b.roof === 'pitched' ? 28 : 12) - (b.kind === 'plaza' ? 18 : 0);
    ctx.font = '600 11px system-ui, sans-serif';
    const text = `${b.emoji} ${b.label}`;
    const tw = ctx.measureText(text).width + 14;
    ctx.fillStyle = 'rgba(20,24,40,0.78)';
    roundRect(ctx, c.x - tw / 2, top - 16, tw, 18, 9); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, c.x, top - 7);
    if (b.sublabel) {
      ctx.font = '500 9.5px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(20,24,40,0.85)';
      ctx.fillText(b.sublabel, c.x, top + 7);
    }
    if (st.waiting) this._badge(c.x + tw / 2, top - 16, '✋', '#ff7a59');
    if (st.fire) this._badge(c.x + tw / 2, top - 16, '🔥', '#e5484d');
    if (st.inspected) this._badge(c.x - tw / 2, top - 16, '🛡️', '#2fbf71');
  }

  _badge(x, y, emoji, color) {
    const { ctx } = this;
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
    ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(emoji, x, y + 1);
  }

  _tree(t) {
    const { ctx } = this;
    const c = this.iso(t.x, t.y);
    const s = t.size;
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.beginPath(); ctx.ellipse(c.x, c.y, 9 * s, 4.5 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7a5a3a'; ctx.fillRect(c.x - 1.5, c.y - 10 * s, 3, 10 * s);
    ctx.fillStyle = t.hue < 0.5 ? '#3f9b4f' : '#4caf5a';
    ctx.beginPath(); ctx.arc(c.x, c.y - 15 * s, 8 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.arc(c.x - 2.5 * s, c.y - 17.5 * s, 3.5 * s, 0, Math.PI * 2); ctx.fill();
  }

  _person(p, now) {
    const { ctx } = this;
    const c = this.iso(p.x, p.y);
    const moving = Boolean(p.path);
    const bob = moving ? Math.abs(Math.sin(now / 90 + p.bob)) * 2.5 : 0;
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(c.x, c.y, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.color; roundRect(ctx, c.x - 4.5, c.y - 15 - bob, 9, 12, 4); ctx.fill();
    ctx.fillStyle = '#f2c9a0'; ctx.beginPath(); ctx.arc(c.x, c.y - 19 - bob, 4.2, 0, Math.PI * 2); ctx.fill();
    if (p.carrying) { ctx.font = '10px system-ui'; ctx.textAlign = 'center'; ctx.fillText(p.carrying, c.x + 7 * p.facing, c.y - 10 - bob); }
  }

  /** Name tags go on top of everything, so a worker is never lost behind a building. */
  _personTag(p) {
    const { ctx } = this;
    const c = this.iso(p.x, p.y);
    ctx.font = '600 9px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(p.name).width + 8;
    ctx.fillStyle = this.selected === p.id ? '#ffd166' : 'rgba(255,255,255,0.9)';
    roundRect(ctx, c.x - tw / 2, c.y + 3, tw, 11, 5); ctx.fill();
    ctx.fillStyle = '#1d2333'; ctx.fillText(p.name, c.x, c.y + 8.5);
  }

  _van(v) {
    const { ctx } = this;
    const c = this.iso(v.x, v.y);
    const flip = v.dir && (v.dir.x - v.dir.y) < 0 ? -1 : 1;
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(c.x, c.y, 10, 4.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(c.x, c.y); ctx.scale(flip, 1);
    ctx.fillStyle = v.kind === 'result' ? '#ffd166' : v.color;
    roundRect(ctx, -10, -13, 20, 10, 3); ctx.fill();
    ctx.fillStyle = 'rgba(30,40,60,0.7)'; ctx.fillRect(4, -11.5, 5, 4);
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(-6, -3, 2.4, 0, Math.PI * 2); ctx.arc(6, -3, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(v.kind === 'result' ? '📦' : '✉️', c.x, c.y - 19);
  }

  _bubble(p) {
    const { ctx } = this;
    const c = this.iso(p.x, p.y);
    const b = p.bubble;
    const text = b.text.replace(/\s+/g, ' ').trim();
    if (!text) return;
    ctx.font = '500 10px system-ui, sans-serif';
    const lines = wrap(ctx, text.length > 110 ? `…${text.slice(-110)}` : text, 150).slice(-3);
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14;
    const h = lines.length * 12 + 10;
    const x = c.x - w / 2; const y = c.y - 34 - h;
    ctx.fillStyle = b.kind === 'say' ? '#fff8e1' : b.kind === 'tool' ? '#e7f6ff' : b.kind === 'error' ? '#ffe3e3' : '#ffffff';
    ctx.strokeStyle = 'rgba(20,24,40,0.25)'; ctx.lineWidth = 1;
    roundRect(ctx, x, y, w, h, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(c.x - 4, y + h); ctx.lineTo(c.x, y + h + 6); ctx.lineTo(c.x + 4, y + h); ctx.fill();
    ctx.fillStyle = '#1d2333'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, x + 7, y + 5 + i * 12));
  }

  _floater(f) {
    const { ctx } = this;
    const age = (this.clock - f.born) / f.life;
    const c = this.iso(f.x, f.y);
    ctx.globalAlpha = Math.max(0, 1 - age * age);
    ctx.font = `700 ${f.big ? 15 : 12}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const y = c.y - f.lift - age * 30;
    const tw = ctx.measureText(f.text).width + 12;
    ctx.fillStyle = 'rgba(20,24,40,0.8)'; roundRect(ctx, c.x - tw / 2, y - 10, tw, 20, 10); ctx.fill();
    ctx.fillStyle = f.color; ctx.fillText(f.text, c.x, y);
    ctx.globalAlpha = 1;
  }

  _particle(s) {
    const { ctx } = this;
    const c = this.iso(s.x, s.y);
    const age = (this.clock - s.born) / s.life;
    ctx.globalAlpha = Math.max(0, 1 - age);
    if (s.kind === 'spark') { ctx.fillStyle = s.color; ctx.fillRect(c.x - 2, c.y - s.lift - 2, 4, 4); }
    else if (s.kind === 'flame') { ctx.fillStyle = age < 0.4 ? '#ffd166' : '#ff7b00'; ctx.beginPath(); ctx.arc(c.x, c.y - s.lift, 4 * (1 - age) + 1, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.fillStyle = '#6b6b6b'; ctx.beginPath(); ctx.arc(c.x, c.y - s.lift, 3 + age * 7, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
  }

  _paper(pg) {
    const { ctx } = this;
    const c = this.iso(pg.x, pg.y);
    const age = (this.clock - pg.born) / pg.life;
    ctx.globalAlpha = Math.max(0, 1 - age);
    ctx.save(); ctx.translate(c.x, c.y - pg.lift); ctx.rotate(Math.sin(pg.spin) * 0.6);
    ctx.fillStyle = '#fffdf5'; ctx.strokeStyle = '#c9c2b0'; ctx.fillRect(-5, -6, 10, 12); ctx.strokeRect(-5, -6, 10, 12);
    ctx.fillStyle = '#c9c2b0'; ctx.fillRect(-3, -3, 6, 1); ctx.fillRect(-3, 0, 6, 1); ctx.fillRect(-3, 3, 4, 1);
    ctx.restore(); ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ input ---

  hitTest(sx, sy) {
    if (!this.world) return null;
    for (const v of this.vans) {
      const c = this.toScreen(v.x, v.y, 8);
      if (Math.hypot(c.x - sx, c.y - sy) < 14 * this.camera.zoom) return { type: 'van', van: v };
    }
    for (const p of this.people.values()) {
      const c = this.toScreen(p.x, p.y, 14);
      if (Math.hypot(c.x - sx, c.y - sy) < 11 * this.camera.zoom) return { type: 'person', id: p.id };
    }
    // buildings: front-most first
    const sorted = [...this.world.buildings].sort((a, b) => (b.x + b.y + b.w + b.h) - (a.x + a.y + a.w + a.h));
    for (const b of sorted) {
      const T = this.toScreen(b.x, b.y, b.height); const R = this.toScreen(b.x + b.w, b.y, b.height);
      const B = this.toScreen(b.x + b.w, b.y + b.h); const L = this.toScreen(b.x, b.y + b.h);
      const shape = [L, B, this.toScreen(b.x + b.w, b.y), R, T, this.toScreen(b.x, b.y + b.h, b.height)];
      if (pointInPoly(sx, sy, shape)) return { type: 'building', id: b.id };
      const lab = this.toScreen(b.x + b.w / 2, b.y + b.h / 2, b.height + 34);
      if (Math.abs(sx - lab.x) < 50 * this.camera.zoom && Math.abs(sy - lab.y) < 12 * this.camera.zoom) return { type: 'building', id: b.id };
    }
    return null;
  }

  _bindInput() {
    const cv = this.canvas;
    let drag = null;
    const pointers = new Map();
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      drag = { x: e.offsetX, y: e.offsetY, cx: this.camera.x, cy: this.camera.y, moved: false };
    });
    cv.addEventListener('pointermove', (e) => {
      if (pointers.size === 2 && pointers.has(e.pointerId)) {
        const [a, b] = [...pointers.values()];
        const before = Math.hypot(a.x - b.x, a.y - b.y);
        pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
        const [a2, b2] = [...pointers.values()];
        const after = Math.hypot(a2.x - b2.x, a2.y - b2.y);
        if (before > 0) this.zoomAt((a2.x + b2.x) / 2, (a2.y + b2.y) / 2, after / before);
        if (drag) drag.moved = true;
        return;
      }
      if (drag && pointers.has(e.pointerId)) {
        const dx = e.offsetX - drag.x; const dy = e.offsetY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
        if (drag.moved) { this.camera.x = drag.cx + dx; this.camera.y = drag.cy + dy; }
        pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
        return;
      }
      const hit = this.hitTest(e.offsetX, e.offsetY);
      const id = hit?.type === 'building' ? hit.id : hit?.type === 'person' ? `person:${hit.id}` : hit?.type === 'van' ? 'van' : null;
      if (id !== this.hover) { this.hover = id; this.onHover(hit, e); }
      cv.style.cursor = hit ? 'pointer' : 'grab';
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (drag && !drag.moved && pointers.size === 0) this.onSelect(this.hitTest(e.offsetX, e.offsetY));
      if (pointers.size === 0) drag = null;
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.1 : 0.9); }, { passive: false });
  }

  zoomAt(sx, sy, factor) {
    const z = Math.max(0.35, Math.min(2.6, this.camera.zoom * factor));
    const k = z / this.camera.zoom;
    this.camera.x = sx - (sx - this.camera.x) * k;
    this.camera.y = sy - (sy - this.camera.y) * k;
    this.camera.zoom = z;
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    if (this.world) this.fit();
  }

  /** Screen position of a building's label, for tour callouts. */
  anchorOf(id) {
    const b = this.world?.byId.get(id);
    if (!b) return null;
    const r = this.canvas.getBoundingClientRect();
    const p = this.toScreen(b.x + b.w / 2, b.y + b.h / 2, b.height / 2);
    return { x: p.x + r.left, y: p.y + r.top };
  }
}

// ------------------------------------------------------------- helpers ---

function poly(ctx, pts) {
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function shade(hex, amt) {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  let r = (n >> 16) & 255; let g = (n >> 8) & 255; let b = n & 255;
  const t = amt < 0 ? 0 : 255; const p = Math.abs(amt);
  r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
  return `rgb(${r},${g},${b})`;
}
function wrap(ctx, text, max) {
  const words = text.split(' '); const lines = []; let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > max && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}
function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]; const b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
