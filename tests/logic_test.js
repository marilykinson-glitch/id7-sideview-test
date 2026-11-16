'use strict';
/** Tests of apps/xinhan_cam/logic.js and camera.js: node tests/logic_test.js */
const assert = require('assert');
const path = require('path');
const L = require(path.join(__dirname, '..', 'apps', 'xinhan_cam', 'logic.js'));
const camera = require(path.join(__dirname, '..', 'apps', 'xinhan_cam', 'camera.js'));

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok   ' + name); };
const tA = [];
const ta = (name, fn) => tA.push([name, fn]);

/* ---------------- the indicators ---------------- */
t('decode: the stalk\'s command, by name and by number, nested anywhere', () => {
    assert.deepStrictEqual(L.decode({ controlIndicateDirection: 'DAUER_BLINKEN_LINKS_EIN' }).direction, 'LEFT');
    assert.deepStrictEqual(L.decode({ controlIndicateDirection: 'DAUER_BLINKEN_LINKS_EIN' }).kind, 'steady');
    assert.deepStrictEqual(L.decode({ a: { b: { controlIndicateDirection: 4 } } }).direction, 'RIGHT');
    assert.deepStrictEqual(L.decode({ controlIndicateDirection: 'TIPP_BLINKEN_RECHTS_EIN' }), { direction: 'RIGHT', kind: 'tip', raw: 'TIPP_BLINKEN_RECHTS_EIN / -' });
    assert.strictEqual(L.decode({ controlIndicateDirection: 1 }).kind, 'tip');
    assert.strictEqual(L.decode({ controlIndicateDirection: 'BEIDSEITIGES_BLINKEN_EIN' }).direction, 'HAZARD');
    assert.strictEqual(L.decode({ controlIndicateDirection: 'BLINKEN_AUS' }).direction, 'OFF');
    assert.strictEqual(L.decode({ controlIndicateDirection: 0 }).direction, 'OFF');
});
t('decode: what blinks, when the command says off or nothing', () => {
    assert.strictEqual(L.decode({ activeFunctionIndicateDirection: 'DAUERBLINKEN_LINKS' }).direction, 'LEFT');
    assert.strictEqual(L.decode({ activeFunctionIndicateDirection: 'TIPPBLINKEN_RECHTS' }).direction, 'RIGHT');
    assert.strictEqual(L.decode({ activeFunctionIndicateDirection: 'TIPPBLINKEN_RECHTS' }).kind, 'tip');
    assert.strictEqual(L.decode({ activeFunctionIndicateDirection: 'WARNBLINKEN_MANUELL' }).direction, 'HAZARD');
    assert.strictEqual(L.decode({ activeFunctionIndicateDirection: 9 }).direction, 'LEFT');
    assert.strictEqual(L.decode({ activeFunctionIndicateDirection: 10 }).direction, 'RIGHT');
    assert.strictEqual(L.decode({ activeFunctionIndicateDirection: 6 }).direction, 'HAZARD');
    assert.strictEqual(L.decode({ activeFunctionIndicateDirection: 0 }).direction, 'OFF');
    assert.strictEqual(L.decode({ controlIndicateDirection: 0, activeFunctionIndicateDirection: 'DAUERBLINKEN_RECHTS' }).direction, 'RIGHT');
    // the command wins over what still blinks from before
    assert.strictEqual(L.decode({ controlIndicateDirection: 3, activeFunctionIndicateDirection: 10 }).direction, 'LEFT');
});
t('decode: an event that says nothing about the indicators', () => {
    assert.strictEqual(L.decode({ something: 1 }).direction, undefined);
    assert.strictEqual(L.decode(null).direction, undefined);
    assert.strictEqual(L.decode(undefined).raw, '- / -');
    assert.strictEqual(L.decode({ controlIndicateDirection: 77 }).direction, undefined);
});

