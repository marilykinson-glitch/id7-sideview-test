'use strict';
/**
 * MGU Studio - the screen of the tool anh-dai-dien (tools/anh-dai-dien), which does the work: a web page for the
 * phone (pick a photo, crop it), writing it into the head unit's files, the backup and the restore. This app shows
 * how to reach the page (a QR code and a PIN), what is changed now, and has the buttons: restart the head unit, a
 * new PIN, restore everything.
 *
 *   the tool  -> /run/anh-dai-dien/status.json, t41.rgba, t51.rgba, t01.rgba .. t15.rgba   (RAM; read here)
 *   this app  -> <its folder>/data/command.json  { id, cmd: 'restore_all' | 'new_pin' | 'reboot' }   (the tool reads it)
 *
 * Node 8.
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const { Canvas } = require('./kit/canvas');
const UI = require('./ui');

const RUN = process.env.ANH_RUN || '/run/anh-dai-dien';
const STALE_MS = 6000;           // the tool writes every 1.5 s

mgu.run({
    async start(ctx) {
        const { ui, log } = ctx;
        let status = null, readAt = 0, thumbs = {}, thumbRev = -1, cmdId = Date.now(), lastKey = '', shown = false;
        const version = (ctx.spec && ctx.spec.version) ? 'Bản ' + ctx.spec.version : '';

        function readStatus(now) {
            if (now - readAt < 700) return;
            readAt = now;
            let s = null;
            try { s = JSON.parse(fs.readFileSync(path.join(RUN, 'status.json'), 'utf8')); } catch (e) { s = null; }
            status = s && typeof s.at === 'number' && Math.abs(now - s.at) < STALE_MS ? s : null;
            if (status && status.rev !== thumbRev && status.compatible) {
                // the small pictures for the cards: the car and the start-up screen as the tool made them (48 wide),
                // the changed profile pictures (96 x 96 from the tool) taken down to 24 x 24
                const t = {}, file = (name) => { try { return fs.readFileSync(path.join(RUN, name)); } catch (e) { return null; } };
                [41, 51].forEach((n) => { const b = file('t' + n + '.rgba'); if (!b || b.length < UI.MINI * 4 || b.length % (UI.MINI * 4) !== 0) return; for (let i = 3; i < b.length; i += 4) if (b[i] > 40 && b[i - 1] + b[i - 2] + b[i - 3] > 60) { t[n] = b; return; } });   // an empty picture is no picture
                (status.slots || []).filter((x) => x.changed).slice(0, 2).forEach((x) => {
                    const b = file('t' + (x.n < 10 ? '0' : '') + x.n + '.rgba');
                    if (!b || b.length !== 96 * 96 * 4) return;
                    const o = Buffer.alloc(24 * 24 * 4);
                    for (let y = 0; y < 24; y++) for (let c = 0; c < 24; c++) for (let k = 0; k < 4; k++) {
                        let sum = 0; for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) sum += b[((y * 4 + dy) * 96 + c * 4 + dx) * 4 + k];
                        o[(y * 24 + c) * 4 + k] = sum >> 4;
                    }
                    t[x.n] = o;
                });
                thumbs = t; thumbRev = status.rev;
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
        const acts = { restoreAll: () => { send('restore_all'); return repaint(); }, newPin: () => { send('new_pin'); return repaint(); }, reboot: () => { send('reboot'); return repaint(); } };

        function model() {
            readStatus(Date.now());
            const s = status;
            const hostOf = (u) => String(u || '').replace(/^http:\/\//, '').replace(/\/\?pin=\d+$/, '');
            return {
                state: !s ? 'down' : !s.compatible ? 'bad' : 'ok', error: s && s.error, url: s && s.url, host: s && hostOf(s.url), pin: s && s.pin,
                slots: s && s.compatible ? s.slots : [], more: s && s.compatible ? (s.more || []) : [], thumbs, message: s && s.message, messageKind: s && s.messageKind,
                needsRestart: !!(s && s.needsRestart), busy: !!(s && s.busy), backup: s && s.backup,
                anyChanged: !!(s && (s.anyChanged || (s.slots || []).some((x) => x.changed))), version,
            };
        }

        const render = async () => {
            const m = model();
            const vis = ui.isVisible('MAIN');
            const key = JSON.stringify([m.state, m.error, m.url, m.pin, m.slots, m.more, thumbRev, m.message, m.messageKind, m.needsRestart, m.busy, m.anyChanged, vis]);
            if (key === lastKey && shown) return;
            lastKey = key; shown = true;
            const cv = ctx.canvas(UI.W, UI.H) || new Canvas(UI.W, UI.H);
            UI.draw(cv, G, ctx.theme(), m, acts);
            await ui.image('MAIN_GFX', cv);
        };
        const loop = ctx.loop('MAIN', 2, render);
        function repaint() { lastKey = ''; return loop && loop.kick ? loop.kick() : render(); }
        ['BTN_REBOOT', 'BTN_PIN', 'BTN_RESTORE'].forEach((b) => { if (ctx.hideButton) ctx.hideButton(b); });
        ui.onClick('BTN_PIN', acts.newPin);
        ui.onClick('BTN_RESTORE', acts.restoreAll);
        ui.onClick('BTN_REBOOT', acts.reboot);
        await render();
        log.info('anh_dai_dien ready');
    },
});
