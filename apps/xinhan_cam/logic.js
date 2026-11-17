'use strict';
/**
 * logic.js - everything Camera xi nhan decides, as pure functions (no kit, no car): the tests run
 * them as they are. Node 8.
 *
 *   decode(value)            a de.bmw.body.Light indicator event -> { direction, kind, raw }
 *   createBlinker(opts)      the turn signals over time -> the side whose camera is wanted
 *   camState(xv, icam)       the camera unit's state -> what its picture holds
 *   viewConfig(settings, targets, kind)   the settings -> the helper's config (crop, turn, size, place)
 *   plan(input)              all of it -> { view, why, want } for this moment
 */

/* ---------------- turn signals ---------------- */

// de.bmw.body.Light StatusFunctionsIndicators / StatusFunctionsIndicators2, as read on a G30 (iDrive 7):
// controlIndicateDirection is what the stalk asks for, activeFunctionIndicateDirection what blinks.
const CONTROL = {
    BLINKEN_AUS: 0,
    TIPP_BLINKEN_LINKS_EIN: 1,
    TIPP_BLINKEN_RECHTS_EIN: 2,
    DAUER_BLINKEN_LINKS_EIN: 3,
    DAUER_BLINKEN_RECHTS_EIN: 4,
    BEIDSEITIGES_BLINKEN_EIN: 8,
};
const CONTROL_DIR = { 0: 'OFF', 1: 'LEFT', 2: 'RIGHT', 3: 'LEFT', 4: 'RIGHT', 8: 'HAZARD' };
const CONTROL_KIND = { 1: 'tip', 2: 'tip', 3: 'steady', 4: 'steady' };
const ACTIVE_DIR = { 0: 'OFF', 6: 'HAZARD', 7: 'LEFT', 8: 'RIGHT', 9: 'LEFT', 10: 'RIGHT' };

/** The first value under `key` anywhere in a (nested) event value. */
function field(value, key) {
    if (!value || typeof value !== 'object') return undefined;
    if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) {
        const found = field(value[keys[i]], key);
        if (found !== undefined) return found;
    }
    return undefined;
}

/**
 * One indicator event: direction 'LEFT' | 'RIGHT' | 'HAZARD' | 'OFF' | undefined (the event says
 * nothing about the indicators), kind 'tip' (the three-blink lane-change tap) | 'steady' | null.
 */
function decode(value) {
    const command = field(value, 'controlIndicateDirection');
    const active = field(value, 'activeFunctionIndicateDirection');
    const code = Object.prototype.hasOwnProperty.call(CONTROL, command) ? CONTROL[command] : command;
    const commanded = CONTROL_DIR[code];
    const a = String(active);
    const observed = ACTIVE_DIR[active]
        || (/^(?:DAUERBLINKEN|TIPPBLINKEN)_LINKS$/.test(a) ? 'LEFT' : undefined)
        || (/^(?:DAUERBLINKEN|TIPPBLINKEN)_RECHTS$/.test(a) ? 'RIGHT' : undefined)
        || (/^WARNBLINKEN/.test(a) ? 'HAZARD' : undefined);
    const direction = commanded && commanded !== 'OFF' ? commanded : observed || commanded;
    let kind = null;
    if (direction === 'LEFT' || direction === 'RIGHT') {
        kind = CONTROL_KIND[code] || (/^TIPPBLINKEN/.test(a) ? 'tip' : /^DAUERBLINKEN/.test(a) ? 'steady' : null);
    }
    return { direction, kind, raw: String(command === undefined || command === null ? '-' : command) + ' / ' + String(active === undefined || active === null ? '-' : active) };
}

/**
 * The side whose camera is wanted, from the indicator events as they come.
 *   b.event(direction, kind, now)   one decoded event (direction undefined: ignored)
 *   b.side(now)                     'left' | 'right' | null
 *   b.state()                       'LEFT' | 'RIGHT' | 'HAZARD' | 'OFF' | 'WAITING' (no event yet)
 * opts: holdMs (the side stays this long after its signal goes off: covers the dark half of a blink
 * and the moment after a turn), tip (false: the three-blink tap does not show the camera),
 * maxMs (a signal left on longer than this is taken as a missed "off": 0 = never).
 */
