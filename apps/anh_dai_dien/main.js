'use strict';
/**
 * MGU Studio - the screen of the tool anh-dai-dien (tools/anh-dai-dien), which does the work: a web page for the
 * phone (pick a photo, crop it), writing it into the head unit's files, the backup and the restore. This app shows
 * how to reach the page (a QR code and a PIN), what is changed now, and has two buttons: restart the head unit,
 * restore everything. Each asks once more before it runs, and says at once that it was pressed.
 *
 *   the tool  -> /run/anh-dai-dien/status.json, t41.rgba, t51.rgba, t01.rgba .. t15.rgba, p51.rgba   (RAM; read here)
 *   this app  -> <its folder>/data/command.json  { id, cmd: 'restore_all' | 'reboot' | 'apply_draft' | 'discard_draft' }
 *
 * Node 8.
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const { Canvas } = require('./kit/canvas');
const UI = require('./ui');
const { Player, FPS, FRAMES } = require('./preview');

const RUN = process.env.ANH_RUN || '/run/anh-dai-dien';
const STALE_MS = 6000;           // the tool writes every 1.5 s

/** Smooth area-average shrink from sw x sw to dw x dw RGBA. */
function shrinkSquare(src, sw, dw) {
    const out = Buffer.allocUnsafe(dw * dw * 4), k = sw / dw;
    for (let y = 0; y < dw; y++) {
        const y0 = y * k, y1 = Math.min(sw, (y + 1) * k), fy0 = Math.floor(y0), fy1 = Math.min(sw - 1, Math.ceil(y1) - 1);
        for (let x = 0; x < dw; x++) {
            const x0 = x * k, x1 = Math.min(sw, (x + 1) * k), fx0 = Math.floor(x0), fx1 = Math.min(sw - 1, Math.ceil(x1) - 1);
            let r = 0, g = 0, b = 0, a = 0, wsum = 0;
            for (let sy = fy0; sy <= fy1; sy++) {
                const wy = Math.max(0, Math.min(y1, sy + 1) - Math.max(y0, sy));
                for (let sx = fx0; sx <= fx1; sx++) {
                    const w = wy * Math.max(0, Math.min(x1, sx + 1) - Math.max(x0, sx));
                    const p = (sy * sw + sx) * 4;
                    r += src[p] * w; g += src[p + 1] * w; b += src[p + 2] * w; a += src[p + 3] * w; wsum += w;
                }
            }
            const q = (y * dw + x) * 4, inv = wsum > 0 ? 1 / wsum : 0;
            out[q] = Math.round(r * inv); out[q + 1] = Math.round(g * inv); out[q + 2] = Math.round(b * inv); out[q + 3] = Math.round(a * inv);
        }
    }
    return out;
}

