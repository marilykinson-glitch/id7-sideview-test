'use strict';
/**
 * Draws the app's screen in a few states to PNG files: node scripts/render_ui.js <out dir>
 * Uses the built app's kit (dist/xinhan_cam, with the Vietnamese fonts): build first.
 */
const fs = require('fs'), path = require('path');
const K = path.join(__dirname, '..', 'dist', 'xinhan_cam', 'source', 'javascript', 'kit');
const { Canvas } = require(path.join(K, 'canvas.js'));
const G = require(path.join(K, 'gauges.js'));
const { Recorder, play } = require(path.join(K, 'record.js'));
const themes = require(path.join(K, 'themes.js'));
const UI = require(path.join(__dirname, '..', 'apps', 'xinhan_cam', 'ui.js'));
const L = require(path.join(__dirname, '..', 'apps', 'xinhan_cam', 'logic.js'));
const out = process.argv[2] || '/tmp/ui';
fs.mkdirSync(out, { recursive: true });
const T = L.parseTargets('map:1088x480,panel:1920x720,hud:800x480');
const theme = themes.theme(themes.ids ? (Array.isArray(themes.ids) ? themes.ids[0] : themes.ids()[0]) : undefined);
const discs = (s) => { const d = {}; ['left', 'right'].forEach((side) => { const c = L.viewConfig(s, T, side); d[side] = { x: c.x, y: c.y, w: c.w, h: c.h }; }); return d; };
const rows = (sig) => [
    { label: 'Xi nhan', text: sig, kind: 'go' }, { label: 'Hộp camera', text: 'DR_ACTIVE/MODE_MOSAIK/7 · đúng chế độ', kind: 'go' },
    { label: 'Luồng hình', text: '1280x480 · 30 hình/giây · ghép 2 khung (sei@19)', kind: 'go' }, { label: 'Đồng hồ', text: 'sẵn sàng · panel 320x320', kind: 'go' }];
const base = { page: 0, edit: 'left', enabled: true, round: true, gauge: true, sizeLabel: 'Vừa khít (320)', front: 'tắt', discs: discs({}), version: 'Bản 0.4.0 · trợ thủ 0.4.0' };
const f = L.frontConfig({}, T);
const states = {
    '1-cho': Object.assign({}, base, { title: 'Chờ xi nhan', titleKind: 'dim', subtitle: 'Bật xi nhan để xem camera gương bên đó trên đồng hồ', rows: rows('Tắt'), shown: null }),
    '2-trai': Object.assign({}, base, { title: 'Đang hiện camera trái', titleKind: 'go', rows: rows('Trái'), shown: 'left' }),
    '3-truoc': Object.assign({}, base, { title: 'Đang hiện camera trước', titleKind: 'go', rows: rows('Tắt'), shown: 'front', front: 'dưới 30 km/h', frontRect: { x: UI.MAP.x + f.x, y: UI.MAP.y + f.y, w: f.w, h: f.h } }),
    '4-vitri': Object.assign({}, base, { page: 1, edit: 'left', shown: 'left', discs: discs({ gaugeDx: 40, gaugeDy: -30 }), note: 'Đang hiện trên đồng hồ', noteKind: 'go' }),
    '5-canhchinh-truoc': Object.assign({}, base, { page: 2, calCam: 'front', note: 'Đang hiện trên đồng hồ', noteKind: 'go',
        calRows: Object.keys(L.CALIB).map((k) => ({ key: k, label: { calH: 'Độ cao camera', calPitch: 'Chúc xuống', calFov: 'Góc nhìn', calYaw: 'Lệch trái / phải', calShift: 'Dịch ngang', calCurve: 'Độ cong (mắt cá)', frontZoom: 'Phóng to' }[k], text: String(L.CALIB[k].d) })) }),
    '6-canhchinh-guong': Object.assign({}, base, { page: 2, calCam: 'left', note: 'Đang hiện trên đồng hồ', noteKind: 'go', calText: 'Dịch ngang 40 · dọc -20 · phóng 120 %' }),
    '7-danduong': Object.assign({}, base, { page: 3, arLabel: 'Khi sắp rẽ', arCard: true, demo: false, navRows: [
        { label: 'Đọc dẫn đường', text: 'đang đọc', kind: 'go' }, { label: 'Nguồn', text: 'Android Auto', kind: 'go' },
        { label: 'Lệnh kế tiếp', text: 'Rẽ phải · còn 180 m', kind: 'go' }, { label: 'Dữ liệu thô', text: '{"maneuver":{"intersection":{"direction":"RIGHT","formattedDistance":{"distance":"180","unit":"METER"}}}}', kind: 'dim' }] }),
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
