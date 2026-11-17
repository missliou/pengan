"""Local operator setup. Credentials go only to exclusively created files."""
import getpass
import hashlib
import json
import os
import pathlib
import re
import secrets
import sys
from urllib.parse import urlsplit

def main():
    if len(sys.argv) not in (2, 3) or (len(sys.argv) == 3 and sys.argv[2] != '--local'):
        raise ValueError('用法: python setup_cloud.py <新的部署配置目录绝对路径> [--local]')
    directory = pathlib.Path(sys.argv[1])
    if not directory.is_absolute():
        raise ValueError('必须使用绝对路径；生产建议 /etc/pengan')
    if directory.resolve().is_relative_to(pathlib.Path(__file__).resolve().parent):
        raise ValueError('部署凭据目录必须位于项目源码目录之外')
    origin = input('站点地址（公网用 https://pengan.example.com，局域网演示用 http://192.168.1.20:5201）: ').strip()
    parsed = urlsplit(origin)
    private_v4 = re.fullmatch(r'(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)\d{1,3}(\.\d{1,3}){2}', parsed.hostname or '')
    plain_lan = parsed.scheme == 'http' and ((private_v4 is not None) or parsed.hostname == 'localhost')
    if not parsed.hostname or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise ValueError('必须填写不含路径、账号或参数的站点地址')
    if parsed.scheme != 'https' and not plain_lan:
        raise ValueError('公网必须使用HTTPS；明文HTTP只允许回环或私有局域网（演示/联调）')
    public_host = parsed.hostname if plain_lan and parsed.hostname != 'localhost' else '127.0.0.1'
    username = input('初始管理员账号: ').strip()
    gateway_id = input('DAYU200登记ID（字母、数字、下划线、短横线）: ').strip()
    if not re.fullmatch(r'[A-Za-z0-9_.-]{1,64}', username) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', gateway_id):
        raise ValueError('账号或设备ID格式无效')
    password = getpass.getpass('管理员密码（至少12字符，不回显）: ')
    if len(password.encode('utf-16-le')) // 2 < 12 or len(password.encode('utf-16-le')) // 2 > 256 or password != getpass.getpass('再次输入密码: '):
        raise ValueError('密码长度无效或两次不一致')
    salt = secrets.token_bytes(16)
    password_hash = 'scrypt-v1$' + salt.hex() + '$' + hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=32).hex()
    token = secrets.token_urlsafe(32)
    config = {'dataDir': str(directory / 'data'), 'publicOrigin': origin, 'publicOriginHost': public_host, 'port': 5201,
              'users': [{'username': username, 'role': 'admin', 'passwordHash': password_hash}],
              'devices': [{'gatewayId': gateway_id, 'tokenSha256': hashlib.sha256(token.encode()).hexdigest()}]}
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Never overwrite existing deployment material, even after an interrupted run.
    for name, content in [('device-credential.json', {'gatewayId': gateway_id, 'origin': origin, 'token': token}), ('cloud-config.json', config)]:
        fd = os.open(directory / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as target:
            json.dump(content, target, ensure_ascii=False, indent=2)
            target.flush()
            os.fsync(target.fileno())
    print('已创建 cloud-config.json 和 device-credential.json；令牌不输出到控制台。')
    print('设备凭据文件仅供本机录入DAYU200，勿上传聊天、日志或交付包；Windows需另核对文件ACL。')
    if parsed.scheme == 'http':
        print('Web地址 ' + origin + '；服务监听 ' + public_host + ':' + str(5201) + '后局域网可访问。')
        print('明文HTTP仅用于演示：令牌与数据未加密，DAYU200只能连私有局域网地址，禁止用于公网。')

if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError):
        print('初始化未完成：请核对输入、目录权限及文件是否已存在；没有覆盖旧文件。', file=sys.stderr)
        sys.exit(1)
