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
    local = len(sys.argv) == 3
    origin = 'http://127.0.0.1:5201' if local else input('公网HTTPS源站，例如 https://pengan.example.com: ').strip()
    parsed = urlsplit(origin)
    if (not local and parsed.scheme != 'https') or not parsed.hostname or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise ValueError('必须填写不含路径、账号或参数的HTTPS源站')
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
    config = {'dataDir': str(directory / 'data'), 'publicOrigin': origin, 'port': 5201,
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
    if local:
        print('本机Web地址 http://127.0.0.1:5201；仅回环访问。原生设备令牌仍只允许HTTPS，不可向此HTTP入口发送。')

if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError):
        print('初始化未完成：请核对输入、目录权限及文件是否已存在；没有覆盖旧文件。', file=sys.stderr)
        sys.exit(1)
