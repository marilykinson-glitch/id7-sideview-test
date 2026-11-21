'use strict';
/**
 * Thời tiết - weather for the car (the car has no Connected Drive). The forecast is fetched by the tool thoi-tiet
 * (tools/thoi-tiet); this app draws it, lets the driver choose the places and what to show, and shows the QR code of
 * the tool's page where any place in the world can be searched on a phone.
 *
 *   the tool  -> /run/thoi-tiet/weather.json   (RAM; read here: forecasts, the address and PIN of the page, the places added there)
 *   this app  -> <its folder>/data/command.json  { id, cmd: 'places' | 'refresh' | 'next_ip', places }
 *   this app  -> <its folder>/data/places.json    the chosen keys; settings.json the settings; custom.json the places from the phone
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
const FPS = 8;                 // the moving weather

mgu.run({
    async start(ctx) {
        const { ui, log } = ctx;
        let keys = Wx.DEFAULT_KEYS.slice(), status = null, readAt = 0, cmdId = Date.now(), lastKey = '', shown = false;
        let why = '', mode = 'main', sel = 0, page = 0, region = 'all', drive = false, message = '', messageKind = 'dim', refreshAt = 0, seenSeq = -1, set = Wx.settingsOf(null), custom = [];
        const f = (n) => path.join(ctx.dataDir, n);
        const load = (n) => { try { return JSON.parse(fs.readFileSync(f(n), 'utf8')); } catch (e) { return null; } };
        const save = (n, v) => { try { fs.writeFileSync(f(n), JSON.stringify(v)); } catch (e) { /* ok */ } };
        set = Wx.settingsOf(load('settings.json'));
        const c0 = load('custom.json'); if (Array.isArray(c0)) custom = c0.filter((c) => c && c.key && c.name && isFinite(c.lat) && isFinite(c.lon)).slice(0, 30);
        const k0 = load('places.json'); if (Array.isArray(k0) && k0.length) keys = Wx.placesFor(k0, custom).map((p) => p.key);
        const t0 = Date.now();

        function send(cmd, extra) {
            try {
                const file = f('command.json');
                fs.writeFileSync(file + '.tmp', JSON.stringify(Object.assign({ id: ++cmdId, cmd }, extra || {})));
                fs.renameSync(file + '.tmp', file);
            } catch (e) { log.warn('command ' + cmd + ': ' + (e && e.message)); }
            readAt = 0;
        }
        const pushPlaces = () => { save('places.json', keys); send('places', { places: Wx.placesFor(keys, custom) }); };
        const saveSet = () => save('settings.json', set);
        function readStatus(now) {
            if (now - readAt < 700) return;
            readAt = now;
            let s = null; why = '';
            try { s = JSON.parse(fs.readFileSync(path.join(RUN, 'weather.json'), 'utf8')); } catch (e) { s = null; why = e && e.code === 'ENOENT' ? 'missing' : e && (e.code === 'EACCES' || e.code === 'EPERM') ? 'denied' : 'bad'; }
            if (s && !(typeof s.at === 'number' && Math.abs(now - s.at) < STALE_MS)) { why = 'old ' + Math.round(Math.abs(now - (s.at || 0)) / 1000) + 's'; s = null; }
            status = s;
            if (status && Array.isArray(status.custom) && JSON.stringify(status.custom) !== JSON.stringify(custom)) { custom = status.custom.slice(0, 30); save('custom.json', custom); }
            if (status && typeof status.seq === 'number') {
                if (seenSeq >= 0 && status.seq !== seenSeq && status.lastAdded && keys.indexOf(status.lastAdded) < 0 && custom.some((c) => c.key === status.lastAdded)) {
                    // a place was just added on the phone: it goes in the list now (the oldest of them leaves when it is full)
                    if (keys.length >= Wx.MAX_PLACES) keys.splice(keys.findIndex((k) => k !== 'here'), 1);
                    keys.push(status.lastAdded); sel = keys.length - 1; pushPlaces();
                    message = 'Đã thêm ' + (custom.filter((c) => c.key === status.lastAdded)[0] || {}).name + ' từ điện thoại.'; messageKind = 'go'; lastKey = '';
                }
                seenSeq = status.seq;
            }
        }
        const hhmm = (ms) => { const d = new Date(ms); return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); };
        const items = () => Wx.listFor(region, custom);
        const pagesOf = () => Math.max(1, Math.ceil(items().length / PER_PAGE));

        const acts = {
            select: (i) => { sel = i; repaint(); },
            openPick: () => { mode = 'pick'; page = 0; message = ''; repaint(); },
            closePick: () => { mode = 'main'; sel = Math.min(sel, Math.max(0, keys.length - 1)); pushPlaces(); repaint(); },
            togglePlace: (k) => {
                const i = keys.indexOf(k);
                if (i >= 0) { if (keys.length > 1) keys.splice(i, 1); else { message = 'Cần giữ ít nhất một địa điểm.'; messageKind = 'warn'; } }
                else if (keys.length < Wx.MAX_PLACES) { keys.push(k); message = ''; }
                else { message = 'Tối đa ' + Wx.MAX_PLACES + ' địa điểm: bỏ bớt một nơi trước.'; messageKind = 'warn'; }
                repaint();
            },
            region: (r) => { region = r; page = 0; repaint(); },
            page: (d) => { const pages = pagesOf(); page = (page + d + pages) % pages; repaint(); },
            refresh: () => { refreshAt = Date.now(); send('refresh'); repaint(); },
            openSettings: () => { mode = 'settings'; message = ''; repaint(); },
            closeSettings: () => { mode = 'main'; repaint(); },
            toggleTile: (id) => {
                const i = set.tiles.indexOf(id);
                if (i >= 0) { set.tiles.splice(i, 1); message = ''; }
                else if (set.tiles.length < Wx.MAX_TILES) { set.tiles.push(id); set = Wx.settingsOf(set); message = ''; }
                else { message = 'Tối đa ' + Wx.MAX_TILES + ' ô: tắt bớt một ô trước.'; messageKind = 'warn'; }
                saveSet(); repaint();
            },
            setBlock: (b) => { set.block = b; saveSet(); repaint(); },
            toggle: (k) => { set[k] = !set[k]; saveSet(); repaint(); },
            setUnit: (u) => { set.unit = u; saveSet(); repaint(); },
            resetSettings: () => { set = Wx.settingsOf(null); saveSet(); message = 'Đã về mặc định.'; messageKind = 'go'; repaint(); },
            drive: (on) => { drive = on; repaint(); },
            openPhone: () => { mode = 'phone'; message = ''; repaint(); },
            closePhone: () => { mode = 'pick'; region = 'my'; page = 0; repaint(); },
            nextIp: () => { send('next_ip'); message = 'Đã đổi sang địa chỉ khác của xe. Quét lại mã QR.'; messageKind = 'dim'; repaint(); },
        };

        function model() {
            readStatus(Date.now());
            const list = Wx.placesFor(keys, custom), s = status;
            if (sel >= list.length) sel = 0;
            const d = s && s.places ? s.places.filter((p) => p.key === list[sel].key)[0] : null;
            const busy = !!(s && s.busy) || Date.now() - refreshAt < 2500;
            return {
                mode, drive, state: !s ? 'down' : 'ok', why, places: list, sel, data: d || null, busy, set,
                updated: d && d.at ? hhmm(d.at) + (d.ok ? '' : ' (cũ)') : '',
                pick: { keys, page, pages: pagesOf(), region, max: Wx.MAX_PLACES, items: items().slice(page * PER_PAGE, (page + 1) * PER_PAGE) },
                phone: { url: s && s.url, pin: s && s.pin, host: s && s.host, count: custom.length },
                message, messageKind, time: (Date.now() - t0) / 1000,
            };
        }
        const render = async () => {
            const m = model(), vis = ui.isVisible('MAIN');
            if (!vis && shown) return;                                // nobody looks: no drawing
            const animated = m.set.fx && (m.mode === 'main') && m.data && m.data.current;
            const frame = animated ? Math.floor(m.time * FPS) : 0;
            const key = JSON.stringify([frame, m.mode, m.drive, m.set, m.state, m.why, m.sel, m.places.map((p) => p.key), m.data && [m.data.at, m.data.ok, m.data.error], m.busy, m.updated, m.pick, m.phone, m.message, vis]);
            if (key === lastKey && shown) return;
            lastKey = key; shown = true;
            const cv = ctx.canvas(UI.W, UI.H) || new Canvas(UI.W, UI.H);
            UI.draw(cv, G, ctx.theme(), m, acts);
            await ui.image('MAIN_GFX', cv);
        };
        const loop = ctx.loop('MAIN', FPS, render);
        function repaint() { lastKey = ''; return loop && loop.kick ? loop.kick() : render(); }
        pushPlaces();
        await render();
        log.info('thoi_tiet ready');
    },
});
