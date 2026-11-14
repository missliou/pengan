import huks from '@ohos.security.huks';
import cryptoFramework from '@ohos.security.cryptoFramework';
import preferences from '@ohos.data.preferences';
import common from '@ohos.app.ability.common';
import util from '@ohos.util';
import {normalizeGatewayAddress} from './ConnectionSettings';
export class DeviceCredential { base: string = ''; id: string = ''; token: string = ''; }
class Envelope { version: number = 1; base: string = ''; id: string = ''; nonce: string = ''; cipher: string = ''; }
const ALIAS = 'pengan_device_credential_v1';
export class CredentialVault {
  private store: preferences.Preferences | undefined = undefined;
  private busy: boolean = false;
  async open(context: common.UIAbilityContext): Promise<void> { this.store = await preferences.getPreferences(context, 'pengan_credentials_v1'); }
  private props(purpose: number, nonce?: Uint8Array, aad?: Uint8Array, tag?: Uint8Array): huks.HuksParam[] {
    const p: huks.HuksParam[] = [
      {tag:huks.HuksTag.HUKS_TAG_ALGORITHM,value:huks.HuksKeyAlg.HUKS_ALG_AES},
      {tag:huks.HuksTag.HUKS_TAG_KEY_SIZE,value:huks.HuksKeySize.HUKS_AES_KEY_SIZE_256},
      {tag:huks.HuksTag.HUKS_TAG_PURPOSE,value:purpose},
      {tag:huks.HuksTag.HUKS_TAG_PADDING,value:huks.HuksKeyPadding.HUKS_PADDING_NONE},
      {tag:huks.HuksTag.HUKS_TAG_BLOCK_MODE,value:huks.HuksCipherMode.HUKS_MODE_GCM}];
    if(nonce)p.push({tag:huks.HuksTag.HUKS_TAG_NONCE,value:nonce});
    if(aad)p.push({tag:huks.HuksTag.HUKS_TAG_ASSOCIATED_DATA,value:aad});
    if(tag)p.push({tag:huks.HuksTag.HUKS_TAG_AE_TAG,value:tag});
    return p;
  }
  private check(base: string, id: string, token: string): void {
    if(normalizeGatewayAddress(base)!==base||!base.startsWith('https://')||!/^[A-Za-z0-9_.:-]{1,80}$/.test(id)||!/^[A-Za-z0-9_-]{32,256}$/.test(token))throw new Error('设备凭据格式无效');
  }
  private async crypt(purpose: number, input: Uint8Array, nonce: Uint8Array, aad: Uint8Array, tag?: Uint8Array): Promise<Uint8Array> {
    const options: huks.HuksOptions = {properties:this.props(purpose,nonce,aad,tag),inData:input};
    const session=await huks.initSession(ALIAS,options);
    try { const output=await huks.finishSession(session.handle,options); if(!output.outData)throw new Error('HUKS未返回数据');return output.outData; }
    catch{try{await huks.abortSession(session.handle,{properties:[]});}catch{}throw new Error('HUKS加解密未完成');}
  }
  async save(base: string, id: string, token: string): Promise<void> {
    if(!this.store||this.busy)throw new Error('凭据保护暂不可用');this.busy=true;
    try{
      this.check(base,id,token);
      if(!await huks.isKeyItemExist(ALIAS,{properties:[]}))await huks.generateKeyItem(ALIAS,{properties:this.props(huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_ENCRYPT|huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_DECRYPT)});
      const nonce=cryptoFramework.createRandom().generateRandomSync(12).data;
      const aad=new util.TextEncoder().encodeInto(JSON.stringify([1,base,id]));
      const cipher=await this.crypt(huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_ENCRYPT,new util.TextEncoder().encodeInto(token),nonce,aad);
      const envelope: Envelope={version:1,base:base,id:id,nonce:new util.Base64Helper().encodeToStringSync(nonce),cipher:new util.Base64Helper().encodeToStringSync(cipher)};
      await this.store.put('envelope',JSON.stringify(envelope));await this.store.flush();
    }catch{throw new Error('HUKS安全保存失败；未保存明文令牌');}finally{this.busy=false;}
  }
  async restore(): Promise<DeviceCredential> {
    if(!this.store||this.busy)throw new Error('凭据保护暂不可用');this.busy=true;
    try{
      const text=await this.store.get('envelope','');if(typeof text!=='string'||!text||text.length>4096)throw new Error('无有效密文');
      const e=JSON.parse(text) as Envelope;
      if(e.version!==1||typeof e.nonce!=='string'||typeof e.cipher!=='string'||!await huks.isKeyItemExist(ALIAS,{properties:[]}))throw new Error('凭据密钥不可用');
      const nonce=new util.Base64Helper().decodeSync(e.nonce),cipher=new util.Base64Helper().decodeSync(e.cipher);
      if(nonce.length!==12||cipher.length<48||cipher.length>272)throw new Error('密文格式异常');
      const raw=await this.crypt(huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_DECRYPT,cipher.slice(0,-16),nonce,new util.TextEncoder().encodeInto(JSON.stringify([1,e.base,e.id])),cipher.slice(-16));
      const token=new util.TextDecoder('utf-8',{fatal:true}).decodeWithStream(raw);this.check(e.base,e.id,token);
      return {base:e.base,id:e.id,token:token};
    }catch{throw new Error('凭据解密失败或未保存；请重新录入，不回退明文');}finally{this.busy=false;}
  }
  async forget(): Promise<void> { if(!this.store||this.busy)throw new Error('凭据保护暂不可用');this.busy=true;try{await this.store.delete('envelope');await this.store.flush();}finally{this.busy=false;} }
}
