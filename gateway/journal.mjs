import {readFile,appendFile,mkdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const digest=row=>createHash('sha256').update(JSON.stringify(row)).digest('hex');
// Local debug evidence, not independent third-party attestation.
export class EventJournal {
  constructor(file){this.file=file;this.count=0;this.previous='GENESIS';this.failed=false;this.queue=Promise.resolve();}
  async open(){
    await mkdir(path.dirname(this.file),{recursive:true});
    let content='';try{if((await stat(this.file)).size>10*1024*1024)throw new Error('journal_size_limit');content=await readFile(this.file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
    if(content&&!content.endsWith('\n'))throw new Error('journal_incomplete_record');
    for(const line of content.split('\n').filter(Boolean)){
      const row=JSON.parse(line),{hash,...body}=row;
      if(body.seq!==this.count+1||body.previous!==this.previous||hash!==digest(body)||body.simulated!==true)throw new Error('journal_integrity_failed');
      this.count=body.seq;this.previous=hash;
    }
    return this;
  }
  append(event){
    const task=this.queue.then(async()=>{
      if(this.failed)throw new Error('journal_unavailable');
      const body={seq:this.count+1,previous:this.previous,at:event.at,event:event.event,detail:event.detail,simulated:true};
      const hash=digest(body),line=JSON.stringify({...body,hash})+'\n';
      let size=0;try{size=(await stat(this.file)).size;}catch(e){if(e.code!=='ENOENT')throw e;}
      if(size+Buffer.byteLength(line)>10*1024*1024)throw new Error('journal_size_limit');
      await appendFile(this.file,line,{encoding:'utf8',mode:0o600});this.count=body.seq;this.previous=hash;
    });
    this.queue=task.catch(()=>{this.failed=true;});return task;
  }
  status(){return {enabled:true,healthy:!this.failed,records:this.count,simulated:true};}
  async flush(){await this.queue;}
}