function createBlinker(opts) {
    let o = Object.assign({ holdMs: 2000, tip: true, maxMs: 0 }, opts || {});
    let dir = 'WAITING', side = null, onAt = 0, offAt = null;
    return {
        configure(next) { o = Object.assign({}, o, next || {}); },
        event(direction, kind, now) {
            if (!direction) return;
            dir = direction;
            if (direction === 'LEFT' || direction === 'RIGHT') {
                if (kind === 'tip' && !o.tip) {
                    // a tap while the other side's camera still shows ends that one too
                    if (side && offAt === null) offAt = now;
                    return;
                }
                const s = direction === 'LEFT' ? 'left' : 'right';
                if (s !== side || offAt !== null) onAt = now;
                side = s;
                offAt = null;
            } else if (direction === 'HAZARD') {
                side = null;             // both sides blink: no camera, at once
                offAt = null;
            } else if (side && offAt === null) {
                offAt = now;             // OFF: the side stays for holdMs
            }
        },
        side(now) {
            if (!side) return null;
            if (offAt !== null && now - offAt >= o.holdMs) { side = null; offAt = null; return null; }
            if (offAt === null && o.maxMs && now - onAt >= o.maxMs) { side = null; return null; }
            return side;
        },
        state() { return dir; },
    };
}

/* ---------------- the camera unit ---------------- */

// CurrentState.application of a parking view (TOPREARVIEW 1, SIDEVIEW 2, RFK 3, OFFROAD 20, REMOTE360 60):
// the driver is looking at the cameras on the centre screen, the stream is that view's
const PARKING = /^(TOPREARVIEW|SIDEVIEW|RFK|OFFROAD|REMOTE360|1|2|3|20|60)$/;
const DR = /^(DR_ACTIVE|51)$/;
// CurrentState.perspective in Drive Recorder mode -> what the picture holds
const ALL4 = [7, 9, 10], FRONT_REAR = [5, 6];

/**
 * What the camera unit shows, from XView3D.CurrentState and ICAM2Proxy.currentState (either may be
 * missing): { known, text, ready, parking, dr, perspective, kind } with kind
 * 'all4' (the four cameras in one picture) | 'left' | 'right' | 'front' | 'rear' | 'frontrear' |
 * 'parking' | 'starting' | 'other' | 'unknown' (no state could be read).
 */
function camState(xv, icam) {
    const states = [xv, icam].filter((s) => s && typeof s === 'object');
    if (!states.length) return { known: false, text: 'không đọc được', ready: false, parking: false, dr: false, perspective: null, kind: 'unknown' };
    const one = (s) => {
        const app = String(s.application), p = Number(s.perspective);
        const starting = /SIGNAL_UNFILLED|^255$/.test(app) || p === 255;
        const dr = DR.test(app);
        let kind = 'other';
        if (starting) kind = 'starting';
        else if (PARKING.test(app)) kind = 'parking';
        else if (dr && ALL4.indexOf(p) >= 0) kind = 'all4';
        else if (dr && p === 3) kind = 'left';
        else if (dr && p === 4) kind = 'right';
        else if (dr && p === 1) kind = 'front';
        else if (dr && p === 2) kind = 'rear';
        else if (dr && FRONT_REAR.indexOf(p) >= 0) kind = 'frontrear';
        return { known: true, text: s.application + '/' + s.mode + '/' + s.perspective, ready: !starting, parking: kind === 'parking', dr, perspective: Number.isFinite(p) ? p : null, kind };
    };
    const all = states.map(one);
    // the one that shows a view we can use counts (either service may lag behind the other)
    const useful = all.filter((s) => ['all4', 'left', 'right'].indexOf(s.kind) >= 0)[0];
    const parking = all.filter((s) => s.parking)[0];
    return parking || useful || all[0];
}

