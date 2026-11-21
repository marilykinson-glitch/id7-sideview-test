'use strict';
/**
 * Thời tiết - weather for the car (the car has no Connected Drive). The forecast is fetched by the tool thoi-tiet
 * (tools/thoi-tiet); this app draws it and lets the driver choose the places.
 *
 *   the tool  -> /run/thoi-tiet/weather.json   (RAM; read here)
 *   this app  -> <its folder>/data/command.json  { id, cmd: 'places' | 'refresh', places }
 *   this app  -> <its folder>/data/places.json   the chosen keys (so they stay after a restart)
 * Node 8.
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const { Canvas } = require('./kit/canvas');
const UI = require('./ui');
const Wx = require('./weather');

const RUN = process.env.TT_RUN || '/run/thoi-tiet';
const STALE_MS = 8000;
const PER_PAGE = 24;

mgu.run({
    async start(ctx) {
        const { ui, log } = ctx;
        let keys = Wx.DEFAULT_KEYS.slice(), status = null, readAt = 0, cmdId = Date.now(), lastKey = '', shown = false;
        let mode = 'main', sel = 0, page = 0, message = '', messageKind = 'dim', refreshAt = 0;
        const file = path.join(ctx.dataDir, 'places.json');
        try { const k = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(k) && k.length) keys = Wx.placesFor(k).map((p) => p.key); } catch (e) { /* first start */ }

        function send(cmd, extra) {
            try {
                const f = path.join(ctx.dataDir, 'command.json');
                fs.writeFileSync(f + '.tmp', JSON.stringify(Object.assign({ id: ++cmdId, cmd }, extra || {})));
                fs.renameSync(f + '.tmp', f);
            } catch (e) { log.warn('command ' + cmd + ': ' + (e && e.message)); }
            readAt = 0;
        }
        const pushPlaces = () => {
            try { fs.writeFileSync(file, JSON.stringify(keys)); } catch (e) { /* ok */ }
            send('places', { places: Wx.placesFor(keys) });
        };
        function readStatus(now) {
            if (now - readAt < 700) return;
            readAt = now;
            let s = null;
            try { s = JSON.parse(fs.readFileSync(path.join(RUN, 'weather.json'), 'utf8')); } catch (e) { s = null; }
            status = s && typeof s.at === 'number' && Math.abs(now - s.at) < STALE_MS ? s : null;
        }
        const hhmm = (ms) => { const d = new Date(ms); return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); };
        const items = () => [Wx.HERE].concat(Wx.CITIES);

        const acts = {
            select: (i) => { sel = i; repaint(); },
            openPick: () => { mode = 'pick'; page = 0; message = ''; repaint(); },
            closePick: () => { mode = 'main'; sel = Math.min(sel, Math.max(0, keys.length - 1)); pushPlaces(); repaint(); },
            togglePlace: (k) => {
                const i = keys.indexOf(k);
                if (i >= 0) { if (keys.length > 1) keys.splice(i, 1); else { message = 'Cần giữ ít nhất một địa điểm.'; messageKind = 'warn'; } }
                else if (keys.length < Wx.MAX_PLACES) keys.push(k);
                else { message = 'Tối đa ' + Wx.MAX_PLACES + ' địa điểm: bỏ bớt một nơi trước.'; messageKind = 'warn'; }
                repaint();
            },
            page: (d) => { const pages = Math.ceil(items().length / PER_PAGE); page = (page + d + pages) % pages; repaint(); },
            refresh: () => { refreshAt = Date.now(); send('refresh'); repaint(); },
        };

        function model() {
            readStatus(Date.now());
            const list = Wx.placesFor(keys), s = status;
            if (sel >= list.length) sel = 0;
            const d = s && s.places ? s.places.filter((p) => p.key === list[sel].key)[0] : null;
            const pages = Math.ceil(items().length / PER_PAGE);
            const busy = !!(s && s.busy) || Date.now() - refreshAt < 2500;
            return {
                mode, state: !s ? 'down' : 'ok', places: list, sel, data: d || null, busy,
                updated: d && d.at ? hhmm(d.at) + (d.ok ? '' : ' (cũ)') : '',
                pick: { keys, page, pages, max: Wx.MAX_PLACES, items: items().slice(page * PER_PAGE, (page + 1) * PER_PAGE) },
                message, messageKind,
            };
        }
        const render = async () => {
            const m = model(), vis = ui.isVisible('MAIN');
            const key = JSON.stringify([m.mode, m.state, m.sel, m.places.map((p) => p.key), m.data && [m.data.at, m.data.ok, m.data.error], m.busy, m.updated, m.pick.keys, m.pick.page, m.message, vis]);
            if (key === lastKey && shown) return;
            lastKey = key; shown = true;
            const cv = ctx.canvas(UI.W, UI.H) || new Canvas(UI.W, UI.H);
            UI.draw(cv, G, ctx.theme(), m, acts);
            await ui.image('MAIN_GFX', cv);
        };
        const loop = ctx.loop('MAIN', 4, render);
        function repaint() { lastKey = ''; return loop && loop.kick ? loop.kick() : render(); }
        pushPlaces();
        await render();
        log.info('thoi_tiet ready');
    },
});