t('blinker: on with the signal, held after it, off', () => {
    const b = L.createBlinker({ holdMs: 2000 });
    assert.strictEqual(b.side(0), null);
    assert.strictEqual(b.state(), 'WAITING');
    b.event('LEFT', 'steady', 1000);
    assert.strictEqual(b.side(1000), 'left');
    assert.strictEqual(b.side(60000), 'left');          // a long wait at the lights
    b.event('OFF', null, 61000);
    assert.strictEqual(b.side(62999), 'left');
    assert.strictEqual(b.side(63000), null);
    assert.strictEqual(b.state(), 'OFF');
});
t('blinker: a blink\'s dark half (off, on again within the hold) never drops the view', () => {
    const b = L.createBlinker({ holdMs: 1000 });
    for (let i = 0; i < 10; i++) {
        b.event('RIGHT', 'steady', i * 700);
        assert.strictEqual(b.side(i * 700 + 10), 'right');
        b.event('OFF', null, i * 700 + 350);
        assert.strictEqual(b.side(i * 700 + 690), 'right');
    }
    assert.strictEqual(b.side(9 * 700 + 350 + 999), 'right');
    assert.strictEqual(b.side(9 * 700 + 350 + 1000), null);
});
t('blinker: the other side takes over at once, hazards end it at once', () => {
    const b = L.createBlinker({ holdMs: 3000 });
    b.event('LEFT', 'steady', 0);
    b.event('RIGHT', 'steady', 500);
    assert.strictEqual(b.side(500), 'right');
    b.event('HAZARD', null, 900);
    assert.strictEqual(b.side(900), null);
    assert.strictEqual(b.state(), 'HAZARD');
    b.event('OFF', null, 1500);
    assert.strictEqual(b.side(1500), null);              // nothing held after hazards
    b.event('LEFT', 'steady', 2000);
    b.event('OFF', null, 2500);
    b.event('RIGHT', 'steady', 3000);                    // the other side during the hold
    assert.strictEqual(b.side(3000), 'right');
    assert.strictEqual(b.side(30000), 'right');
});
t('blinker: the lane-change tap, with and without the setting', () => {
    const on = L.createBlinker({ holdMs: 2000, tip: true });
    on.event('LEFT', 'tip', 0);
    assert.strictEqual(on.side(100), 'left');
    const off = L.createBlinker({ holdMs: 2000, tip: false });
    off.event('LEFT', 'tip', 0);
    assert.strictEqual(off.side(100), null);
    off.event('LEFT', 'steady', 200);                    // pushed through: steady
    assert.strictEqual(off.side(300), 'left');
    off.event('RIGHT', 'tip', 400);                      // a tap the other way ends it (after the hold)
    assert.strictEqual(off.side(2399), 'left');
    assert.strictEqual(off.side(2400), null);
    off.configure({ tip: true, holdMs: 1000 });
    off.event('RIGHT', 'tip', 5000);
    assert.strictEqual(off.side(5001), 'right');
    off.event('OFF', null, 6000);
    assert.strictEqual(off.side(6999), 'right');
    assert.strictEqual(off.side(7000), null);
});
t('blinker: events without a direction change nothing', () => {
    const b = L.createBlinker();
    b.event('LEFT', 'steady', 0);
    b.event(undefined, null, 10);
    assert.strictEqual(b.side(20), 'left');
    assert.strictEqual(b.state(), 'LEFT');
});

