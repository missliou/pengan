#!/bin/bash
set -e
BASE="$(cd "$(dirname "$0")" && pwd)"
gcc -std=c99 -Wall -Wextra -Werror "$BASE/tests/printf_cap_test.c" -o /tmp/pengan-printf-cap-test
/tmp/pengan-printf-cap-test > "$BASE/tests/printf-cap-output.txt"
