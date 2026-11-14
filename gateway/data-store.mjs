import {DatabaseSync} from 'node:sqlite';
import {mkdir,open,unlink,chmod} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
const fail=code=>{throw Error(code);};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v);
const MAX_IMAGE=2*1024*1024;
function imageInfo(bytes){
 if(bytes.length>MAX_IMAGE||bytes.length<24)fail('invalid_media_image');
 let width,height,mime;
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR'){
  width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);mime='image/png';
 }else if(bytes[0]===255&&bytes[1]===216&&bytes.at(-2)===255&&bytes.at(-1)===217){
  for(let offset=2;offset+4<bytes.length;){
   if(bytes[offset++]!==255)break;while(bytes[offset]===255)offset++;
   const marker=bytes[offset++];if(marker===218||marker===217)break;
   const size=bytes.readUInt16BE(offset);if(size<2||offset+size>bytes.length)break;
   if([192,193,194].includes(marker)&&size>=8){height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);mime='image/jpeg';break;}offset+=size;
  }
 }
 if(!mime||!width||!height||width>8192||height>8192||width*height>24000000)fail('invalid_media_image');
 return {mime,width,height};
}
const fields='seq,media_id AS mediaId,gateway_id AS gatewayId,category,label,captured_at AS capturedAt,created_at AS createdAt,actor,telemetry_seq AS telemetrySeq,sha256,bytes,mime,width,height';
export class DataStore {
 constructor({directory,now=Date.now}){this.directory=directory;this.now=now;this.tail=Promise.resolve();}
 async open(historyRows=[]){
  await mkdir(path.join(this.directory,'images'),{recursive:true,mode:0o700});
  this.db=new DatabaseSync(path.join(this.directory,'records.sqlite'));
  try{
   await chmod(path.join(this.directory,'records.sqlite'),0o600);
   this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS history_records(seq INTEGER PRIMARY KEY,kind TEXT NOT NULL,gateway_id TEXT NOT NULL,recorded_at INTEGER NOT NULL,hash TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS history_device_kind ON history_records(gateway_id,kind,seq);
    CREATE TABLE IF NOT EXISTS media(seq INTEGER PRIMARY KEY AUTOINCREMENT,media_id TEXT UNIQUE NOT NULL,gateway_id TEXT NOT NULL,category TEXT NOT NULL CHECK(category IN ('crop','person')),label TEXT NOT NULL,captured_at INTEGER NOT NULL,created_at INTEGER NOT NULL,actor TEXT NOT NULL,telemetry_seq INTEGER,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,mime TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS media_device_category ON media(gateway_id,category,seq);`);
   if(!this.db.prepare('PRAGMA table_info(media)').all().some(c=>c.name==='upload_id'))this.db.exec('ALTER TABLE media ADD COLUMN upload_id TEXT');
   this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS media_upload_key ON media(gateway_id,actor,upload_id) WHERE upload_id IS NOT NULL; PRAGMA user_version=2;');
   if(this.db.prepare('PRAGMA quick_check').get().quick_check!=='ok')fail('database_integrity_failed');
   const existing=this.db.prepare('SELECT seq,hash FROM history_records ORDER BY seq').all();
   if(existing.some(r=>historyRows[r.seq-1]?.hash!==r.hash))fail('database_history_mismatch');
   this.db.exec('BEGIN IMMEDIATE');try{for(const row of historyRows)this.record(row);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
   return this;
  }catch(e){this.db.close();this.db=null;throw e;}
 }
 record(row){
  const old=this.db.prepare('SELECT hash FROM history_records WHERE seq=?').get(row.seq);
  if(old){if(old.hash!==row.hash)fail('database_history_mismatch');return;}
  this.db.prepare('INSERT INTO history_records VALUES(?,?,?,?,?,?)').run(row.seq,row.kind,row.gatewayId,row.recordedAt,row.hash,JSON.stringify(row));
 }
 queryHistory({kind,gatewayId,limit=50,beforeSeq=Number.MAX_SAFE_INTEGER}){
  const rows=this.db.prepare('SELECT payload FROM history_records WHERE kind=? AND gateway_id=? AND seq<? ORDER BY seq DESC LIMIT ?').all(kind,gatewayId,beforeSeq,limit+1);
  return {items:rows.slice(0,limit).map(r=>JSON.parse(r.payload)),nextBeforeSeq:rows.length>limit?JSON.parse(rows[limit-1].payload).seq:null};
 }
 status(){return {engine:'sqlite',schemaVersion:2,historyRecords:this.db.prepare('SELECT count(*) AS n FROM history_records').get().n,...this.db.prepare('SELECT count(*) AS images,coalesce(sum(bytes),0) AS imageBytes FROM media').get(),maxImageBytes:MAX_IMAGE,imagesStored:'private-files',encryptedAtRest:false};}
 upload(body,context){const task=this.tail.then(()=>this.writeImage(body,context));this.tail=task.catch(()=>{});return task;}
 async writeImage(body,{gatewayId,actor,role}){
  if(role!=='admin')fail('media_forbidden');
  if(!body||Object.keys(body).some(k=>!['category','label','capturedAt','telemetrySeq','base64','authorized','uploadId'].includes(k))||!['crop','person'].includes(body.category)||!id(gatewayId)||typeof actor!=='string')fail('invalid_media_record');
  const uploadId=body.uploadId??null;if(uploadId!==null&&!id(uploadId))fail('invalid_media_record');
  if(body.authorized!==true)fail('media_authorization_required');
  const label=body.label?.trim(),capturedAt=body.capturedAt,telemetrySeq=body.telemetrySeq??null;
  if(typeof label!=='string'||!label.length||label.length>120||/[\x00-\x1f]/.test(label)||!Number.isSafeInteger(capturedAt)||capturedAt<0||capturedAt>this.now()+300000)fail('invalid_media_record');
  if(telemetrySeq!==null){const row=Number.isSafeInteger(telemetrySeq)&&this.db.prepare('SELECT kind,gateway_id FROM history_records WHERE seq=?').get(telemetrySeq);if(!row||row.kind!=='telemetry'||row.gateway_id!==gatewayId)fail('invalid_media_telemetry');}
  if(typeof body.base64!=='string'||body.base64.length>Math.ceil(MAX_IMAGE/3)*4||!body.base64.length||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.base64))fail('invalid_media_image');
  const bytes=Buffer.from(body.base64,'base64'),info=imageInfo(bytes),mediaId=randomUUID();
  if(bytes.toString('base64')!==body.base64)fail('invalid_media_image');
  if(uploadId){const prior=this.db.prepare('SELECT * FROM media WHERE gateway_id=? AND actor=? AND upload_id=?').get(gatewayId,actor,uploadId);
   if(prior){if(prior.category!==body.category||prior.label!==label||prior.captured_at!==capturedAt||prior.telemetry_seq!==telemetrySeq||prior.sha256!==sha(bytes))fail('media_upload_conflict');return this.detail(prior.media_id,gatewayId,role);}}
  const status=this.status();if(status.images>=5000||status.imageBytes+bytes.length>512*1024*1024)fail('media_capacity_exceeded');
  const file=path.join(this.directory,'images',mediaId),handle=await open(file,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}catch(e){await handle.close();await unlink(file).catch(()=>{});throw e;}await handle.close();
  try{this.db.prepare('INSERT INTO media(media_id,gateway_id,category,label,captured_at,created_at,actor,telemetry_seq,sha256,bytes,mime,width,height,upload_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(mediaId,gatewayId,body.category,label,capturedAt,this.now(),actor,telemetrySeq,sha(bytes),bytes.length,info.mime,info.width,info.height,uploadId);}
  catch(e){await unlink(file).catch(()=>{});throw e;}
  return this.detail(mediaId,gatewayId,role);
 }
 list({gatewayId,role,category='',limit=20,beforeSeq=Number.MAX_SAFE_INTEGER}){
  if(!id(gatewayId)||!['admin','viewer'].includes(role)||!['','crop','person'].includes(category)||!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(beforeSeq)||beforeSeq<1)fail('invalid_media_query');
  if(category==='person'&&role!=='admin')fail('media_forbidden');
  const allowed=role==='admin'?category: 'crop';
  const rows=this.db.prepare(`SELECT ${fields} FROM media WHERE gateway_id=? AND (?='' OR category=?) AND seq<? ORDER BY seq DESC LIMIT ?`).all(gatewayId,allowed,allowed,beforeSeq,limit+1);
  return {items:rows.slice(0,limit),nextBeforeSeq:rows.length>limit?rows[limit-1].seq:null,historical:true,isCurrent:false};
 }
 detail(mediaId,gatewayId,role){
  if(!/^[a-f0-9-]{36}$/.test(mediaId)||!id(gatewayId)||!['admin','viewer'].includes(role))fail('media_not_found');
  const row=this.db.prepare(`SELECT ${fields} FROM media WHERE media_id=? AND gateway_id=?`).get(mediaId,gatewayId);
  if(!row||row.category==='person'&&role!=='admin')fail('media_not_found');return row;
 }
 async content(mediaId,gatewayId,role){
  const row=this.detail(mediaId,gatewayId,role);let handle,bytes;
  try{
   handle=await open(path.join(this.directory,'images',row.mediaId),'r');const info=await handle.stat();
   if(!info.isFile()||info.size!==row.bytes||row.bytes>MAX_IMAGE)fail('media_integrity_failed');
   bytes=Buffer.alloc(row.bytes);let offset=0;
   while(offset<bytes.length){const {bytesRead}=await handle.read(bytes,offset,bytes.length-offset,offset);if(!bytesRead)fail('media_integrity_failed');offset+=bytesRead;}
   if((await handle.stat()).size!==row.bytes||sha(bytes)!==row.sha256)fail('media_integrity_failed');
  }catch(e){if(e.message==='media_integrity_failed')throw e;fail('media_file_unavailable');}finally{await handle?.close();}
  return {row,bytes};
 }
 async close(){await this.tail;this.db?.close();this.db=null;}
}