/* ---------------- the camera unit's state ---------------- */
t('camState: Drive Recorder views, parking views, starting, nothing readable', () => {
    const dr = (p) => ({ application: 'DR_ACTIVE', mode: 'MODE_MOSAIK', perspective: p });
    assert.strictEqual(L.camState(dr(7)).kind, 'all4');
    assert.strictEqual(L.camState(dr(9)).kind, 'all4');
    assert.strictEqual(L.camState(dr(10)).kind, 'all4');
    assert.strictEqual(L.camState(dr(3)).kind, 'left');
    assert.strictEqual(L.camState(dr(4)).kind, 'right');
    assert.strictEqual(L.camState(dr(1)).kind, 'front');
    assert.strictEqual(L.camState(dr(2)).kind, 'rear');
    assert.strictEqual(L.camState(dr(5)).kind, 'frontrear');
    assert.strictEqual(L.camState(dr(0)).kind, 'other');
    assert.strictEqual(L.camState({ application: 51, mode: 50, perspective: 9 }).kind, 'all4');
    assert.strictEqual(L.camState({ application: 'TOPREARVIEW', mode: 'x', perspective: 1 }).kind, 'parking');
    assert.strictEqual(L.camState({ application: 3, mode: 0, perspective: 0 }).kind, 'parking');
    assert.strictEqual(L.camState({ application: 'SIGNAL_UNFILLED', mode: 0, perspective: 0 }).kind, 'starting');
    assert.strictEqual(L.camState({ application: 'OFF', mode: 0, perspective: 255 }).kind, 'starting');
    assert.strictEqual(L.camState({ application: 'DR_STANDBY', mode: 'MODE_MOSAIK', perspective: 7 }).kind, 'other');
    assert.deepStrictEqual(L.camState(undefined, undefined).kind, 'unknown');
    assert.strictEqual(L.camState(undefined, undefined).known, false);
    assert.strictEqual(L.camState(dr(9)).text, 'DR_ACTIVE/MODE_MOSAIK/9');
});
t('camState: two services that disagree - a parking view wins, else the usable view', () => {
    const dr = (p) => ({ application: 'DR_ACTIVE', mode: 'MODE_MOSAIK', perspective: p });
    assert.strictEqual(L.camState({ application: 'OFF', mode: 0, perspective: 0 }, dr(9)).kind, 'all4');
    assert.strictEqual(L.camState(dr(9), { application: 'OFF', mode: 0, perspective: 0 }).kind, 'all4');
    assert.strictEqual(L.camState(dr(9), { application: 'RFK', mode: 0, perspective: 0 }).kind, 'parking');
    assert.strictEqual(L.camState(undefined, dr(3)).kind, 'left');
});