/* ---------------- the helper's config ---------------- */

const QUADS = { tl: [0, 0], tr: [500, 0], bl: [0, 500], br: [500, 500] };
const HEIGHTS = { small: 288, fit: 320, medium: 384, large: 480 };
const GAUGE = { cx: 380, cy: 400 };

/** "map:1088x480,panel:1920x720,hud:800x480" -> { map: { w, h }, ... } */
function parseTargets(text) {
    const out = {};
    String(text || '').split(',').forEach((part) => {
        const m = /^([a-z0-9_]+):(\d+)x(\d+)$/i.exec(part.trim());
        if (m) out[m[1]] = { w: Number(m[2]), h: Number(m[3]) };
    });
    return out;
}

/** A crop "x,y,w,h" (1/1000) zoomed in about its middle: zoom 100 = all of it, 200 = the middle half. */
function zoomCrop(x, y, w, h, zoom) {
    const z = Math.max(100, Math.min(400, Number(zoom) || 100));
    const nw = Math.max(50, Math.round(w * 100 / z)), nh = Math.max(50, Math.round(h * 100 / z));
    return [Math.round(x + (w - nw) / 2), Math.round(y + (h - nh) / 2), nw, nh].join(',');
}

/**
 * The helper's config for these settings.
 * mode 'mosaic': each side is its quarter of the four-camera picture; 'single': the camera unit sends
 * the wanted mirror camera alone and the view is the whole picture.
 * targets: the cluster renderer's (parseTargets); side: the side shown, for "place: side".
 */
