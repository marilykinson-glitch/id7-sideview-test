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
const Icons3d = require('./icons3d');

const RUN = process.env.TT_RUN || '/run/thoi-tiet';
const STALE_MS = 8000;
const PER_PAGE = 24;
const FPS = 8;                 // the moving weather

mgu.run({
    async start(ctx) {
        const { ui, log } = ctx;
        // what the home-screen widget does, shown in the settings (the car has no log to read): the last lines the kit logs about it
        const wlog = [], wstat = { frames: 0, ok: 0, warn: '', first: '', pushes: '', cells: [] };
        ['info', 'warn', 'error'].forEach((k) => {
            const orig = log[k];
            if (typeof orig !== 'function') return;
            log[k] = function () {
                try { const m = Array.prototype.map.call(arguments, (a) => (a && a.message) || String(a)).join(' '); if (/widget/i.test(m)) { if (k !== 'info') wstat.warn = k + ': ' + m; else if (/first image/.test(m)) wstat.first = m; else if (/widget cell /.test(m)) { wstat.cells.push(m.replace('widget cell ', '').slice(0, 40)); if (wstat.cells.length > 24) wstat.cells.shift(); } else if (/widget loop/.test(m)) wstat.pushes = m; wlog.push((k === 'info' ? '' : k + ': ') + m); if (wlog.length > 8) wlog.shift(); } } catch (e) { /* the log is not ours */ }
                return orig.apply(this, arguments);
            };
        });
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
            if (s && !Array.isArray(s.places)) { s = null; why = 'bad'; }
            if (s && Array.isArray(s.places)) s.places = s.places.filter((p) => p && typeof p.key === 'string');
            if (s && Array.isArray(s.places)) s.places.forEach((p) => { if (p && p.here && p.name) p.name = Wx.viName(p.name); });
            status = s;
            if (status && Array.isArray(status.custom) && JSON.stringify(status.custom) !== JSON.stringify(custom)) {
                const selected = keys[sel];
                custom = status.custom.filter((c) => c && typeof c.key === 'string' && typeof c.name === 'string' && typeof c.lat === 'number' && typeof c.lon === 'number' && isFinite(c.lat) && isFinite(c.lon) && Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180).slice(0, 30);
                save('custom.json', custom);
                const valid = Wx.placesFor(keys, custom).map((p) => p.key);
                if (JSON.stringify(valid) !== JSON.stringify(keys)) {
                    keys = valid; sel = Math.max(0, keys.indexOf(selected)); pushPlaces(); lastKey = '';
                }
                page = Math.min(page, pagesOf() - 1);
            }
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
        // the car's own clock zone is not trusted: the time is shown in the zone of "Vị trí hiện tại" (else of the place shown), as Open-Meteo reports it
        const zoneOf = (d) => {
            const ok = (p) => p && p.current && typeof p.current.utc === 'number';
            const here = status && status.places ? status.places.filter((p) => p.here && ok(p))[0] : null;
            return ok(here) ? here.current.utc : ok(d) ? d.current.utc : null;
        };
        const hhmm = (ms, utc) => {
            if (typeof utc === 'number') { const z = new Date(ms + utc * 1000); return ('0' + z.getUTCHours()).slice(-2) + ':' + ('0' + z.getUTCMinutes()).slice(-2); }
            const d = new Date(ms); return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); };
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
            refresh: () => { refreshAt = Date.now(); send('refresh', { places: Wx.placesFor(keys, custom) }); repaint(); },
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
                mode, drive, state: !s ? 'down' : 'ok', why, netError: s && s.netError, places: list, sel, data: d || null, busy, set,
                updated: d && d.at ? hhmm(d.at, zoneOf(d)) + (d.ok ? '' : ' (cũ)') : '',
                pick: { keys, page, pages: pagesOf(), region, max: Wx.MAX_PLACES, items: items().slice(page * PER_PAGE, (page + 1) * PER_PAGE) },
                phone: { url: s && s.url, pin: s && s.pin, host: s && s.host, count: custom.length },
                widget: { version: (mgu.SPEC && mgu.SPEC.version) || '', ready: !!(ctx.widget && ctx.widget.ready), n: ctx.widget && ctx.widget.instances ? ctx.widget.instances().length : 0, frames: wstat.frames, ok: wstat.ok, lines: [wstat.warn || 'chưa có cảnh báo hay lỗi nào về widget', wstat.first || 'chưa đẩy được ảnh đầu tiên lên widget', wstat.cells.length ? 'ô ảnh: ' + wstat.cells.join(' | ') : (wstat.pushes || wlog[wlog.length - 1] || '')] },
                message, messageKind, time: (Date.now() - t0) / 1000,
            };
        }
        const render = async () => {
            const m = model(), vis = ui.isVisible('MAIN');
            if (!vis && shown) return;                                // nobody looks: no drawing
            const animated = m.set.fx && (m.mode === 'main') && m.data && m.data.current;
            const frame = animated ? Math.floor(m.time * FPS) : 0;
            const key = JSON.stringify([frame, m.mode, m.drive, m.set, m.state, m.why, m.sel, m.places.map((p) => p.key), m.data && [m.data.at, m.data.ok, m.data.error], m.busy, m.updated, m.pick, m.phone, m.message, vis, m.mode === 'settings' ? m.widget : 0]);
            if (key === lastKey && shown) return;
            lastKey = key; shown = true;
            const cv = ctx.canvas(UI.W, UI.H) || new Canvas(UI.W, UI.H);
            UI.draw(cv, G, ctx.theme(), m, acts);
            await ui.image('MAIN_GFX', cv);
        };
        // the home-screen widget: BMW's own weather widget layout (LT_Table_OnlineApps_WeatherWidget, big and small), filled cell by
        // cell: the place "Vị trí hiện tại" if it has a forecast, else the first place that has one. Only what changed is sent.
        const wsent = {}, wicons = {};
        let widgetRetryAt = 0;
        // size: a number (square) or [w, h, icon size]: the car shows the picture as it is, from the cell's corner
        const iconCanvas = (icon, day, size) => {
            const k = icon + '|' + (day ? 1 : 0) + '|' + size;
            if (!wicons[k]) {
                const w = size[0] || size, h = size[1] || size, sz = size[2] || Math.round(size * 0.98);
                wicons[k] = icon === 'empty' ? new Canvas(w, h) : Icons3d.make(icon, day, w, h, sz);
            }
            return { cv: wicons[k], key: k };
        };
        const widgetCells = (d) => {
            const c = {}, T = (cell, v) => { c[cell] = ['Text', String(v)]; }, B = (cell, v) => { c[cell] = ['Bool', !!v]; }, A = (cell, icon, day, size) => { c[cell] = ['Asset', icon, day, size]; };
            if (!d || !d.current) {
                T('Title', 'Thời tiết'); T('Text1stRow', 'Đang chờ dữ liệu');
                ['Text2ndRow', 'TextTemp', 'TextTempUnit', 'TextRainProbability', 'TextRainProbabilityUnit', 'TextAQI_Asia'].forEach((k) => T(k, ''));
                A('IllustrationActualWeather', 'empty', true, [200, 150, 160]); A('IconRaindrops', 'empty', true, 48);
                [1, 2, 3].forEach((n) => { T('TextDayliDetail' + n, ''); T('TextTempDayDetail' + n, ''); T('TextTempDayDetailUnit' + n, ''); A('IconDayliDetail' + n, 'empty', true, 44); });
                B('IsAQI_Visible', false); B('IsAQI_Asia_Visible', false); return c;
            }
            const cur = d.current, today = (d.daily && d.daily[0]) || {}, wc = Wx.describe(cur.code), num = (v) => Wx.deg(v).replace('°', '');
            T('Title', d.name || 'Thời tiết');
            A('IllustrationActualWeather', wc.icon, cur.day, [200, 150, 160]);
            T('TextTemp', num(cur.t)); T('TextTempUnit', '°' + Wx.getUnit());
            // the layout shows no title: the place is the first row, the weather (or the rain that is coming) the second
            T('Text1stRow', d.name || 'Thời tiết');
            T('Text2ndRow', d.ok === false ? 'Dữ liệu cũ · ' + wc.text : typeof cur.rainIn === 'number' ? (cur.rainIn === 0 ? 'Đang mưa' : 'Mưa sau ' + cur.rainIn + ' phút') : wc.text + '  ·  ' + Wx.deg(today.hi) + ' / ' + Wx.deg(today.lo));
            A('IconRaindrops', 'rain', true, 48);
            T('TextRainProbability', today.pop === null || today.pop === undefined ? '–' : String(Math.round(today.pop))); T('TextRainProbabilityUnit', '%');
            [1, 2, 3].forEach((n) => {
                const dy = (d.daily || [])[n], i = n - 1;
                if (!dy) {
                    T('TextDayliDetail' + n, '');
                    A('IconDayliDetail' + n, 'empty', true, 44);
                    T('TextTempDayDetail' + n, ''); T('TextTempDayDetailUnit' + n, '');
                    return;
                }
                T('TextDayliDetail' + n, i === 0 ? 'Mai' : (dy.dow === 0 ? 'CN' : 'T' + (dy.dow + 1)));
                A('IconDayliDetail' + n, Wx.describe(dy.code).icon, true, 44);
                T('TextTempDayDetail' + n, Wx.deg(dy.hi)); T('TextTempDayDetailUnit' + n, '');
            });
            const air = d.air && typeof d.air.aqi === 'number' && isFinite(d.air.aqi);
            B('IsAQI_Visible', false); B('IsAQI_Asia_Visible', air);
            T('TextAQI_Asia', air ? 'AQI ' + Math.round(d.air.aqi) : '');
            return c;
        };
        if (ctx.widget && ctx.widget.loop) {
            if (ctx.widget.onChange) ctx.widget.onChange(() => { Object.keys(wsent).forEach((k) => delete wsent[k]); });
            ctx.widget.loop(1, async (inst) => {
                readStatus(Date.now());
                const list = status && status.places ? status.places : [];
                const d = list.filter((p) => p.here && p.current)[0] || list.filter((p) => p.current)[0] || null;
                wstat.frames++;
                Wx.setUnit(set.unit);
                if (Date.now() - widgetRetryAt >= 30000) { Object.keys(wsent).forEach((k) => delete wsent[k]); widgetRetryAt = Date.now(); }
                const cells = widgetCells(d), sent = wsent[inst.spawnId] || (wsent[inst.spawnId] = {});
                await Promise.all(Object.keys(cells).map(async (cell) => {
                    const v = cells[cell], sig = JSON.stringify(v);
                    if (sent[cell] === sig) return;
                    if (v[0] === 'Asset') { const ic = iconCanvas(v[1], v[2], v[3]); await ctx.widget.asset(inst.spawnId, cell, ic.cv, ic.key); }
                    else await ctx.widget.set(inst.spawnId, cell, v[1], v[0]);
                    sent[cell] = sig;
                }));
                wstat.ok++;
                return null;
            });
        }
        const loop = ctx.loop('MAIN', FPS, render);
        function repaint() { lastKey = ''; return loop && loop.kick ? loop.kick() : render(); }
        pushPlaces();
        await render();
        log.info('thoi_tiet ready');
    },
});
