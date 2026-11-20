'use strict';
/**
 * Draws the Ảnh đại diện screen in a few states to PNG files:
 *   node scripts/render_ui_avatar.js <out dir> [wbitmaps.res wbitmaps.res.ids | the tool's run folder]
 * Uses the built app's kit (dist/anh_dai_dien, with the Vietnamese fonts): build first. With a bundle the
 * fifteen pictures are the real ones, else flat colours.
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
const W = require(path.join(__dirname, '..', 'tools', 'anh-dai-dien', 'wbm.js'));
const out = process.argv[2] || '/tmp/ui';
fs.mkdirSync(out, { recursive: true });
const theme = themes.theme(themes.ids ? (Array.isArray(themes.ids) ? themes.ids[0] : themes.ids()[0]) : undefined);

const thumbs = {};
for (let n = 1; n <= 15; n++) {
    if (process.argv[3] && !process.argv[4]) thumbs[n] = fs.readFileSync(path.join(process.argv[3], 't' + (n < 10 ? '0' : '') + n + '.rgba'));
    else if (process.argv[3]) {
        if (n === 1) global.B = new W.Bundle(fs.readFileSync(process.argv[3]), fs.readFileSync(process.argv[4], 'utf8'));
        const full = W.flipRows(global.B.rgba('S' + (n < 10 ? '0' : '') + n), W.SIZE, W.SIZE);
        thumbs[n] = W.shrink(full, W.SIZE, W.SIZE, UI.SMALL);
    } else {
        const b = Buffer.alloc(UI.SMALL * UI.SMALL * 4);
        for (let i = 0; i < b.length; i += 4) { b[i] = 40 + n * 12; b[i + 1] = 90; b[i + 2] = 200 - n * 8; b[i + 3] = 255; }
        thumbs[n] = b;
    }
}
const slots = (changed) => Array.from({ length: 15 }, (_, i) => ({ n: i + 1, changed: changed.indexOf(i + 1) >= 0 }));
const more = (changed) => ['Hình xe', 'Khởi động', 'Nhạc Bluetooth', 'Nhạc USB', 'Nhạc', 'Radio FM', 'Radio AM', 'Radio', 'Người gọi'].map((label, i) => ({ n: 21 + i, label, changed: changed.indexOf(21 + i) >= 0 }));
const base = { state: 'ok', ipCount: 3, ipIndex: 0, more: more([]), url: 'http://192.168.43.15:8137/?pin=4821', host: '192.168.43.15:8137', pin: '4821', slots: slots([]), thumbs, version: 'Bản 0.6.0', message: 'Sẵn sàng.', messageKind: 'dim', anyChanged: false };
const states = {
    '1-san-sang': base,
    '2-da-doi': Object.assign({}, base, { slots: slots([2, 7]), more: more([21, 22, 23]), anyChanged: true, needsRestart: true, message: 'Đã đổi hình số 7. Khởi động lại màn hình xe để thấy.', messageKind: 'go' }),
    '3-dang-ghi': Object.assign({}, base, { busy: true, slots: slots([3]), anyChanged: true }),
    '4-chua-co-mang': Object.assign({}, base, { url: '', host: '', pin: '4821' }),
    '5-tro-thu-chua-chay': { state: 'down', slots: [], thumbs: {}, version: 'Bản 0.6.0' },
    '6-goi-la': { state: 'bad', error: 'Gói ảnh có cấu trúc lạ (pictures are not back to back)', slots: [], thumbs: {}, version: 'Bản 0.6.0' },
};
Object.keys(states).forEach((k) => {
    const r = new Recorder(UI.W, UI.H, { textScale: 1 });
    r.own = true;                                   // the kit runs the screen: the page's own buttons are drawn
    UI.draw(r, G, theme, states[k], {});
    const cv = new Canvas(UI.W, UI.H);
    play(r.words(), cv);
    fs.writeFileSync(path.join(out, k + '.png'), cv.png());
    console.log(path.join(out, k + '.png'));
});
