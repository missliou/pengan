// Local whisper.cpp only. Audio is neither logged nor passed to a model provider.
export class LocalSpeech {
 constructor({url='',fetchFn=fetch}={}){if(url){const u=new URL(url);if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash||u.pathname!=='/inference')throw Error('invalid_speech_config');}this.url=url;this.fetchFn=fetchFn;this.busy=false;}
 status(){return {configured:Boolean(this.url),engine:'whisper.cpp-local',storesAudio:false,externalProvider:false};}
 async transcribe(body){
  if(!this.url)throw Error('speech_not_configured');if(this.busy)throw Error('speech_busy');
  if(!body||Object.keys(body).some(k=>!['wavBase64','authorized'].includes(k))||body.authorized!==true||typeof body.wavBase64!=='string'||body.wavBase64.length>430000||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.wavBase64))throw Error('invalid_speech_audio');
  const wav=Buffer.from(body.wavBase64,'base64');
  if(wav.length<3244||wav.length>320044||wav.toString('base64')!==body.wavBase64||wav.toString('ascii',0,4)!=='RIFF'||wav.readUInt32LE(4)!==wav.length-8||wav.toString('ascii',8,16)!=='WAVEfmt '||wav.readUInt32LE(16)!==16||wav.readUInt16LE(20)!==1||wav.readUInt16LE(22)!==1||wav.readUInt32LE(24)!==16000||wav.readUInt32LE(28)!==32000||wav.readUInt16LE(32)!==2||wav.readUInt16LE(34)!==16||wav.toString('ascii',36,40)!=='data'||wav.readUInt32LE(40)!==wav.length-44||(wav.length-44)%2)throw Error('invalid_speech_audio');
  this.busy=true;
  try{
   const form=new FormData();form.append('file',new Blob([wav],{type:'audio/wav'}),'speech.wav');form.append('response_format','json');form.append('language','zh');form.append('prompt','智慧农业，大棚，温度，湿度，番茄，传感器，通风。');
   const response=await this.fetchFn(this.url,{method:'POST',body:form,redirect:'error',signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw Error('speech_unavailable');
   const reader=response.body.getReader();let size=0;const chunks=[];
   try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();throw Error('speech_response_too_large');}chunks.push(value);}}finally{reader.releaseLock();}
   const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(typeof data.text!=='string'||!data.text.trim()||data.text.length>1000)throw Error('invalid_speech_result');
   return {text:data.text.trim(),engine:'whisper.cpp-local',requiresConfirmation:true,executed:false};
  }catch(error){if(/^(speech_|invalid_speech_)/.test(error.message))throw error;throw Error('speech_unavailable');}finally{this.busy=false;}
 }
}
