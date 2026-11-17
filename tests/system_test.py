#!/usr/bin/env python3
"""The whole thing but the car: the app (tests/run_app.js runs apps/xinhan_cam/main.js as it is, with a
stand-in kit, indicator events and camera unit), the helper (tools/xinhan-cam/xinhan-cam.js), the
decoder (native/build/mgu-sidecam, the head-unit binary under this machine's loader), a made-up
four-camera stream through a fake AVB bridge and a fake cluster renderer.

  python3 tests/system_test.py          (after native/build.sh test, which makes the stream)
"""
import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'native', 'test'))
from fake_cluster_render import FakeClusterRender  # noqa: E402

T = os.path.join(ROOT, 'native', 'build', 'test')
BIN = os.path.join(ROOT, 'native', 'build', 'mgu-sidecam')
MOSAIC = os.path.join(T, 'mosaic.rtp')
fails = []


def check(ok, what):
    print(('  ok   ' if ok else '  FAIL ') + what)
    if not ok:
        fails.append(what)


def rgb_at(a, w, h, x, y):
    Y = a[y * w + x]
    U = a[w * h + (y // 2) * w + x // 2] - 128
    V = a[w * h + (y // 2) * w + w // 2 + x // 2] - 128
    c = lambda v: max(0, min(255, int(round(v))))
    return c(Y + 1.402 * V), c(Y - 0.344136 * U - 0.714136 * V), c(Y + 1.772 * U)


def colour(a, w, h, x0=0, y0=0, x1=None, y1=None):
    x1, y1 = x1 or w, y1 or h
    px = [rgb_at(a, w, h, x, y) for y in range(y0, y1, 8) for x in range(x0, x1, 8)]
    return tuple(sorted(p[i] for p in px)[len(px) // 2] for i in range(3))


def near(c, want, tol=45):
    return c is not None and all(abs(a - b) <= tol for a, b in zip(c, want))


RED, GREEN, BLUE, YELLOW = (208, 0, 0), (0, 192, 0), (0, 0, 208), (208, 208, 0)
LEFT_ON = {'statusFunctionsIndicators': {'controlIndicateDirection': 'DAUER_BLINKEN_LINKS_EIN', 'activeFunctionIndicateDirection': 'DAUERBLINKEN_LINKS'}}
RIGHT_ON = {'statusFunctionsIndicators': {'controlIndicateDirection': 'DAUER_BLINKEN_RECHTS_EIN', 'activeFunctionIndicateDirection': 'DAUERBLINKEN_RECHTS'}}
OFF = {'statusFunctionsIndicators': {'controlIndicateDirection': 'BLINKEN_AUS', 'activeFunctionIndicateDirection': 0}}
HAZARD = {'statusFunctionsIndicators': {'controlIndicateDirection': 'BEIDSEITIGES_BLINKEN_EIN', 'activeFunctionIndicateDirection': 'WARNBLINKEN_MANUELL'}}


class Rig:
    def __init__(self, name, app_env=None):
        self.dir = os.path.join(T, 'sys-' + name)
        shutil.rmtree(self.dir, ignore_errors=True)
        self.data = os.path.join(self.dir, 'oap', 'oap_1234', 'data')
        kit = os.path.join(self.dir, 'oap', 'oap_1234', 'source', 'javascript', 'kit')
        os.makedirs(self.data)
        os.makedirs(kit)
        os.makedirs(os.path.join(self.dir, 'run'))
        json.dump({'id': 'xinhan_cam', 'version': '0.0.0'}, open(os.path.join(kit, 'app-spec.json'), 'w'))
        self.sock = os.path.join(self.dir, 'cr.sock')
        self.cr = FakeClusterRender(self.sock)
        self.cr.start()
        wrapper = os.path.join(self.dir, 'mgu-sidecam')
        with open(wrapper, 'w') as f:
            f.write('#!/bin/sh\nexec /lib64/ld-linux-x86-64.so.2 --library-path %s %s "$@"\n' % (os.path.join(T, 'lib'), BIN))
        os.chmod(wrapper, 0o755)
        self.status_file = os.path.join(self.dir, 'run', 'status.json')
        self.helper_env = dict(os.environ, XINHAN_OAP=os.path.join(self.dir, 'oap'), XINHAN_RUN=os.path.join(self.dir, 'run'),
                               XINHAN_BIN=wrapper, XINHAN_ARGS='--socket ' + self.sock, XINHAN_LOG=os.path.join(self.dir, 'helper.log'),
                               SIDECAM_FAKE_AVB=MOSAIC, XINHAN_NAV=os.path.join(ROOT, 'tests', 'fake_nav.js'),
                               XINHAN_NAV_ARGS=os.path.join(self.dir, 'nav.json'))
        self.app_env = dict(os.environ, XINHAN_STATUS=self.status_file)
        self.app_env.update(app_env or {})
        self.helper = self.app = None
        self.rows, self.logs, self.ecu, self.model = {}, [], [], {}
        self.start_helper()
        self.start_app()

    def start_helper(self):
        self.helper_log = open(os.path.join(self.dir, 'helper.out'), 'a')
        self.helper = subprocess.Popen(['node', os.path.join(ROOT, 'tools', 'xinhan-cam', 'xinhan-cam.js'), 'run'], env=self.helper_env,
                                       stdout=self.helper_log, stderr=self.helper_log)

    def start_app(self):
        self.app = subprocess.Popen(['node', os.path.join(ROOT, 'tests', 'run_app.js'), self.data], env=self.app_env,
                                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        threading.Thread(target=self._read, args=(self.app,), daemon=True).start()

    def _read(self, p):
        for line in p.stdout:
            try:
                j = json.loads(line.decode())
            except ValueError:
                self.logs.append(('raw', line.decode().rstrip()))
                continue
            if 'ui' in j:
                self.rows[j['ui'][0]] = j['ui'][1]
            elif 'model' in j:
                self.model = j['model']
            elif 'log' in j:
                self.logs.append(tuple(j['log']))
            elif 'ecu' in j:
                self.ecu.append(j['ecu'])

    def cmd(self, **kw):
        self.app.stdin.write((json.dumps(kw) + '\n').encode())
        self.app.stdin.flush()

    def status(self):
        try:
            return json.load(open(self.status_file))
        except (OSError, ValueError):
            return {}

    def native(self):
        return self.status().get('native') or {}

    def wait(self, cond, secs):
        end = time.time() + secs
        while time.time() < end:
            if cond():
                return True
            time.sleep(0.02)
        return bool(cond())

    def shown(self):
        """(colour of the visible layer's newest frame, layer) or (None, None)."""
        with self.cr.lock:
            vis = [(r, l) for r, l in self.cr.layers.items() if l.get('visible', 1)]
            if len(vis) != 1 or vis[0][0] not in self.cr.frames:
                return None, None
            a, l = self.cr.frames[vis[0][0]][0], vis[0][1]
        if len(a) != l['vw'] * l['vh'] * 3 // 2:
            return None, l
        return a, l

    def shows(self, want, tol=45):
        a, l = self.shown()
        return a is not None and near(colour(a, l['vw'], l['vh']), want, tol)

    def visible(self):
        """{ target: colour of its newest frame } of the visible layers that have a whole frame."""
        out = {}
        with self.cr.lock:
            for ref, l in self.cr.layers.items():
                if not l.get('visible', 1) or ref not in self.cr.frames:
                    continue
                a = self.cr.frames[ref][0]
                if len(a) == l['vw'] * l['vh'] * 3 // 2:
                    out[l.get('target')] = colour(a, l['vw'], l['vh'])
        return out

    def nav(self, **kw):
        """What the (fake) navigation reader reports from now on."""
        with open(os.path.join(self.dir, 'nav.json.tmp'), 'w') as f:
            json.dump(kw, f)
        os.replace(os.path.join(self.dir, 'nav.json.tmp'), os.path.join(self.dir, 'nav.json'))

    def helper_said(self, text):
        try:
            return text in open(os.path.join(self.dir, 'helper.out')).read()
        except OSError:
            return False

    def control(self):
        try:
            return json.load(open(os.path.join(self.data, 'control.json')))
        except (OSError, ValueError):
            return {}

    def close(self):
        for p in (self.app, self.helper):
            if p and p.poll() is None:
                p.send_signal(signal.SIGTERM)
        for p in (self.app, self.helper):
            if p:
                try:
                    p.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    p.kill()
        self.cr.close()
        self.helper_log.close()


def t_drive():
    print('a drive: start, left, off, right, hazards, the test buttons, settings')
    r = Rig('drive')
    try:
        check(r.wait(lambda: r.native().get('pictures', 0) > 5 and r.native().get('cr') == 'connected', 15), 'the helper started the decoder; pictures decoded, renderer connected')
        c = r.control().get('config') or {}
        check(c.get('w') == 320 and c.get('h') == 320 and c.get('left_round') == 1 and c.get('left') == '0,500,375,500' and c.get('right') == '625,500,375,500' and c.get('target') == 'panel',
              'as installed: round, 320x320, the rearward part of each mirror camera, on the whole cluster')
        r.cmd(light=[0, LEFT_ON])
        ok = r.wait(lambda: r.shown()[1] is not None and r.shown()[1].get('vw') == 320 and r.shown()[0] is not None, 3)
        check(ok and r.shown()[1].get('x') == 220 and r.shown()[1].get('y') == 240, 'left signal: in the speedometer (220,240)')
        r.cmd(light=[0, RIGHT_ON])
        check(r.wait(lambda: r.shown()[1] is not None and r.shown()[1].get('x') == 1380 and r.shows(YELLOW), 3), 'right signal straight after: in the rev counter (1380,240), yellow')
        r.cmd(light=[0, LEFT_ON])
        ok = r.wait(lambda: r.shown()[1] is not None and r.shown()[1].get('x') == 220 and r.shown()[0] is not None and near(colour(r.shown()[0], 320, 320, 90, 90, 230, 230), BLUE), 3)
        a = r.shown()[0]
        check(ok and near(colour(a, 320, 320, 90, 90, 230, 230), BLUE) and near(colour(a, 320, 320, 0, 0, 32, 32), (0, 0, 0), 6)
              and near(colour(a, 320, 320, 288, 288, 320, 320), (0, 0, 0), 6), 'left signal: a blue disc, black corners')
        r.cmd(light=[0, OFF])
        r.wait(lambda: not r.cr.visible(), 4)
        r.cmd(set=['shape', 'square'])          # the rest of this drive with the whole rectangle, in the middle of the map
        r.cmd(set=['place', 'center'])
        r.cmd(set=['size', 'medium'])
        r.cmd(set=['target', 'map'])
        time.sleep(0.4)
        check(r.status().get('app') == 'xinhan_cam', 'the helper found the app')
        check(r.wait(lambda: [c[0] for c in r.ecu] == ['clientAttach', 'changeState'], 5), 'the app attached to the camera unit and asked for a view')
        if len(r.ecu) >= 2:
            check(r.ecu[0][1] == {'type': 'CLIENT_INDIRECT'} and r.ecu[1][1]['desiredState'] == {'application': 'DR_ACTIVE', 'mode': 'MODE_MOSAIK', 'perspective': 7}
                  and r.ecu[1][1]['cookie'] == 100, 'as an indirect client, DR_ACTIVE / MODE_MOSAIK / 7, with its cookie')
        time.sleep(1.5)
        check(len(r.ecu) == 2, 'and asked nothing more once the unit showed it (%d calls)' % len(r.ecu))
        check(r.control().get('view') == 'none' and not r.cr.visible(), 'nothing shown without a signal')
        c = r.control().get('config') or {}
        check(c.get('left') == '0,500,500,500' and c.get('w') == 512 and c.get('x') == 288, 'the config reached the control file (512x384 at 288, the lower quarters)')
        mtime = os.path.getmtime(os.path.join(r.data, 'control.json'))
        time.sleep(1.2)
        check(os.path.getmtime(os.path.join(r.data, 'control.json')) == mtime, 'the control file is not rewritten while nothing changes (no flash wear)')

        t0 = time.time()
        r.cmd(light=[0, LEFT_ON])
        check(r.wait(lambda: r.shows(BLUE), 3), 'left signal: the left mirror camera (blue) on the cluster')
        dt = time.time() - t0
        check(dt < 0.7, 'left signal: %.0f ms from the indicator event to the picture in the renderer' % (dt * 1000))
        time.sleep(2.5)
        check(r.shows(BLUE), 'still there 2.5 s later (the app keeps confirming it)')
        t0 = time.time()
        r.cmd(light=[0, OFF])
        time.sleep(1.5)
        check(r.shows(BLUE), 'signal off: held (still shown 1.5 s later)')
        check(r.wait(lambda: not r.cr.visible(), 2), 'signal off: gone after the 2 s hold (%.1f s)' % (time.time() - t0))

        r.cmd(light=[0, RIGHT_ON])
        check(r.wait(lambda: r.shows(YELLOW), 3), 'right signal: the right mirror camera (yellow)')
        t0 = time.time()
        r.cmd(light=[0, HAZARD])
        check(r.wait(lambda: not r.cr.visible(), 1), 'hazards: gone at once (%.0f ms)' % ((time.time() - t0) * 1000))
        r.cmd(light=[0, OFF])
        time.sleep(0.3)
        check(not r.cr.visible(), 'hazards off: nothing')

        # blinking as a car that reports each blink: on / off every 350 ms
        r.cmd(light=[1, {'activeFunctionIndicateDirection': 'TIPPBLINKEN_LINKS'}])
        seen_hidden = False
        r.wait(lambda: r.shows(BLUE), 2)
        for i in range(6):
            r.cmd(light=[1, {'activeFunctionIndicateDirection': 0}])
            time.sleep(0.35)
            seen_hidden = seen_hidden or not r.cr.visible()
            r.cmd(light=[1, {'activeFunctionIndicateDirection': 'TIPPBLINKEN_LINKS'}])
            time.sleep(0.35)
            seen_hidden = seen_hidden or not r.cr.visible()
        check(not seen_hidden and r.shows(BLUE), 'a signal reported blink by blink (second event): the picture never drops out')
        r.cmd(light=[1, {'activeFunctionIndicateDirection': 0}])
        check(r.wait(lambda: not r.cr.visible(), 4), 'and goes after it')

        # the "slower than" setting
        r.cmd(visible=True)
        r.cmd(set=['maxSpeed', '30'])
        r.cmd(speed=int(20 / 0.015625))
        r.cmd(light=[0, LEFT_ON])
        check(r.wait(lambda: r.shows(BLUE), 3), 'setting "slower than 30 km/h", at 20: shown')
        r.cmd(speed=int(60 / 0.015625))
        check(r.wait(lambda: not r.cr.visible(), 2), 'at 60: gone')
        check(r.wait(lambda: '30 km/h' in r.rows.get('ROW_STATE', ''), 2), 'the page says why: ' + r.rows.get('ROW_STATE', ''))
        r.cmd(speed=int(25 / 0.015625))
        check(r.wait(lambda: r.shows(BLUE), 2), 'at 25: back')
        r.cmd(set=['maxSpeed', '0'])
        r.cmd(light=[0, OFF])
        r.wait(lambda: not r.cr.visible(), 4)

        # the page and its buttons
        check(r.wait(lambda: 'Chờ xi nhan' in r.rows.get('ROW_STATE', '') and 'ROW_VIDEO' in r.rows, 3), 'the page shows its rows')
        print('         ' + ' | '.join(r.rows.get(k, '') for k in ('ROW_STATE', 'ROW_SIGNAL', 'ROW_CAMERA', 'ROW_VIDEO', 'ROW_CLUSTER', 'ROW_NOTE')))
        check('Chờ xi nhan' in r.rows.get('ROW_STATE', '') and '1280x960' in r.rows.get('ROW_VIDEO', '') and 'DR_ACTIVE/MODE_MOSAIK/9' in r.rows.get('ROW_CAMERA', '')
              and 'sẵn sàng' in r.rows.get('ROW_CLUSTER', ''), 'state, stream, camera unit and cluster rows say what is going on')
        r.cmd(click='BTN_ALL')
        ok = r.wait(lambda: r.shown()[0] is not None, 3)
        a, l = r.shown()
        if ok:
            q = [colour(a, 512, 384, x, y, x + 256, y + 192) for (x, y) in ((0, 0), (256, 0), (0, 192), (256, 192))]
            check(near(q[0], RED) and near(q[1], GREEN) and near(q[2], BLUE) and near(q[3], YELLOW), 'button "all four cameras": the whole picture')
        else:
            check(False, 'button "all four cameras": shown')
        check(r.wait(lambda: 'cả 4 camera' in r.rows.get('ROW_STATE', '') and r.model.get('shown') == 'all', 2), 'the page says so: ' + r.rows.get('ROW_STATE', ''))
        r.cmd(click='BTN_RIGHT')
        check(r.wait(lambda: r.shows(YELLOW), 3), 'button "right": the right camera, over the running test')
        r.cmd(set=['enabled', 'off'])
        r.cmd(click='BTN_LEFT')
        check(r.wait(lambda: r.shows(BLUE), 3), 'button "left" works with the feature switched off')
        r.cmd(light=[0, RIGHT_ON])
        time.sleep(0.5)
        check(r.shows(BLUE), 'switched off: a signal changes nothing')
        r.cmd(light=[0, OFF])
        r.cmd(set=['enabled', 'on'])

        # settings while driving
        r.cmd(set=['quadLeft', 'tl'])
        r.cmd(set=['size', 'large'])
        r.cmd(light=[0, LEFT_ON])
        ok = r.wait(lambda: r.shown()[1] is not None and r.shown()[1].get('vw') == 640 and r.shows(RED), 4)
        check(ok, 'settings: left camera = top-left quarter, large: 640x480, red')
        r.cmd(set=['rotLeft', '90'])
        ok = r.wait(lambda: r.shown()[1] is not None and r.shown()[1].get('vw') == 640 and r.shown()[0] is not None
                    and near(colour(r.shown()[0], 640, 480, 0, 0, 120, 480), (0, 0, 0), 8) and near(colour(r.shown()[0], 640, 480, 200, 0, 440, 480), RED), 4)
        check(ok, 'settings: turned 90 degrees while shown: a 360x480 picture between black bars')
        r.cmd(light=[0, OFF])
        # the Position page: the side being placed shows live; buttons and taps move it
        r.cmd(set=['shape', 'round']); r.cmd(set=['place', 'gauge']); r.cmd(set=['size', 'fit']); r.cmd(set=['quadLeft', 'bl']); r.cmd(set=['rotLeft', '0'])
        r.cmd(tab=1)
        check(r.wait(lambda: r.shown()[1] is not None and r.shown()[1].get('x') == 220 and r.shows(BLUE, 60), 4), 'Position page: the left camera shows on the cluster by itself, in the speedometer')
        time.sleep(3.0)
        check(r.shown()[1] is not None and r.model.get('note') == 'Đang hiện trên đồng hồ', 'and stays for as long as the page is open')
        r.cmd(act='moveRight'); r.cmd(act='moveRight'); r.cmd(act='down')
        check(r.wait(lambda: r.shown()[1] is not None and r.shown()[1].get('x') == 240 and r.shown()[1].get('y') == 250, 4), 'buttons: 20 towards the middle, 10 down: the layer moves (240,250)')
        check(r.model.get('discs', {}).get('left', {}).get('x') == 240 and r.model['discs']['right']['x'] == 1920 - 240 - 320, 'the picture on the page follows, mirrored for the right side')
        r.cmd(act='side')
        check(r.wait(lambda: r.shown()[1] is not None and r.shown()[1].get('x') == 1360 and r.shows(YELLOW, 60), 4), 'button "side": the right camera shows, in the rev counter, with the same offsets')
        # a tap at the picture's (1500,300) cluster point: PICS[1] is at 56,92 scaled 0.5
        r.cmd(tap=[56 + 1500 * 0.5, 92 + 300 * 0.5])
        check(r.wait(lambda: r.shown()[1] is not None and r.shown()[1].get('x') == 1340 and r.shown()[1].get('y') == 140, 4), 'a tap on the picture: the view\'s middle goes there (1500,300)')
        r.cmd(act='larger')
        check(r.wait(lambda: r.shown()[1] is not None and r.shown()[1].get('vw') == 384, 4), 'button "larger": 384')
        r.cmd(act='reset')
        check(r.wait(lambda: r.shown()[1] is not None and r.shown()[1].get('vw') == 320 and r.shown()[1].get('x') == 1380 and r.shown()[1].get('y') == 240, 4), 'button "default": back in the dial\'s middle, 320')
        r.cmd(tab=0)
        check(r.wait(lambda: not r.cr.visible(), 4), 'leaving the page: the view goes')

        # the front camera in the middle of the cluster (the "front" setting), and a turn signal over it
        r.cmd(speed=int(20 / 0.015625))
        r.cmd(set=['front', 'slow30'])
        ok = r.wait(lambda: r.shown()[1] is not None and r.shown()[1].get('target') == 'map' and r.shown()[1].get('vw') == 960 and r.shows(RED), 4)
        check(ok, 'front camera below 30 km/h, at 20: the front camera (red) 960x432 on the map area')
        check(r.wait(lambda: r.model.get('shown') == 'front' and r.model.get('frontRect') is not None, 2), 'the page shows it')
        r.cmd(light=[0, RIGHT_ON])
        check(r.wait(lambda: r.shown()[1] is not None and r.shown()[1].get('target') == 'panel' and r.shows(YELLOW, 60), 4), 'right signal: the right mirror camera takes over, in the rev counter')
        r.cmd(light=[0, OFF])
        check(r.wait(lambda: r.shown()[1] is not None and r.shown()[1].get('target') == 'map' and r.shows(RED), 6), 'signal off: the front camera is back')
        r.cmd(speed=int(45 / 0.015625))
        check(r.wait(lambda: not r.cr.visible(), 3), 'at 45 km/h: gone')
        r.cmd(set=['front', 'always'])
        check(r.wait(lambda: r.shows(RED), 4), 'front camera "always": shown at any speed')
        r.cmd(light=[0, HAZARD])
        time.sleep(0.6)
        check(r.shows(RED), 'hazards: the front camera stays')
        r.cmd(light=[0, OFF])
        r.cmd(set=['front', 'off'])
        check(r.wait(lambda: not r.cr.visible(), 3), 'front camera off: gone')
        # the Calibrate page: the camera being set shows; the mirror cameras' part moves, the front camera gets its marks
        r.cmd(speed=0)
        r.cmd(tab=2)
        check(r.wait(lambda: r.shown()[1] is not None and r.shows(BLUE, 60) and (r.control().get('config') or {}).get('left') == '0,500,375,500', 4), 'Calibrate page: the left mirror camera shows')
        r.cmd(act='panR'); r.cmd(act='panR'); r.cmd(act='panU'); r.cmd(act='zoomIn')
        check(r.wait(lambda: (r.control().get('config') or {}).get('left') == '20,513,341,455', 3), 'its part moves right and up and is enlarged: ' + str((r.control().get('config') or {}).get('left')))
        r.cmd(act='calReset')
        check(r.wait(lambda: (r.control().get('config') or {}).get('left') == '0,500,375,500', 3), '"default" puts it back')
        r.cmd(act='camF')
        check(r.wait(lambda: r.shown()[1] is not None and r.shown()[1].get('target') == 'map' and (r.control().get('ar') or {}).get('mode') == 'marks', 4), 'front camera: shown, with the calibration marks asked for')
        check(r.wait(lambda: r.helper_said('ar: marks'), 3), 'the decoder draws them')
        r.cmd(act='calH+'); r.cmd(act='calPitch-'); r.cmd(act='frontZoom+')
        ok = r.wait(lambda: (r.control().get('ar') or {}).get('height_cm') == 75 and r.control()['ar'].get('pitch_x10') == 70 and (r.control().get('config') or {}).get('front') == '23,114,455,273', 3)
        check(ok, 'height +5 cm, tilt -1 degree, zoom +10 %%: %s %s' % (r.control().get('ar'), (r.control().get('config') or {}).get('front')))
        r.cmd(act='calReset')
        r.cmd(tab=0)
        check(r.wait(lambda: not r.cr.visible() and r.helper_said('ar: off'), 4), 'leaving the page: gone, marks off')

        # the navigation's next turn on the front camera ("ar: near", the default)
        r.cmd(speed=int(36 / 0.015625))
        r.nav(active=True, kind='turn', angle=90, meters=600, exit=0, provider='ANDROID_AUTO', state='INACTIVE')
        check(r.wait(lambda: ((r.status().get('nav') or {}).get('last') or {}).get('meters') == 600, 4), 'the helper reads the navigation (the app asks it to): a turn 600 m ahead')
        time.sleep(0.5)
        check(not r.cr.visible(), 'too far yet: nothing shown')
        r.nav(active=True, kind='turn', angle=90, meters=180, exit=0, provider='ANDROID_AUTO', state='INACTIVE')
        check(r.wait(lambda: r.shows(RED) and (r.control().get('ar') or {}).get('mode') == 'route' and r.helper_said('ar: route'), 5), '180 m before the turn: the front camera with the route on it')
        check(r.control()['ar'].get('speed') == 35 or r.control()['ar'].get('speed') == 40, 'the car\'s speed goes along, for counting the turn nearer: %s' % r.control()['ar'].get('speed'))
        r.cmd(set=['blinkFront', 'mirror'])
        r.cmd(light=[0, LEFT_ON])
        check(r.wait(lambda: r.shown()[1] is not None and r.shown()[1].get('target') == 'panel' and r.shows(BLUE, 60), 4), '"mirror camera only", left signal: the left mirror camera takes over')
        r.cmd(light=[0, OFF])
        check(r.wait(lambda: r.shown()[1] is not None and r.shown()[1].get('target') == 'map' and r.shows(RED), 6), 'signal off: the route again')
        # both at once (the default): the front camera stays in the middle, the mirror camera in its dial
        r.cmd(set=['blinkFront', 'nav'])
        r.cmd(light=[0, RIGHT_ON])
        def both():
            v = r.visible()
            return len(v) == 2 and near(v.get('map', (0, 0, 0)), RED, 45) and near(v.get('panel', (0, 0, 0)), YELLOW, 60)
        check(r.wait(both, 5), 'right signal with the route on: the front camera (map area) and the right mirror camera (its dial) together: %s' % r.visible())
        check((r.control().get('aux') or {}).get('x') == 1380 and r.control().get('view') == 'front' and r.native().get('aux_shown') == 1, 'the second view sits where the mirror camera does alone')
        r.cmd(light=[0, OFF])
        check(r.wait(lambda: list(r.visible().keys()) == ['map'] and r.native().get('aux') == 'none', 6), 'signal off: the mirror camera goes, the route stays')
        # the display has no room for a second video: the mirror camera alone, as without the setting
        r.cr.refuse_layers = 1
        r.cmd(light=[0, LEFT_ON])
        check(r.wait(lambda: list(r.visible().keys()) == ['panel'] and near(r.visible()['panel'], BLUE, 60) and r.control().get('view') == 'left', 8), 'the renderer refuses the second layer: the left mirror camera alone')
        r.cmd(light=[0, OFF])
        check(r.wait(lambda: list(r.visible().keys()) == ['map'], 6), 'signal off: the route again')
        time.sleep(15.5)                                    # the refusal is remembered for 15 s
        r.nav(active=False, kind=None, angle=0, meters=-1, exit=0, provider='', state='INACTIVE')
        check(r.wait(lambda: not r.cr.visible(), 4), 'the turn is done, no next one: gone')
        r.nav(active=True, kind='roundabout', angle=0, meters=900, exit=2, provider='NONE', state='ACTIVE')
        r.cmd(set=['ar', 'always'])
        check(r.wait(lambda: r.shows(RED) and (r.control().get('ar') or {}).get('mode') == 'route', 5), '"always": shown for the whole route')
        r.cmd(set=['ar', 'off'])
        check(r.wait(lambda: not r.cr.visible() and (r.status().get('nav') or {}).get('wanted') is False, 4), '"off": gone, and the navigation is no longer read')
        r.cmd(tab=3)
        r.cmd(act='demo')
        check(r.wait(lambda: r.shows(RED) and (r.control().get('ar') or {}).get('mode') == 'demo', 5), 'Navigation page, "demo": the front camera with a made-up turn')
        r.cmd(act='demo')
        check(r.wait(lambda: not r.cr.visible(), 4), 'pressed again: gone')
        r.cmd(tab=0)
        errors = [l for l in r.logs if l[0] in ('error', 'raw')]
        check(not errors, 'no errors in the app\'s log %s' % errors[:3])
    finally:
        r.close()


def t_parking_and_single():
    print('a parking view; the single-camera mode; a camera unit that takes numbers only')
    r = Rig('single', app_env={'ECU_NAMES': '0'})
    try:
        r.wait(lambda: r.native().get('pictures', 0) > 5 and len(r.ecu) >= 2, 15)
        calls = [c[0] for c in r.ecu]
        check(calls[:4] == ['clientAttach', 'clientAttach', 'changeState', 'changeState'], 'names refused: attach and request sent again as numbers %s' % calls[:4])
        check(r.ecu[1][1] == {'type': 1} and r.ecu[3][1]['desiredState'] == {'application': 51, 'mode': 50, 'perspective': 7}, 'CLIENT_INDIRECT 1, DR_ACTIVE 51, MODE_MOSAIK 50')
        r.cmd(visible=True)
        r.cmd(ecu={'application': 'RFK', 'mode': 'x', 'perspective': 1})      # reverse: the rear view camera on the centre screen
        time.sleep(2.5)
        r.cmd(light=[0, LEFT_ON])
        time.sleep(1.0)
        check(not r.cr.visible(), 'parking view on: the signal shows nothing')
        check(r.wait(lambda: 'camera đỗ xe' in r.rows.get('ROW_STATE', ''), 2), 'the page says why: ' + r.rows.get('ROW_STATE', ''))
        n = len(r.ecu)
        r.cmd(ecu={'application': 'OFF', 'mode': 'x', 'perspective': 0})        # the parking view closed
        check(r.wait(lambda: r.shows(BLUE), 8), 'parking view closed: the app gets the cameras back and shows the left one')
        check(len(r.ecu) > n, 'by asking the unit again')
        r.cmd(light=[0, OFF])
        r.wait(lambda: not r.cr.visible(), 4)

        r.cmd(set=['mode', 'single'])
        time.sleep(0.5)
        n = len(r.ecu)
        r.cmd(light=[0, RIGHT_ON])
        check(r.wait(lambda: any(c[0] == 'changeState' and c[1]['desiredState']['perspective'] == 4 for c in r.ecu[n:]), 2), 'single mode, right signal: the unit is asked for the right camera (4)')
        check(r.wait(lambda: r.shown()[0] is not None, 3), 'shown once the unit says it is on')
        check((r.control().get('config') or {}).get('right') == '625,0,375,1000', 'as the rearward part of that camera\'s picture (round)')
        r.cmd(light=[0, OFF])
        check(r.wait(lambda: not r.cr.visible(), 4), 'signal off: gone')
        check(r.wait(lambda: r.ecu[-1][0] == 'changeState' and r.ecu[-1][1]['desiredState']['perspective'] == 7, 3), 'and the unit is given back the four-camera view (7)')
        n = len(r.ecu)
        r.cmd(shutdown=True)
        check(r.wait(lambda: any(c[0] == 'clientDetach' for c in r.ecu[n:]), 2), 'the app stopping: it detaches from the camera unit')
    finally:
        r.close()


def t_failures():
    print('things going away: the app, the decoder, the helper')
    r = Rig('failures')
    try:
        r.wait(lambda: r.native().get('pictures', 0) > 5 and len(r.ecu) >= 2, 15)
        r.cmd(light=[0, LEFT_ON])
        check(r.wait(lambda: r.shows(BLUE), 3), 'shown')
        t0 = time.time()
        r.app.kill()                                             # the app dies with the camera on
        check(r.wait(lambda: not r.cr.visible(), 5), 'the app killed: the picture goes by itself (%.1f s)' % (time.time() - t0))
        check(time.time() - t0 < 3.5, 'within 3.5 s')
        r.start_app()
        r.wait(lambda: len(r.rows) >= 0 and r.control().get('view') == 'none', 3)
        r.cmd(light=[0, RIGHT_ON])
        check(r.wait(lambda: r.shows(YELLOW), 4), 'the app started again: works again')

        pid = None
        for line in open(os.path.join(r.dir, 'helper.out')):
            if 'mgu-sidecam started (pid ' in line:
                pid = int(line.split('pid ')[1].split(')')[0])
        os.kill(pid, signal.SIGKILL)                             # the decoder dies (the wrapper execs it: same pid)
        check(r.wait(lambda: not r.cr.visible(), 3), 'the decoder killed: the renderer drops its layer')
        check(r.wait(lambda: r.shows(YELLOW), 12), 'the helper starts it again and the view is back (signal still on)')
        r.cmd(light=[0, OFF])
        r.wait(lambda: not r.cr.visible(), 4)

        r.helper.send_signal(signal.SIGTERM)                     # the tool is updated or removed
        r.helper.wait(timeout=5)
        r.cmd(visible=True)
        check(r.wait(lambda: 'chưa chạy' in r.rows.get('ROW_VIDEO', ''), 6), 'the helper stopped: the page says so: ' + r.rows.get('ROW_VIDEO', '')[:50])
        r.cmd(light=[0, LEFT_ON])
        time.sleep(0.5)
        check(r.control().get('view') == 'none', 'and the app asks for no view')
        r.start_helper()
        check(r.wait(lambda: r.shows(BLUE), 15), 'the helper back: the view shows (signal still on)')
    finally:
        r.close()


for t in (t_drive, t_parking_and_single, t_failures):
    t()
print('system_test: %d FAILED: %s' % (len(fails), '; '.join(fails)) if fails else 'system_test: all ok')
sys.exit(1 if fails else 0)
