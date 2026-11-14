import { EnvSnapshot } from '../model/Models';

// 真实驱动接入前的模拟设备。每次返回新对象，便于 ArkUI 状态刷新。
export class DemoDevice {
  env: EnvSnapshot = new EnvSnapshot();
  fan: boolean = false;
  fanStartedAt: number = 0;
  stale: boolean = false;

  snapshot(): EnvSnapshot {
    const out = new EnvSnapshot();
    out.co = this.env.co;
    out.co2 = this.env.co2;
    out.temperature = this.env.temperature;
    out.humidity = this.env.humidity;
    out.soil = this.env.soil;
    out.light = this.env.light;
    out.sampledAt = this.env.sampledAt;
    out.sensorOnline = this.env.sensorOnline;
    out.emergency = this.env.emergency;
    return out;
  }

  scenario(name: string): void {
    this.env.co = name === 'co' ? 65 : 4;
    this.env.co2 = name === 'co2' ? 2200 : 680;
    this.stale = name === 'stale';
    this.env.sampledAt = Date.now() - (this.stale ? 60000 : 0);
  }

  startFan(): boolean {
    if (this.env.emergency || this.fan) return false;
    this.fan = true;
    this.fanStartedAt = Date.now();
    return true;
  }

  stopFan(): void {
    this.fan = false;
    this.fanStartedAt = 0;
  }

  tick(): void {
    if (this.env.sensorOnline && !this.stale) {
      this.env.sampledAt = Date.now();
      if (this.fan && !this.env.emergency) {
        this.env.co = Math.max(4, this.env.co - 9);
        this.env.co2 = Math.max(680, this.env.co2 - 260);
      }
    }
  }
}
