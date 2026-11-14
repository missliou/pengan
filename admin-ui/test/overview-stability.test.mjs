import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, button, find, flush } from './helpers/dom.mjs';
import renderOverview from '../src/pages/overview.js';
import { LiveObservations } from '../src/lib/freshness.js';
import { PageScope } from '../src/lib/session.js';
import { demoObservations } from '../src/demo.js';

test('overview retains card/button nodes across polls and expiry while clearing stale values', async t => {
  installDom(t); let now = 100000, tick, navigated = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setInterval', fn => { tick = fn; return 1; });
  t.mock.method(globalThis, 'clearInterval', () => {});
  const live = new LiveObservations(() => now), obs = demoObservations(now);
  obs.hardware.source = 'http'; obs.hardware.sampleAgeMs = 0;
  live.ingest(obs, now);
  const scope = new PageScope(); t.after(() => scope.dispose());
  const root = await renderOverview({ scope, state: {}, live, demoMode: false,
    markStatus() {}, setConnection() {}, navigate() { navigated++; }, dataSource: {
      getHealth: async () => ({ mode: 'hardware' }), getObservations: async () => live.current(),
      getModelStatus: async () => ({ configured: false }), getHardwareHistory: async () => ({ items: [] }),
    } });
  await flush();
  const card = find(root, n => n.className === 'card stat');
  const refresh = button(root, '重新读取');
  assert.match(root.textContent, /25.6/);
  for (let i = 0; i < 24; i++) {
    now += 500; tick(); await flush();
    assert.equal(find(root, n => n.className === 'card stat'), card);
    assert.equal(button(root, '重新读取'), refresh);
  }
  assert.doesNotMatch(root.textContent, /25.6/);
  assert.match(root.textContent, /过期/);
  await refresh.click(); assert.equal(navigated, 1);
});
