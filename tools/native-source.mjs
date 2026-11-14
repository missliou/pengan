import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const excluded=new Set(['node_modules','oh_modules','.hvigor','.git','build','sdk']);
export async function fingerprintNativeSources(projectRoot){
 const directory=path.join(projectRoot,'openharmony'),records=[];
 async function walk(folder,relative=''){
  for(const entry of await readdir(folder,{withFileTypes:true})){
   if(excluded.has(entry.name)||entry.name==='local.properties'||entry.name==='.env'||/\.(p12|p7b|pem|key|jks|cer)$/i.test(entry.name))continue;
   const name=relative?relative+'/'+entry.name:entry.name;
   if(entry.isDirectory())await walk(path.join(folder,entry.name),name);
   else if(entry.isFile()){const data=await readFile(path.join(folder,entry.name));records.push({path:name,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});}
  }
 }
 await walk(directory);records.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 return {sha256:createHash('sha256').update(JSON.stringify(records)).digest('hex'),files:records.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await fingerprintNativeSources(path.resolve(fileURLToPath(new URL('..',import.meta.url))))));