function viewConfig(settings, targets, side, view) {
    const s = settings || {};
    if (view === 'front') return frontConfig(s, targets);
    // "gauge": the view sits inside the dial on the signal's side (left: the speedometer, right: the rev
    // counter), which only the whole-cluster target reaches
    const gauge = s.place === 'gauge' || s.place === undefined;
    const target = gauge ? 'panel' : ['map', 'panel', 'hud'].indexOf(s.target) >= 0 ? s.target : 'map';
    const t = (targets && targets[target]) || { map: { w: 1088, h: 480 }, panel: { w: 1920, h: 720 }, hud: { w: 800, h: 480 } }[target];
    const single = s.mode === 'single';
    const stretch = [100, 150, 200].indexOf(Number(s.stretch)) >= 0 ? Number(s.stretch) : 100;
    const rot = (k) => ([0, 90, 180, 270].indexOf(Number(s[k])) >= 0 ? Number(s[k]) : 0);
    const quad = (k, d) => QUADS[s[k]] || QUADS[d];
    const round = s.shape !== 'square';
    const ql = quad('quadLeft', 'bl'), qr = quad('quadRight', 'br');
    // the picture's shape on the cluster: a quarter of the four-camera picture is 4:3, a single camera is 8:3;
    // "stretch" widens it when the camera unit squeezed the picture sideways
    const base = single ? 8 / 3 : 4 / 3;
    const wide = base * stretch / 100;
    // round: a part of the picture as wide as it is high on the cluster (1 / wide of its width), zoomed.
    // "aim" slides that part along the car: a mirror camera looks straight out sideways, so the road
    // behind is at the edge of its picture away from the car's front - the left edge of the left camera's
    // picture, the right edge of the right one's ('rear', what a blind-spot monitor shows); 'front' the
    // other edge, 'side' the middle.
    const aim = s.aim === 'side' || s.aim === 'front' ? s.aim : 'rear';
    const fine = (k) => Math.max(-500, Math.min(500, Number(s[k]) || 0));
    const part = (x, y, w, h, isLeft) => {
        // zoomL / zoomR (the Calibrate page, per camera) come on top of the "zoom" setting
        const z = Math.max(100, Math.min(400, (Number(s.zoom) || 100) * Math.max(100, Math.min(300, Number(s[isLeft ? 'zoomL' : 'zoomR']) || 100)) / 100));
        let nw = (round && wide > 1 ? w / wide : w) * 100 / z;
        const nh = Math.max(50, h * 100 / z);
        nw = Math.max(50, nw);
        const slack = w - nw;
        const towardsLeft = (aim === 'rear') === isLeft;         // rear: left camera -> left edge, right camera -> right edge
        let nx = aim === 'side' ? x + slack / 2 : towardsLeft ? x : x + slack;
        let ny = y + (h - nh) / 2;
        // the Calibrate page's fine setting of this camera: moved by thousandths of its own picture, kept inside it
        nx = Math.max(x, Math.min(x + w - nw, nx + fine(isLeft ? 'panLx' : 'panRx') * w / 1000));
        ny = Math.max(y, Math.min(y + h - nh, ny + fine(isLeft ? 'panLy' : 'panRy') * h / 1000));
        return [Math.round(nx), Math.round(ny), Math.round(nw), Math.round(nh)].join(',');
    };
    const left = single ? part(0, 0, 1000, 1000, true) : part(ql[0], ql[1], 500, 500, true);
    const right = single ? part(0, 0, 1000, 1000, false) : part(qr[0], qr[1], 500, 500, false);
    const turned = (r) => r === 90 || r === 270;
    const shape = (r) => (round ? 1 : turned(r) ? 1 / wide : wide);
    // one layer for both sides: as wide as the wider of the two
    const aspect = Math.max(shape(rot('rotLeft')), shape(rot('rotRight')));
    let h = HEIGHTS[s.size] || (gauge ? HEIGHTS.fit : HEIGHTS.medium);
    if (h > t.h) h = t.h;
    let w = Math.round(h * aspect);
    if (w > t.w) { w = t.w; h = Math.round(w / aspect); }
    w = Math.max(64, w - (w % 4));
    h = Math.max(64, h - (h % 2));
    let x = Math.round((t.w - w) / 2), y = Math.round((t.h - h) / 2);
    if (s.place === 'side' && side === 'left') x = Math.min(x, 16);
    if (s.place === 'side' && side === 'right') x = Math.max(x, t.w - w - 16);
    if (s.place === 'top') y = 0;
    if (s.place === 'bottom') y = t.h - h;
    if (gauge) {
        // the dials' free middles on the 1920x720 cluster of a G30 (Live Cockpit Professional), measured
        // from photos of the car: GAUGE.cx in from each side, GAUGE.cy down; gaugeDx moves the view towards
        // the middle of the cluster (negative: outwards), gaugeDy down
        const dx = Math.max(-400, Math.min(400, Number(s.gaugeDx) || 0)), dy = Math.max(-200, Math.min(200, Number(s.gaugeDy) || 0));
        const cx = side === 'right' ? t.w - GAUGE.cx - dx : GAUGE.cx + dx;
        x = Math.round(cx - w / 2);
        y = Math.round(GAUGE.cy + dy - h / 2);
        x = Math.max(0, Math.min(t.w - w, x));
        y = Math.max(0, Math.min(t.h - h, y));
    }
    x -= x % 2;
    y -= y % 2;
    const fps = [8, 10, 12, 15].indexOf(Number(s.fps)) >= 0 ? Number(s.fps) : 12;
    const flip = s.mirror === 'on' ? 1 : 0;
    return {
        op: 'config', target, w, h, x, y, fps, klass: 'overlay', exclusive: 1, contend: 1, persist: s.layer === 'make' ? 0 : 1,
        left, left_rot: rot('rotLeft'), left_flip: flip, left_sar: stretch, left_round: round ? 1 : 0,
        right, right_rot: rot('rotRight'), right_flip: flip, right_sar: stretch, right_round: round ? 1 : 0,
        all: '0,0,1000,1000', all_rot: 0, all_flip: 0, all_sar: 100,
        front: frontCrop(s), front_rot: 0, front_flip: 0, front_sar: 100, front_round: 0,
        // a car whose camera unit sends the four cameras as two wide pictures by turns: the helper puts
        // them one above the other, and the quarters above are of that picture
        pair: single ? 0 : 1, pair_swap: s.pairSwap === 'on' ? 1 : 0,
    };
}

