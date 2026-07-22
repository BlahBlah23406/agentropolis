// Multi-user hosted agent platform logic for Agentropolis.
// Manages join codes, guest session tokens, per-user event logs, and guest missions.

import { randomBytes } from 'node:crypto';

// In-memory state
const joinCodes = new Map();     // code -> { code, expiresAt, maxUses, uses, createdAt }
const guestSessions = new Map(); // token -> { userId, displayName, token, createdAt, lastSeen }
const userEvents = new Map();    // userId -> Array of events
const userMessages = new Map();  // userId -> Array of { text, reply, ts, sessionKey }

function randomAlphanumeric(length = 6) {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // exclude easily confused chars (0,1,O,I)
  const bytes = randomBytes(length);
  let res = '';
  for (let i = 0; i < length; i++) {
    res += chars[bytes[i] % chars.length];
  }
  return res;
}

export function createJoinCode({ ttlMs = 24 * 3600 * 1000, maxUses = 1 } = {}) {
  let code = randomAlphanumeric(6);
  while (joinCodes.has(code)) {
    code = randomAlphanumeric(6);
  }
  const entry = {
    code,
    expiresAt: Date.now() + ttlMs,
    maxUses: Math.max(1, Number(maxUses) || 1),
    uses: 0,
    createdAt: Date.now(),
  };
  joinCodes.set(code, entry);
  return { ...entry };
}

export function listJoinCodes() {
  const now = Date.now();
  const list = [];
  for (const [code, entry] of joinCodes.entries()) {
    if (entry.expiresAt > now && entry.uses < entry.maxUses) {
      list.push({
        code: entry.code,
        expiresAt: entry.expiresAt,
        remainingUses: entry.maxUses - entry.uses,
        createdAt: entry.createdAt,
      });
    }
  }
  return list;
}

export function validateAndUseJoinCode(inputCode) {
  const code = String(inputCode || '').trim().toUpperCase();
  if (!code) return { ok: false, error: 'Join code is required' };

  const entry = joinCodes.get(code);
  if (!entry) return { ok: false, error: 'Invalid join code' };

  if (Date.now() > entry.expiresAt) {
    joinCodes.delete(code);
    return { ok: false, error: 'Join code has expired' };
  }

  if (entry.uses >= entry.maxUses) {
    joinCodes.delete(code);
    return { ok: false, error: 'Join code has reached maximum uses' };
  }

  entry.uses++;
  if (entry.uses >= entry.maxUses) {
    // leave it expired/consumed
  }
  return { ok: true, entry };
}

export function createGuestSession(displayName) {
  const name = String(displayName || '').trim().slice(0, 40) || 'Guest Agent';
  const userId = 'u_' + randomBytes(4).toString('hex');
  const token = 'tok_' + randomBytes(24).toString('hex');
  const session = {
    userId,
    displayName: name,
    token,
    createdAt: Date.now(),
    lastSeen: Date.now(),
  };
  guestSessions.set(token, session);
  userEvents.set(userId, []);
  userMessages.set(userId, []);
  
  // Initial welcome event for the guest's city feed
  addUserEvent(userId, {
    ts: Date.now(),
    type: 'order_in',
    source: 'system',
    text: `Guest agent online for ${name}`,
    dept: 'governor',
  });

  return session;
}

export function getGuestSession(token) {
  if (!token || typeof token !== 'string') return null;
  const rawToken = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();
  const session = guestSessions.get(rawToken);
  if (session) {
    session.lastSeen = Date.now();
  }
  return session || null;
}

export function addUserEvent(userId, event) {
  let list = userEvents.get(userId);
  if (!list) {
    list = [];
    userEvents.set(userId, list);
  }
  const fullEvent = {
    ts: event.ts || Date.now(),
    type: event.type || 'action',
    ...event,
  };
  list.push(fullEvent);
  if (list.length > 500) {
    list.splice(0, list.length - 500);
  }
  return fullEvent;
}

export function getUserEvents(userId, maxEvents = 500) {
  const list = userEvents.get(userId) || [];
  return list.slice(-maxEvents);
}

export function addUserMessage(userId, msg) {
  let list = userMessages.get(userId);
  if (!list) {
    list = [];
    userMessages.set(userId, list);
  }
  list.push(msg);
  if (list.length > 100) {
    list.splice(0, list.length - 100);
  }
}

export function getUserMessages(userId) {
  return userMessages.get(userId) || [];
}

export async function runGuestMission({ session, text, runMissionFn }) {
  const ts = Date.now();
  const sessionKey = `agent:main:agentropolis-user-${session.userId}-${ts}`;

  addUserEvent(session.userId, {
    ts,
    type: 'order_in',
    source: 'guest_web',
    text,
    dept: 'governor',
  });

  addUserEvent(session.userId, {
    ts: ts + 10,
    type: 'route',
    dept: 'governor',
    via: "Governor's Office",
  });

  addUserEvent(session.userId, {
    ts: ts + 20,
    type: 'worker_start',
    dept: 'research',
  });

  addUserEvent(session.userId, {
    ts: ts + 30,
    type: 'action',
    dept: 'research',
    tool: 'openclaw',
    text: `Processing task for ${session.displayName}...`,
  });

  const res = await runMissionFn({ text, sessionKey, displayName: session.displayName });

  if (res.ok) {
    const endTs = Date.now();
    addUserEvent(session.userId, {
      ts: endTs,
      type: 'result',
      dept: 'governor',
      text: res.reply || 'Task completed successfully',
    });
    addUserEvent(session.userId, {
      ts: endTs + 10,
      type: 'deliver_out',
      channel: 'web',
      text: res.reply || 'Task completed successfully',
    });
    addUserMessage(session.userId, {
      text,
      reply: res.reply,
      ts: endTs,
      sessionKey,
    });
    return { ok: true, reply: res.reply, sessionKey };
  } else {
    addUserEvent(session.userId, {
      ts: Date.now(),
      type: 'result',
      dept: 'governor',
      text: `Error: ${res.error || 'Mission execution failed'}`,
    });
    return { ok: false, error: res.error || 'Mission execution failed' };
  }
}

// Reset helper for testing
export function _resetMultiuserStore() {
  joinCodes.clear();
  guestSessions.clear();
  userEvents.clear();
  userMessages.clear();
}
