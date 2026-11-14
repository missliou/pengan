import {startDemo} from './runtime.mjs';
import {EventJournal} from './journal.mjs';
import {fileURLToPath} from 'node:url';
import {AiConfigStore} from './ai-config.mjs';
import {HardwareHistory} from './hardware-history.mjs';
import {AnalysisHistory} from './analysis-history.mjs';
// Credentials are loaded only by the server; .env is never served over HTTP.
try { process.loadEnvFile(fileURLToPath(new URL('./.env',import.meta.url))); }
catch(error){if(error.code!=='ENOENT')throw new Error('模型配置文件读取失败');}
const operationMode=process.env.PENGAN_OPERATION_MODE||'hardware';
if(!['hardware','simulation'].includes(operationMode))throw new Error('invalid_operation_mode');
const journal=operationMode==='simulation'?await new EventJournal(fileURLToPath(new URL('../tmp/runtime/gateway-events.jsonl',import.meta.url))).open():undefined;
const configStore=new AiConfigStore(fileURLToPath(new URL('../tmp/runtime/ai-config.json',import.meta.url)));
const savedConfig=await configStore.open();
const historyStore=await new HardwareHistory(fileURLToPath(new URL('../tmp/runtime/hardware-history.jsonl',import.meta.url))).open();
const analysisStore=await new AnalysisHistory(fileURLToPath(new URL('../tmp/runtime/ai-analysis-history.jsonl',import.meta.url))).open();
const runtime=await startDemo({operationMode,historyStore,analysisStore,journal,httpHost:process.env.PENGAN_HTTP_HOST||'127.0.0.1',configStore,plannerOptions:savedConfig||undefined});
console.log(`棚安${operationMode==='hardware'?'真实数据':'模拟演示'}网关 http://${process.env.PENGAN_HTTP_HOST||'127.0.0.1'}:${runtime.httpPort}`);
console.log(operationMode==='hardware'?'HH-HSP真实采集与AI只读分析；模拟指令已禁用。':'模拟演示模式，不能代表实物控制。');
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(stopping)return;stopping=true;await runtime.close();process.exit(0);});
