#!/bin/bash
set -e
export PATH=/home/asus/hi3861-build/venv/bin:/home/asus/hi3861-build/gcc_riscv32/bin:/usr/local/bin:/usr/bin:/bin
BASE="$(cd "$(dirname "$0")" && pwd)"
python3 "$BASE/prepare_sdk.py"
cd /home/asus/pengan-hsp101-sdk
scons -Q -j4 > "$BASE/build.log" 2>&1 || { tail -35 "$BASE/build.log"; exit 1; }
mkdir -p "$BASE/dist"
cp output/bin/OHOS_Image.bin "$BASE/dist/pengan-hsp101-0.1.8-allinone.bin"
tail -5 "$BASE/build.log"
