'use strict';
/**
 * Camera xi nhan - the mirror camera of the side whose turn signal is on, in the instrument cluster.
 *
 * This app is the part that knows the car: it reads the turn signals and the speed, keeps the camera
 * unit in the mode whose stream holds the mirror cameras (camera.js), and decides from moment to
 * moment which view is wanted (logic.js). The picture itself is the root tool xinhan-cam's
 * (tools/xinhan-cam, installed with the app): it receives the camera stream, decodes it and draws the
 * view through the cluster renderer.
 *
 *   this app  -> data/control.json   { at, seq, view: 'none'|'left'|'right'|'all', config: {...} }
 *                written when it changes, and twice a second while a view is wanted (the tool drops a
 *                view that is not confirmed for 2 s: an app that stopped never leaves a camera on)
 *   the tool  -> /run/xinhan-cam/status.json   what the stream, the decoder and the cluster say
 *
 * Starts with the head unit and keeps running in the background (app.json "startType": "autostart").
 * Its screen (ui.js) shows the state on a picture of the cluster, has buttons to try each view, and a
 * Position page where the view is placed by hand while it shows live on the cluster.
 * Node 8.
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const { Canvas } = require('./kit/canvas');
const L = require('./logic');
const camera = require('./camera');
const UI = require('./ui');

const STATUS = process.env.XINHAN_STATUS || '/run/xinhan-cam/status.json';
const STATUS_STALE_MS = 4000;       // the tool writes at least once a second
const SPEED_STALE_MS = 8000;        // statusCarSpeed2 polls every 1 s with a 3 s timeout; steady cruise must not drop speed to null
const TICK_MS = 100;
const HEARTBEAT_MS = 500;
const CAM_TICK_MS = 500;
const CAM_IDLE_MS = 1500;
const CAM_CACHE_MS = 8000;          // keep last good XView3D / ICAM2 state across a single SOME/IP timeout
const BLINKER_MAX_MS = 120000;      // stationary ceiling (2 min) if an "off" event was missed
const BLINKER_TIP_MAX_MS = 6000;    // 3-blink / 5-blink comfort tap safety ceiling (6 s)
const BLINKER_MAX_KM = 0.35;        // moving safety ceiling: 350 m + 20 s without a new indicator event
const BLINKER_MOVE_MS = 20000;
const AR_HOLD_MS = 3500;
const FRONT_HOLD_MS = 1500;
const IF = {
    light: 'de.bmw.body.Light',
    speed: 'de.bmw.infotainment.vehicle.Vehicle2',
    gear: 'de.bmw.infrastructure.VehicleInformation',
    icam: 'de.bmw.infotainment.video.cameraproxy.ICAM2Proxy',
    cam: 'de.bmw.infotainment.video.cameraproxy.CameraProxy',
    xv: 'de.bmw.dass.XView3D',
};
const WIRE = { CLIENT_INDIRECT: 1, DR_ACTIVE: 51, MODE_MOSAIK: 50 };
const errText = (e) => String(e && e.message || e).slice(0, 120);

// the decoder's reasons for not showing a view, as the screen says them
const WHY_VI = {
    'no camera picture yet': 'chưa có hình từ hộp camera',
    'the camera pictures stopped': 'hình camera đã ngừng (đã ẩn, không để hình đứng)',
    'one of the two camera pictures stopped': 'một trong hai nhóm hình camera ngừng đến (đã ẩn, không để hình đứng)',
    'the cluster renderer is not connected': 'chưa nối được bộ vẽ đồng hồ',
    'the app stopped asking': 'app ngừng yêu cầu',
    'no view asked for': 'chưa yêu cầu camera nào',
    'the setting changed': 'đang đổi cài đặt',
};

mgu.run({
    async start(ctx) {
        const { ui, settings, log, signals } = ctx;
        // The control file goes to a folder in RAM the helper makes for the app (/run/xinhan-cam/app): it is
        // rewritten twice a second while a view shows, which on the head unit's flash would wear it for nothing.
        // Without that folder (a helper older than 0.7.0, or not up yet) the app's data folder, as before.
        const RUN_DIR = path.join(path.dirname(STATUS), 'app');
        let runOk = false, runTriedAt = -1e9;
        // (tried again every 2 s once the helper has made it, as at a start where the app comes up first; else every 30 s)
        const ctlDir = (now) => (runOk || now - runTriedAt >= 30000 || (now - runTriedAt >= 2000 && fs.existsSync(RUN_DIR)) ? RUN_DIR : ctx.dataDir);
        // write a file into the control folder: RAM when it can, else the data folder; returns the folder used
        function put(name, data, now) {
            const dir = ctlDir(now);
            if (dir === RUN_DIR) {
                try {
                    fs.writeFileSync(path.join(dir, name + '.tmp'), data);
                    fs.renameSync(path.join(dir, name + '.tmp'), path.join(dir, name));
                    if (!runOk) { runOk = true; log.info('control file in RAM: ' + dir); dropOld(); }
                    return dir;
                } catch (e) {
                    if (runOk || runTriedAt < 0) log.info('control file in the data folder (' + errText(e) + ')');
                    runOk = false;
                    runTriedAt = now;
                }
            }
            fs.writeFileSync(path.join(ctx.dataDir, name + '.tmp'), data);
            fs.renameSync(path.join(ctx.dataDir, name + '.tmp'), path.join(ctx.dataDir, name));
            return ctx.dataDir;
        }
        // once the RAM folder works, what an earlier version left in the data folder goes
        function dropOld() { ['control.json', 'label.bin'].forEach((f) => { try { fs.unlinkSync(path.join(ctx.dataDir, f)); } catch (e) { /* none */ } }); }
        // the settings the page's Position tab keeps besides the listed ones: where in the dial the view sits
        const EXTRA = ['gaugeDx', 'gaugeDy', 'panLx', 'panLy', 'panRx', 'panRy', 'zoomL', 'zoomR'].concat(Object.keys(L.CALIB));
        // a drag on the Position page in progress: where the view is now (saved when the finger comes up)
        let dragPos = null, reverse = false;
        const nightAt = (now) => { const h = new Date(now).getHours(); return h >= 18 || h < 6; };
        const cfg = (now) => {
            const o = {};
            settings.schema.forEach((s) => { o[s.key] = settings.get(s.key); });
            EXTRA.forEach((k) => { o[k] = settings.get(k); });
            if (o.nightRim === 'dim' || o.nightRim === 'bright') o.night = nightAt(now || Date.now());
            // (a drag whose finger's lift never came: forgotten after 10 s still)
            if (dragPos && Date.now() - dragPos.at > 10000) dragPos = null;
            if (dragPos) { o.gaugeDx = dragPos.dx; o.gaugeDy = dragPos.dy; o.place = 'gauge'; }
            return o;
        };

        /* ---- the turn signals ---- */
        const blinker = L.createBlinker({ maxMs: BLINKER_MAX_MS, tipMaxMs: BLINKER_TIP_MAX_MS, maxKm: BLINKER_MAX_KM, moveMaxMs: BLINKER_MOVE_MS });
        const applyBlinker = () => blinker.configure({
            holdMs: (Number(settings.get('hold')) || 2) * 1000,
            tip: settings.get('tip') !== 'off',
            maxMs: BLINKER_MAX_MS,
            tipMaxMs: BLINKER_TIP_MAX_MS,
            maxKm: BLINKER_MAX_KM,
            moveMaxMs: BLINKER_MOVE_MS,
        });
        applyBlinker();
        let lightState = 'Đang kết nối', lightEvents = 0, lastRaw = ['-', '-'], lastDir = [null, null], stream0OffAt = -1e9, stream0OffDir = null;
        const onLight = (index, value) => {
            const now = Date.now();
            const ev = L.decode(value);
            lightEvents++;
            const rawSame = ev.raw === lastRaw[index];
            if (!rawSame) { lastRaw[index] = ev.raw; log.info('indicators ' + (index + 1) + ': ' + ev.raw + ' -> ' + (ev.direction || '-')); }
            // An unchanged indicator subfield while a view/hold is active means another light field in the struct notified:
            // never let it clear offAt and resurrect a cancelled blinker.
            if (rawSame && blinker.side(now) !== null) return;
            if (index === 0) {
                if (ev.direction === 'OFF' && (lastDir[0] === 'LEFT' || lastDir[0] === 'RIGHT')) { stream0OffAt = now; stream0OffDir = lastDir[0]; }
                else if (ev.direction === 'LEFT' || ev.direction === 'RIGHT') { stream0OffAt = -1e9; stream0OffDir = null; }
            } else if (ev.direction === stream0OffDir && lastDir[0] === 'OFF' && now >= stream0OffAt && now - stream0OffAt < 350) {
                lastDir[1] = ev.direction;
                return;
            }
            if (ev.direction) lastDir[index] = ev.direction;
            blinker.event(ev.direction, ev.kind, now);
            tick();
        };
        signals.watch(IF.light, '1', {
            StatusFunctionsIndicators: (v) => onLight(0, v),
            StatusFunctionsIndicators2: (v) => onLight(1, v),
        }, log).then((sub) => { lightState = sub.error ? 'Lỗi: ' + errText(sub.error) : 'Đã kết nối'; })
            .catch((e) => { lightState = 'Lỗi: ' + errText(e); });

        /* ---- the speed (the speed limit, the front camera below 30 / 60, the route's distance, missed-off distance cap) ---- */
        let speed = null, speedAt = 0;
        signals.watch(IF.speed, '1', {
            statusCarSpeed2: (v) => {
                const raw = v && v.speedVehicleCentreOfGravity;
                if (!Number.isFinite(raw) || raw === 65535) return;
                const now = Date.now();
                speed = raw * 0.015625;             // BMW's scaling, km/h
                speedAt = now;
                blinker.travel(speed, now);
            },
        }, log, { pollMs: 1000 })
            .then((sub) => { if (sub.error) log.warn('speed: ' + sub.error); }).catch((e) => log.warn('speed: ' + e));

        /* ---- reverse gear (instant detach so the rear-view camera never waits) ---- */
        const onGear = (v) => {
            const r = L.decodeReverse(v);
            if (r !== null && r !== reverse) { reverse = r; log.info('reverse gear: ' + (r ? 'on' : 'off')); tick(); }
        };
        signals.watch(IF.gear, '1', { statusGearboxDrive: onGear, DataPowerTrain2: onGear }, log)
            .then((sub) => { if (sub.error) log.info('gearbox: ' + sub.error); }).catch((e) => log.info('gearbox: ' + e));

        /* ---- the camera unit ---- */
        const px = {}, link = {}, tries = {}, camCache = {};
        const connect = (name) => {
            if (px[name] || link[name] === 'connecting') return;
            link[name] = 'connecting';
            tries[name] = (tries[name] || 0) + 1;
            Promise.resolve().then(() => signals.proxy(IF[name], '1'))
                .then((p) => { px[name] = p; link[name] = 'ok'; log.info(name + ' connected'); },
                    (e) => {
                        const why = errText(e);
                        if (tries[name] === 1) log.warn(name + ': ' + why + ' (tried again every 30 s, then every 5 min)');
                        link[name] = why;
                        setTimeout(() => connect(name), tries[name] < 10 ? 30000 : 300000);
                    });
        };
        ['icam', 'xv'].forEach(connect);
        const get = (name, field) => (px[name] ? Promise.resolve().then(() => px[name].getValue(field, 3000)).then((v) => {
            if (v !== undefined) camCache[name] = { v, at: Date.now() };
            return v;
        }, () => {
            const c = camCache[name];
            return c && Date.now() - c.at < CAM_CACHE_MS ? c.v : undefined;
        }) : Promise.resolve(undefined));
        // enum arguments by name (as the getters return them); a proxy that refuses names gets the wire numbers
        const named = (fn, byName, byNumber) => Promise.resolve().then(() => fn(byName))
            .catch((e) => { log.info('camera: names refused (' + errText(e) + '), trying numbers'); return fn(byNumber); });
        // clientAttach / clientDetach are the base interface's (CameraProxy). On the car ICAM2Proxy serves them;
        // only if it refuses is CameraProxy itself connected and tried (from the next ask on)
        const camCall = (method, args) => {
            if (!px.icam && !px.cam) return Promise.reject(new Error('the camera service is not connected'));
            const first = px.icam || px.cam;
            return signals.call(first, method, args, 10000).catch((e) => {
                if (px.cam && first !== px.cam) return signals.call(px.cam, method, args, 10000);
                connect('cam');
                throw e;
            });
        };
        const cam = camera.create({
            log,
            io: {
                read: () => Promise.all([get('xv', 'CurrentState'), get('icam', 'currentState')]).then((r) => ({ xv: r[0], icam: r[1] })),
                attach: () => named((a) => camCall('clientAttach', a), { type: 'CLIENT_INDIRECT' }, { type: WIRE.CLIENT_INDIRECT })
                    .then((r) => (r && typeof r === 'object' ? r.cookie : r)),
                request: (cookie, perspective) => {
                    if (!px.icam) return Promise.reject(new Error('the camera service is not connected'));
                    const st = (a, m) => ({ cookie, desiredState: { application: a, mode: m, perspective } });
                    return named((a) => signals.call(px.icam, 'changeState', a, 10000), st('DR_ACTIVE', 'MODE_MOSAIK'), st(WIRE.DR_ACTIVE, WIRE.MODE_MOSAIK));
                },
                detach: (cookie) => camCall('clientDetach', { cookie }),
            },
        });

        /* ---- the tool's status ---- */
        let status = null, statusReadAt = 0;
        const readStatus = (now) => {
            if (now - statusReadAt < 200) return status;
            statusReadAt = now;
            try {
                const s = JSON.parse(fs.readFileSync(STATUS, 'utf8'));
                status = now - Date.parse(s.at) < STATUS_STALE_MS ? s : null;
            } catch (e) { status = null; }
            return status;
        };

        /* ---- the decision, ten times a second and on every indicator event ---- */
        let test = null, testUntil = 0;
        let page = 0, edit = 'left', calCam = 'left';
        let lastControl = '', lastWriteAt = 0, seq = 0;
        let lastPlan = { view: 'none', why: 'Đang khởi động', want: null }, lastSide = null;
        let camTickAt = 0, lastWant, lastBusy, auxRefusedAt = -1e9, auxReason = '', arHoldUntil = 0, arLatched = false, frontHoldUntil = 0, frontLatched = false;
        const writeControl = (view, config, ar, aux, now) => {
            const body = JSON.stringify({ view, config, ar, aux });
            const active = view !== 'none';
            if (body === lastControl && !(active && now - lastWriteAt >= HEARTBEAT_MS)) return;
            if (body !== lastControl) seq++;
            lastControl = body;
            lastWriteAt = now;
            try {
                const dir = put('control.json', JSON.stringify({ at: new Date(now).toISOString(), seq, view, config, ar, aux }), now);
                // the road's name drawn for another folder: drawn again into this one
                if (streetPic && streetPic.dir !== dir) labelFor = null;
            } catch (e) { log.warn('control file: ' + errText(e)); }
        };
        // the road's name for the turn card, drawn here (the kit's letters have every Vietnamese mark) into
        // label.bin beside the control file, which the helper hands to the decoder: one byte a pixel, 0 nothing to 255 white
        let labelFor = null, streetPic = null, labelSeq = 0;
        function streetLabel(street, s) {
            const size = s.frontSize === 'small' ? 15 : 19;
            const key = street + '|' + size;
            if (key === labelFor) return streetPic;
            labelFor = key;
            streetPic = null;
            try {
                const probe = new Canvas(8, 8);
                const tw = Math.ceil(probe.textWidth(street, size, { literal: true, font: 'bold' }));
                const w = Math.min(640, (tw + 16 + 3) & ~3), h = (size + 12) & ~1;
                const cv = new Canvas(w, h);
                cv.clear('#000000');
                cv.text(street, w / 2, Math.round(h / 2 + size * 0.36), size, '#ffffff', { literal: true, font: 'bold', align: 'center' });
                const out = Buffer.alloc(w * h);
                for (let i = 0; i < w * h; i++) out[i] = cv.d[i * 4 + 1];
                const dir = put('label.bin', out, Date.now());
                streetPic = { w, h, seq: ++labelSeq, street, dir };
            } catch (e) { log.warn('street label: ' + errText(e)); }
            return streetPic;
        }
        const positioning = () => page === 1 && ui.isVisible('MAIN');
        // the Calibrate page: the camera being set shows for as long as the page is open (the front one with its marks)
        const calibrating = () => page === 2 && ui.isVisible('MAIN');
        // the navigation's next turn, as the helper read it (fresh: the helper's status is)
        const navNow = (st) => (st && st.nav && st.nav.last && st.nav.last.active ? st.nav.last : null);
        function tick() {
            const now = Date.now();
            // the Position page: the side being placed shows on the cluster for as long as the page is open
            if (positioning()) { test = edit; testUntil = now + 1500; }
            if (calibrating()) { test = calCam === 'front' ? 'calfront' : calCam; testUntil = now + 1500; }
            if (test && now >= testUntil) { test = null; log.info('test ended'); }
            const side = blinker.side(now);
            if (side) lastSide = side;
            const s = cfg(now);
            const st = readStatus(now);
            const n = st && st.native;
            // the route's hold after the turn: from whether the turn itself is near (never from the hold itself,
            // which kept the front camera up for as long as a route ran), keeping arLatched steady across turn signals
            const kmhNow = speed !== null && now - speedAt < SPEED_STALE_MS ? speed : null;
            const nvNow = navNow(st);
            if (s.ar === 'off' || s.enabled === 'off' || !nvNow) { arHoldUntil = 0; arLatched = false; }
            else if (L.arWanted({ arMode: s.ar, nav: nvNow, speed: kmhNow, arLatched })) { arHoldUntil = now + AR_HOLD_MS; arLatched = true; }
            else if (now >= arHoldUntil) { arLatched = false; }
            if (s.front === 'off' || s.enabled === 'off') { frontHoldUntil = 0; frontLatched = false; }
            else if (s.front === 'always' || (kmhNow !== null && /^slow(\d+)$/.test(String(s.front)) && kmhNow <= Number(RegExp.$1) + (frontLatched ? 4 : 0))) {
                frontHoldUntil = now + FRONT_HOLD_MS;
                frontLatched = true;
            } else if (now >= frontHoldUntil) {
                frontLatched = false;
            }
            if (n && n.aux_state === 'refused' && now - auxRefusedAt >= 15000) { auxRefusedAt = now; auxReason = String(n.aux_reason || '').slice(0, 80); log.warn('second view refused (' + (n.aux_reason || '') + '): the mirror camera alone'); }
            const p = L.plan({
                enabled: s.enabled !== 'off', reverse, mode: s.mode, source: s.source, side, test, front: s.front,
                frontLatched, frontHold: now < frontHoldUntil,
                arMode: s.ar, nav: nvNow, arLatched, arHold: now < arHoldUntil,
                // the second layer was refused a moment ago: the mirror camera alone for a while
                dual: s.blinkFront, auxRefused: now - auxRefusedAt < 15000,
                speed: kmhNow, maxSpeed: Number(s.maxSpeed) || 0,
                cam: cam.info().cam,
                helper: { ok: !!n, pictureAge: n ? n.picture_age_ms : null, pictureW: n ? n.picture_w : 0, pictureH: n ? n.picture_h : 0, pair: n ? n.pair : null },
            });
            if (p.view !== lastPlan.view || p.why !== lastPlan.why) log.info('view ' + p.view + (p.why ? ' (' + p.why + ')' : ''));
            lastPlan = p;
            const targets = L.parseTargets(n && n.targets);
            const shownSide = p.view === 'left' || p.view === 'right' ? p.view : test === 'left' || test === 'right' ? test : lastSide;
            // what the helper draws on the front camera; the car's speed (in steps of 5 km/h) only while a route is
            // drawn; nav: whether the helper should read the navigation at all
            const kmh = p.ar === 'route' && kmhNow !== null ? Math.round(kmhNow / 5) * 5 : -1;
            const ar = Object.assign(L.arConfig(s, p.view === 'front' ? p.ar : 'off', kmh), p.ar === 'route' && nvNow && nvNow.street && s.arStreet !== 'off' && streetLabel(nvNow.street, s) ? { label: { w: streetPic.w, h: streetPic.h, seq: streetPic.seq, street: streetPic.street } } : {}, { nav: s.ar === 'near' || s.ar === 'always' || page === 3 ? 1 : 0 });
            writeControl(p.view, L.viewConfig(s, targets, shownSide, p.view, !!p.aux), ar, p.aux ? L.auxConfig(s, targets, p.aux) : null, now);
            // the camera unit: at once when what is wanted changes or a side comes on, twice a second
            // while a signal/test is active or the unit is not in its mode yet, else every 1.5 s
            const busy = !!(side || test) || cam.info().phase !== 'on';
            if (p.want !== lastWant || busy !== lastBusy || now - camTickAt >= (busy ? CAM_TICK_MS : CAM_IDLE_MS)) {
                lastWant = p.want;
                lastBusy = busy;
                camTickAt = now;
                cam.tick(p.want);
            }
        }
        setInterval(tick, TICK_MS);

        /* ---- the screen ---- */
        const SIDE = { LEFT: 'Trái', RIGHT: 'Phải', HAZARD: 'Đèn khẩn cấp', OFF: 'Tắt', WAITING: 'Chưa nhận tín hiệu' };
        const VIEW = { left: 'Camera trái', right: 'Camera phải', all: 'Cả 4 camera', front: 'Camera trước' };
        const PHASE = { on: 'đúng chế độ', idle: 'không yêu cầu', asked: 'đã yêu cầu', waiting: 'xe chưa cho, chờ thử lại', starting: 'đang khởi động', 'parking view': 'đang hiện camera đỗ xe', 'asked (state unreadable)': 'đã yêu cầu (không đọc được trạng thái)' };
        const label = (key) => settings.display(key);
        // per-second figures from the helper's running counts, over the last 2 s or more
        let perfPrev = null, perfOut = { text: 'đang đo', warn: false }, heat = null, heatAt = 0;
        function cpuHeat(now) {
            if (now - heatAt < 5000) return heat;
            heatAt = now;
            heat = null;
            try {
                fs.readdirSync('/sys/class/thermal').filter((d) => /^thermal_zone\d+$/.test(d)).forEach((d) => {
                    const t = Number(fs.readFileSync('/sys/class/thermal/' + d + '/temp', 'utf8')) / 1000;
                    if (t > 0 && t < 150 && (heat === null || t > heat)) heat = t;
                });
            } catch (e) { /* not readable here */ }
            return heat;
        }
        function perf(now, n) {
            const cur = { t: now, sent: n.frames_sent || 0, aux: n.aux_frames || 0, dropped: n.dropped || 0, lost: n.lost || 0, pics: n.pictures || 0 };
            if (!perfPrev || cur.sent < perfPrev.sent || cur.pics < perfPrev.pics) { perfPrev = cur; return perfOut; }
            const dt = (now - perfPrev.t) / 1000;
            if (dt < 2) return perfOut;
            const r = (k) => Math.round((cur[k] - perfPrev[k]) / dt * 10) / 10;
            const sent = r('sent'), aux = r('aux'), drop = r('dropped'), lost = r('lost');
            const h = cpuHeat(now);
            const ms = (us) => (us / 1000).toFixed(1).replace('.', ',');
            perfOut = {
                warn: drop > 0 || lost > 2 || (h !== null && h >= 90),
                text: 'giải mã ' + ms(n.decode_us || 0) + ' · vẽ ' + ms(n.view_us || 0) + (n.aux_us ? '+' + ms(n.aux_us) : '') + ' ms · ' + Math.round(sent) + (aux ? '+' + Math.round(aux) : '') +
                    ' hình/s · rớt ' + drop + (lost ? ' · mất ' + lost : '') + ' gói/s' + (h !== null ? ' · CPU ' + Math.round(h) + '°C' : ''),
            };
            perfPrev = cur;
            return perfOut;
        }
        function model() {
            const now = Date.now();
            const s = cfg(), st = readStatus(now), n = st && st.native, info = cam.info();
            const targets = L.parseTargets(n && n.targets);
            const v = { page, edit, enabled: s.enabled !== 'off', round: s.shape !== 'square', gauge: s.place === 'gauge' || s.place === undefined,
                sizeLabel: label('size'), front: String(label('front')).toLowerCase() };
            // where each view sits: the helper's own config for that side
            v.discs = {};
            ['left', 'right'].forEach((side) => {
                const c = L.viewConfig(s, targets, side);
                if (c.target === 'panel') v.discs[side] = { x: c.x, y: c.y, w: c.w, h: c.h };
                else if (c.target === 'map') v.discs[side] = { x: UI.MAP.x + c.x, y: UI.MAP.y + c.y, w: c.w, h: c.h };
            });
            if (s.front !== 'off' || lastPlan.view === 'front') {
                const f = L.frontConfig(s, targets);
                v.frontRect = { x: UI.MAP.x + f.x, y: UI.MAP.y + f.y, w: f.w, h: f.h };
            }
            const showing = lastPlan.view !== 'none' && n && n.shown;
            v.shown = showing ? lastPlan.view : null;
            v.shownAux = showing && lastPlan.aux && n.aux_shown ? lastPlan.aux : null;
            if (lastPlan.view !== 'none') {
                if (showing && n.layer === 'shown') { v.title = 'Đang hiện ' + VIEW[lastPlan.view].toLowerCase(); v.titleKind = 'go'; }
                else if (showing) { v.title = VIEW[lastPlan.view]; v.titleKind = 'warn'; v.subtitle = 'Đang gửi hình, đồng hồ chưa hiện (' + n.layer + (n.layer_reason ? ': ' + n.layer_reason : '') + ')'; }
                else { v.title = VIEW[lastPlan.view]; v.titleKind = 'warn'; v.subtitle = 'Đang bật' + (n && n.why ? ': ' + (WHY_VI[n.why] || n.why) : ''); }
            } else {
                v.title = lastPlan.why;
                v.titleKind = lastPlan.why === 'Chờ xi nhan' ? 'dim' : 'warn';
                if (lastPlan.why === 'Chờ xi nhan') v.subtitle = 'Bật xi nhan để xem camera gương bên đó trên đồng hồ';
            }
            const fresh = n && n.picture_age_ms >= 0 && n.picture_age_ms < 1500;
            const signalOk = lightState === 'Đã kết nối';
            v.rows = [
                { label: 'Xi nhan', text: SIDE[blinker.state()] + (signalOk ? '' : ' (' + lightState + ')'), kind: signalOk ? (blinker.state() === 'WAITING' ? 'dim' : 'go') : 'warn' },
                { label: 'Hộp camera', kind: info.phase === 'on' ? 'go' : info.phase === 'idle' ? 'dim' : 'warn',
                    text: (info.cam.known ? info.cam.text : link.icam === 'ok' || link.xv === 'ok' ? 'chưa đọc được' : 'chưa nối (' + (link.icam || '-') + ')') + ' · ' + (PHASE[info.phase] || info.phase) },
                { label: 'Luồng hình', kind: fresh ? 'go' : 'warn',
                    text: !st ? 'Trợ thủ xinhan-cam chưa chạy' : !n ? 'Trợ thủ: ' + (st.note || 'đang khởi động') : fresh
                        ? n.picture_w + 'x' + n.picture_h + ' · ' + (st.fps || 0) + ' hình/giây' + (n.pair && n.pair !== 'off' ? ' · ghép 2 khung (' + n.pair + ')' : '')
                        : 'chưa có hình (' + (n.avb === 'ok' ? 'đã nối, hộp camera chưa phát' : 'chưa nối: ' + (n.avb || 'đang thử')) + ')' },
                { label: 'Đồng hồ', kind: n && n.cr === 'connected' && n.layer !== 'refused' ? 'go' : 'warn',
                    text: !n ? 'chờ trợ thủ' : n.cr !== 'connected' ? 'chưa nối được cluster-render' : n.layer === 'refused' ? 'từ chối lớp video: ' + n.layer_reason
                        : 'sẵn sàng · ' + n.target + ' ' + n.layer_w + 'x' + n.layer_h },
            ];
            // the two cameras together: what holds it up, or that it shows
            const older = (a, b) => { const x = String(a || '0').split('.').map(Number), y = b.split('.').map(Number); for (let k = 0; k < 3; k++) { if ((x[k] || 0) !== y[k]) return (x[k] || 0) < y[k]; } return false; };
            if (s.blinkFront !== 'mirror') {
                const oldHelper = st && older(st.version, '0.6.0');
                v.rows.push({ label: 'Hai camera',
                    kind: oldHelper || (n && n.aux_state === 'refused') || now - auxRefusedAt < 15000 ? 'warn' : lastPlan.aux && n && n.aux_shown ? 'go' : 'dim',
                    text: oldHelper ? 'trợ thủ còn bản ' + st.version + ': khởi động lại màn hình để lên bản mới'
                        : lastPlan.aux ? (n && n.aux_shown && n.shown && n.layer === 'shown' ? 'đang hiện cả hai' : 'cam trước ' + (n && n.shown ? 'đã gửi hình' : 'chưa hiện') + ' (' + ((n && n.target) || '?') + ', ' + ((n && n.layer) || '?') + ((n && n.layer_reason) ? ': ' + n.layer_reason : '') + ') · cam gương ' + (n && n.aux_shown ? 'đang hiện' : ((n && n.aux_state) || '?') + ((n && n.aux_reason) ? ': ' + n.aux_reason : '')))
                            : now - auxRefusedAt < 15000 ? 'bộ vẽ từ chối hình thứ hai (' + auxReason + ')'
                                : lastPlan.dualWhy ? 'không giữ cam trước: ' + lastPlan.dualWhy : 'sẵn sàng' });
            }
            // how hard the helper works: decode and drawing times, what it dropped, pictures sent, the CPU's heat
            if (n) {
                const pf = perf(now, n);
                v.rows.push({ label: 'Hiệu năng', kind: pf.warn ? 'warn' : 'dim', text: pf.text });
            }
            v.version = 'Bản ' + ctx.spec.version + (st && st.version ? ' · trợ thủ ' + st.version : '');
            if (page === 1 || page === 2) {
                v.note = showing ? 'Đang hiện trên đồng hồ' : lastPlan.why || '';
                v.noteKind = showing ? 'go' : 'warn';
            }
            if (page === 2) {
                v.calCam = calCam;
                if (calCam === 'front') {
                    const U = { calH: ' cm', calPitch: '°', calFov: '°', calYaw: '°', calShift: ' cm', calCurve: '', frontZoom: ' %', frontPanY: '' };
                    const N = { calH: 'Độ cao camera', calPitch: 'Chúc xuống', calFov: 'Góc nhìn', calYaw: 'Lệch trái / phải', calShift: 'Dịch ngang', calCurve: 'Độ cong (mắt cá)', frontZoom: 'Phóng to', frontPanY: 'Dịch hình xuống' };
                    v.calRows = Object.keys(L.CALIB).map((k) => ({ key: k, label: N[k], text: L.calib(s, k) + U[k] }));
                } else {
                    const L_ = calCam === 'left';
                    v.calText = 'Dịch ngang ' + (Number(s[L_ ? 'panLx' : 'panRx']) || 0) + ' · dọc ' + (Number(s[L_ ? 'panLy' : 'panRy']) || 0) + ' · phóng ' + (Number(s[L_ ? 'zoomL' : 'zoomR']) || 100) + ' %';
                }
            }
            if (page === 3) {
                const nv = (st && st.nav) || null, last = nv && nv.last;
                const PROV = { NONE: 'Bản đồ BMW', CAR_PLAY: 'Apple CarPlay', CARPLAY: 'Apple CarPlay', ANDROID_AUTO: 'Android Auto' };
                const KIND = { turn: 'Rẽ', roundabout: 'Vòng xuyến', destination: 'Đến nơi', straight: 'Đi thẳng' };
                const turnText = !last || !last.kind ? 'chưa có' : KIND[last.kind] + (last.kind === 'turn' ? (last.angle < 0 ? ' trái' : ' phải') + (Math.abs(last.angle) <= 45 ? ' nhẹ' : Math.abs(last.angle) >= 170 ? ' (quay đầu)' : '') : last.kind === 'roundabout' && last.exit ? ', lối ra ' + last.exit : '') +
                    (last.street ? ' vào ' + last.street : '') + (last.meters >= 0 ? ' · còn ' + (last.meters >= 1000 ? (last.meters / 1000).toFixed(1).replace('.', ',') + ' km' : last.meters + ' m') : '');
                const NS = { 'not started': 'chưa bật', starting: 'đang mở', found: 'đã thấy trong xe, đang mở', reading: 'đang đọc', 'no interface': 'xe không có dịch vụ dẫn đường', ended: 'bộ đọc dừng, sẽ thử lại', 'failed to start': 'không chạy được bộ đọc' };
                v.navRows = [
                    { label: 'Đọc dẫn đường', text: !st ? 'Trợ thủ chưa chạy' : !nv ? 'Trợ thủ bản cũ, cần khởi động lại màn hình' : (NS[nv.state] || nv.state) + (nv.note ? ' · ' + nv.note : ''), kind: nv && nv.state === 'reading' ? 'go' : 'warn' },
                    { label: 'Nguồn', text: last ? (PROV[last.provider] || last.provider || 'không rõ') + (last.state && (!last.provider || last.provider === 'NONE') ? ' · ' + last.state : '') : (nv && nv.proxies && nv.proxies.length ? nv.proxies.join(' · ') : 'chưa có'), kind: last ? 'go' : 'dim' },
                    { label: 'Lệnh kế tiếp', text: turnText, kind: last && last.active ? 'go' : 'dim' },
                    { label: 'Dữ liệu thô', text: nv && nv.raw ? String(nv.raw).slice(0, 110) : (nv && nv.ifaces && nv.ifaces.length ? nv.ifaces.map((x) => x.split('.').pop()).join(', ') : 'chưa có'), kind: 'dim' },
                ];
                v.arLabel = label('ar');
                v.arCard = s.arCard !== 'off';
                v.demo = test === 'ardemo';
            }
            return v;
        }

        const startTest = (view, secs) => () => {
            // a second press of the view that is on ends it
            if (test === view && !positioning()) { test = null; testUntil = 0; } else { test = view; testUntil = Date.now() + secs * 1000; log.info('test ' + view + ' for ' + secs + ' s'); }
            tick();
            repaint();
        };
        const cycle = (key) => () => { settings.cycle(key); };
        const num = (key) => Number(settings.get(key)) || 0;
        const move = (dx, dy) => () => {
            if (settings.get('place') !== 'gauge') settings.set('place', 'gauge');
            settings.set('gaugeDx', Math.max(-400, Math.min(400, num('gaugeDx') + dx)));
            settings.set('gaugeDy', Math.max(-200, Math.min(200, num('gaugeDy') + dy)));
            log.info('view at ' + num('gaugeDx') + ', ' + num('gaugeDy') + ' from the dial\'s middle');
        };
        const sizes = settings.item('size').options.map((o) => o[0]);
        const resize = (d) => () => { const i = Math.max(0, Math.min(sizes.length - 1, sizes.indexOf(settings.get('size')) + d)); settings.set('size', sizes[i]); };
        const acts = {
            left: startTest('left', 8), right: startTest('right', 8), all: startTest('all', 15),
            // "Camera trước": its setting, off -> below 30 -> below 60 -> always
            front: cycle('front'),
            toggle: () => settings.set('enabled', settings.get('enabled') === 'off' ? 'on' : 'off'),
            side: () => { edit = edit === 'left' ? 'right' : 'left'; tick(); repaint(); },
            up: move(0, -UI.STEP), down: move(0, UI.STEP),
            // gaugeDx counts towards the middle of the cluster: to the right for the left dial, to the left for the right one
            moveLeft: () => move(edit === 'left' ? -UI.STEP : UI.STEP, 0)(),
            moveRight: () => move(edit === 'left' ? UI.STEP : -UI.STEP, 0)(),
            smaller: resize(-1), larger: resize(1), shape: cycle('shape'),
            reset: () => { settings.set('gaugeDx', 0); settings.set('gaugeDy', 0); settings.set('place', 'gauge'); settings.set('size', 'fit'); },
            // the Calibrate page
            camL: () => { calCam = 'left'; tick(); repaint(); }, camR: () => { calCam = 'right'; tick(); repaint(); }, camF: () => { calCam = 'front'; tick(); repaint(); },
            panL: () => pan(-20, 0), panR: () => pan(20, 0), panU: () => pan(0, -20), panD: () => pan(0, 20),
            zoomIn: () => zoomCam(10), zoomOut: () => zoomCam(-10),
            calReset: () => {
                if (calCam === 'front') Object.keys(L.CALIB).forEach((k) => settings.set(k, L.CALIB[k].d));
                else { const S = calCam === 'left' ? 'L' : 'R'; settings.set('pan' + S + 'x', 0); settings.set('pan' + S + 'y', 0); settings.set('zoom' + S, 100); }
            },
            // the Navigation page
            arMode: cycle('ar'), arCard: cycle('arCard'), demo: startTest('ardemo', 26),
        };
        function pan(dx, dy) {
            const S = calCam === 'left' ? 'L' : 'R';
            settings.set('pan' + S + 'x', Math.max(-500, Math.min(500, num('pan' + S + 'x') + dx)));
            settings.set('pan' + S + 'y', Math.max(-500, Math.min(500, num('pan' + S + 'y') + dy)));
        }
        function zoomCam(d) {
            const k = calCam === 'left' ? 'zoomL' : 'zoomR';
            settings.set(k, Math.max(100, Math.min(300, (num(k) || 100) + d)));
        }
        // the front camera's numbers: 'calH-' / 'calH+' and so on
        Object.keys(L.CALIB).forEach((k) => {
            const c = L.CALIB[k];
            acts[k + '-'] = () => settings.set(k, Math.max(c.min, L.calib(cfg(), k) - c.step));
            acts[k + '+'] = () => settings.set(k, Math.min(c.max, L.calib(cfg(), k) + c.step));
        });
        ctx.onTab((i) => { page = i; tick(); repaint(); });
        // a tap on the cluster's picture (Position page): the view of the half tapped goes there
        ctx.onTap((x, y) => {
            if (page !== 1) return;
            const h = UI.hit(x, y);
            if (!h) return;
            edit = h.x < UI.PANEL.w / 2 ? 'left' : 'right';
            const cx = edit === 'left' ? h.x : UI.PANEL.w - h.x;
            if (settings.get('place') !== 'gauge') settings.set('place', 'gauge');
            settings.set('gaugeDx', Math.round(Math.max(-400, Math.min(400, cx - L.GAUGE.cx))));
            settings.set('gaugeDy', Math.round(Math.max(-200, Math.min(200, h.y - L.GAUGE.cy))));
            tick();
            repaint();
        });

        // a finger on a view's place in the Position page's picture drags it there, live on the cluster
        if (ctx.onDrag) ctx.onDrag((phase, x, y) => {
            const h = UI.hit(x, y);
            if (phase === 'start') {
                // only on the Position page (a move, an end or a cancel ends what was begun there, wherever)
                if (page !== 1 || !h) return false;
                const st0 = readStatus(Date.now()), s = cfg(), targets = L.parseTargets(st0 && st0.native && st0.native.targets);
                // the view under the finger (or near it), of either side
                const side = ['left', 'right'].find((sd) => {
                    const v = L.viewConfig(s, targets, sd);
                    if (v.target !== 'panel') return false;
                    const cx = v.x + v.w / 2, cy = v.y + v.h / 2, r = Math.max(v.w, v.h) / 2 + 60;
                    return Math.abs(h.x - cx) <= r && Math.abs(h.y - cy) <= r;
                });
                if (!side) return false;
                const v = L.viewConfig(s, targets, side);
                edit = side;
                dragPos = { side, dx: Number(s.gaugeDx) || 0, dy: Number(s.gaugeDy) || 0, offX: v.x + v.w / 2 - h.x, offY: v.y + v.h / 2 - h.y, at: Date.now() };
                return true;
            }
            if (!dragPos) return false;
            if ((phase === 'move' || phase === 'end') && h) {
                const cx = h.x + dragPos.offX, cy = h.y + dragPos.offY;
                const dx = dragPos.side === 'left' ? cx - L.GAUGE.cx : UI.PANEL.w - L.GAUGE.cx - cx;
                dragPos.dx = Math.round(Math.max(-400, Math.min(400, dx)));
                dragPos.dy = Math.round(Math.max(-200, Math.min(200, cy - L.GAUGE.cy)));
                dragPos.at = Date.now();
            }
            if (phase === 'end' || phase === 'cancel') {
                const d = dragPos;
                dragPos = null;
                if (phase === 'end') {
                    // saved once, when the finger comes up (not at every move: the settings file is on flash)
                    if (settings.get('place') !== 'gauge') settings.set('place', 'gauge');
                    settings.set('gaugeDx', d.dx);
                    settings.set('gaugeDy', d.dy);
                    log.info('view dragged to ' + d.dx + ', ' + d.dy + ' from the dial\'s middle');
                }
            }
            tick();
            repaint();
            return true;
        });

        const render = async () => {
            const cv = ctx.canvas(UI.W, UI.H) || new Canvas(UI.W, UI.H);
            UI.draw(cv, G, ctx.theme(), model(), acts);
            await ui.image('MAIN_GFX', cv);
        };
        const loop = ctx.loop('MAIN', 4, render);
        function repaint() { return loop && loop.kick ? loop.kick() : render(); }
        ['BTN_LEFT', 'BTN_RIGHT', 'BTN_ALL', 'BTN_FRONT'].forEach((b) => { if (ctx.hideButton) ctx.hideButton(b); });
        ui.onClick('BTN_LEFT', acts.left);
        ui.onClick('BTN_RIGHT', acts.right);
        ui.onClick('BTN_ALL', acts.all);
        ui.onClick('BTN_FRONT', acts.front);
        settings.onChange(() => { applyBlinker(); tick(); repaint(); });

        // MainApp asks the app to stop: the camera unit gets its mode back, the tool is told at once
        if (ctx.app && ctx.app.on) ctx.app.on('shutdown', () => {
            try { put('control.json', JSON.stringify({ at: new Date().toISOString(), seq: ++seq, view: 'none', config: null }), Date.now()); } catch (e) { /* the tool drops the view by itself */ }
            cam.release();
        });
        tick();
        await render();
        log.info('xinhan_cam ready (mode ' + settings.get('mode') + ', ' + (settings.get('enabled') !== 'off' ? 'on' : 'off') + ')');
    },
});
