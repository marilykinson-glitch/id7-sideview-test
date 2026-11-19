#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""End-to-end tests of the head-unit binary: build/mgu-sidecam run under this
machine's loader with a fake AVB bridge (test/fake_ias_avb.c) and a fake
cluster renderer (test/fake_cluster_render.py).

  e2e.py <mgu-sidecam> <dir with mosaic.rtp, mosaic_lossy.rtp, refresh_late.rtp and lib/>
"""
import json
import os
import subprocess
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fake_cluster_render import FakeClusterRender  # noqa: E402

BIN, DIR = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
# SIDECAM_LOADER / SIDECAM_LIBPATH: another loader and library path, to run the binary under a real glibc 2.27
# (its elf/ld.so and build folders, and a fake AVB bridge built against it)
LOADER = os.environ.get('SIDECAM_LOADER', '/lib64/ld-linux-x86-64.so.2')
LIBPATH = os.environ.get('SIDECAM_LIBPATH', os.path.join(DIR, 'lib'))
fails = []


def check(ok, what):
    print(('  ok   ' if ok else '  FAIL ') + what)
    if not ok:
        fails.append(what)


class Cam:
    def __init__(self, name, rtp=None, file_mode=False, env=None, refuse=0, loop=True):
        self.name = name
        self.sock = os.path.join(DIR, 'cr-%s.sock' % name)
        self.cr = FakeClusterRender(self.sock, refuse_layers=refuse)
        self.cr.start()
        e = dict(os.environ)
        args = [LOADER, '--library-path', LIBPATH, BIN, '--socket', self.sock]
        if file_mode:
            args += ['--file', rtp] + (['--loop'] if loop else [])
        elif rtp:
            e['SIDECAM_FAKE_AVB'] = rtp
        e.update(env or {})
        self.log = open(os.path.join(DIR, 'log-%s.txt' % name), 'w')
        self.p = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.log, env=e)
        self.status, self.statuses = {}, []
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()

    def _read(self):
        for line in self.p.stdout:
            try:
                j = json.loads(line.decode())
            except ValueError:
                continue
            if j.get('ev') == 'status':
                self.status = j
                self.statuses.append((time.time(), j))

    def send(self, **kw):
        self.p.stdin.write((json.dumps(kw) + '\n').encode())
        self.p.stdin.flush()

    def hold(self, side, secs):
        """Asks for a view as the helper does: again twice a second."""
        end = time.time() + secs
        while time.time() < end:
            self.send(op='view', side=side)
            time.sleep(0.25)

    def wait(self, cond, secs, side=None):
        end = time.time() + secs
        while time.time() < end:
            if side:
                self.send(op='view', side=side)
            if cond(self.status):
                return True
            time.sleep(0.05)
        return cond(self.status)

    def atlas(self):
        """The newest frame of the (one) visible layer: (bytes, layer dict)."""
        with self.cr.lock:
            vis = [(r, l) for r, l in self.cr.layers.items() if l.get('visible', 1)]
            if len(vis) != 1 or vis[0][0] not in self.cr.frames:
                return None, None
            return self.cr.frames[vis[0][0]][0], vis[0][1]

    def close(self):
        try:
            self.p.stdin.close()
        except OSError:
            pass
        try:
            self.p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.p.kill()
        self.cr.close()
        self.log.close()
        return self.p.returncode


def rgb_at(atlas, w, h, x, y):
    """The colour the atlas shader draws at (x, y): full-range BT.601."""
    Y = atlas[y * w + x]
    U = atlas[w * h + (y // 2) * w + x // 2] - 128
    V = atlas[w * h + (y // 2) * w + w // 2 + x // 2] - 128
    c = lambda v: max(0, min(255, int(round(v))))
    return c(Y + 1.402 * V), c(Y - 0.344136 * U - 0.714136 * V), c(Y + 1.772 * U)


def mean_rgb(atlas, w, h, x0, y0, x1, y1):
    """The usual colour of a region: the median, so the moving white square does not count."""
    px = [rgb_at(atlas, w, h, x, y) for y in range(y0, y1, 8) for x in range(x0, x1, 8)]
    return tuple(sorted(p[i] for p in px)[len(px) // 2] for i in range(3))


def near(c, want, tol=45):
    return all(abs(a - b) <= tol for a, b in zip(c, want))


RED, GREEN, BLUE, YELLOW, BLACK = (208, 0, 0), (0, 192, 0), (0, 0, 208), (208, 208, 0), (0, 0, 0)
MOSAIC, LOSSY, LATE = (os.path.join(DIR, n) for n in ('mosaic.rtp', 'mosaic_lossy.rtp', 'refresh_late.rtp'))


def t_views():
    print('views from the bus stream (left = bottom-left, right = bottom-right, all = the whole picture)')
    c = Cam('views', MOSAIC)
    try:
        check(c.wait(lambda s: s.get('pictures', 0) > 5 and s.get('cr') == 'connected', 10), 'pictures decoded and the renderer connected')
        check(c.status.get('avb') == 'ok', 'joined the bus stream (avb ok)')
        check(c.status.get('picture_w') == 1280 and c.status.get('picture_h') == 960, 'picture is 1280x960')
        check(c.status.get('shown') == 0 and not c.cr.visible(), 'nothing shown before a view is asked for')
        check(c.status.get('layer_w') == 512 and c.status.get('layer_x') == 288 and c.status.get('layer_y') == 48,
              'the layer is 512x384 centred on the map (288,48)')
        with c.cr.lock:
            l = list(c.cr.layers.values())
        check(len(l) == 1 and l[0].get('kind') == 'video' and l[0].get('vw') == 512 and l[0].get('vh') == 384
              and l[0].get('w') == 512 and l[0].get('h') == 384 and l[0].get('exclusive') == 1 and l[0].get('contend') == 1
              and l[0].get('target') == 'map' and not l[0].get('visible', 1),
              'one hidden video layer, drawn at its frame size, exclusive, contending')
        t0 = time.time()
        check(c.wait(lambda s: s.get('shown') == 1, 3, 'left'), 'left: shown')
        dt = time.time() - t0
        check(dt < 0.6, 'left: shown %.0f ms after it was asked for' % (dt * 1000))
        c.hold('left', 0.6)
        a, lay = c.atlas()
        check(a is not None and len(a) == 512 * 384 * 3 // 2, 'left: a 512x384 atlas in the visible layer')
        if a:
            check(near(mean_rgb(a, 512, 384, 0, 0, 512, 384), BLUE), 'left: the picture is the bottom-left camera (blue) %s' % (mean_rgb(a, 512, 384, 0, 0, 512, 384),))
        c.hold('right', 0.8)
        a, lay = c.atlas()
        check(a is not None and near(mean_rgb(a, 512, 384, 0, 0, 512, 384), YELLOW), 'right: the bottom-right camera (yellow)')
        check(c.status.get('view') == 'right' and c.status.get('shown') == 1, 'right: status says shown')
        c.hold('all', 0.8)
        a, lay = c.atlas()
        if a:
            q = [mean_rgb(a, 512, 384, x0, y0, x0 + 256, y0 + 192) for (x0, y0) in ((0, 0), (256, 0), (0, 192), (256, 192))]
            check(near(q[0], RED) and near(q[1], GREEN) and near(q[2], BLUE) and near(q[3], YELLOW), 'all: red, green, blue, yellow quadrants %s' % (q,))
        else:
            check(False, 'all: an atlas')
        c.hold('front', 0.8)
        a, lay = c.atlas()
        check(a is not None and near(mean_rgb(a, 512, 384, 0, 0, 512, 384), RED), 'front: the top-left camera (red)')
        c.send(op='view', side='none')
        check(c.wait(lambda s: s.get('shown') == 0 and s.get('view') == 'none', 2), 'none: status says hidden')
        time.sleep(0.3)
        sent = c.status.get('frames_sent', 0)
        check(not c.cr.visible(), 'none: the layer is hidden')
        with c.cr.lock:
            last = list(c.cr.frames.values())[0][0]
        check(near(mean_rgb(last, 512, 384, 0, 0, 512, 384), BLACK, 5), 'none: the layer keeps a black picture, not the last view')
        time.sleep(1.0)
        check(c.status.get('frames_sent', 0) == sent, 'none: no more frames are sent')
        check(c.status.get('pictures', 0) > 0 and c.status.get('picture_age_ms', 9999) < 500, 'none: still decoding (ready for the next view)')
        # the views' pace: about 12 a second
        f0 = [(t, s['frames_sent']) for t, s in c.statuses if s.get('shown')]
        if len(f0) > 3:
            fps = (f0[-1][1] - f0[0][1]) / max(0.001, f0[-1][0] - f0[0][0])
            check(8 <= fps <= 14, 'frames go to the renderer at the set pace (%.1f a second, set 12)' % fps)
        check(c.status.get('decode_us', 0) > 0, 'decode time reported (%d us a picture here)' % c.status.get('decode_us', 0))
    finally:
        rc = c.close()
    check(rc == 0, 'ends cleanly when its stdin closes (exit %s)' % rc)


def t_heartbeat():
    print('a view nobody asks for again goes by itself')
    c = Cam('heartbeat', MOSAIC)
    try:
        c.wait(lambda s: s.get('pictures', 0) > 5 and s.get('cr') == 'connected', 10)
        c.send(op='view', side='left')
        check(c.wait(lambda s: s.get('shown') == 1, 3), 'shown')
        t0 = time.time()
        check(c.wait(lambda s: s.get('shown') == 0, 6), 'hidden without being told')
        dt = time.time() - t0
        check(2.5 <= dt <= 4.5, 'after about 3 s (%.1f s)' % dt)
        check('stopped asking' in c.status.get('why', ''), 'why: %s' % c.status.get('why'))
        check(not c.cr.visible(), 'the layer is hidden')
    finally:
        c.close()


def t_stall():
    print('the pictures stop: the view goes, and comes back with them')
    c = Cam('stall', MOSAIC, file_mode=True, loop=False)
    try:
        c.wait(lambda s: s.get('pictures', 0) > 5 and s.get('cr') == 'connected', 10)
        check(c.wait(lambda s: s.get('shown') == 1, 3, 'right'), 'shown while the file plays')
        t_end = time.time() + 12
        hidden = False
        last_pic, last_pic_t = -1, time.time()
        stop_t = None
        while time.time() < t_end:
            c.send(op='view', side='right')
            time.sleep(0.05)
            p = c.status.get('pictures', 0)
            if p != last_pic:
                last_pic, last_pic_t = p, time.time()
            if c.status.get('shown') == 0 and time.time() - last_pic_t > 0.5:
                hidden, stop_t = True, time.time() - last_pic_t
                break
        check(hidden, 'hidden once the pictures stopped')
        if stop_t is not None:
            check(stop_t < 1.6, 'within %.1f s of the last picture' % stop_t)
        check('stopped' in c.status.get('why', ''), 'why: %s' % c.status.get('why'))
        check(not c.cr.visible(), 'the layer is hidden (no frozen picture on the cluster)')
    finally:
        c.close()


def t_late_join():
    print('a stream joined late, with no IDR picture (intra refresh) and no marker bits')
    c = Cam('late', LATE)
    try:
        check(c.wait(lambda s: s.get('pictures', 0) > 10, 10), 'pictures decoded (%d, %d keyframes)' % (c.status.get('pictures', 0), c.status.get('keyframes', 0)))
        check(c.wait(lambda s: s.get('shown') == 1, 3, 'left'), 'left: shown')
        c.hold('left', 1.5)
        a, lay = c.atlas()
        check(a is not None and near(mean_rgb(a, 512, 384, 0, 0, 512, 384), BLUE, 60), 'left: blue once the refresh has gone round %s' % (mean_rgb(a, 512, 384, 0, 0, 512, 384) if a else None,))
    finally:
        c.close()


def t_loss():
    print('a stream that loses every 40th packet')
    c = Cam('loss', LOSSY)
    try:
        check(c.wait(lambda s: s.get('pictures', 0) > 20, 10), 'pictures decoded through the losses')
        check(c.wait(lambda s: s.get('shown') == 1, 3, 'right'), 'right: shown')
        c.hold('right', 2.0)
        check(c.wait(lambda s: s.get('lost', 0) > 0, 8, 'right'), 'the losses are counted (%d)' % c.status.get('lost', 0))
        check(c.status.get('shown') == 1, 'still shown 2 s later')
        check(c.p.poll() is None, 'still running')
    finally:
        c.close()


def t_config():
    print('settings: size, place, turn, mirror, crop, a layer made for each view')
    c = Cam('config', MOSAIC)
    try:
        c.wait(lambda s: s.get('pictures', 0) > 5 and s.get('cr') == 'connected', 10)
        # the left view: the right half of the bottom-left camera, turned 90 degrees, in a 400x300 layer at 20,40
        c.send(op='config', w=400, h=300, x=21, y=40, fps=8, left='250,500,250,500', left_rot=90, right='500,0,500,500', right_flip=1)
        check(c.wait(lambda s: s.get('layer_w') == 400 and s.get('layer_h') == 300 and s.get('layer') != 'none', 3), 'a new 400x300 layer')
        check(c.status.get('layer_x') == 20 and c.status.get('layer_y') == 40, 'at an even place (20,40)')
        check(c.wait(lambda s: s.get('shown') == 1, 3, 'left'), 'left: shown')
        c.hold('left', 0.6)
        a, lay = c.atlas()
        ok = a is not None and len(a) == 400 * 300 * 3 // 2
        check(ok, 'left: a 400x300 atlas')
        if ok:
            # 320x480 turned is 480x320 (3:2) in 400x300: 400x266, bars of 17 rows above and below
            check(near(mean_rgb(a, 400, 300, 0, 0, 400, 12), BLACK, 8) and near(mean_rgb(a, 400, 300, 0, 290, 400, 300), BLACK, 8), 'left: black bars above and below the turned picture')
            check(near(mean_rgb(a, 400, 300, 0, 30, 400, 270), BLUE), 'left: blue between them')
        c.hold('right', 0.8)
        a, lay = c.atlas()
        check(a is not None and near(mean_rgb(a, 400, 300, 0, 0, 400, 300), GREEN), 'right: now set to the top-right camera (green)')
        with c.cr.lock:
            n_layers = len(c.cr.layers)
        check(n_layers == 1, 'still one layer')
        # sizes the renderer cannot take are refused here, the old ones kept
        c.send(op='config', w=5000, h=10)
        time.sleep(0.3)
        check(c.status.get('layer_w') == 400, 'a size out of range is ignored')
        # a layer only while a view shows
        c.send(op='view', side='none')
        c.send(op='config', persist=0)
        check(c.wait(lambda s: s.get('layer') == 'none', 3), 'persist 0: no layer between views')
        time.sleep(0.2)
        with c.cr.lock:
            n_layers = len(c.cr.layers)
        check(n_layers == 0, 'persist 0: the renderer has none either')
        check(c.wait(lambda s: s.get('shown') == 1, 3, 'left'), 'persist 0: left shown (a layer made for it)')
        c.send(op='view', side='none')
        check(c.wait(lambda s: s.get('layer') == 'none' and s.get('shown') == 0, 3), 'persist 0: the layer is dropped with the view')
        # another target
        c.send(op='config', persist=1, target='hud', w=320, h=240, x=-1, y=-1)
        check(c.wait(lambda s: s.get('target') == 'hud' and s.get('layer_x') == 240 and s.get('layer_y') == 120, 3), 'target hud: centred in 800x480 (240,120)')
        c.send(op='config', target='nowhere')
        c.hold('left', 0.8)
        check(c.status.get('shown') == 0 and 'no target' in c.status.get('why', ''), 'a target the renderer lacks: not shown, why: %s' % c.status.get('why'))
    finally:
        c.close()


def t_half_stops():
    print('two pictures by turns, told apart by the SEI tag; then one kind stops, the other comes on')
    c = Cam('half', os.path.join(DIR, 'pairs_half.rtp'), file_mode=True, loop=False)
    try:
        c.send(op='config', pair=1)
        check(c.wait(lambda s: s.get('pair', '').startswith('sei@') and s.get('cr') == 'connected', 10), 'told apart by the SEI tag: %s' % c.status.get('pair'))
        check(c.wait(lambda s: s.get('shown') == 1, 3, 'left'), 'left: shown while both kinds come')
        t_end = time.time() + 12
        hidden_at, pics_after = None, 0
        p0 = None
        while time.time() < t_end:
            c.send(op='view', side='left')
            time.sleep(0.05)
            s = c.status
            if s.get('source_age_ms', 0) > 300 and p0 is None:
                p0 = s.get('pictures', 0)          # the second kind has stopped: pictures still come
            if p0 is not None and s.get('shown') == 0:
                hidden_at = s.get('source_age_ms')
                pics_after = s.get('pictures', 0) - p0
                break
        check(hidden_at is not None, 'hidden, not frozen, once one kind stopped')
        if hidden_at is not None:
            check(hidden_at <= 1600, 'within %s ms of the last whole picture' % hidden_at)
            p1 = c.status.get('pictures', 0)
            more = c.wait(lambda s: s.get('pictures', 0) > p1 + 5, 4, 'left')
            check(more and c.status.get('shown') == 0,
                  'the other kind still comes (%d more pictures), still hidden' % (c.status.get('pictures', 0) - p1))
        check('one of the two' in c.status.get('why', ''), 'why: %s' % c.status.get('why'))
        check(not c.cr.visible(), 'the layer is hidden (no frozen picture on the cluster)')
    finally:
        c.close()


def t_pairs():
    print('a camera unit that sends two 1280x480 pictures by turns (front|rear, left|right), as a G30 does')
    c = Cam('pairs', os.path.join(DIR, 'pairs.rtp'))
    try:
        c.send(op='config', pair=1)
        check(c.wait(lambda s: s.get('pictures', 0) > 8 and s.get('cr') == 'connected', 10), 'pictures decoded')
        check(c.status.get('picture_w') == 1280 and c.status.get('picture_h') == 480, 'each 1280x480')
        check(c.status.get('pair') == 'count', 'told apart by counting (this stream has no SEI tag): %s' % c.status.get('pair'))
        check(c.wait(lambda s: s.get('shown') == 1, 3, 'all'), 'all: shown')
        c.hold('all', 0.8)
        a, lay = c.atlas()
        if a:
            q = [mean_rgb(a, 512, 384, x0, y0, x0 + 256, y0 + 192) for (x0, y0) in ((0, 0), (256, 0), (0, 192), (256, 192))]
            check(near(q[0], RED) and near(q[1], GREEN) and near(q[2], BLUE) and near(q[3], YELLOW), 'all: the two pictures one above the other: red, green / blue, yellow %s' % (q,))
        else:
            check(False, 'all: an atlas')
        c.hold('left', 0.8)
        a, lay = c.atlas()
        check(a is not None and near(mean_rgb(a, 512, 384, 0, 0, 512, 384), BLUE), 'left: the left half of the second picture (blue), steady')
        cols = set()
        for i in range(12):
            c.hold('right', 0.1)
            a, lay = c.atlas()
            if a:
                cols.add(near(mean_rgb(a, 512, 384, 0, 0, 512, 384), YELLOW))
        check(cols == {True}, 'right: yellow in every frame over a second (no flicker between the two pictures)')
        c.send(op='config', pair_swap=1)
        c.hold('left', 0.8)
        a, lay = c.atlas()
        check(a is not None and near(mean_rgb(a, 512, 384, 0, 0, 512, 384), RED), 'pair_swap: the other picture below (left is red)')
        c.send(op='config', pair=0, pair_swap=0, all='0,0,1000,1000')
        c.hold('all', 0.8)
        check(c.status.get('pair') == 'off', 'pair 0: off (single-camera mode: each picture as it is)')
    finally:
        c.close()


def t_renderer_restart():
    print('the cluster renderer restarts while a view shows')
    c = Cam('restart', MOSAIC)
    try:
        c.wait(lambda s: s.get('pictures', 0) > 5 and s.get('cr') == 'connected', 10)
        check(c.wait(lambda s: s.get('shown') == 1, 3, 'left'), 'shown')
        c.cr.kick()
        c.hold('left', 0.3)
        t0 = time.time()
        check(c.wait(lambda s: s.get('shown') == 1 and s.get('cr') == 'connected' and bool(c.cr.visible()), 6, 'left'), 'shown again after the reconnect (%.1f s)' % (time.time() - t0))
        c.hold('left', 0.5)
        a, lay = c.atlas()
        check(a is not None and near(mean_rgb(a, 512, 384, 0, 0, 512, 384), BLUE), 'with the camera picture')
    finally:
        c.close()


def t_refused():
    print('the renderer refuses the layer (the display holds two videos already)')
    c = Cam('refused', MOSAIC, refuse=2)
    try:
        c.wait(lambda s: s.get('pictures', 0) > 5 and s.get('cr') == 'connected', 10)
        check(c.wait(lambda s: s.get('layer') == 'refused', 3), 'status says refused')
        check('too many video buffers' in c.status.get('layer_reason', ''), 'with the renderer\'s reason: %s' % c.status.get('layer_reason'))
        t0 = time.time()
        c.hold('left', 1.0)
        asks = len([e for e in c.cr.events if e[1] == 'layer'])
        check(asks <= 3, 'not asked for again in a loop (%d layer requests so far)' % asks)
        check(c.wait(lambda s: s.get('shown') == 1, 8, 'left'), 'shown once the renderer takes it (%.1f s)' % (time.time() - t0))
    finally:
        c.close()


def t_join_retry():
    print('the bus is not there yet when the program starts')
    c = Cam('join', MOSAIC, env={'SIDECAM_FAKE_AVB_FAIL': '2'})
    try:
        check(c.wait(lambda s: s.get('avb') not in (None, '', 'ok'), 3), 'status says why: %s' % c.status.get('avb'))
        check(c.wait(lambda s: s.get('avb') == 'ok' and s.get('pictures', 0) > 3, 10), 'joined on a later try, pictures decoded')
    finally:
        c.close()


def t_no_renderer():
    print('no cluster renderer at all')
    sock = os.path.join(DIR, 'cr-none.sock')
    if os.path.exists(sock):
        os.unlink(sock)
    e = dict(os.environ, SIDECAM_FAKE_AVB=MOSAIC)
    p = subprocess.Popen([LOADER, '--library-path', LIBPATH, BIN, '--socket', sock], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=e)
    try:
        st = {}
        end = time.time() + 4
        while time.time() < end:
            p.stdin.write(b'{"op":"view","side":"left"}\n')
            p.stdin.flush()
            line = p.stdout.readline()
            if line:
                st = json.loads(line.decode())
            if st.get('pictures', 0) > 5 and 'not connected' in st.get('why', ''):
                break
        check(st.get('pictures', 0) > 5 and st.get('shown') == 0 and 'not connected' in st.get('why', ''), 'decodes, shows nothing, says why: %s' % st.get('why'))
        check(p.poll() is None, 'keeps running')
    finally:
        p.stdin.close()
        p.wait(timeout=5)


for t in (t_views, t_pairs, t_half_stops, t_heartbeat, t_stall, t_late_join, t_loss, t_config, t_renderer_restart, t_refused, t_join_retry, t_no_renderer):
    t()
print('e2e: %d FAILED: %s' % (len(fails), '; '.join(fails)) if fails else 'e2e: all ok')
sys.exit(1 if fails else 0)
