#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Builds mgu-sidecam for the head unit (x86-64, glibc 2.27) on any x86-64 Linux
# with gcc/g++ (13 tested), binutils, python3 and nasm. No Docker, no network.
#
#   FFMPEG_SRC=/path/to/FFmpeg-n7.1 ./build.sh          # the binary: build/mgu-sidecam
#   ./build.sh test                                     # and the host tests
#
# How it stays compatible with the unit's older glibc: toolchain/README.md.
set -eu
cd "$(dirname "$0")"
B=build
TC=toolchain
VERSION=$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' ../tools/xinhan-cam/component.json | head -n 1)
CFLAGS_COMMON="-O2 -g0 -fPIC -U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=0 -fno-stack-protector -fno-plt -ffunction-sections -fdata-sections"
GCCDIR=$(dirname "$(gcc -print-file-name=crtbeginS.o)")
mkdir -p $B/stubs $B/obj

# 1. FFmpeg's H.264 decoder (LGPL 2.1 or later; no GPL or nonfree parts), static
if [ ! -f $B/ffmpeg/lib/libavcodec.a ]; then
    : "${FFMPEG_SRC:?set FFMPEG_SRC to an FFmpeg source tree (n7.1: git clone --depth 1 --branch n7.1 https://github.com/FFmpeg/FFmpeg)}"
    mkdir -p $B/ffmpeg-build
    FF_OUT=$(pwd)/$B/ffmpeg
    (cd $B/ffmpeg-build && "$FFMPEG_SRC/configure" --prefix="$FF_OUT" \
        --disable-everything --disable-programs --disable-doc --disable-avdevice --disable-avformat \
        --disable-swscale --disable-swresample --disable-avfilter --disable-network --disable-autodetect \
        --enable-decoder=h264 --enable-parser=h264 --enable-pic --disable-debug --enable-static --disable-shared \
        --enable-pthreads --extra-cflags="-U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=0 -fno-stack-protector" >configure.log 2>&1 \
        && make -j"$(nproc)" >make.log 2>&1 && make install >>make.log 2>&1)
fi

# 2. link-only stubs: glibc 2.27 and the unit's AVB bridge
python3 $TC/gen_glibc_stubs.py $TC/abilists $B/stubs >/dev/null
for l in libc libpthread libm libdl librt ld; do
    so=$(cat $B/stubs/$l.soname)
    gcc -shared -nostdlib -Wl,-soname,"$so" -Wl,--version-script=$B/stubs/$l.map -Wl,--hash-style=both -o "$B/stubs/$so" $B/stubs/$l.S
done
gcc -shared -nostdlib -fPIC -Wl,-soname,libias-media_transport-avb_ufipc_bridge.so.1 \
    -o $B/stubs/libias-media_transport-avb_ufipc_bridge.so.1 $TC/ias_avb_stub.c

# 3. compile
TP=third_party/idrive-apps
INC="-Isrc -I$TP/waze-on-cluster/src -I$TP/cluster-render/include -I$TP/cluster-render/src -I$B/ffmpeg/include"
CXXFLAGS="-std=c++14 $CFLAGS_COMMON -Wall -Wextra -pthread -DSIDECAM_VERSION=\"$VERSION\" -DAVB_RECEIVER_NAME=\"xinhancam.receiver\""
SRCS="src/main.cpp src/pipeline.cpp src/decoder.cpp src/resample.cpp src/overlay.cpp
      $TP/waze-on-cluster/src/avb_source.cpp $TP/waze-on-cluster/src/rtp_h264.cpp
      $TP/cluster-render/client/client.cpp $TP/cluster-render/client/protocol.cpp $TP/cluster-render/src/log.cpp"
OBJS=""
for s in $SRCS; do
    o=$B/obj/$(echo "$s" | tr '/' '_' | sed 's/\.cpp$/.o/')
    g++ $CXXFLAGS $INC -c -o "$o" "$s" &
    OBJS="$OBJS $o"
done
gcc $CFLAGS_COMMON -c -o $B/obj/start.o $TC/start.S &
gcc $CFLAGS_COMMON -c -o $B/obj/csu.o $TC/csu.c &
gcc $CFLAGS_COMMON -c -o $B/obj/compat.o $TC/compat.c &
wait

# 4. link: our start file and constructors, libstdc++ and libgcc static, glibc by the 2.27 stubs
g++ -nostdlib -nostartfiles -pie -o $B/mgu-sidecam \
    -Wl,--dynamic-linker=/lib/ld-linux-x86-64.so.2 -Wl,-z,nopack-relative-relocs -Wl,--hash-style=both \
    -Wl,--gc-sections -Wl,-z,relro -Wl,-z,now -Wl,--no-undefined -Wl,-s \
    $B/obj/start.o $B/obj/csu.o "$(gcc -print-file-name=crti.o)" "$GCCDIR/crtbeginS.o" \
    $OBJS $B/obj/compat.o \
    $B/ffmpeg/lib/libavcodec.a $B/ffmpeg/lib/libavutil.a \
    "$GCCDIR/libstdc++.a" "$GCCDIR/libgcc.a" "$GCCDIR/libgcc_eh.a" \
    -L$B/stubs -l:libias-media_transport-avb_ufipc_bridge.so.1 \
    -l:libpthread.so.0 -l:libm.so.6 -l:libdl.so.2 -l:librt.so.1 -l:libc.so.6 -l:ld-linux-x86-64.so.2 \
    "$GCCDIR/libgcc.a" "$GCCDIR/crtendS.o" "$(gcc -print-file-name=crtn.o)"

# 5. every import must exist on the unit
python3 $TC/check_abi.py $B/mgu-sidecam $TC/abilists \
    libias-media_transport-avb_ufipc_bridge.so.1:ias_avbbridge_create_receiver,ias_avbbridge_register_H264_cb,ias_avbbridge_destroy_receiver
ls -l $B/mgu-sidecam

if [ "${1:-}" = "test" ]; then
    sh test/run.sh
fi
