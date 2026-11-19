#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Host tests of the head-unit binary itself (build/mgu-sidecam, run under this
# machine's loader): a made-up four-camera stream through a fake AVB bridge
# into a fake cluster renderer. Needs ffmpeg (with libx264) and python3.
set -eu
cd "$(dirname "$0")/.."
B=build/test
mkdir -p $B/lib
gcc -shared -fPIC -O2 -Wl,-soname,libias-media_transport-avb_ufipc_bridge.so.1 \
    -o $B/lib/libias-media_transport-avb_ufipc_bridge.so.1 test/fake_ias_avb.c -lpthread
g++ -std=c++14 -O2 -Wall -Wextra -Isrc -o $B/resample_test test/resample_test.cpp src/resample.cpp
$B/resample_test
g++ -std=c++14 -O2 -Wall -Wextra -fsanitize=address,undefined -Isrc -o $B/overlay_test test/overlay_test.cpp src/overlay.cpp
$B/overlay_test
# top-left red (front), top-right green (rear), bottom-left blue (left mirror), bottom-right yellow (right mirror),
# each with a square moving across it so every picture differs
Q='[0:v][4:v]overlay=x=mod(t*120\,560):y=200[a];[1:v][4:v]overlay=x=mod(t*90\,560):y=100[b];[2:v][4:v]overlay=x=mod(t*60\,560):y=300[c];[3:v][4:v]overlay=x=mod(t*150\,560):y=50[d];[a][b][c][d]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0'
R=15
ins() { echo "-f lavfi -i color=c=0xD00000:s=640x480:r=$1 -f lavfi -i color=c=0x00C000:s=640x480:r=$1 -f lavfi -i color=c=0x0000D0:s=640x480:r=$1 -f lavfi -i color=c=0xD0D000:s=640x480:r=$1 -f lavfi -i color=c=white:s=80x80:r=$1"; }
IN=$(ins 15)
if [ ! -f $B/mosaic.h264 ]; then
    ffmpeg -loglevel error -y $IN -filter_complex "$Q" -t 8 -c:v libx264 -profile:v main -preset veryfast -bf 0 -g 15 \
        -pix_fmt yuv420p -f h264 $B/mosaic.h264
    ffmpeg -loglevel error -y $IN -filter_complex "$Q" -t 8 -c:v libx264 -profile:v main -preset veryfast -bf 0 \
        -x264-params "intra-refresh=1:keyint=30:min-keyint=30:repeat-headers=1" -pix_fmt yuv420p -f h264 $B/refresh.h264
fi
if [ ! -f $B/pairs.h264 ]; then
    # as a G30 sends it: 1280x480 pictures by turns, front|rear (red|green) then left|right (blue|yellow)
    ffmpeg -loglevel error -y $(ins 30) -filter_complex "$Q,crop=1280:480:0:'mod(n,2)*480'" -t 8 -c:v libx264 -profile:v main \
        -preset veryfast -bf 0 -g 30 -pix_fmt yuv420p -f h264 $B/pairs.h264
fi
python3 test/rtp_pack.py $B/pairs.h264 $B/pairs.rtp
if [ ! -f $B/pairs_intra.h264 ]; then
    # the same, every picture on its own (a picture left out breaks nothing else)
    ffmpeg -loglevel error -y $(ins 30) -filter_complex "$Q,crop=1280:480:0:'mod(n,2)*480'" -t 8 -c:v libx264 -profile:v main \
        -preset veryfast -bf 0 -g 1 -pix_fmt yuv420p -f h264 $B/pairs_intra.h264
fi
python3 test/rtp_pack.py $B/pairs_intra.h264 $B/pairs_half.rtp --sei-tag --stop-odd-after 60
python3 test/rtp_pack.py $B/mosaic.h264 $B/mosaic.rtp
python3 test/rtp_pack.py $B/mosaic.h264 $B/mosaic_lossy.rtp --drop-every 40
python3 test/rtp_pack.py $B/refresh.h264 $B/refresh_late.rtp --no-marker --skip-pictures 17
python3 test/e2e.py build/mgu-sidecam $B
