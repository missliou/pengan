import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {HspHttpReader} from '../gateway/hsp-http.mjs';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--ip')throw Error('usage: node tools/read-hsp-http.mjs --ip 192.168.1.100');
const controller=new AbortController();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>controller.abort());
const reader=await new HspHttpReader({ip:args[1],file:fileURLToPath(new URL('../tmp/runtime/hsp-latest.json',import.meta.url))}).open();
console.log('HH-HSP101无线只读采集启动；失败或重复帧不刷新采样时间，10秒后转未知。');
let failed=false;
while(!controller.signal.aborted){
 try{const result=await reader.poll(controller.signal);if(failed&&result.accepted)console.log('无线采集恢复，已收到新帧');failed=false;}
 catch{if(!controller.signal.aborted&&!failed)console.error('无线采集失败；请检查板子IP和配网状态，旧数据不刷新。');failed=true;}
 await delay(2000,undefined,{signal:controller.signal}).catch(()=>{});
}
