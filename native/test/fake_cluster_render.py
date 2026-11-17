#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""A stand-in for the cluster render service, for mgu-sidecam's tests: speaks
its protocol (u32 length | u8 type | body) on a unix socket, answers hello,
says every layer is shown, and records what the client did.

  server = FakeClusterRender(path, refuse_layers=0); server.start()
  server.events   [(seconds, kind, dict)]: 'layer', 'set', 'drop', 'frame', 'hello'
  server.frames   {ref: (bytes, frame id)} the newest frame per layer
"""
import json
import os
import socket
import struct
import threading
import time


class FakeClusterRender(threading.Thread):
    def __init__(self, path, refuse_layers=0, targets='map:1088x480,panel:1920x720,hud:800x480'):
        super().__init__(daemon=True)
        self.path, self.targets, self.refuse_layers = path, targets, refuse_layers
        self.events, self.frames, self.layers = [], {}, {}
        self.lock = threading.Lock()
        self.t0 = time.time()
        self.conn = None
        self.stop_flag = False
        if os.path.exists(path):
            os.unlink(path)
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.bind(path)
        self.sock.listen(2)

    def send(self, conn, obj):
        body = json.dumps(obj).encode()
        conn.sendall(struct.pack('<IB', len(body) + 1, ord('J')) + body)

    def note(self, kind, d):
        with self.lock:
            self.events.append((time.time() - self.t0, kind, d))

    def kick(self):
        """Drops the client, as a restart of the service does."""
        c = self.conn
        if c:
            try:
                c.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def run(self):
        while not self.stop_flag:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            self.conn = conn
            with self.lock:
                self.layers = {}
            buf = b''
            try:
                while True:
                    d = conn.recv(1 << 20)
                    if not d:
                        break
                    buf += d
                    while len(buf) >= 5:
                        n = struct.unpack('<I', buf[:4])[0]
                        if len(buf) < 4 + n:
                            break
                        typ, body = buf[4:5], buf[5:4 + n]
                        buf = buf[4 + n:]
                        if typ == b'J':
                            self.on_json(conn, json.loads(body.decode()))
                        elif typ == b'F':
                            ref, fid, rects = struct.unpack('<IQH', body[:14])
                            px = body[14 + rects * 8:]
                            with self.lock:
                                self.frames[ref] = (px, fid)
                            self.note('frame', {'ref': ref, 'id': fid, 'bytes': len(px)})
            except OSError:
                pass
            finally:
                conn.close()
                self.conn = None
                self.note('disconnect', {})

    def on_json(self, conn, j):
        op = j.get('op')
        if op == 'hello':
            self.note('hello', j)
            self.send(conn, {'ev': 'hello', 'proto': 1, 'backend': 'id7', 'targets': self.targets, 'repeat': 1})
        elif op == 'layer':
            self.note('layer', j)
            # refuse_vw: every layer whose video is that wide, for as long as it is set
            if getattr(self, 'refuse_vw', 0) == j.get('vw') or self.refuse_layers > 0:
                if getattr(self, 'refuse_vw', 0) != j.get('vw'):
                    self.refuse_layers -= 1
                self.send(conn, {'ev': 'error', 'op': 'layer', 'ref': j['ref'], 'reason': 'too many video buffers on the display'})
                return
            with self.lock:
                self.layers[j['ref']] = dict(j)
            self.send(conn, {'ev': 'target', 'target': j.get('target'), 'state': 'shown', 'holder': '', 'reason': ''})
            self.send(conn, {'ev': 'layer', 'ref': j['ref'], 'state': 'shown' if j.get('visible', 1) else 'hidden', 'reason': ''})
        elif op == 'set':
            self.note('set', j)
            with self.lock:
                if j['ref'] in self.layers:
                    self.layers[j['ref']].update(j)
            self.send(conn, {'ev': 'layer', 'ref': j['ref'], 'state': 'shown' if j.get('visible', 1) else 'hidden', 'reason': ''})
        elif op == 'drop':
            self.note('drop', j)
            with self.lock:
                self.layers.pop(j['ref'], None)
        elif op == 'repeat':
            self.note('repeat', j)

    def visible(self):
        with self.lock:
            return [r for r, l in self.layers.items() if l.get('visible', 1)]

    def close(self):
        self.stop_flag = True
        self.kick()
        self.sock.close()
