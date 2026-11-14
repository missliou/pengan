import { DirectTelemetry } from './DirectTelemetry';
import { CloudSample } from './CloudUpload';

export class DirectHardwareReading {
  source: string = 'dayu-direct';
  deviceOnline: boolean = false;
  sampleAgeMs: number = -1;
  text: string = '';
}

// UI projection only. Never maps a real sample into the simulated EnvSnapshot.
export class DirectHardwareView {
  private collector: DirectTelemetry = new DirectTelemetry();
  private ip: string = '';
  private confirmed: boolean = false;
  private issue: string = 'board_not_configured';
  private revision: number = 0;

  configure(ip: string): void {
    if (ip.length > 0) this.collector.configure(ip);
    else this.collector.invalidate();
    this.ip = ip; this.confirmed = false; this.issue = ip.length > 0 ? 'board_no_sample' : 'board_not_configured'; this.revision++;
  }

  invalidate(): void {
    this.collector.invalidate(); this.confirmed = false; this.issue = 'board_no_sample'; this.revision++;
  }

  async poll(): Promise<DirectHardwareReading> {
    if (this.ip.length === 0) return this.read();
    const revision = this.revision;
    const sample = await this.collector.pollOnce();
    if (revision !== this.revision) return this.read();
    if (sample.deviceOnline) { this.confirmed = true; this.issue = ''; }
    else if (sample.reason === 'board_duplicate_frame') this.issue = sample.reason;
    else { this.confirmed = false; this.issue = sample.reason; }
    return this.read();
  }

  read(): DirectHardwareReading {
    const reading = new DirectHardwareReading();
    const snapshot = this.collector.currentSnapshot();
    const reason = this.confirmed ? snapshot.reason : this.issue;
    if (!this.confirmed || !snapshot.deviceOnline) {
      const label = reason === 'board_not_configured' ? '请在设备诊断填写HH-HSP101局域网IP' : reason === 'telemetry_stale' ? '样本超过10秒有效期' : '尚未确认新的有效采集帧（' + reason + '）';
      reading.text = 'DAYU200直采 · ' + label + '\n温湿度/ADC未知；CO/CO₂未接入，禁止真实准入；未上传云端';
      return reading;
    }
    const q = snapshot.quality, v = snapshot.values;
    const temperature = q.temperatureValid && v.temperatureC !== null ? v.temperatureC.toFixed(1) + '℃' : '未知';
    const humidity = q.humidityValid && v.humidityPct !== null ? v.humidityPct.toFixed(1) + '%' : '未知';
    const gas = q.gasValid && v.gasRaw !== null && v.gasMv !== null ? v.gasRaw.toString() + ' counts / ' + v.gasMv.toString() + 'mV（非浓度）' : '未知';
    reading.deviceOnline = true; reading.sampleAgeMs = snapshot.sampleAgeMs as number;
    reading.text = 'DAYU200直采 · HH-HSP101 · 接收年龄 ' + reading.sampleAgeMs.toString() + 'ms' +
      (this.issue === 'board_duplicate_frame' ? ' · 未收到新帧，沿用原失效时间' : '') +
      '\n温度：' + temperature + ' / 湿度：' + humidity + '\nMQ-2 ADC：' + gas +
      '\nCO/CO₂未接入，真实准入未知/拒止，无执行器；可能未上传云端，上传回执另见设备诊断';
    return reading;
  }

  uploadSample(): CloudSample {
    const snapshot = this.collector.currentSnapshot();
    if (!this.confirmed || !snapshot.deviceOnline || snapshot.frame === null) throw new Error('没有已确认的新鲜直采帧');
    const result = new CloudSample(); result.sessionBootId = snapshot.sessionBootId;
    result.sampleAgeMs = snapshot.sampleAgeMs as number; result.frameJson = JSON.stringify(snapshot.frame);
    return result;
  }
}
