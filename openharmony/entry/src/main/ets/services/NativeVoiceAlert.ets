import audio from '@ohos.multimedia.audio';
import common from '@ohos.app.ability.common';

export class NativeVoiceAlert {
  lastError: string = '';
  private playing: boolean = false;
  private active: audio.AudioRenderer | undefined = undefined;
  private generation: number = 0;
  private lastPlayed: number = 0;
  private cancelPlayback: (() => void) | undefined = undefined;

  async play(context: common.UIAbilityContext, clip: string): Promise<boolean> {
    if (!['co_high', 'co2_high', 'sensor_invalid', 'emergency', 'voice_test'].includes(clip)) return false;
    if (this.playing || Date.now() - this.lastPlayed < 3000) return false;
    this.playing = true;
    const token = this.generation;
    let renderer: audio.AudioRenderer | undefined = undefined;
    let feed: ((buffer: ArrayBuffer) => void) | undefined = undefined;
    let watchdog: number = -1;
    try {
      this.lastError = '';
      if (!canIUse('SystemCapability.Multimedia.Audio.Core') || !canIUse('SystemCapability.Multimedia.Audio.Renderer')) throw new Error('设备不支持音频播放系统能力');
      const data = await context.resourceManager.getRawFileContent(clip + '.pcm');
      if (data.byteLength === 0 || data.byteLength > 1000000 || data.byteLength % 2 !== 0) throw new Error('提示音资源为空、过长或PCM格式不完整');
      if (token !== this.generation) return false;
      const options: audio.AudioRendererOptions = {
        streamInfo: { samplingRate: audio.AudioSamplingRate.SAMPLE_RATE_16000, channels: audio.AudioChannel.CHANNEL_1,
          sampleFormat: audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE, encodingType: audio.AudioEncodingType.ENCODING_TYPE_RAW },
        rendererInfo: { usage: audio.StreamUsage.STREAM_USAGE_NOTIFICATION, rendererFlags: 0 }
      };
      renderer = await audio.createAudioRenderer(options);
      this.active = renderer;
      if (token !== this.generation) return false;
      const samples = data.slice();
      let offset = 0;
      const completion = new Promise<void>((resolve, reject) => {
        this.cancelPlayback = () => { reject(new Error('语音已取消')); };
        feed = (buffer: ArrayBuffer) => {
          const output = new Uint8Array(buffer);
          output.fill(0);
          if (token !== this.generation || output.length === 0 || output.length % 2 !== 0) {
            reject(new Error('语音输出不可用'));
            return;
          }
          const count = Math.min(output.length, samples.length - offset);
          output.set(samples.subarray(offset, offset + count));
          offset += count;
          if (offset >= samples.length) resolve();
        };
        watchdog = setTimeout(() => { reject(new Error('语音输出超时')); }, Math.ceil(samples.length / 32) + 5000);
      });
      completion.catch(() => {});
      if (!feed) return false;
      renderer.on('writeData', feed);
      await renderer.start();
      this.lastPlayed = Date.now();
      await completion;
      renderer.off('writeData', feed);
      if (token !== this.generation) return false;
      await renderer.drain();
      await renderer.stop();
      return true;
    } catch (error) {
      this.lastError = '提示音播放失败：' + (error as Error).message;
      return false;
    } finally {
      clearTimeout(watchdog);
      this.cancelPlayback = undefined;
      if (renderer && feed) { try { renderer.off('writeData', feed); } catch (error) {} }
      if (renderer) { try { await renderer.release(); } catch (error) {} }
      if (this.active === renderer) this.active = undefined;
      this.playing = false;
    }
  }

  async stop(): Promise<void> {
    this.generation++;
    if (this.cancelPlayback) this.cancelPlayback();
    const renderer = this.active;
    if (renderer) { try { await renderer.stop(); } catch (error) { this.lastError = '提示音停止失败：' + (error as Error).message; } }
  }
}
