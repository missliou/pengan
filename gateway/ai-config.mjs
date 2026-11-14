import {readFile,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export function validateConfig(input,current={}){
  if(!input||!['deepseek','qwen'].includes(input.provider)||typeof input.model!=='string'||!/^[-A-Za-z0-9._:/]{1,150}$/.test(input.model))throw new Error('invalid_ai_config');
  if(input.key!==undefined&&typeof input.key!=='string')throw new Error('invalid_ai_config');
  if(input.workspaceId!==undefined&&typeof input.workspaceId!=='string')throw new Error('invalid_ai_config');
  const workspaceId=input.provider==='qwen'?(input.workspaceId===undefined?(current.provider==='qwen'?current.workspaceId||'':''):input.workspaceId.trim()):'';
  if(workspaceId&&!/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(workspaceId))throw new Error('invalid_ai_config');
  const key=input.clearKey===true?'':(input.key||((input.provider===current.provider)?current.key:''));
  if(input.clearKey!==true&&!key)throw new Error('key_required_for_provider');
  if(key&&!/^[-A-Za-z0-9._]{8,500}$/.test(key))throw new Error('invalid_ai_config');
  return {provider:input.provider,model:input.model,key,workspaceId};
}

export class AiConfigStore {
  constructor(file){this.file=file;this.current=null;}
  async open(){
    try{const text=await readFile(this.file,'utf8');const raw=JSON.parse(text);this.current=validateConfig({...raw,clearKey:raw.key===''},raw);}
    catch(error){if(error.code!=='ENOENT')throw new Error('ai_config_load_failed');}
    return this.current;
  }
  async save(config){
    await mkdir(path.dirname(this.file),{recursive:true});
    const temp=this.file+'.'+randomUUID()+'.tmp';
    try{await writeFile(temp,JSON.stringify(config),{encoding:'utf8',mode:0o600,flag:'wx'});await rename(temp,this.file);this.current=config;}
    catch{await rm(temp,{force:true}).catch(()=>{});throw new Error('config_save_failed');}
  }
}
