import preferences from '@ohos.data.preferences';
import common from '@ohos.app.ability.common';
import {CloudSample,QueuedSample} from './CloudUpload';
export class OfflineQueue {
  private store: preferences.Preferences | undefined = undefined;
  private rows: QueuedSample[] = [];
  private tail: Promise<void> = Promise.resolve();
  private ready: boolean = false;
  async open(context: common.UIAbilityContext): Promise<void> {
    this.ready = false; this.store = await preferences.getPreferences(context, 'pengan_offline_v1');
    const text = await this.store.get('samples', '[]');
    if (typeof text !== 'string' || text.length > 1048576) throw new Error('离线队列损坏，已保留原数据');
    const rows = JSON.parse(text) as QueuedSample[];
    if (!Array.isArray(rows) || rows.length > 500 || !rows.every((r: QueuedSample) => this.valid(r))) throw new Error('离线队列格式无效，未覆盖原数据');
    this.rows = rows; this.ready = true;
  }
  private valid(row: QueuedSample): boolean {
    return !!row && typeof row.target === 'string' && row.target.startsWith('https://') && row.target.length < 600 &&
      typeof row.sessionBootId === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(row.sessionBootId) &&
      Number.isSafeInteger(row.capturedAt) && row.capturedAt > 0 && Number.isSafeInteger(row.sampleAgeMs) && row.sampleAgeMs >= 0 && row.sampleAgeMs < 10000 &&
      typeof row.frameJson === 'string' && row.frameJson.length <= 4096 && typeof row.key === 'string' && row.key === row.sessionBootId + '/' + row.frameJson;
  }
  count(): number { return this.rows.length; }
  private async persist(rows: QueuedSample[]): Promise<void> {
    if (!this.ready || !this.store) throw new Error('离线队列未就绪');
    const text = JSON.stringify(rows); if (text.length > 1048576 || rows.length > 500) throw new Error('离线队列已满，请先补发或处理');
    try { await this.store.put('samples', text); await this.store.flush(); this.rows = rows; }
    catch { this.ready = false; throw new Error('离线队列写入失败，停止修改并保留已存数据'); }
  }
  async enqueue(sample: CloudSample, target: string): Promise<string> {
    const row = new QueuedSample(); row.sessionBootId = sample.sessionBootId; row.sampleAgeMs = sample.sampleAgeMs; row.frameJson = sample.frameJson;
    row.target = target; row.capturedAt = Date.now(); row.key = row.sessionBootId + '/' + row.frameJson;
    if (!this.valid(row)) throw new Error('不能缓存无效或过期采集帧');
    const work = this.tail.then(async () => { if (!this.ready) throw new Error('离线队列不可用'); if (!this.rows.some((r: QueuedSample) => r.target === target && r.key === row.key)) await this.persist(this.rows.concat([row])); });
    this.tail = work.catch(() => {}); await work; return row.key;
  }
  batch(target: string): QueuedSample[] { if (!this.ready) throw new Error('离线队列不可用'); return this.rows.filter((r: QueuedSample) => r.target === target).slice(0, 10); }
  async acknowledge(target: string, keys: string[]): Promise<void> {
    const work = this.tail.then(() => this.persist(this.rows.filter((r: QueuedSample) => r.target !== target || !keys.includes(r.key))));
    this.tail = work.catch(() => {}); await work;
  }
}