/* ---------------- the helper's config ---------------- */
const DEF = { enabled: 'on', size: 'medium', place: 'center', target: 'map', quadLeft: 'bl', quadRight: 'br', rotLeft: '0', rotRight: '0', mirror: 'off', zoom: '100', stretch: '100', fps: '12', mode: 'mosaic', layer: 'keep' };
const set = (o) => Object.assign({}, DEF, o);
t('viewConfig: the defaults - the lower quarters, 512x384 in the middle of the map', () => {
    const c = L.viewConfig(DEF, L.parseTargets('map:1088x480,panel:1920x720,hud:800x480'), null);
    assert.strictEqual(c.op, 'config');
    assert.deepStrictEqual([c.target, c.w, c.h, c.x, c.y, c.fps], ['map', 512, 384, 288, 48, 12]);
    assert.deepStrictEqual([c.left, c.right, c.all], ['0,500,500,500', '500,500,500,500', '0,0,1000,1000']);
    assert.deepStrictEqual([c.left_rot, c.right_rot, c.left_flip, c.right_flip, c.left_sar, c.persist, c.exclusive, c.contend], [0, 0, 0, 0, 100, 1, 1, 1]);
});
t('viewConfig: sizes, places, targets; always a width of 4, even height and place, inside the target', () => {
    const T = L.parseTargets('map:1088x480,panel:1920x720,hud:800x480');
    ['small', 'medium', 'large'].forEach((size) => ['center', 'side', 'top', 'bottom'].forEach((place) => ['map', 'panel', 'hud'].forEach((target) => {
        ['0', '90'].forEach((rot) => ['100', '200'].forEach((stretch) => ['mosaic', 'single'].forEach((mode) => [null, 'left', 'right'].forEach((side) => {
            const c = L.viewConfig(set({ size, place, target, rotLeft: rot, rotRight: rot, stretch, mode }), T, side);
            const t = T[target];
            assert.strictEqual(c.w % 4, 0); assert.strictEqual(c.h % 2, 0); assert.strictEqual(c.x % 2, 0); assert.strictEqual(c.y % 2, 0);
            assert.ok(c.w >= 64 && c.h >= 64 && c.x >= 0 && c.y >= 0 && c.x + c.w <= t.w && c.y + c.h <= t.h, JSON.stringify([size, place, target, rot, stretch, mode, side, c]));
        }))));
    })));
    assert.deepStrictEqual([L.viewConfig(set({ size: 'large' }), T).w, L.viewConfig(set({ size: 'large' }), T).h], [640, 480]);
    assert.deepStrictEqual([L.viewConfig(set({ size: 'small' }), T).w, L.viewConfig(set({ size: 'small' }), T).h], [384, 288]);
    assert.strictEqual(L.viewConfig(set({ place: 'side' }), T, 'left').x, 16);
    assert.strictEqual(L.viewConfig(set({ place: 'side' }), T, 'right').x, 1088 - 512 - 16);
    assert.strictEqual(L.viewConfig(set({ place: 'side' }), T, null).x, 288);
    assert.strictEqual(L.viewConfig(set({ place: 'top' }), T).y, 0);
    assert.strictEqual(L.viewConfig(set({ place: 'bottom' }), T).y, 96);
    assert.strictEqual(L.viewConfig(set({ target: 'hud' }), T).x, 144);
});
t('viewConfig: which quarter, turns, the mirror, zoom, stretch, the single-camera mode', () => {
    const T = L.parseTargets('map:1088x480');
    let c = L.viewConfig(set({ quadLeft: 'tl', quadRight: 'tr', rotLeft: '90', rotRight: '270', mirror: 'on' }), T);
    assert.deepStrictEqual([c.left, c.right, c.left_rot, c.right_rot, c.left_flip, c.right_flip], ['0,0,500,500', '500,0,500,500', 90, 270, 1, 1]);
    assert.deepStrictEqual([c.w, c.h], [288, 384]);                 // a 4:3 picture turned is 3:4
    c = L.viewConfig(set({ zoom: '200' }), T);
    assert.deepStrictEqual([c.left, c.right], ['125,625,250,250', '625,625,250,250']);
    c = L.viewConfig(set({ stretch: '200' }), T);
    assert.deepStrictEqual([c.w, c.h, c.left_sar, c.right_sar, c.all_sar], [1024, 384, 200, 200, 100]);
    c = L.viewConfig(set({ stretch: '200', size: 'large' }), T);    // 8:3 at 480 high is wider than the map
    assert.deepStrictEqual([c.w, c.h], [1088, 408]);
    c = L.viewConfig(set({ mode: 'single' }), T);                   // one camera alone: the whole 8:3 picture
    assert.deepStrictEqual([c.left, c.right, c.w, c.h], ['0,0,1000,1000', '0,0,1000,1000', 1024, 384]);
    c = L.viewConfig(set({ layer: 'make' }), T);
    assert.strictEqual(c.persist, 0);
    c = L.viewConfig({}, null);                                     // no settings, no renderer yet
    assert.deepStrictEqual([c.target, c.w, c.h, c.fps], ['map', 512, 384, 12]);
    c = L.viewConfig(set({ target: 'x', size: 'y', fps: '99', rotLeft: '45', quadLeft: 'zz' }), T);
    assert.deepStrictEqual([c.target, c.h, c.fps, c.left_rot, c.left], ['map', 384, 12, 0, '0,500,500,500']);
});
t('parseTargets, zoomCrop', () => {
    assert.deepStrictEqual(L.parseTargets('map:1088x480,hud:800x480'), { map: { w: 1088, h: 480 }, hud: { w: 800, h: 480 } });
    assert.deepStrictEqual(L.parseTargets(''), {});
    assert.deepStrictEqual(L.parseTargets(undefined), {});
    assert.strictEqual(L.zoomCrop(0, 0, 1000, 1000, 100), '0,0,1000,1000');
    assert.strictEqual(L.zoomCrop(0, 0, 1000, 1000, 125), '100,100,800,800');
    assert.strictEqual(L.zoomCrop(500, 500, 500, 500, 150), '584,584,333,333');
    assert.strictEqual(L.zoomCrop(0, 0, 1000, 1000, 'abc'), '0,0,1000,1000');
});

