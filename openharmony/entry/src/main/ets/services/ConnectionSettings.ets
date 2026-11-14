import preferences from '@ohos.data.preferences';
import common from '@ohos.app.ability.common';

export const DEFAULT_GATEWAY: string = 'http://127.0.0.1:5187';

// This config selects a simulation gateway, not a real hardware identity.
export function normalizeGatewayAddress(value: string): string {
  const address = value.trim().replace(/\/+$/, '');
  if (address.length > 240) throw new Error('地址过长');
  const match = /^(https?):\/\/([a-zA-Z0-9.-]+)(?::([0-9]{1,5}))?$/.exec(address);
  if (!match) throw new Error('请输入 http(s)://主机:端口，不包含路径、账号或参数');
  const host = match[2].toLowerCase();
  if (host.startsWith('.') || host.endsWith('.') || host.includes('..')) throw new Error('主机名无效');
  if (match[3] && (Number(match[3]) < 1 || Number(match[3]) > 65535)) throw new Error('端口应为1至65535');
  const parts = host.split('.');
  const ipv4 = parts.length === 4 && parts.every((part: string) => /^\d+$/.test(part) && Number(part) <= 255 && String(Number(part)) === part);
  if (/^[0-9.]+$/.test(host) && !ipv4) throw new Error('IPv4地址无效');
  const local = host === 'localhost' || (ipv4 && (parts[0] === '127' || parts[0] === '10' ||
    (parts[0] === '192' && parts[1] === '168') || (parts[0] === '172' && Number(parts[1]) >= 16 && Number(parts[1]) <= 31)));
  if (match[1] === 'http' && !local) throw new Error('公网服务必须使用HTTPS；HTTP仅用于本地或私有局域网调试');
  return match[1] + '://' + host + (match[3] ? ':' + Number(match[3]).toString() : '');
}

export class ConnectionSettings {
  private store: preferences.Preferences | undefined = undefined;

  async open(context: common.UIAbilityContext): Promise<string> {
    this.store = undefined;
    try {
      this.store = await preferences.getPreferences(context, 'pengan_connection_v1');
      const saved = await this.store.get('gatewayAddress', DEFAULT_GATEWAY);
      if (typeof saved !== 'string') throw new Error('已保存的连接配置无效');
      return normalizeGatewayAddress(saved);
    } catch (error) {
      this.store = undefined;
      throw new Error('连接配置读取失败：' + (error as Error).message);
    }
  }

  async save(value: string): Promise<string> {
    const address = normalizeGatewayAddress(value);
    if (!this.store) throw new Error('连接配置尚未载入');
    try {
      await this.store.put('gatewayAddress', address);
      await this.store.flush();
    } catch (error) {
      throw new Error('连接配置保存失败：' + (error as Error).message);
    }
    return address;
  }
}
