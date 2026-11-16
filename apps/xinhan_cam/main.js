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
 * Starts with the head unit and keeps running in the background (app.json "startType": "autostart");
 * its page shows the state and has buttons to try each camera with the car parked.
 * Node 8.
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const L = require('./logic');
const camera = require('./camera');

const STATUS = process.env.XINHAN_STATUS || '/run/xinhan-cam/status.json';
const STATUS_STALE_MS = 4000;       // the tool writes at least once a second
const TICK_MS = 100;
const HEARTBEAT_MS = 500;
const CAM_TICK_MS = 500;
const CAM_IDLE_MS = 2000;
const IF = {
    light: 'de.bmw.body.Light',
    speed: 'de.bmw.infotainment.vehicle.Vehicle2',
    icam: 'de.bmw.infotainment.video.cameraproxy.ICAM2Proxy',
    cam: 'de.bmw.infotainment.video.cameraproxy.CameraProxy',
    xv: 'de.bmw.dass.XView3D',
};
const WIRE = { CLIENT_INDIRECT: 1, DR_ACTIVE: 51, MODE_MOSAIK: 50 };
const errText = (e) => String(e && e.message || e).slice(0, 120);

mgu.run({
    async start(ctx) {
        const { ui, settings, log, signals } = ctx;
        const controlFile = path.join(ctx.dataDir, 'control.json');
        const cfg = () => {
            const o = {};
            settings.schema.forEach((s) => { o[s.key] = settings.get(s.key); });
            return o;
        };

        /* ---- the turn signals ---- */
        const blinker = L.createBlinker();
        const applyBlinker = () => blinker.configure({ holdMs: (Number(settings.get('hold')) || 2) * 1000, tip: settings.get('tip') !== 'off' });
        applyBlinker();
        let lightState = 'Đang kết nối', lightEvents = 0, lastRaw = ['-', '-'];
        const onLight = (index, value) => {
            const ev = L.decode(value);
            lightEvents++;
            if (ev.raw !== lastRaw[index]) { lastRaw[index] = ev.raw; log.info('indicators ' + (index + 1) + ': ' + ev.raw + ' -> ' + (ev.direction || '-')); }
            blinker.event(ev.direction, ev.kind, Date.now());
            tick();
        };
        signals.watch(IF.light, '1', {
            StatusFunctionsIndicators: (v) => onLight(0, v),
            StatusFunctionsIndicators2: (v) => onLight(1, v),
        }, log).then((sub) => { lightState = sub.error ? 'Lỗi: ' + errText(sub.error) : 'Đã kết nối'; })
            .catch((e) => { lightState = 'Lỗi: ' + errText(e); });

        /* ---- the speed (only for the "slower than" setting) ---- */
        let speed = null, speedAt = 0;
        signals.watch(IF.speed, '1', {
            statusCarSpeed2: (v) => {
                const raw = v && v.speedVehicleCentreOfGravity;
                if (!Number.isFinite(raw) || raw === 65535) return;
                speed = raw * 0.015625;             // BMW's scaling, km/h
                speedAt = Date.now();
            },
        }, log, { pollMs: 1000, active: () => Number(settings.get('maxSpeed')) > 0 })
            .then((sub) => { if (sub.error) log.warn('speed: ' + sub.error); }).catch((e) => log.warn('speed: ' + e));

        /* ---- the camera unit ---- */
        const px = {}, link = {}, tries = {};
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
        const get = (name, field) => (px[name] ? Promise.resolve().then(() => px[name].getValue(field, 3000)).catch(() => undefined) : Promise.resolve(undefined));
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
        let lastControl = '', lastWriteAt = 0, seq = 0;
        let lastPlan = { view: 'none', why: 'Đang khởi động', want: null }, lastSide = null;
        let camTickAt = 0, lastWant, lastBusy;
        const writeControl = (view, config, now) => {
            const body = JSON.stringify({ view, config });
            const active = view !== 'none';
            if (body === lastControl && !(active && now - lastWriteAt >= HEARTBEAT_MS)) return;
            if (body !== lastControl) seq++;
            lastControl = body;
            lastWriteAt = now;
            try {
                fs.writeFileSync(controlFile + '.tmp', JSON.stringify({ at: new Date(now).toISOString(), seq, view, config }));
                fs.renameSync(controlFile + '.tmp', controlFile);
            } catch (e) { log.warn('control file: ' + errText(e)); }
        };
        function tick() {
            const now = Date.now();
            if (test && now >= testUntil) { test = null; log.info('test ended'); }
            const side = blinker.side(now);
            if (side) lastSide = side;
            const s = cfg();
            const st = readStatus(now);
            const n = st && st.native;
            const p = L.plan({
                enabled: s.enabled !== 'off', mode: s.mode, source: s.source, side, test,
                speed: speed !== null && now - speedAt < 3000 ? speed : null, maxSpeed: Number(s.maxSpeed) || 0,
                cam: cam.info().cam,
                helper: { ok: !!n, pictureAge: n ? n.picture_age_ms : null, pictureW: n ? n.picture_w : 0, pictureH: n ? n.picture_h : 0, pair: n ? n.pair : null },
            });
            if (p.view !== lastPlan.view || p.why !== lastPlan.why) log.info('view ' + p.view + (p.why ? ' (' + p.why + ')' : ''));
            lastPlan = p;
            const targets = L.parseTargets(n && n.targets);
            const shownSide = p.view === 'left' || p.view === 'right' ? p.view : test === 'left' || test === 'right' ? test : lastSide;
            writeControl(p.view, L.viewConfig(s, targets, shownSide), now);
            // the camera unit: at once when what is wanted changes or a side comes on, twice a second
            // while a view is wanted or the unit is not in its mode yet, else every 2 s
            const busy = !!(side || test) || cam.info().phase !== 'on';
            if (p.want !== lastWant || busy !== lastBusy || now - camTickAt >= (busy ? CAM_TICK_MS : CAM_IDLE_MS)) {
                lastWant = p.want;
                lastBusy = busy;
                camTickAt = now;
                cam.tick(p.want);
            }
        }
        setInterval(tick, TICK_MS);
        settings.onChange(() => { applyBlinker(); tick(); refresh(); });

        /* ---- the page ---- */
        const SIDE = { LEFT: 'Trái', RIGHT: 'Phải', HAZARD: 'Đèn khẩn cấp', OFF: 'Tắt', WAITING: 'Chưa nhận tín hiệu' };
        const VIEW = { left: 'camera TRÁI', right: 'camera PHẢI', all: 'cả 4 camera' };
        let shownRows = {};
        const row = (name, text) => {
            if (shownRows[name] === text) return Promise.resolve();
            shownRows[name] = text;
            return ui.text(name, text);
        };
        function refresh() {
            if (!ui.isVisible('MAIN')) return Promise.resolve();
            const now = Date.now();
            const st = readStatus(now), n = st && st.native, info = cam.info();
            let state;
            if (lastPlan.view !== 'none') {
                // "shown" is the helper's: the layer is on and gets pictures; the cluster itself may still hold them back
                if (n && n.shown && n.layer === 'shown') state = 'Đang hiện ' + VIEW[lastPlan.view];
                else if (n && n.shown) state = 'Đang gửi hình ' + VIEW[lastPlan.view] + ', đồng hồ chưa hiện (' + n.layer + (n.layer_reason ? ': ' + n.layer_reason : '') + ')';
                else state = 'Đang bật ' + VIEW[lastPlan.view] + (n && n.why ? ' - ' + n.why : '');
            } else state = lastPlan.why;
            let video = 'Trợ thủ xinhan-cam chưa chạy (cài công cụ xinhan-cam trong Store, rồi khởi động lại màn hình)';
            if (st && !n) video = 'Trợ thủ: ' + (st.note || 'đang khởi động bộ giải mã');
            if (n) {
                video = n.picture_age_ms >= 0 && n.picture_age_ms < 1500
                    ? 'Luồng camera: ' + n.picture_w + 'x' + n.picture_h + ', ' + (st.fps || 0) + ' hình/giây'
                        + (n.pair && n.pair !== 'off' ? ', ghép 2 khung xen kẽ (' + n.pair + ')' : '')
                    : 'Luồng camera: chưa có hình (' + (n.avb === 'ok' ? 'đã nối, hộp camera chưa phát' : 'chưa nối được: ' + (n.avb || 'đang thử')) + ')';
            }
            let cluster = 'Đồng hồ: chờ trợ thủ';
            if (n) {
                cluster = n.cr !== 'connected' ? 'Đồng hồ: chưa nối được cluster-render (cài cluster-render trong Store)'
                    : n.layer === 'refused' ? 'Đồng hồ: từ chối lớp video - ' + n.layer_reason
                        : 'Đồng hồ: sẵn sàng, ' + n.target + ' ' + n.layer_w + 'x' + n.layer_h + (n.target_holder && n.target_holder !== 'none' ? ' (đang do ' + n.target_holder + ' giữ)' : '');
            }
            const camText = 'Hộp camera: ' + (info.cam.known ? info.cam.text : link.icam === 'ok' || link.xv === 'ok' ? 'chưa đọc được trạng thái' : 'chưa nối (' + (link.icam || '-') + ')')
                + ' - ' + ({ on: 'đúng chế độ', idle: 'không yêu cầu', asked: 'đã yêu cầu', waiting: 'xe chưa cho, chờ thử lại', starting: 'đang khởi động', 'parking view': 'đang hiện camera đỗ xe' }[info.phase] || info.phase)
                + (info.attached ? ' (app này giữ)' : '');
            return Promise.all([
                row('ROW_STATE', 'Trạng thái: ' + state),
                row('ROW_SIGNAL', 'Xi nhan: ' + SIDE[blinker.state()] + ' (' + lightState + ', ' + lightEvents + ' tín hiệu)'),
                row('ROW_CAMERA', camText),
                row('ROW_VIDEO', video),
                row('ROW_CLUSTER', cluster),
                row('ROW_NOTE', 'Bản ' + ctx.spec.version + (st && st.version ? ', trợ thủ ' + st.version : '') + (n && n.sei ? ', SEI ' + String(n.sei).slice(32, 56) + (n.sei_prev ? ' / ' + String(n.sei_prev).slice(32, 56) : '') : ', không có SEI')),
            ]).catch((e) => log.warn('page: ' + errText(e)));
        }
        const startTest = (view, secs) => () => {
            test = view;
            testUntil = Date.now() + secs * 1000;
            log.info('test ' + view + ' for ' + secs + ' s');
            tick();
            return refresh();
        };
        ui.onClick('BTN_LEFT', startTest('left', 8));
        ui.onClick('BTN_RIGHT', startTest('right', 8));
        ui.onClick('BTN_ALL', startTest('all', 15));
        ui.onVisible((name, visible) => { if (name === 'MAIN' && visible) { shownRows = {}; refresh(); } });
        setInterval(refresh, 500);

        // MainApp asks the app to stop: the camera unit gets its mode back, the tool is told at once
        ctx.app.on('shutdown', () => {
            try { fs.writeFileSync(controlFile, JSON.stringify({ at: new Date().toISOString(), seq: ++seq, view: 'none', config: null })); } catch (e) { /* the tool drops the view by itself */ }
            cam.release();
        });
        tick();
        log.info('xinhan_cam ready (mode ' + settings.get('mode') + ', ' + (settings.get('enabled') !== 'off' ? 'on' : 'off') + ')');
    },
});
