// Manual UI test backend using the real gateway router. Loopback only, no disk
// config/history, no hardware reads, no inherited model credentials or outbound AI.
import { startDemo } from '../../../gateway/runtime.mjs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const isolated = await mkdtemp(path.join(tmpdir(), 'pengan-admin-ui-test-'));
const runtime = await startDemo({ httpPort: 0, httpHost: '127.0.0.1', operationMode: 'hardware',
  hardwareFile: path.join(isolated, 'no-hardware.json'),
  configStore: { async save() { /* memory-only planner replacement by real router */ } },
  plannerOptions: { provider: null, model: null, key: null, workspaceId: '',
    fetchFn: async () => { throw Error('ui_test_outbound_disabled'); } },
});
console.log(JSON.stringify({ purpose: 'isolated-ui-test', port: runtime.httpPort, providerNetwork: false, persistentWrites: false }));
const timeout = setTimeout(async () => { await runtime.close(); }, 30 * 60 * 1000);
async function close() { clearTimeout(timeout); await runtime.close(); process.exit(0); }
process.once('SIGINT', close); process.once('SIGTERM', close);
