import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  createJoinCode, validateAndUseJoinCode, createGuestSession,
  getGuestSession, getUserEvents, _resetMultiuserStore
} from '../src/multiuser.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

test('multiuser module: join code generation, validation, and usage limits', () => {
  _resetMultiuserStore();
  const codeObj = createJoinCode({ ttlMs: 60000, maxUses: 1 });
  assert.equal(typeof codeObj.code, 'string');
  assert.equal(codeObj.code.length, 6);
  assert.equal(codeObj.maxUses, 1);

  // First use should succeed
  const val1 = validateAndUseJoinCode(codeObj.code);
  assert.equal(val1.ok, true);

  // Second use should fail (max uses reached)
  const val2 = validateAndUseJoinCode(codeObj.code);
  assert.equal(val2.ok, false);
  assert.match(val2.error, /maximum uses|Invalid/i);
});

test('multiuser module: guest session management and event isolation', () => {
  _resetMultiuserStore();
  const s1 = createGuestSession('Alice');
  const s2 = createGuestSession('Bob');

  assert.ok(s1.token && s1.userId);
  assert.ok(s2.token && s2.userId);
  assert.notEqual(s1.userId, s2.userId);
  assert.notEqual(s1.token, s2.token);

  const found1 = getGuestSession(s1.token);
  assert.equal(found1.displayName, 'Alice');

  const invalid = getGuestSession('tok_invalid');
  assert.equal(invalid, null);

  const e1 = getUserEvents(s1.userId);
  const e2 = getUserEvents(s2.userId);
  assert.equal(e1.length, 1);
  assert.equal(e2.length, 1);
  assert.match(e1[0].text, /Alice/);
  assert.match(e2[0].text, /Bob/);
});

test('server endpoints: join code flow, per-user mission, and session isolation', async (t) => {
  const port = await getFreePort();
  const srv = spawn(process.execPath, [join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TEST_MOCK_MISSION: '1' },
    stdio: 'ignore',
    windowsHide: true,
  });

  try {
    // Wait for server boot
    let up = false;
    for (let i = 0; i < 25 && !up; i++) {
      await new Promise((r) => setTimeout(r, 200));
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(900) });
        up = res.ok;
      } catch { /* booting */ }
    }
    assert.ok(up, 'Server failed to start');

    // 1. Generate join code via owner endpoint
    const genRes = await fetch(`http://127.0.0.1:${port}/api/owner/join-code`, { method: 'POST' });
    assert.equal(genRes.status, 200);
    const genData = await genRes.json();
    assert.equal(genData.ok, true);
    assert.equal(typeof genData.code, 'string');
    assert.equal(genData.code.length, 6);

    // 2. Join as guest using the join code
    const joinRes = await fetch(`http://127.0.0.1:${port}/api/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ joinCode: genData.code, displayName: 'TestExplorer' }),
    });
    assert.equal(joinRes.status, 200);
    const joinData = await joinRes.json();
    assert.equal(joinData.ok, true);
    assert.ok(joinData.token);
    assert.equal(joinData.user.displayName, 'TestExplorer');

    // 3. Verify user identity via /api/user/me
    const meRes = await fetch(`http://127.0.0.1:${port}/api/user/me`, {
      headers: { 'Authorization': `Bearer ${joinData.token}` },
    });
    assert.equal(meRes.status, 200);
    const meData = await meRes.json();
    assert.equal(meData.user.displayName, 'TestExplorer');

    // 4. Test unauthorized request without token
    const unauthRes = await fetch(`http://127.0.0.1:${port}/api/user/city`);
    assert.equal(unauthRes.status, 401);

    // 5. Test per-user city endpoint
    const cityRes = await fetch(`http://127.0.0.1:${port}/api/user/city`, {
      headers: { 'Authorization': `Bearer ${joinData.token}` },
    });
    assert.equal(cityRes.status, 200);
    const cityData = await cityRes.json();
    assert.equal(cityData.isGuest, true);
    assert.equal(cityData.user.displayName, 'TestExplorer');
    assert.ok(Array.isArray(cityData.events));

    // 6. Test submitting guest mission
    const missionRes = await fetch(`http://127.0.0.1:${port}/api/user/mission`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Authorization': `Bearer ${joinData.token}`,
      },
      body: JSON.stringify({ text: 'Calculate hyperdrive coordinates' }),
    });
    assert.ok(missionRes.status === 200 || missionRes.status === 502);
    const missionData = await missionRes.json();
    assert.ok(missionData.ok || missionData.error);

    // 7. Verify per-user message history
    const msgRes = await fetch(`http://127.0.0.1:${port}/api/user/messages`, {
      headers: { 'Authorization': `Bearer ${joinData.token}` },
    });
    assert.equal(msgRes.status, 200);
    const msgData = await msgRes.json();
    assert.equal(msgData.ok, true);
    assert.ok(Array.isArray(msgData.messages));
    assert.equal(msgData.messages.length, 1);
    assert.equal(msgData.messages[0].text, 'Calculate hyperdrive coordinates');

  } finally {
    srv.kill();
  }
});
