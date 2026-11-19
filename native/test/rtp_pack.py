#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""An H.264 Annex-B file as RTP packets (RFC 6184: single NAL units and FU-A),
each written behind a 2-byte big-endian length, for mgu-sidecam --file and
the fake AVB bridge.

  rtp_pack.py in.h264 out.rtp [--no-marker] [--skip-pictures N] [--drop-every N] [--sei-tag] [--stop-odd-after N]

--no-marker: no marker bit on a picture's last packet (the receiver then ends
a picture at the next one's first packet). --skip-pictures: the stream as a
receiver that joins late sees it, without its first N pictures (parameter
sets after that are kept as sent). --drop-every N: every Nth packet lost.
--sei-tag: a user-data SEI before each picture whose 19th byte (after the 16-byte UUID: aa, a counter, the
tag, 55) is 09 and 0a by turns, as a G30's camera unit tags its two pictures. --stop-odd-after N: from
picture N on, the odd pictures (the second kind) are not sent: one kind stops, the other comes on.
"""
import struct
import sys


def nals(data):
    i, out, n = 0, [], len(data)
    starts = []
    while True:
        j = data.find(b'\x00\x00\x01', i)
        if j < 0:
            break
        starts.append(j + 3)
        i = j + 3
    for k, s in enumerate(starts):
        e = (starts[k + 1] - 3) if k + 1 < len(starts) else n
        while e > s and data[e - 1] == 0:
            e -= 1
        out.append(data[s:e])
    return out


def first_mb_zero(nal):
    return len(nal) > 1 and (nal[1] & 0x80) != 0   # ue(v) 0 is the single bit 1


def main():
    a = sys.argv[1:]
    src, dst = a[0], a[1]
    marker = '--no-marker' not in a
    skip = int(a[a.index('--skip-pictures') + 1]) if '--skip-pictures' in a else 0
    drop = int(a[a.index('--drop-every') + 1]) if '--drop-every' in a else 0
    tag = '--sei-tag' in a
    stop_odd = int(a[a.index('--stop-odd-after') + 1]) if '--stop-odd-after' in a else -1
    units = nals(open(src, 'rb').read())
    # group into pictures: a new one starts at a slice with first_mb 0; parameter sets and SEI go with the next slice
    pictures, cur, has_slice = [], [], False
    for u in units:
        t = u[0] & 31
        new = (t in (1, 5) and first_mb_zero(u) and has_slice) or (t in (6, 7, 8, 9) and has_slice)
        if new:
            pictures.append(cur)
            cur, has_slice = [], False
        cur.append(u)
        if t in (1, 5):
            has_slice = True
    if cur:
        pictures.append(cur)
    seq, ts, count, sent = 1000, 90000, 0, 0
    with open(dst, 'wb') as f:
        def emit(payload, m):
            nonlocal seq, count, sent
            hdr = struct.pack('>BBHII', 0x80, 96 | (0x80 if m else 0), seq & 0xffff, ts & 0xffffffff, 0x1234abcd)
            seq += 1
            count += 1
            if drop and count % drop == 0:
                return
            pkt = hdr + payload
            f.write(struct.pack('>H', len(pkt)) + pkt)
            sent += 1
        for pi, pic in enumerate(pictures):
            if tag:
                uuid = bytes(range(0x11, 0x21))
                body = uuid + bytes([0xaa, pi % 200 + 1, 0x09 if pi % 2 == 0 else 0x0a, 0x55])
                pic = [bytes([0x06, 0x05, len(body)]) + body + b'\x80'] + list(pic)
            if stop_odd >= 0 and pi >= stop_odd and pi % 2 == 1:
                ts += 6000
                continue
            if pi >= skip:
                for ni, u in enumerate(pic):
                    last = ni == len(pic) - 1
                    if len(u) <= 1400:
                        emit(u, marker and last)
                    else:
                        ind = (u[0] & 0xe0) | 28
                        body, off = u[1:], 0
                        while off < len(body):
                            chunk = body[off:off + 1398]
                            s = 0x80 if off == 0 else 0
                            e = 0x40 if off + len(chunk) >= len(body) else 0
                            emit(bytes([ind, s | e | (u[0] & 31)]) + chunk, marker and last and e)
                            off += len(chunk)
            ts += 6000   # 15 pictures a second at 90 kHz
    print('%s: %d pictures (%d skipped), %d packets' % (dst, len(pictures), min(skip, len(pictures)), sent))


if __name__ == '__main__':
    main()
