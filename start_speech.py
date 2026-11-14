"""Launch a preinstalled local whisper.cpp service on loopback only."""
import argparse
import pathlib
import subprocess
import sys

def main():
    parser = argparse.ArgumentParser(description='启动本地语音识别服务，不开放公网')
    parser.add_argument('--binary', required=True, type=pathlib.Path)
    parser.add_argument('--model', required=True, type=pathlib.Path)
    parser.add_argument('--port', type=int, default=8178)
    parser.add_argument('--threads', type=int, default=2)
    args = parser.parse_args()
    if not all(p.is_absolute() and p.is_file() for p in (args.binary, args.model)):
        parser.error('引擎和模型必须是已存在文件的绝对路径')
    if not 1024 <= args.port <= 65535 or not 1 <= args.threads <= 8:
        parser.error('端口或线程数无效')
    command = [str(args.binary), '-m', str(args.model), '--host', '127.0.0.1', '--port', str(args.port), '-ng', '-t', str(args.threads), '-l', 'zh']
    try:
        return subprocess.call(command, cwd=args.binary.parent)
    except KeyboardInterrupt:
        return 130

if __name__ == '__main__':
    sys.exit(main())