mgu.run({
    async start(ctx) {
        const { ui, log } = ctx;
        let status = null, readAt = 0, thumbs = {}, thumbRev = -1, cmdId = Date.now(), lastKey = '', shown = false;
        let pv = null, mode = 'main', playing = '', playAt = 0;       // the preview: its player, the screen shown, what plays and since when
        const version = (ctx.spec && ctx.spec.version) ? 'Bản ' + ctx.spec.version : '';

        function readStatus(now) {
            if (now - readAt < 700) return;
            readAt = now;
            let s = null;
            try { s = JSON.parse(fs.readFileSync(path.join(RUN, 'status.json'), 'utf8')); } catch (e) { s = null; }
            status = s && typeof s.at === 'number' && Math.abs(now - s.at) < STALE_MS ? s : null;
            if (status && status.rev !== thumbRev && status.compatible) {
                // the small pictures for the cards: the car and the start-up screen (144 wide, or 48 from an older helper),
                // and three profile pictures (96 x 96 from the tool) smoothly scaled to 52 x 52
                const t = {}, file = (name) => { try { return fs.readFileSync(path.join(RUN, name)); } catch (e) { return null; } };
                [41, 51].forEach((n) => {
                    const b = file('t' + n + '.rgba');
                    const okSize = b && ((b.length >= UI.MINI * 4 && b.length % (UI.MINI * 4) === 0) || (b.length >= 48 * 4 && b.length % (48 * 4) === 0));
                    if (!okSize) return;
                    for (let i = 3; i < b.length; i += 4) if (b[i] > 40 && b[i - 1] + b[i - 2] + b[i - 3] > 60) { t[n] = b; return; }
                });
                const all = status.slots || [], fw = UI.FACE || 52;
                all.filter((x) => x.changed).concat(all.filter((x) => !x.changed)).slice(0, 3).forEach((x) => {
                    const b = file('t' + (x.n < 10 ? '0' : '') + x.n + '.rgba');
                    if (!b || b.length !== 96 * 96 * 4) return;
                    t[x.n] = shrinkSquare(b, 96, fw);
                });
                thumbs = t; thumbRev = status.rev;
                // the preview picture (480 x 180 or 120 x 45) with the light's box and auto-close flag
                const pvs = status.preview, pb = pvs && file('p51.rgba');
                pv = pvs && pb && pb.length === pvs.w * pvs.h * 4 ? new Player(pb, pvs.w, pvs.h, pvs.shine, pvs.brief) : null;
            }
        }

        function send(cmd) {
            try {
                const f = path.join(ctx.dataDir, 'command.json');
                fs.writeFileSync(f + '.tmp', JSON.stringify({ id: ++cmdId, cmd }));
                fs.renameSync(f + '.tmp', f);
                log.info('command ' + cmd);
            } catch (e) { log.warn('command ' + cmd + ': ' + (e && e.message)); }
            readAt = 0;
        }
        // A button asks once more: the first press arms it for six seconds (its label says so), the second runs it.
        const ARM_MS = 6000, NOTE_MS = 9000;
        let armed = '', armedAt = 0, note = '', noteKind = 'dim', noteAt = 0, noteOver = '';
        const tell = (text, kind) => { note = text; noteKind = kind; noteAt = Date.now(); noteOver = status ? String(status.message) : ''; };
        function press(key, cmd, ask, done) {
            const now = Date.now();
            if (armed === key && now - armedAt < ARM_MS) { armed = ''; send(cmd); tell(done, 'go'); return repaint(); }
            armed = key; armedAt = now; tell(ask, 'warn');
            setTimeout(() => { if (armed === key && Date.now() - armedAt >= ARM_MS) { armed = ''; note = ''; repaint(); } }, ARM_MS + 50);
            return repaint();
        }
        // the preview plays at the video's pace: FPS pictures a second, FRAMES of them (the opening 'in', the closing 'out'),
        // 'both' = the opening, a pause, the closing; when stopped, show the full lit/unlit picture so it never rests on black
        const HOLD = FPS;
        function where(now) {
            const restFrame = pv && pv.brief ? pv.moving.in : FRAMES - 1;
            if (!playing) return { kind: 'in', f: restFrame };
            const e = Math.max(0, Math.floor((now - playAt) * FPS / 1000));
            if (playing === 'in') return { kind: 'in', f: Math.min(e, FRAMES - 1), over: e >= FRAMES };
            if (playing === 'out') return { kind: 'out', f: Math.min(e, FRAMES - 1), over: e >= FRAMES };
            if (playing === 'both') {
                const gap = pv && pv.brief ? Math.round(FPS * 0.4) : HOLD;
                if (e < FRAMES) return { kind: 'in', f: e };
                if (e < FRAMES + gap) return { kind: 'in', f: pv && pv.brief ? FRAMES - 1 : FRAMES - 1 };
                return { kind: 'out', f: Math.min(e - FRAMES - gap, FRAMES - 1), over: e >= 2 * FRAMES + gap };
            }
            return { kind: 'in', f: restFrame };
        }
        function play(kind) { playing = kind; playAt = Date.now(); note = ''; repaint(); }
        const acts = {
            openPreview: () => { if (!pv) return; mode = 'preview'; play('both'); },
            back: () => { mode = 'main'; playing = ''; repaint(); },
            play,
            apply: () => { send('apply_draft'); mode = 'main'; playing = ''; tell('Đã nhận lệnh: đang áp dụng màn hình khởi động…', 'go'); repaint(); },
            discard: () => { send('discard_draft'); mode = 'main'; playing = ''; tell('Đã nhận lệnh: bỏ bản nháp…', 'go'); repaint(); },
            reboot: () => press('reboot', 'reboot', 'Bấm Khởi động lại lần nữa để xác nhận.', 'Đã nhận lệnh: màn hình xe đang khởi động lại…'),
            restoreAll: () => press('restore', 'restore_all', 'Bấm Khôi phục tất cả lần nữa để xác nhận.', 'Đã nhận lệnh: đang khôi phục hình gốc…'),
        };

        function model() {
            readStatus(Date.now());
            const s = status, now = Date.now();
            if (armed && now - armedAt >= ARM_MS) armed = '';
            if (note && !armed && (now - noteAt > NOTE_MS || (s && String(s.message) !== noteOver))) note = '';      // the tool has answered
            const hostOf = (u) => String(u || '').replace(/^http:\/\//, '').replace(/\/\?pin=\d+$/, '');
            return {
                state: !s ? 'down' : !s.compatible ? 'bad' : 'ok', error: s && s.error, url: s && s.url, host: s && hostOf(s.url), pin: s && s.pin,
                slots: s && s.compatible ? s.slots : [], more: s && s.compatible ? (s.more || []) : [], thumbs, message: s && s.message, messageKind: s && s.messageKind,
                needsRestart: !!(s && s.needsRestart), carWhere: s && s.carWhere, armed, note, noteKind, busy: !!(s && s.busy), backup: s && s.backup,
                anyChanged: !!(s && (s.anyChanged || (s.slots || []).some((x) => x.changed))), version,
                mode, pvReady: !!pv, draft: !!(s && s.preview && s.preview.draft), playing,
            };
        }

        const render = async () => {
            const m = model();
            const vis = ui.isVisible('MAIN');
            let at = null;
            if (mode === 'preview' && pv) {
                at = where(Date.now());
                if (at.over && playing) { playing = ''; m.playing = ''; at = where(Date.now()); }
                m.pv = { player: pv, kind: at.kind, f: at.f, w: pv.w, h: pv.h };
            } else if (mode === 'preview') mode = m.mode = 'main';
            const key = JSON.stringify([m.state, m.error, m.url, m.pin, m.slots, m.more, thumbRev, m.message, m.messageKind, m.needsRestart, m.busy, m.anyChanged, m.carWhere, m.armed, m.note, vis, m.mode, m.draft, m.pvReady, m.playing, at && at.kind, at && at.f]);
            if (key === lastKey && shown) return;
            lastKey = key; shown = true;
            const cv = ctx.canvas(UI.W, UI.H) || new Canvas(UI.W, UI.H);
            UI.draw(cv, G, ctx.theme(), m, acts);
            await ui.image('MAIN_GFX', cv);
        };
        const loop = ctx.loop('MAIN', 30, render);
        function repaint() { lastKey = ''; return loop && loop.kick ? loop.kick() : render(); }
        ['BTN_REBOOT', 'BTN_RESTORE'].forEach((b) => { if (ctx.hideButton) ctx.hideButton(b); });
        ui.onClick('BTN_RESTORE', acts.restoreAll);
        ui.onClick('BTN_REBOOT', acts.reboot);
        await render();
        log.info('anh_dai_dien ready');
    },
});
