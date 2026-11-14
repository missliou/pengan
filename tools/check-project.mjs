import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
async function files(dir){const found=[];for(const entry of await readdir(dir,{withFileTypes:true})){if(['node_modules','.git','tmp'].includes(entry.name))continue;const name=path.join(dir,entry.name);if(entry.isDirectory())found.push(...await files(name));else found.push(name);}return found;}
let checked=0;const errors=[];
for(const file of await files(path.join(root,'openharmony'))){
 if(!/\.json5?$/.test(file))continue;
 try{JSON.parse(await readFile(file,'utf8'));checked++;}catch(error){errors.push(path.relative(root,file)+': '+error.message);}
}
const entry=path.join(root,'openharmony/entry/src/main');
const module=JSON.parse(await readFile(path.join(entry,'module.json5'),'utf8')).module;
for(const ability of module.abilities){try{await stat(path.resolve(entry,ability.srcEntry));}catch{errors.push('Ability 入口缺失 '+ability.srcEntry);}}
const profile=JSON.parse(await readFile(path.join(entry,'resources/base/profile/main_pages.json'),'utf8'));
for(const page of profile.src){try{await stat(path.join(entry,'ets',page+'.ets'));}catch{errors.push('页面缺失 '+page);}}
for(const scope of ['openharmony/AppScope','openharmony/entry/src/main']){
 const base=path.join(root,scope,'resources/base');
 const resources={string:new Set(),color:new Set(),media:new Set(),profile:new Set()};
 for(const f of await files(base)){
  const folder=path.basename(path.dirname(f));
  if(folder==='element'&&f.endsWith('.json')){const data=JSON.parse(await readFile(f,'utf8'));for(const type of ['string','color'])for(const item of data[type]||[])resources[type].add(item.name);}
  if(['media','profile'].includes(folder))resources[folder].add(path.basename(f,path.extname(f)));
 }
 const manifest=scope.endsWith('AppScope')?'app.json5':'module.json5';
 const text=await readFile(path.join(root,scope,manifest),'utf8');
 for(const match of text.matchAll(/\$(string|color|media|profile):([\w_]+)/g))if(!resources[match[1]].has(match[2]))errors.push(scope+' 缺失资源 '+match[0]);
}
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
else console.log(`PASS: ${checked} 个 JSON/JSON5 配置、Ability 入口、页面路径和资源引用。此检查不等于 ArkTS 编译。`);
