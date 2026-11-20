'use strict';
/**
 * Ảnh đại diện - the screen of the tool anh-dai-dien (tools/anh-dai-dien), which does the work: a web page
 * for the phone (pick a photo, crop it square), writing it into the head unit's avatar bundle, the backup and
 * the restore. This app shows how to reach the page (a QR code and a PIN), the fifteen pictures as they are on
 * the car now, and has the two buttons: a new PIN, restore everything.
 *
 *   the tool  -> /run/anh-dai-dien/status.json, t01.rgba .. t15.rgba   (RAM; read here)
 *   this app  -> <its folder>/data/command.json  { id, cmd: 'restore_all' | 'new_pin' }   (the tool reads it)
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
const SLOTS = 15;

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
                const t = {};
                for (let n = 1; n <= SLOTS; n++) {
                    try { const b = fs.readFileSync(path.join(RUN, 't' + (n < 10 ? '0' : '') + n + '.rgba')); if (b.length === UI.SMALL * UI.SMALL * 4) t[n] = b; } catch (e) { /* not written yet */ }
                }
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
        const acts = { restoreAll: () => { send('restore_all'); return repaint(); }, newPin: () => { send('new_pin'); return repaint(); } };

        function model() {
            readStatus(Date.now());
            const s = status;
            const hostOf = (u) => String(u || '').replace(/^http:\/\//, '').replace(/\/\?pin=\d+$/, '');
            return {
                state: !s ? 'down' : !s.compatible ? 'bad' : 'ok', error: s && s.error, url: s && s.url, host: s && hostOf(s.url), pin: s && s.pin,
                slots: s && s.compatible ? s.slots : [], thumbs, message: s && s.message, messageKind: s && s.messageKind,
                needsRestart: !!(s && s.needsRestart), busy: !!(s && s.busy), backup: s && s.backup,
                anyChanged: !!(s && (s.slots || []).some((x) => x.changed)), version,
            };
        }

        const render = async () => {
            const m = model();
            const vis = ui.isVisible('MAIN');
            const key = JSON.stringify([m.state, m.error, m.url, m.pin, m.slots, thumbRev, m.message, m.messageKind, m.needsRestart, m.busy, m.anyChanged, vis]);
            if (key === lastKey && shown) return;
            lastKey = key; shown = true;
            const cv = ctx.canvas(UI.W, UI.H) || new Canvas(UI.W, UI.H);
            UI.draw(cv, G, ctx.theme(), m, acts);
            await ui.image('MAIN_GFX', cv);
        };
        const loop = ctx.loop('MAIN', 2, render);
        function repaint() { lastKey = ''; return loop && loop.kick ? loop.kick() : render(); }
        ['BTN_PIN', 'BTN_RESTORE'].forEach((b) => { if (ctx.hideButton) ctx.hideButton(b); });
        ui.onClick('BTN_PIN', acts.newPin);
        ui.onClick('BTN_RESTORE', acts.restoreAll);
        await render();
        log.info('anh_dai_dien ready');
    },
});
