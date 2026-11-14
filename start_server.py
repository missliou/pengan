#!/usr/bin/env python3
"""棚安服务端启动入口；仅使用 Python 标准库，服务仍由 Node.js 运行。"""
import argparse
import ipaddress
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys

ROOT = Path(__file__).resolve().parent


def private_ipv4(value, loopback=False):
    try:
        address = ipaddress.IPv4Address(value)
    except ipaddress.AddressValueError:
        raise argparse.ArgumentTypeError("请填写 IPv4 地址，例如 192.168.1.89")
    networks = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
    if loopback:
        networks.append("127.0.0.0/8")
    if not any(address in ipaddress.IPv4Network(n) for n in networks):
        raise argparse.ArgumentTypeError("仅支持明确的局域网 IPv4 地址" + ("或回环地址" if loopback else ""))
    return str(address)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1", type=lambda v: private_ipv4(v, True), help="电脑监听地址，默认仅本机 127.0.0.1")
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--serial", help="HH-HSP101 串口，例如 COM7（需要 PowerShell 7）")
    source.add_argument("--wifi", type=private_ipv4, help="已配网板子的局域网 IP")
    parser.add_argument("--mode", choices=("hardware", "simulation"), default="hardware", help="默认真实数据 hardware；演示须显式 simulation")
    parser.add_argument("--check", action="store_true", help="只检查环境并显示启动命令，不启动服务或采集")
    args = parser.parse_args()
    if args.serial and not re.fullmatch(r"COM\d+", args.serial):
        parser.error("串口格式应为 COM7 等明确端口")
    if (args.wifi or args.serial) and args.mode != "hardware":
        parser.error("实物采集参数仅用于 hardware 模式")
    node = shutil.which("node")
    if not node:
        parser.exit(1, "未找到 Node.js，请安装 Node.js 22 或更新版本并加入 PATH。\n")
    try:
        version = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=5, check=True).stdout.strip()
        if int(version.lstrip("v").split(".")[0]) < 22:
            raise ValueError("Node.js 版本过低")
    except (OSError, ValueError, subprocess.SubprocessError):
        parser.exit(1, "无法使用 Node.js 22+，请检查本机安装。\n")
    if args.serial and not shutil.which("pwsh.exe"):
        parser.exit(1, "串口采集需要安装 PowerShell 7（pwsh.exe）。\n")
    if not (ROOT / "tools/system.mjs").is_file():
        parser.exit(1, "缺少 tools/system.mjs，请保留完整项目目录。\n")
    if not all((ROOT / "gateway/node_modules" / name / "package.json").is_file() for name in ("aedes", "mqtt")):
        parser.exit(1, "缺少服务端依赖，请在项目目录执行：npm ci --prefix gateway\n")
    command = [node, str(ROOT / "tools/system.mjs"), "--host", args.host, "--mode", args.mode]
    if args.serial:
        command += ["--serial", args.serial]
    if args.wifi:
        command += ["--wifi", args.wifi]
    print("Node.js " + version, flush=True)
    if args.check:
        print("检查通过（未验证端口、板子或模型），启动命令：")
        print(subprocess.list2cmdline(command))
        return 0
    print("控制台：http://{}:5187/；按 Ctrl+C 停止本次服务。".format(args.host), flush=True)
    child = subprocess.Popen(command, cwd=ROOT, start_new_session=(os.name != "nt"))
    try:
        return child.wait()
    except KeyboardInterrupt:
        # Windows console delivers Ctrl+C to both Python and Node. Node owns its collectors.
        if os.name != "nt":
            os.killpg(child.pid, signal.SIGINT)
        try:
            child.wait(timeout=5)
        except (subprocess.TimeoutExpired, KeyboardInterrupt):
            if child.poll() is None:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(child.pid), "/T", "/F"], capture_output=True, timeout=5)
                else:
                    os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=5)
        return 130


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, subprocess.SubprocessError) as error:
        print("启动或停止失败：" + str(error), file=sys.stderr)
        sys.exit(1)
