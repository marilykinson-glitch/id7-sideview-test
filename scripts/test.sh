#!/bin/sh
# Everything that can be checked without the car. From the repository root:
#   FFMPEG_SRC=/path/to/FFmpeg-n7.1 sh scripts/test.sh
# Needs gcc/g++, nasm, python3, node, ffmpeg (with libx264) and acorn for node (NODE_PATH).
set -eu
cd "$(dirname "$0")/.."
sh native/build.sh test
cmp native/build/mgu-sidecam tools/xinhan-cam/mgu-sidecam || echo "note: tools/xinhan-cam/mgu-sidecam differs from this build (copy it over to ship this one)"
node tests/logic_test.js
node tests/nav_read_test.js
python3 tests/system_test.py
node tests/anh_dai_dien_test.js
node tests/thoi_tiet_test.js
node scripts/check_node8.js
