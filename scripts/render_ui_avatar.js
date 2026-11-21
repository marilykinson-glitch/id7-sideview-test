'use strict';
/**
 * Draws the MGU Studio screen in a few states to PNG files:
 *   node scripts/render_ui_avatar.js <out dir> [car.png start.png face1.png face2.png]
 * Uses the built app's kit (dist/anh_dai_dien, with the Vietnamese fonts): build first.
 */
const fs = require('fs'), path = require('path');
const K = path.join(__dirname, '..', 'dist', 'anh_dai_dien', 'source', 'javascript', 'kit');
const Module = require('module');
const load = Module._load;                              // the app finds the kit as ./kit/...: here it is the built one
Module._load = function (request, parent, isMain) { return load.call(this, /^\.\/kit\//.test(request) ? path.join(K, request.slice(6)) : request, parent, isMain); };
const { Canvas } = require(path.join(K, 'canvas.js'));
const G = require(path.join(K, 'gauges.js'));
const { Recorder, play } = require(path.join(K, 'record.js'));
const themes = require(path.join(K, 'themes.js'));
const UI = require(path.join(__dirname, '..', 'apps', 'anh_dai_dien', 'ui.js'));
const out = process.argv[2] || '/tmp/ui';
fs.mkdirSync(out, { recursive: true });
const theme = themes.theme(themes.ids ? (Array.isArray(themes.ids) ? themes.ids[0] : themes.ids()[0]) : undefined);

const W = require(path.join(__dirname, '..', 'tools', 'anh-dai-dien', 'wbm.js'));
const BOOT = require(path.join(__dirname, '..', 'tools', 'anh-dai-dien', 'boot.js'));
const small = (file, w, h) => { try { const p = BOOT.pngDecode(fs.readFileSync(file)); return W.resize(p.rgba, p.w, p.h, w, h); } catch (e) { return null; } };
const thumbs = {};
if (process.argv[3]) { thumbs[41] = small(process.argv[3], 48, 24); thumbs[51] = small(process.argv[4], 48, 18); thumbs[2] = small(process.argv[5], 24, 24); thumbs[7] = small(process.argv[6], 24, 24); thumbs[1] = small(process.argv[5], 24, 24); thumbs[3] = small(process.argv[6], 24, 24); }
Object.keys(thumbs).forEach((k) => { if (!thumbs[k]) delete thumbs[k]; });
const slots = (changed) => Array.from({ length: 15 }, (_, i) => ({ n: i + 1, changed: changed.indexOf(i + 1) >= 0 }));
const more = (changed) => [[41, 'Hình xe'], [51, 'Khởi động'], [21, 'Nhạc Bluetooth'], [22, 'Nhạc USB'], [23, 'Nhạc'], [24, 'Radio FM'], [25, 'Radio AM'], [26, 'Radio'], [27, 'Người gọi']].map((d) => ({ n: d[0], label: d[1], changed: changed.indexOf(d[0]) >= 0 }));
const base = { state: 'ok', more: more([]), url: 'http://192.168.43.15:8137/?pin=4821', host: '192.168.43.15:8137', pin: '4821', slots: slots([]), thumbs, version: 'Bản 0.10.0', message: 'Sẵn sàng.', messageKind: 'dim', anyChanged: false };
const states = {
    '1-san-sang': base,
    '2-da-doi': Object.assign({}, base, { slots: slots([2, 7]), more: more([41, 51, 21]), anyChanged: true, needsRestart: true, message: 'Đã đổi hình số 7. Khởi động lại màn hình xe để thấy.', messageKind: 'go' }),
    '7-bam-lan-nua': Object.assign({}, base, { slots: slots([2, 7]), more: more([41, 51]), anyChanged: true, needsRestart: true, carWhere: 'tile', armed: 'reboot', note: 'Bấm Khởi động lại lần nữa để xác nhận.', noteKind: 'warn' }),
    '8-da-nhan-lenh': Object.assign({}, base, { slots: slots([2, 7]), more: more([41, 51]), anyChanged: true, needsRestart: true, carWhere: 'tile', note: 'Đã nhận lệnh: màn hình xe đang khởi động lại…', noteKind: 'go' }),
    '3-dang-ghi': Object.assign({}, base, { busy: true, slots: slots([3]), anyChanged: true }),
    '4-chua-co-mang': Object.assign({}, base, { url: '', host: '', pin: '4821' }),
    '5-tro-thu-chua-chay': { state: 'down', slots: [], version: 'Bản 0.7.2' },
    '6-goi-la': { state: 'bad', error: 'Gói ảnh có cấu trúc lạ (pictures are not back to back)', slots: [], version: 'Bản 0.7.2' },
};
// the preview of the start-up screen (the picture of argv[4] at 120 x 45 cells, a light on the logo at the middle)
const { Player } = require(path.join(__dirname, '..', 'apps', 'anh_dai_dien', 'preview.js'));
const pvCells = process.argv[4] ? small(process.argv[4], 120, 45) : null;
if (pvCells) {
    const player = new Player(pvCells, 120, 45, { x: 0.42, y: 0.41, w: 0.165, h: 0.17 });
    const withPv = (kind, f, extra) => Object.assign({}, base, { mode: 'preview', pvReady: true, pv: { buf: player.frame(kind, f), w: 120, h: 45 } }, extra);
    states['9-xem-thu-dang-mo'] = withPv('in', 20, { draft: true, playing: 'both' });
    states['10-xem-thu-toa-sang'] = withPv('in', 42, { draft: true, playing: 'both' });
    states['11-xem-thu-dang-tat'] = withPv('out', 26, { draft: false, playing: 'out' });
    states['12-the-co-ban-nhap'] = Object.assign({}, base, { slots: slots([]), slots: slots([]), more: more([41]), pvReady: true, draft: true, message: 'Đã gửi bản nháp. Xem thử trên màn hình xe, rồi bấm Áp dụng.', messageKind: 'go' });
}
Object.keys(states).forEach((k) => {
    const r = new Recorder(UI.W, UI.H, { textScale: 1 });
    r.own = true;                                   // the kit runs the screen: the page's own buttons are drawn
    UI.draw(r, G, theme, states[k], { openPreview: () => {}, play: () => {}, apply: () => {}, discard: () => {}, back: () => {} });
    const cv = new Canvas(UI.W, UI.H);
    play(r.words(), cv);
    fs.writeFileSync(path.join(out, k + '.png'), cv.png());
    console.log(path.join(out, k + '.png'));
});
