import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API } from '../src/lib/api.js';

test('fetch uses same-origin credentials, refuses redirects, and carries page cancellation', async t => {
  const scope = new AbortController(); let init;
  t.mock.method(globalThis, 'fetch', async (_url, options) => { init = options; return Response.json({ ok: true }); });
  assert.deepEqual(await API.getHealth({ signal: scope.signal }), { ok: true });
  assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'same-origin');
  scope.abort(); assert.equal(init.signal.aborted, true);
});

test('stream size limit cancels the reader and invalid UTF-8 is a parse failure', async t => {
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(65537)); }, cancel() { cancelled = true; },
  })));
  await assert.rejects(API.getHealth(), e => e.kind === 'parse'); assert.equal(cancelled, true);
  globalThis.fetch = async () => new Response(new Uint8Array([0xff]));
  await assert.rejects(API.getHealth(), e => e.kind === 'parse');
});

test('malformed JSON and upstream raw error text never appear as accepted data', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{'));
  await assert.rejects(API.getHealth(), e => e.kind === 'parse');
  globalThis.fetch = async () => Response.json({ error: 'private error text! token=example' }, { status: 500 });
  await assert.rejects(API.getHealth(), e => e.message === '请求失败 HTTP 500' && e.code === '');
});

test('lost write response is explicitly unconfirmed; navigation abort is stale', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('network failed'); });
  await assert.rejects(API.saveModelConfig({ provider: 'deepseek' }, 'test-only'), e => e.kind === 'offline' && /结果未确认/.test(e.message));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(API.getHealth({ signal: controller.signal }), e => e.kind === 'stale');
});

test('existing history envelopes fit their explicit larger response allowance', async t => {
  const body = { historical: true, items: [{ summary: 'x'.repeat(70000) }] };
  t.mock.method(globalThis, 'fetch', async () => Response.json(body));
  assert.deepEqual(await API.getAnalysisHistory(), body);
  await assert.rejects(API.getHealth(), e => e.kind === 'parse');
});