const FRONT_CROP = '0,0,500,500';      // the front camera: the upper left quarter of the four-camera picture
/** The front camera's part shown: the middle of its quarter, by the Calibrate page's "frontZoom" (percent). */
function frontCrop(s) {
    const z = Math.max(100, Math.min(300, Number(s && s.frontZoom) || 100));
    if (s && s.frontSize === 'wide') {
        // a strip as wide as the camera's picture and 0.6 of that high (20:9 on the cluster), moved up or
        // down by "frontPanY" so the horizon can be put where BMW's own view has it
        const w = 500 * 100 / z, h = w * 0.6;
        const y = Math.max(0, Math.min(500 - h, 250 - h / 2 + calib(s, 'frontPanY') * 500 / 1000));
        return [Math.round((500 - w) / 2), Math.round(y), Math.round(w), Math.round(h)].join(',');
    }
    return z === 100 ? FRONT_CROP : zoomCrop(0, 0, 500, 500, z);
}
// wide: BMW's Augmented View fills the cluster's middle from dial to dial, its edges fading out
const FRONT_SIZES = { small: [384, 288], medium: [512, 384], large: [640, 480], wide: [960, 432] };

/**
 * The config while the front camera shows (the "front" setting): a 4:3 rectangle in the middle of the
 * cluster's map area, over the map. Its own layer geometry: the helper makes the layer again when a
 * turn signal brings a mirror camera up, and again after it.
 */
function frontConfig(s, targets) {
    const t = (targets && targets.map) || { w: 1088, h: 480 };
    const size = FRONT_SIZES[s.frontSize] || FRONT_SIZES.medium;
    let w = Math.min(size[0], t.w), h = Math.min(size[1], t.h);
    w -= w % 4;
    h -= h % 2;
    let x = Math.round((t.w - w) / 2), y = Math.round((t.h - h) / 2);
    x -= x % 2;
    y -= y % 2;
    const fps = [8, 10, 12, 15].indexOf(Number(s.fps)) >= 0 ? Math.min(Number(s.fps), 10) : 10;   // a large picture: easy on the link
    return {
        op: 'config', target: 'map', w, h, x, y, fps, klass: 'overlay', exclusive: 1, contend: 1, persist: s.layer === 'make' ? 0 : 1,
        front: frontCrop(s), front_rot: 0, front_flip: 0, front_sar: 100, front_round: 0,
        all: '0,0,1000,1000', all_rot: 0, all_flip: 0, all_sar: 100,
        pair: 1, pair_swap: s.pairSwap === 'on' ? 1 : 0,
    };
}

/* ---------------- what to show now ---------------- */

/**
 * input: {
 *   enabled, mode ('mosaic' | 'single'), source ('auto' | 'passive'),
 *   side ('left' | 'right' | null: the blinker's), test ('left' | 'right' | 'all' | null),
 *   speed (km/h or null), maxSpeed (0: any), cam (camState()),
 *   helper: { ok, pictureAge, pictureW, pictureH } (the helper's status; ok false: not running)
 * }
 * (also front: 'off' | 'always' | 'slow30' | 'slow60', and test may be 'front')
 * -> { view: 'left' | 'right' | 'front' | 'all' | 'none', why (when none, or what holds it up), want }
 * want: the perspective to ask the camera unit for (7 all four, 3 left, 4 right), or null to ask for
 * nothing (off, or "passive": use what another app has on).
 */
/** Whether the "front" setting wants the front camera now: 'always', or 'slow30' / 'slow60' below that speed. */
function frontWanted(i) {
    const f = i.front;
    if (f === 'always') return true;
    const m = /^slow(\d+)$/.exec(String(f || ''));
    if (!m) return false;
    return i.speed !== null && i.speed !== undefined && i.speed <= Number(m[1]);
}

