import {readFile,stat,mkdir,open,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const MAX_BYTES=2*1024*1024,MAX_DOCUMENTS=100;
const fail=code=>{throw Error(code);},digest=text=>createHash('sha256').update(text).digest('hex');
const identifier=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v);
function inputDocument(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['id','title','source','text','gatewayId'].includes(k))||!identifier(input.gatewayId)||input.id!==undefined&&!identifier(input.id))fail('invalid_knowledge_document');
 const {title,source='',text}=input;
 if(typeof title!=='string'||!title.trim()||title.length>160||typeof source!=='string'||source.length>500||typeof text!=='string'||!text.trim()||text.length>40000||[title,source,text].some(v=>v.includes('\0')))fail('invalid_knowledge_document');
 return {id:input.id||randomUUID(),gatewayId:input.gatewayId,title:title.trim(),source:source.trim(),text:text.trim()};
}
const metadata=doc=>({id:doc.id,gatewayId:doc.gatewayId,title:doc.title,source:doc.source,updatedAt:doc.updatedAt,contentSha256:doc.contentSha256,characters:doc.text.length,trust:'untrusted-reference'});
function tokens(text){
 const lower=text.normalize('NFKC').toLowerCase(),out=new Set(lower.match(/[a-z0-9_]+/g)||[]);
 for(const word of lower.match(/[\p{Script=Han}]+/gu)||[]){if(word.length===1)out.add(word);else for(let i=0;i<word.length-1;i++)out.add(word.slice(i,i+2));}
 return out;
}
// Lexical retrieval only: no embedding provider, network access or safety override.
export class KnowledgeStore {
 constructor({file,now=Date.now}={}){if(!path.isAbsolute(file||''))fail('knowledge_absolute_path_required');this.file=file;this.now=now;this.documents=[];this.ready=false;this.tail=Promise.resolve();}
 async open(){
  this.ready=false;let docs=[];
  try{
   if((await stat(this.file)).size>MAX_BYTES)fail('knowledge_capacity_exceeded');
   const raw=JSON.parse(await readFile(this.file,'utf8'));
   if(raw.schemaVersion!==1||!Array.isArray(raw.documents)||raw.documents.length>MAX_DOCUMENTS)fail('invalid_knowledge_store');
   const ids=new Set();
   docs=raw.documents.map(doc=>{
    const clean=inputDocument({id:doc.id,gatewayId:doc.gatewayId,title:doc.title,source:doc.source,text:doc.text});
    if(ids.has(clean.id)||!Number.isSafeInteger(doc.updatedAt)||doc.updatedAt<0||digest(clean.text)!==doc.contentSha256)fail('invalid_knowledge_store');
    ids.add(clean.id);return {...clean,updatedAt:doc.updatedAt,contentSha256:doc.contentSha256};
   });
  }catch(error){if(error.code!=='ENOENT')fail('knowledge_store_unavailable');}
  this.documents=docs;this.ready=true;return this;
 }
 upsert(input){const task=this.tail.then(()=>this.write(input));this.tail=task.catch(()=>{});return task;}
 async write(input){
  if(!this.ready)fail('knowledge_store_not_ready');
  const clean=inputDocument(input),old=this.documents.find(d=>d.id===clean.id);
  if(old&&old.gatewayId!==clean.gatewayId)fail('knowledge_document_scope_mismatch');
  if(!old&&this.documents.length>=MAX_DOCUMENTS)fail('knowledge_capacity_exceeded');
  const updatedAt=this.now();if(!Number.isSafeInteger(updatedAt)||updatedAt<0)fail('invalid_knowledge_time');
  const doc={...clean,updatedAt,contentSha256:digest(clean.text)};
  const next=old?this.documents.map(d=>d.id===doc.id?doc:d):[...this.documents,doc];
  const json=JSON.stringify({schemaVersion:1,documents:next});if(Buffer.byteLength(json)>MAX_BYTES)fail('knowledge_capacity_exceeded');
  const temp=this.file+'.'+randomUUID()+'.tmp';let handle;
  try{await mkdir(path.dirname(this.file),{recursive:true});handle=await open(temp,'wx',0o600);await handle.writeFile(json);await handle.sync();await handle.close();handle=null;await rename(temp,this.file);}
  catch{fail('knowledge_write_failed');}finally{await handle?.close().catch(()=>{});await rm(temp,{force:true}).catch(()=>{});}
  this.documents=next;return metadata(doc);
 }
 list(gatewayId){if(!this.ready)fail('knowledge_store_not_ready');if(!identifier(gatewayId))fail('invalid_knowledge_scope');return this.documents.filter(d=>d.gatewayId===gatewayId).map(metadata).sort((a,b)=>b.updatedAt-a.updatedAt||a.id.localeCompare(b.id));}
 search(query,gatewayId,limit=5){
  if(!this.ready)fail('knowledge_store_not_ready');if(!identifier(gatewayId))fail('invalid_knowledge_scope');
  if(typeof query!=='string'||!query.trim()||query.length>1000||!Number.isInteger(limit)||limit<1||limit>10)fail('invalid_knowledge_query');
  const terms=tokens(query);if(!terms.size)return [];
  const hits=[];
  for(const doc of this.documents.filter(d=>d.gatewayId===gatewayId)){
   for(let offset=0;offset<doc.text.length;offset+=320){
    const content=doc.text.slice(offset,offset+400),bodyTerms=tokens(content),titleTerms=tokens(doc.title);let matched=0,titleMatched=0;
    for(const term of terms){if(bodyTerms.has(term))matched++;if(titleTerms.has(term))titleMatched++;}
    if(!matched&&!titleMatched)continue;
    const score=Number(((matched+titleMatched*0.5)/terms.size).toFixed(6));
    hits.push({chunkId:doc.id+':'+offset,documentId:doc.id,title:doc.title,source:doc.source,content,score,contentSha256:digest(content),documentSha256:doc.contentSha256,trust:'untrusted-reference'});
    if(offset+400>=doc.text.length)break;
   }
  }
  return hits.sort((a,b)=>b.score-a.score||a.chunkId.localeCompare(b.chunkId)).slice(0,limit);
 }
 async flush(){await this.tail;}
}