/* ---------------- what to show ---------------- */
const ALL4 = L.camState({ application: 'DR_ACTIVE', mode: 'MODE_MOSAIK', perspective: 9 });
const HELPER = { ok: true, pictureAge: 40, pictureW: 1280, pictureH: 960 };
const base = (o) => Object.assign({ enabled: true, mode: 'mosaic', source: 'auto', side: null, test: null, speed: 30, maxSpeed: 0, cam: ALL4, helper: HELPER }, o);
t('plan: waits for the signal, shows its side, asks the unit for all four cameras', () => {
    assert.deepStrictEqual(L.plan(base({})), { view: 'none', why: 'Chờ xi nhan', want: 7 });
    assert.deepStrictEqual(L.plan(base({ side: 'left' })), { view: 'left', why: '', want: 7 });
    assert.deepStrictEqual(L.plan(base({ side: 'right' })), { view: 'right', why: '', want: 7 });
});
t('plan: off; passive never asks the unit', () => {
    assert.deepStrictEqual(L.plan(base({ enabled: false, side: 'left' })), { view: 'none', why: 'Đang tắt', want: null });
    assert.strictEqual(L.plan(base({ source: 'passive', side: 'left' })).want, null);
    assert.strictEqual(L.plan(base({ source: 'passive', side: 'left' })).view, 'left');     // another app has it on
    assert.strictEqual(L.plan(base({ source: 'passive' })).want, null);
});
t('plan: nothing shown without a fresh picture of the right kind', () => {
    assert.strictEqual(L.plan(base({ side: 'left', helper: { ok: false } })).view, 'none');
    assert.strictEqual(L.plan(base({ side: 'left', helper: null })).view, 'none');
    assert.strictEqual(L.plan(base({ side: 'left', helper: Object.assign({}, HELPER, { pictureAge: -1 }) })).why, 'Chưa có hình từ camera');
    assert.strictEqual(L.plan(base({ side: 'left', helper: Object.assign({}, HELPER, { pictureAge: 4000 }) })).why, 'Luồng camera đang dừng');
    assert.strictEqual(L.plan(base({ side: 'left', cam: L.camState({ application: 'RFK', mode: 0, perspective: 0 }) })).why, 'Xe đang hiện camera đỗ xe');
    assert.strictEqual(L.plan(base({ side: 'left', cam: L.camState({ application: 'SIGNAL_UNFILLED', mode: 0, perspective: 255 }) })).why, 'Hộp camera đang khởi động');
    const fr = L.plan(base({ side: 'left', cam: L.camState({ application: 'DR_ACTIVE', mode: 'MODE_MOSAIK', perspective: 5 }) }));
    assert.strictEqual(fr.view, 'none');
    assert.ok(/chưa ở chế độ 4 camera/.test(fr.why));
    assert.strictEqual(fr.want, 7);                                     // and keeps asking for all four
});
t('plan: the unit\'s state unreadable - the picture\'s shape decides', () => {
    const unknown = L.camState();
    assert.strictEqual(L.plan(base({ side: 'right', cam: unknown })).view, 'right');                        // 1280x960: the four cameras
    assert.strictEqual(L.plan(base({ side: 'right', cam: unknown, helper: Object.assign({}, HELPER, { pictureH: 480 }) })).view, 'none');
});
t('plan / viewConfig: two pictures by turns (G30) - paired in four-camera mode, never in single mode', () => {
    assert.strictEqual(L.viewConfig(DEF, null).pair, 1);
    assert.strictEqual(L.viewConfig(DEF, null).pair_swap, 0);
    assert.strictEqual(L.viewConfig(set({ pairSwap: 'on' }), null).pair_swap, 1);
    assert.strictEqual(L.viewConfig(set({ mode: 'single' }), null).pair, 0);
    const g30 = { ok: true, pictureAge: 30, pictureW: 1280, pictureH: 480, pair: 'sei@17' };
    assert.strictEqual(L.plan(base({ side: 'left', helper: g30 })).view, 'left');                       // the unit says all four
    assert.strictEqual(L.plan(base({ side: 'left', helper: g30, cam: L.camState() })).view, 'left');    // state unreadable: paired counts
    assert.strictEqual(L.plan(base({ side: 'left', helper: Object.assign({}, g30, { pair: 'off' }), cam: L.camState() })).view, 'none');
});
t('plan: the speed limit setting', () => {
    assert.strictEqual(L.plan(base({ side: 'left', maxSpeed: 50, speed: 49 })).view, 'left');
    assert.strictEqual(L.plan(base({ side: 'left', maxSpeed: 50, speed: 51 })).view, 'none');
    assert.strictEqual(L.plan(base({ side: 'left', maxSpeed: 50, speed: null })).view, 'left');             // speed not known: shown
    assert.strictEqual(L.plan(base({ side: 'left', maxSpeed: 0, speed: 180 })).view, 'left');
    assert.strictEqual(L.plan(base({ test: 'left', maxSpeed: 50, speed: 80 })).view, 'left');               // a test is the driver's own tap
});
t('plan: the test buttons work with the feature off and without a signal', () => {
    assert.strictEqual(L.plan(base({ enabled: false, test: 'left' })).view, 'left');
    assert.strictEqual(L.plan(base({ enabled: false, test: 'left' })).want, 7);
    assert.strictEqual(L.plan(base({ test: 'all' })).view, 'all');
    assert.strictEqual(L.plan(base({ test: 'all', side: 'left' })).view, 'all');
    assert.strictEqual(L.plan(base({ test: 'right', side: 'left' })).view, 'right');
    assert.strictEqual(L.plan(base({ test: 'all', cam: L.camState({ application: 'DR_ACTIVE', mode: 'x', perspective: 5 }) })).view, 'all');   // whatever the picture holds
    assert.strictEqual(L.plan(base({ test: 'all', helper: { ok: true, pictureAge: -1 } })).view, 'none');
});
t('plan: single-camera mode asks for the side\'s camera and waits for it', () => {
    const left = L.camState({ application: 'DR_ACTIVE', mode: 'MODE_MOSAIK', perspective: 3 });
    const single = { ok: true, pictureAge: 30, pictureW: 1280, pictureH: 480 };
    assert.deepStrictEqual(L.plan(base({ mode: 'single' })), { view: 'none', why: 'Chờ xi nhan', want: 7 });
    let p = L.plan(base({ mode: 'single', side: 'left' }));               // still the four-camera picture
    assert.strictEqual(p.view, 'none'); assert.strictEqual(p.want, 3);
    p = L.plan(base({ mode: 'single', side: 'left', cam: left, helper: single }));
    assert.deepStrictEqual(p, { view: 'left', why: '', want: 3 });
    p = L.plan(base({ mode: 'single', side: 'right', cam: left, helper: single }));    // the other camera is on
    assert.strictEqual(p.view, 'none'); assert.strictEqual(p.want, 4);
    p = L.plan(base({ mode: 'single', side: 'right', cam: L.camState(), helper: single }));
    assert.strictEqual(p.view, 'right');
    p = L.plan(base({ mode: 'single', side: 'right', cam: L.camState(), helper: HELPER }));
    assert.strictEqual(p.view, 'none');
});