/** How near the next turn has to be for "ar: near" to bring the front camera up, in metres. */
const AR_NEAR_M = 250;
/** Whether the "ar" setting wants the front camera with the route on it now. i.nav: the helper's (navState()). */
function arWanted(i) {
    const n = i.nav;
    if (!n || !n.active || (i.arMode !== 'near' && i.arMode !== 'always')) return false;
    if (i.arMode === 'always') return true;
    return typeof n.meters === 'number' && n.meters >= 0 && n.meters <= AR_NEAR_M;
}

/** The numbers of the Calibrate page for the front camera, with their limits, steps and defaults. */
const CALIB = {
    calH: { d: 70, min: 30, max: 150, step: 5 },          // cm above the road
    calPitch: { d: 8, min: -10, max: 45, step: 1 },       // degrees down
    calFov: { d: 100, min: 40, max: 190, step: 5 },       // degrees across the picture
    calYaw: { d: 0, min: -20, max: 20, step: 1 },         // degrees to the right
    calShift: { d: 0, min: -100, max: 100, step: 5 },     // cm to the right of the car's middle
    calCurve: { d: 40, min: 0, max: 100, step: 10 },      // 0 straight lines .. 100 fisheye
    frontZoom: { d: 100, min: 100, max: 300, step: 10 },  // percent
    frontPanY: { d: 0, min: -200, max: 200, step: 10 },   // the wide view's strip moved down, thousandths of the camera's picture
};
const calib = (s, k) => {
    const c = CALIB[k], v = Number(s && s[k]);
    return Number.isFinite(v) && s[k] !== '' && s[k] !== null && s[k] !== undefined ? Math.max(c.min, Math.min(c.max, v)) : c.d;
};
/**
 * What the helper draws on the front camera: mode 'off' | 'marks' (the Calibrate page) | 'route' (the
 * navigation's next turn, which the helper has itself) | 'demo' (a made-up turn coming nearer).
 * speed (km/h or null): between two distances from the navigation the helper counts the turn nearer by it.
 */
/**
 * The helper's second view: the mirror camera of `side` on a layer of its own, where and as viewConfig
 * puts it when it shows alone. null: none.
 */
function auxConfig(s, targets, side) {
    if (side !== 'left' && side !== 'right') return null;
    const c = viewConfig(s, targets, side, side);
    return { side, target: c.target, w: c.w, h: c.h, x: c.x, y: c.y, fps: Math.min(c.fps, 10), crop: c[side], rot: c[side + '_rot'],
        flip: c[side + '_flip'], sar: c[side + '_sar'], round: c[side + '_round'] };
}

function arConfig(s, mode, speed) {
    return {
        mode: ['marks', 'route', 'demo'].indexOf(mode) >= 0 ? mode : 'off',
        height_cm: calib(s, 'calH'), pitch_x10: Math.round(calib(s, 'calPitch') * 10), fov: calib(s, 'calFov'),
        yaw_x10: Math.round(calib(s, 'calYaw') * 10), shift_cm: calib(s, 'calShift'), curve: calib(s, 'calCurve'),
        card: s && s.arCard === 'off' ? 0 : 1,
        white: s && s.arColor === 'blue' ? 0 : 1,
        style: s && s.arStyle === 'road' ? 1 : 0, fade: s && s.frontSize === 'wide' ? 1 : 0,
        speed: typeof speed === 'number' && speed >= 0 ? Math.round(speed) : -1,
    };
}

