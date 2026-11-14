import preferences from '@ohos.data.preferences';
import common from '@ohos.app.ability.common';

export class DirectConnectionConfig {
  schemaVersion: number = 1;
  mode: string = 'direct';
  boardIp: string = '';
}

export function normalizeDirectConfig(mode: string, boardIp: string): DirectConnectionConfig {
  if (mode !== 'direct' && mode !== 'gateway') throw new Error('采集模式无效');
  if (typeof boardIp !== 'string') throw new Error('采集板IP无效');
  const ip = boardIp.trim();
  if (ip.length > 0) {
    const parts: string[] = ip.split('.');
    if (parts.length !== 4 || !parts.every((part: string) => /^\d+$/.test(part) && Number(part) <= 255 && Number(part).toString() === part)) throw new Error('请填写裸私网IPv4，不含http、端口或路径');
    const local = parts[0] === '10' || (parts[0] === '192' && parts[1] === '168') || (parts[0] === '172' && Number(parts[1]) >= 16 && Number(parts[1]) <= 31);
    if (!local) throw new Error('采集板仅支持同一局域网私网IPv4');
  }
  const config = new DirectConnectionConfig(); config.mode = mode; config.boardIp = ip;
  return config;
}

// One serialized value prevents a mode/IP pair from being partially updated.
// It contains no Wi-Fi password, model key or device credential.
export class DirectConnectionSettings {
  private store: preferences.Preferences | undefined = undefined;
  isReady(): boolean { return this.store !== undefined; }

  async open(context: common.UIAbilityContext): Promise<DirectConnectionConfig> {
    this.store = undefined;
    try {
      const store = await preferences.getPreferences(context, 'pengan_direct_connection_v1');
      const raw = await store.get('config', JSON.stringify(new DirectConnectionConfig()));
      if (typeof raw !== 'string') throw new Error('配置不是文本');
      const config = JSON.parse(raw) as DirectConnectionConfig;
      if (!config || config.schemaVersion !== 1) throw new Error('配置版本无效');
      const checked = normalizeDirectConfig(config.mode, config.boardIp);
      this.store = store;
      return checked;
    } catch (error) { throw new Error('直采配置读取失败，未自动覆盖：' + (error as Error).message); }
  }

  async save(mode: string, boardIp: string): Promise<DirectConnectionConfig> {
    const config = normalizeDirectConfig(mode, boardIp);
    if (config.mode === 'direct' && config.boardIp.length === 0) throw new Error('请先填写HH-HSP101局域网IP');
    if (!this.store) throw new Error('直采配置未载入，请重启应用核对存储');
    try { await this.store.put('config', JSON.stringify(config)); await this.store.flush(); }
    catch { this.store = undefined; throw new Error('配置保存结果未确认，未切换当前来源；请重启应用核对存储'); }
    return config;
  }
}
