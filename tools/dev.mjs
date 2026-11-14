import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const children=['prototype/server.mjs','gateway/demo.mjs'].map(script=>spawn(process.execPath,[path.join(root,script)],{cwd:root,stdio:'inherit',shell:false,windowsHide:true}));
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;for(const child of children)if(!child.killed)child.kill();process.exitCode=code;}
for(const child of children){child.on('error',error=>{console.error(error.message);stop(1);});child.on('exit',code=>{if(!stopping)stop(code||0);});}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop());
console.log('棚安本地联调：http://127.0.0.1:5186，按 Ctrl+C 关闭子服务。');
