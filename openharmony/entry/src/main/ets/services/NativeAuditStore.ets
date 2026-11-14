import preferences from '@ohos.data.preferences';
import cryptoFramework from '@ohos.security.cryptoFramework';
import util from '@ohos.util';
import common from '@ohos.app.ability.common';
import { EnvSnapshot, EventRecord } from '../model/Models';

export class AuditRecord extends EventRecord {
  co: number;
  co2: number;
  coValid: boolean;
  co2Valid: boolean;
  sampledAt: number;
  previous: string = 'GENESIS';
  hash: string = '';
  environmentSimulated: boolean = true;
  constructor(event: EventRecord, env: EnvSnapshot) {
    super(event.id, event.title, event.detail, event.source, event.blocked);
    this.at = event.at;
    this.time = event.time;
    this.coValid = Number.isFinite(env.co);
    this.co2Valid = Number.isFinite(env.co2);
    this.co = this.coValid ? env.co : -1;
    this.co2 = this.co2Valid ? env.co2 : -1;
    this.sampledAt = env.sampledAt;
  }
}

interface AuditExport {
  formatVersion: number;
  prototype: boolean;
  hardwareActuation: boolean;
  exportedAt: string;
  integrityValid: boolean;
  verificationNote: string;
  records: AuditRecord[];
}

export class NativeAuditStore {
  rows: AuditRecord[] = [];
  private store: preferences.Preferences | undefined = undefined;
  private queue: Promise<void> = Promise.resolve();
  private writable: boolean = false;
  private opened: boolean = false;

  private async digest(row: AuditRecord): Promise<string> {
    try {
      if (!canIUse('SystemCapability.Security.CryptoFramework.MessageDigest')) throw new Error('SHA256系统能力不可用');
      // Fixed field order is independent of JSON object property enumeration.
      const text = JSON.stringify([row.id, row.at, row.time, row.title, row.detail, row.source,
        row.blocked, row.co, row.co2, row.coValid, row.co2Valid, row.sampledAt, row.environmentSimulated, row.previous]);
      const md = cryptoFramework.createMd('SHA256');
      await md.update({ data: new util.TextEncoder().encodeInto(text) });
      const output = await md.digest();
      let result = '';
      for (let i = 0; i < output.data.length; i++) {
        result += output.data[i].toString(16).padStart(2, '0');
      }
      return result;
    } catch (error) {
      this.writable = false;
      throw new Error('台账摘要失败：' + (error as Error).message);
    }
  }

  async open(context: common.UIAbilityContext): Promise<void> {
    this.opened = false;
    this.writable = false;
    try {
      if (!canIUse('SystemCapability.Security.CryptoFramework.MessageDigest')) throw new Error('SHA256系统能力不可用');
      this.store = await preferences.getPreferences(context, 'pengan_audit_v2');
      const count = await this.store.get('count', 0);
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > 1000) {
        throw new Error('审计记录数量无效，保留原数据等待检查');
      }
      const loaded: AuditRecord[] = [];
      for (let i = 1; i <= count; i++) {
        const raw = await this.store.get('record_' + i.toString(), '');
        if (typeof raw !== 'string' || raw.length === 0) throw new Error('审计记录缺失');
        const row = JSON.parse(raw) as AuditRecord;
        if (row.id !== i || !Number.isFinite(row.at) || typeof row.title !== 'string' || typeof row.detail !== 'string' ||
          typeof row.source !== 'string' || typeof row.time !== 'string' || typeof row.blocked !== 'boolean' ||
          typeof row.previous !== 'string' || typeof row.hash !== 'string' ||
          typeof row.coValid !== 'boolean' || typeof row.co2Valid !== 'boolean' ||
          row.environmentSimulated !== true ||
          !Number.isFinite(row.co) || !Number.isFinite(row.co2) || !Number.isFinite(row.sampledAt)) {
          throw new Error('审计记录字段无效');
        }
        loaded.push(row);
      }
      this.rows = loaded;
      this.opened = true;
      await this.verify();
      this.writable = true;
    } catch (error) {
      this.writable = false;
      // Keep a fully loaded but invalid chain available for explicitly marked inspection export.
      throw new Error('台账打开失败，保留原记录：' + (error as Error).message);
    }
  }

  append(event: EventRecord, env: EnvSnapshot): Promise<void> {
    // Capture the action snapshot before any queued asynchronous work.
    const row = new AuditRecord(event, env);
    const operation = this.queue.then(async () => {
      if (!this.store || !this.writable) throw new Error('审计存储未就绪');
      if (this.rows.length >= 1000) throw new Error('原型台账已达 1000 条容量，需导出后升级存储');
      row.id = this.rows.length + 1;
      row.previous = this.rows.length > 0 ? this.rows[this.rows.length - 1].hash : 'GENESIS';
      row.hash = await this.digest(row);
      const encoded = JSON.stringify(row);
      if (new util.TextEncoder().encodeInto(encoded).length > 8000) throw new Error('单条台账过长');
      try {
        await this.store.put('record_' + row.id.toString(), encoded);
        await this.store.put('count', row.id);
        await this.store.flush();
        this.rows.push(row);
      } catch (error) {
        this.writable = false;
        throw new Error('台账保存失败，已停止追加以保留异常现场');
      }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  async verify(): Promise<number> {
    if (!this.opened) throw new Error('台账尚未载入，不能报告校验通过');
    let previous = 'GENESIS';
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i];
      if (row.previous !== previous || row.hash !== await this.digest(row)) {
        this.writable = false;
        throw new Error('哈希链在第 ' + (i + 1).toString() + ' 条不一致');
      }
      previous = row.hash;
    }
    return this.rows.length;
  }

  async exportJson(): Promise<string> {
    await this.queue;
    if (!this.opened) throw new Error('台账尚未载入，不能导出空记录冒充成功');
    let valid = true;
    let note = '本地哈希链连续一致；未配置独立云端锚定';
    try { await this.verify(); }
    catch (error) { valid = false; note = '哈希链存在不一致，此导出仅供检查，不证明完整性'; }
    const data: AuditExport = { formatVersion: 2, prototype: true, hardwareActuation: false,
      exportedAt: new Date().toISOString(), integrityValid: valid, verificationNote: note, records: this.rows.slice() };
    return JSON.stringify(data, null, 2);
  }
}