/* ---------------- camera.js against a fake camera unit ---------------- */
function fakeUnit(o) {
    const u = Object.assign({ state: { application: 'OFF', mode: 0, perspective: 0 }, obeys: true, delay: 0, calls: [], nextCookie: 7, readable: true, failAttach: 0 }, o || {});
    u.io = {
        read: () => Promise.resolve(u.readable ? { xv: u.state, icam: u.state } : {}),
        attach: () => { u.calls.push('attach'); if (u.failAttach-- > 0) return Promise.reject(new Error('not there')); return Promise.resolve(u.nextCookie++); },
        request: (cookie, p) => { u.calls.push('request ' + cookie + ' ' + p); if (u.obeys) u.state = { application: 'DR_ACTIVE', mode: 'MODE_MOSAIK', perspective: p === 7 ? 9 : p }; return Promise.resolve(); },
        detach: (cookie) => { u.calls.push('detach ' + cookie); return Promise.resolve(); },
    };
    return u;
}
ta('camera: asks once, sees the view, asks nothing more', async () => {
    const u = fakeUnit();
    let now = 0;
    const cam = camera.create({ io: u.io, now: () => now });
    await cam.tick(7);
    assert.deepStrictEqual(u.calls, ['attach', 'request 7 7']);
    for (let i = 0; i < 20; i++) { now += 500; await cam.tick(7); }
    assert.deepStrictEqual(u.calls, ['attach', 'request 7 7']);
    assert.strictEqual(cam.info().phase, 'on');
    assert.strictEqual(cam.info().cam.kind, 'all4');
    assert.strictEqual(cam.info().attached, true);
});
ta('camera: another app already has the view on - never attaches', async () => {
    const u = fakeUnit({ state: { application: 'DR_ACTIVE', mode: 'MODE_MOSAIK', perspective: 9 } });
    let now = 0;
    const cam = camera.create({ io: u.io, now: () => now });
    for (let i = 0; i < 10; i++) { now += 500; await cam.tick(7); }
    assert.deepStrictEqual(u.calls, []);
    assert.strictEqual(cam.info().attached, false);
    assert.strictEqual(cam.info().phase, 'on');
});
ta('camera: a unit that does not follow - four asks 3 s apart, then a minute of nothing, then again', async () => {
    const u = fakeUnit({ obeys: false });
    let now = 0;
    const cam = camera.create({ io: u.io, now: () => now });
    for (let i = 0; i < 100; i++) { await cam.tick(7); now += 500; }      // 50 s
    assert.deepStrictEqual(u.calls.filter((c) => /^request/.test(c)).length, camera.MAX_TRIES);
    assert.strictEqual(u.calls.filter((c) => c === 'attach').length, 1);
    assert.strictEqual(cam.info().phase, 'waiting');
    for (let i = 0; i < 60; i++) { await cam.tick(7); now += 500; }       // past the minute
    assert.ok(u.calls.filter((c) => /^request/.test(c)).length > camera.MAX_TRIES);
    assert.ok(u.calls.filter((c) => /^request/.test(c)).length <= 2 * camera.MAX_TRIES);
});
ta('camera: waits while a parking view has the cameras, asks again after it', async () => {
    const u = fakeUnit();
    let now = 0;
    const cam = camera.create({ io: u.io, now: () => now });
    await cam.tick(7);
    u.state = { application: 'RFK', mode: 0, perspective: 0 };           // reverse gear
    for (let i = 0; i < 40; i++) { now += 500; await cam.tick(7); }
    assert.deepStrictEqual(u.calls, ['attach', 'request 7 7']);
    assert.strictEqual(cam.info().phase, 'parking view');
    u.state = { application: 'OFF', mode: 0, perspective: 0 };           // the view closed, the mode not back
    now += 500; await cam.tick(7);
    assert.deepStrictEqual(u.calls, ['attach', 'request 7 7', 'request 7 7']);
    now += 500; await cam.tick(7);
    assert.strictEqual(cam.info().phase, 'on');
});
ta('camera: a unit still starting is asked again every 4 s without using up the tries', async () => {
    const u = fakeUnit({ obeys: false, state: { application: 'SIGNAL_UNFILLED', mode: 0, perspective: 255 } });
    let now = 0;
    const cam = camera.create({ io: u.io, now: () => now });
    for (let i = 0; i < 80; i++) { await cam.tick(7); now += 500; }       // 40 s of starting
    const asks = u.calls.filter((c) => /^request/.test(c)).length;
    assert.ok(asks >= 9 && asks <= 11, 'asks ' + asks);
    assert.strictEqual(cam.info().phase, 'starting');
    u.obeys = true;
    now += 4000; await cam.tick(7);
    now += 500; await cam.tick(7);
    assert.strictEqual(cam.info().phase, 'on');
});
ta('camera: another view wanted is asked for at once; nothing wanted detaches', async () => {
    const u = fakeUnit();
    let now = 0;
    const cam = camera.create({ io: u.io, now: () => now });
    await cam.tick(7); now += 100;
    await cam.tick(3); now += 100;                                       // single-camera mode: the left mirror
    assert.deepStrictEqual(u.calls, ['attach', 'request 7 7', 'request 7 3']);
    await cam.tick(3);
    assert.strictEqual(cam.info().cam.kind, 'left');
    now += 100; await cam.tick(7);
    assert.deepStrictEqual(u.calls.slice(-1), ['request 7 7']);
    now += 100; await cam.tick(null);
    assert.deepStrictEqual(u.calls.slice(-1), ['detach 7']);
    assert.strictEqual(cam.info().attached, false);
    now += 100; await cam.tick(null);
    assert.strictEqual(u.calls.filter((c) => /^detach/.test(c)).length, 1);
    const before = u.calls.length;
    now += 100; await cam.tick(7);                                        // wanted again, and the unit still shows it:
    assert.strictEqual(u.calls.length, before);                           // nothing to ask
    u.state = { application: 'OFF', mode: 0, perspective: 0 };
    now += 100; await cam.tick(7);
    assert.deepStrictEqual(u.calls.slice(-2), ['attach', 'request 8 7']);
});
ta('camera: state unreadable - asked once, again every 30 s; a failed attach is tried again', async () => {
    const u = fakeUnit({ readable: false, failAttach: 1 });
    let now = 0;
    const cam = camera.create({ io: u.io, now: () => now });
    await cam.tick(7);
    assert.deepStrictEqual(u.calls, ['attach']);                          // it failed
    for (let i = 0; i < 70; i++) { now += 500; await cam.tick(7); }       // 35 s
    assert.deepStrictEqual(u.calls, ['attach', 'attach', 'request 7 7']);
    assert.strictEqual(cam.info().cam.known, false);
    await cam.release();
    assert.deepStrictEqual(u.calls.slice(-1), ['detach 7']);
});
ta('camera: a tick while one is under way does nothing', async () => {
    const u = fakeUnit();
    let release;
    const slow = new Promise((r) => { release = r; });
    const read = u.io.read;
    u.io.read = () => slow.then(read);
    const cam = camera.create({ io: u.io, now: () => 0 });
    const a = cam.tick(7), b = cam.tick(7), c = cam.tick(7);
    release();
    await Promise.all([a, b, c]);
    assert.deepStrictEqual(u.calls, ['attach', 'request 7 7']);
});

(async () => {
    for (const [name, fn] of tA) { await fn(); n++; console.log('  ok   ' + name); }
    console.log('logic_test: ' + n + ' tests ok');
})().catch((e) => { console.error('  FAIL ' + (e && e.stack || e)); process.exit(1); });
