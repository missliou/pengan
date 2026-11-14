import audio from '@ohos.multimedia.audio';
import abilityAccessCtrl from '@ohos.abilityAccessCtrl';
import common from '@ohos.app.ability.common';
import util from '@ohos.util';
export class NativeSpeechInput {
  private active: boolean = false;
  private generation: number = 0;
  private rejectPending: ((error: Error) => void) | undefined = undefined;
  cancel(): void { this.generation++;if(this.rejectPending)this.rejectPending(new Error('录音已取消')); }
  async capture(context: common.UIAbilityContext): Promise<string> {
    if(this.active)throw new Error('录音尚未结束');this.active=true;
    const generation=++this.generation;let capturer: audio.AudioCapturer | undefined = undefined;
    let timer: number = -1;const chunks: Uint8Array[]=[];let size=0;
    try{
      const permission=await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(context,['ohos.permission.MICROPHONE']);
      if(generation!==this.generation||permission.authResults[0]!==0)throw new Error('录音取消或未授权麦克风');
      capturer=await audio.createAudioCapturer({streamInfo:{samplingRate:audio.AudioSamplingRate.SAMPLE_RATE_16000,channels:audio.AudioChannel.CHANNEL_1,sampleFormat:audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE,encodingType:audio.AudioEncodingType.ENCODING_TYPE_RAW},capturerInfo:{source:audio.SourceType.SOURCE_TYPE_MIC,capturerFlags:0}});
      if(generation!==this.generation)throw new Error('录音已取消');
      capturer.on('readData',(buffer: ArrayBuffer)=>{
        if(generation!==this.generation)return;
        const remaining=256000-size;if(remaining<=0)return;
        const chunk=new Uint8Array(buffer).slice(0,remaining);chunks.push(chunk);size+=chunk.length;
      });
      await capturer.start();
      if(generation!==this.generation)throw new Error('录音已取消');
      await new Promise<void>((resolve,reject)=>{this.rejectPending=reject;timer=setTimeout(resolve,8000);});
      await capturer.stop();
      if(generation!==this.generation||size<3200)throw new Error('未录到有效声音数据');
      size-=size%2;const wav=new Uint8Array(44+size),view=new DataView(wav.buffer);
      const text=(offset: number,value: string):void=>{for(let i=0;i<value.length;i++)wav[offset+i]=value.charCodeAt(i);};
      text(0,'RIFF');view.setUint32(4,36+size,true);text(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,size,true);
      let offset=44;for(const chunk of chunks){const part=chunk.subarray(0,Math.min(chunk.length,wav.length-offset));wav.set(part,offset);offset+=part.length;}
      return new util.Base64Helper().encodeToStringSync(wav);
    }finally{
      if(timer>=0)clearTimeout(timer);this.rejectPending=undefined;
      if(capturer){try{await capturer.stop();}catch{}try{await capturer.release();}catch{}}
      chunks.splice(0);this.active=false;
    }
  }
}