function plan(i) {
    const none = (why, want) => ({ view: 'none', why, want: want === undefined ? null : want });
    if (!i.enabled && !i.test) return none('Đang tắt');
    const single = i.mode === 'single';
    const ask = i.source !== 'passive';
    const side = i.test === 'left' || i.test === 'right' ? i.test : i.test === 'all' ? null : i.side;
    // what the camera unit should send: in single mode the wanted mirror camera while a side is on,
    // else (and always in mosaic mode) all four, which is also what Drive Recorder keeps on
    const want = !ask ? null : single && side ? (side === 'left' ? 3 : 4) : 7;
    // the front camera in the middle of the cluster while no signal is on (the "front" setting, or its test
    // button): only from the four-camera picture, so never in the moments single mode has one camera on
    // also while the navigation's next turn is near (the "ar" setting), and for the Calibrate page and the demo
    const arOn = !i.test && !side && i.enabled && arWanted(i);
    const frontTest = i.test === 'front' || i.test === 'calfront' || i.test === 'ardemo';
    const frontOn = frontTest || arOn || (!i.test && !side && i.enabled && frontWanted(i));
    // "dual": with a turn signal on, the front camera stays in the middle and the mirror camera gets a layer of
    // its own inside its dial - while the route is drawn ('nav'), or whenever the front camera would show
    // ('always'). Not while the renderer refused that second layer (the display holds two videos): then the
    // mirror camera alone, as without it.
    const dualAr = !!i.side && !i.test && i.enabled && !single && arWanted(i);
    const dual = !i.auxRefused && !i.test && !!i.side && !single && i.enabled &&
        ((i.dual === 'nav' && dualAr) || (i.dual === 'always' && (dualAr || frontWanted(i))));
    const ar = i.test === 'calfront' ? 'marks' : i.test === 'ardemo' ? 'demo' : arOn ? 'route' : 'off';
    if (!side && i.test !== 'all' && !frontOn) return none(i.frontWhy || 'Chờ xi nhan', want);
    if (!i.test && i.maxSpeed && i.speed !== null && i.speed !== undefined && i.speed > i.maxSpeed) {
        return none('Xe chạy nhanh hơn ' + i.maxSpeed + ' km/h', want);
    }
    const h = i.helper || {};
    if (!h.ok) return none('Trợ thủ xinhan-cam chưa chạy', want);
    const cam = i.cam || { kind: 'unknown' };
    if (cam.kind === 'parking') return none('Xe đang hiện camera đỗ xe', want);
    if (cam.kind === 'starting') return none('Hộp camera đang khởi động', want);
    if (h.pictureAge === null || h.pictureAge === undefined || h.pictureAge < 0) return none('Chưa có hình từ camera', want);
    if (h.pictureAge > 1500) return none('Luồng camera đang dừng', want);
    if (i.test === 'all') return { view: 'all', why: '', want };
    if (frontOn) {
        const four = (i.cam || {}).kind === 'all4' || ((i.cam || {}).kind === 'unknown' && (h.pictureH >= 800 || (!!h.pair && h.pair !== 'off')));
        if (!four) return none('Chờ xi nhan', want);
        return { view: 'front', why: '', want, ar };
    }
    // the four-camera picture is 1280x960, or two 1280x480 pictures by turns (the helper pairs them); one camera is 1280x480
    const tall = h.pictureH >= 800 || (!!h.pair && h.pair !== 'off');
    if (single) {
        // the wanted camera alone: the unit says so, or (state unreadable) the picture is a single camera's
        const on = cam.kind === side || (cam.kind === 'unknown' && !tall);
        if (!on) return none('Chờ hộp camera chuyển sang camera ' + (side === 'left' ? 'trái' : 'phải'), want);
        return { view: side, why: '', want };
    }
    const on = cam.kind === 'all4' || (cam.kind === 'unknown' && tall);
    if (!on) {
        if (cam.kind === 'unknown') return none('Hình camera không phải dạng ghép 4 camera', want);
        return none('Hộp camera chưa ở chế độ 4 camera (' + cam.text + ')', want);
    }
    if (dual) return { view: 'front', why: '', want, ar: dualAr ? 'route' : 'off', aux: side };
    return { view: side, why: '', want };
}

module.exports = { decode, field, createBlinker, camState, parseTargets, zoomCrop, viewConfig, frontConfig, plan, CONTROL, HEIGHTS, GAUGE, FRONT_SIZES, frontCrop, auxConfig, arWanted, arConfig, calib, CALIB, AR_NEAR_M };
