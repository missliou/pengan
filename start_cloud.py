"""Run the authenticated local/Ubuntu backend without printing deployment secrets."""
import argparse
import pathlib
import shutil
import subprocess
import sys

def main():
    parser = argparse.ArgumentParser(description='棚安数据库、图片与AI云端服务启动器')
    parser.add_argument('--config', required=True, type=pathlib.Path, help='已有cloud-config.json绝对路径')
    args = parser.parse_args()
    config = args.config
    if not config.is_absolute() or not config.is_file():
        parser.error('配置必须是已存在文件的绝对路径；新环境先运行setup_cloud.py')
    node = shutil.which('node')
    if not node:
        parser.error('未找到Node.js，请安装Node.js 22.13及以上版本')
    script = pathlib.Path(__file__).resolve().parent / 'gateway' / 'cloud-main.mjs'
    try:
        return subprocess.call([node, str(script), '--config', str(config)], cwd=script.parent.parent)
    except KeyboardInterrupt:
        return 130

if __name__ == '__main__':
    sys.exit(main())
