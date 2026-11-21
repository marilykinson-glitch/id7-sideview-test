'use strict';
/**
 * weather.js - what the Thời tiết app knows about weather: the words (Vietnamese) for the WMO codes Open-Meteo
 * gives, the icon each code gets, wind directions, day names, the list of places to choose from, and the
 * formatting of numbers.
 */

/** WMO weather code -> { icon, text }; icon names are drawn by icons.js. */
function describe(code) {
    const c = Number(code);
    if (c === 0) return { icon: 'clear', text: 'Trời quang' };
    if (c === 1) return { icon: 'mostly-clear', text: 'Ít mây' };
    if (c === 2) return { icon: 'partly', text: 'Có mây' };
    if (c === 3) return { icon: 'cloudy', text: 'Nhiều mây' };
    if (c === 45 || c === 48) return { icon: 'fog', text: 'Sương mù' };
    if (c >= 51 && c <= 55) return { icon: 'drizzle', text: 'Mưa phùn' };
    if (c === 56 || c === 57) return { icon: 'sleet', text: 'Mưa phùn lạnh' };
    if (c === 61) return { icon: 'rain', text: 'Mưa nhẹ' };
    if (c === 63) return { icon: 'rain', text: 'Mưa vừa' };
    if (c === 65) return { icon: 'heavy-rain', text: 'Mưa to' };
    if (c === 66 || c === 67) return { icon: 'sleet', text: 'Mưa đá nhỏ' };
    if (c === 71 || c === 73 || c === 75 || c === 77) return { icon: 'snow', text: 'Tuyết' };
    if (c === 80) return { icon: 'showers', text: 'Mưa rào nhẹ' };
    if (c === 81) return { icon: 'showers', text: 'Mưa rào' };
    if (c === 82) return { icon: 'heavy-rain', text: 'Mưa rào to' };
    if (c === 85 || c === 86) return { icon: 'snow', text: 'Mưa tuyết' };
    if (c === 95) return { icon: 'storm', text: 'Giông' };
    if (c === 96 || c === 99) return { icon: 'storm', text: 'Giông, mưa đá' };
    return { icon: 'cloudy', text: 'Không rõ' };
}

const DOW = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
const COMPASS = ['Bắc', 'Đông Bắc', 'Đông', 'Đông Nam', 'Nam', 'Tây Nam', 'Tây', 'Tây Bắc'];
const compass = (deg) => (deg === null || deg === undefined || !isFinite(deg) ? '' : COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]);

let unit = 'C';
const setUnit = (u) => { unit = u === 'F' ? 'F' : 'C'; };
const getUnit = () => unit;
/** A temperature as the screen writes it: whole degrees (°C or °F as chosen), "–" when there is none. */
const deg = (v) => (v === null || v === undefined || !isFinite(v) ? '–' : Math.round(unit === 'F' ? v * 9 / 5 + 32 : v) + '°');
const pct = (v) => (v === null || v === undefined || !isFinite(v) ? '–' : Math.round(v) + '%');
const kmh = (v) => (v === null || v === undefined || !isFinite(v) ? '–' : Math.round(v) + ' km/h');
const uvText = (v) => (v === null || v === undefined || !isFinite(v) ? '–' : v < 3 ? 'Thấp' : v < 6 ? 'Vừa' : v < 8 ? 'Cao' : v < 11 ? 'Rất cao' : 'Cực cao');

/** US AQI: the word and the colour of its band. */
function aqiBand(v) {
    if (v === null || v === undefined || !isFinite(v)) return { text: '', color: '#8a93a3' };
    if (v <= 50) return { text: 'Tốt', color: '#2fd27a' };
    if (v <= 100) return { text: 'Trung bình', color: '#ffd23f' };
    if (v <= 150) return { text: 'Kém', color: '#ff9f2e' };
    if (v <= 200) return { text: 'Xấu', color: '#ff5a3c' };
    if (v <= 300) return { text: 'Rất xấu', color: '#b45cff' };
    return { text: 'Nguy hại', color: '#c0392b' };
}

/** Places to choose from: key, name, latitude, longitude, region (bac, trung, tn, nam, nn = abroad). */
const RAW = [
    ['hanoi', 'Hà Nội', 21.028, 105.854, 'bac'], ['haiphong', 'Hải Phòng', 20.845, 106.688, 'bac'], ['halong', 'Hạ Long', 20.959, 107.043, 'bac'], ['thainguyen', 'Thái Nguyên', 21.594, 105.848, 'bac'],
    ['viettri', 'Việt Trì', 21.322, 105.402, 'bac'], ['bacninh', 'Bắc Ninh', 21.186, 106.076, 'bac'], ['hoabinh', 'Hòa Bình', 20.813, 105.338, 'bac'], ['ninhbinh', 'Ninh Bình', 20.250, 105.975, 'bac'],
    ['namdinh', 'Nam Định', 20.420, 106.168, 'bac'], ['haiduong', 'Hải Dương', 20.940, 106.333, 'bac'], ['langson', 'Lạng Sơn', 21.853, 106.761, 'bac'], ['sapa', 'Sa Pa', 22.336, 103.844, 'bac'],
    ['hagiang', 'Hà Giang', 22.823, 104.984, 'bac'], ['dienbien', 'Điện Biên', 21.386, 103.017, 'bac'],
    ['thanhhoa', 'Thanh Hóa', 19.807, 105.776, 'trung'], ['vinh', 'Vinh', 18.679, 105.681, 'trung'], ['donghoi', 'Đồng Hới', 17.469, 106.623, 'trung'], ['dongha', 'Đông Hà', 16.816, 107.100, 'trung'],
    ['hue', 'Huế', 16.463, 107.585, 'trung'], ['danang', 'Đà Nẵng', 16.054, 108.202, 'trung'], ['hoian', 'Hội An', 15.880, 108.338, 'trung'], ['tamky', 'Tam Kỳ', 15.573, 108.474, 'trung'],
    ['quangngai', 'Quảng Ngãi', 15.120, 108.804, 'trung'], ['quynhon', 'Quy Nhơn', 13.782, 109.219, 'trung'], ['tuyhoa', 'Tuy Hòa', 13.088, 109.093, 'trung'], ['nhatrang', 'Nha Trang', 12.239, 109.197, 'trung'],
    ['phanrang', 'Phan Rang', 11.567, 108.989, 'trung'], ['phanthiet', 'Phan Thiết', 10.933, 108.100, 'trung'],
    ['dalat', 'Đà Lạt', 11.940, 108.458, 'tn'], ['buonmathuot', 'Buôn Ma Thuột', 12.668, 108.038, 'tn'], ['pleiku', 'Pleiku', 13.983, 108.000, 'tn'],
    ['hcm', 'TP. Hồ Chí Minh', 10.776, 106.701, 'nam'], ['cantho', 'Cần Thơ', 10.045, 105.747, 'nam'], ['vungtau', 'Vũng Tàu', 10.346, 107.084, 'nam'], ['bienhoa', 'Biên Hòa', 10.957, 106.842, 'nam'],
    ['thudaumot', 'Thủ Dầu Một', 10.994, 106.650, 'nam'], ['tayninh', 'Tây Ninh', 11.310, 106.098, 'nam'], ['mytho', 'Mỹ Tho', 10.360, 106.360, 'nam'], ['bentre', 'Bến Tre', 10.243, 106.375, 'nam'],
    ['vinhlong', 'Vĩnh Long', 10.254, 105.972, 'nam'], ['longxuyen', 'Long Xuyên', 10.386, 105.435, 'nam'], ['rachgia', 'Rạch Giá', 10.012, 105.080, 'nam'], ['soctrang', 'Sóc Trăng', 9.603, 105.973, 'nam'],
    ['baclieu', 'Bạc Liêu', 9.285, 105.724, 'nam'], ['camau', 'Cà Mau', 9.177, 105.150, 'nam'], ['phuquoc', 'Phú Quốc', 10.227, 103.967, 'nam'],
    ['bangkok', 'Bangkok', 13.756, 100.502, 'nn'], ['singapore', 'Singapore', 1.352, 103.820, 'nn'], ['kualalumpur', 'Kuala Lumpur', 3.139, 101.687, 'nn'], ['tokyo', 'Tokyo', 35.676, 139.650, 'nn'],
    ['seoul', 'Seoul', 37.566, 126.978, 'nn'], ['beijing', 'Bắc Kinh', 39.904, 116.407, 'nn'], ['shanghai', 'Thượng Hải', 31.230, 121.474, 'nn'], ['hongkong', 'Hồng Kông', 22.320, 114.170, 'nn'],
    ['taipei', 'Đài Bắc', 25.033, 121.565, 'nn'], ['dubai', 'Dubai', 25.205, 55.271, 'nn'], ['moscow', 'Moskva', 55.756, 37.617, 'nn'], ['london', 'London', 51.507, -0.128, 'nn'],
    ['paris', 'Paris', 48.857, 2.352, 'nn'], ['berlin', 'Berlin', 52.520, 13.405, 'nn'], ['munich', 'Munich', 48.137, 11.575, 'nn'], ['newyork', 'New York', 40.713, -74.006, 'nn'],
    ['losangeles', 'Los Angeles', 34.052, -118.244, 'nn'], ['sydney', 'Sydney', -33.869, 151.209, 'nn'],
];
const CITIES = RAW.map((c) => ({ key: c[0], name: c[1], lat: c[2], lon: c[3], region: c[4] }));
/** The filters of the list of places. */
const REGIONS = [['all', 'Tất cả'], ['bac', 'Miền Bắc'], ['trung', 'Miền Trung'], ['tn', 'Tây Nguyên'], ['nam', 'Miền Nam'], ['nn', 'Nước ngoài'], ['my', 'Của tôi']];
/** The places of one filter ('all' also has the place the car is at, first, and the ones added from the phone last; 'my' = those). */
function listFor(region, custom) {
    const mine = (custom || []).map((c) => Object.assign({}, c, { region: 'my' }));
    if (region === 'my') return mine;
    if (region === 'all' || !region) return [{ key: 'here', name: 'Vị trí hiện tại', region: 'all' }].concat(CITIES, mine);
    return CITIES.filter((c) => c.region === region);
}

/** A short word for the driver, or null: what the weather means for the road, else when the rain comes. */
function tip(cur, today, hourly, air) {
    if (!cur) return null;
    const c = Number(cur.code), wet = (x) => (x >= 51 && x <= 67) || (x >= 80 && x <= 86) || x >= 95;
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return { text: 'Tuyết: đi chậm, đường trơn', kind: 'warn' };
    if (c >= 95) return { text: 'Giông: tránh dừng dưới cây', kind: 'crit' };
    if (air && air.aqi > 150) return { text: 'Bụi mịn cao: bật lọc gió trong', kind: 'warn' };
    if (wet(c)) return { text: c === 65 || c === 82 ? 'Mưa to: giảm tốc, bật đèn' : 'Đường trơn: giữ khoảng cách', kind: 'warn' };
    if (c === 45 || c === 48) return { text: 'Sương mù: bật đèn sương', kind: 'warn' };
    if (cur.wind >= 40) return { text: 'Gió mạnh: cẩn thận khi vượt xe tải', kind: 'warn' };
    for (let i = 1; i < Math.min(4, (hourly || []).length); i++) {
        const h = hourly[i];
        if (wet(Number(h.code)) || (h.pop !== null && h.pop >= 60)) return { text: 'Mưa lúc ' + h.time, kind: 'info' };
    }
    if (today && today.uv >= 8 && cur.day) return { text: 'UV cao: nên che nắng', kind: 'info' };
    if (cur.t >= 36) return { text: 'Nắng nóng: bật điều hoà trước', kind: 'info' };
    return null;
}

/** A place name the location service gives in English ("Ho Chi Minh City", "Hanoi", "Da Nang") as the list writes it, with its accents. */
const bare = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase()
    .replace(/\b(city|province|thanh pho|tp|tinh)\b/g, ' ').replace(/[^a-z0-9]+/g, '');
function viName(name) {
    const b = bare(name);
    if (!b) return name;
    const hit = CITIES.filter((c) => c.region !== 'nn' && bare(c.name) === b)[0];
    return hit ? hit.name : name;
}
const HERE = { key: 'here', name: 'Vị trí hiện tại', lat: 0, lon: 0, here: true };
const DEFAULT_KEYS = ['here', 'hanoi', 'hcm', 'danang'];
const MAX_PLACES = 6;

/** The places for a list of keys, 'here' first if present; unknown keys are dropped. */
function placesFor(keys, custom) {
    const out = [];
    (keys || []).forEach((k) => {
        const p = k === 'here' ? HERE : CITIES.filter((c) => c.key === k)[0] || (custom || []).filter((c) => c.key === k)[0];
        if (p && !out.some((x) => x.key === p.key)) out.push(Object.assign({}, p));
    });
    if (!out.length) return placesFor(DEFAULT_KEYS, custom);
    return out.slice(0, MAX_PLACES);
}

/** The figures that can be shown in the small tiles, in the order of the settings. */
const TILES = [['wind', 'Gió'], ['gust', 'Gió giật'], ['humidity', 'Độ ẩm'], ['rain', 'Mưa'], ['uv', 'Chỉ số UV'], ['aqi', 'Không khí (AQI)'], ['vis', 'Tầm nhìn'], ['pressure', 'Áp suất'], ['sun', 'Mặt trời']];
/** What the middle block on the right shows: the next hours as icons, as a temperature curve, the sun's arc, or nothing. */
const BLOCKS = [['icons', 'Theo giờ'], ['chart', 'Biểu đồ'], ['sun', 'Mặt trời'], ['off', 'Ẩn']];
const DEFAULT_SETTINGS = { tiles: ['wind', 'humidity', 'rain', 'uv', 'aqi'], block: 'icons', days: true, tips: true, fx: true, unit: 'C' };
const MAX_TILES = 8;
/** Settings as stored (anything may be missing or wrong) -> a complete, valid set. */
function settingsOf(o) {
    o = o && typeof o === 'object' ? o : {};
    const ids = TILES.map((x) => x[0]);
    const tiles = Array.isArray(o.tiles) ? ids.filter((k) => o.tiles.indexOf(k) >= 0).slice(0, MAX_TILES) : DEFAULT_SETTINGS.tiles.slice();
    const bool = (v, d) => (typeof v === 'boolean' ? v : d);
    return { tiles, block: BLOCKS.some((b) => b[0] === o.block) ? o.block : DEFAULT_SETTINGS.block, days: bool(o.days, true), tips: bool(o.tips, true), fx: bool(o.fx, true), unit: o.unit === 'F' ? 'F' : 'C' };
}
const mins = (hhmm) => { const m = /^(\d\d):(\d\d)/.exec(String(hhmm || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
/** The sun today: { rise, set (minutes of the day), now, p: 0..1 while it is up (else null), left: minutes of light left (0 when down) }. */
function sunDay(curTime, today) {
    const rise = mins(today && today.sunrise), set = mins(today && today.sunset), now = mins(String(curTime || '').slice(11, 16));
    if (rise === null || set === null || now === null || set <= rise) return null;
    const up = now >= rise && now <= set;
    return { rise, set, now, p: up ? (now - rise) / (set - rise) : null, left: up ? set - now : 0 };
}
const hm = (m) => (m === null ? '–' : ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2));
/** One tile: { title, value, sub, bar } (bar: a colour for an accent under the value) from what the forecast knows. */
function tileInfo(id, cur, today, daily, air) {
    const f = (v) => v !== null && v !== undefined && isFinite(v);
    if (id === 'wind') return { title: 'Gió', value: f(cur.wind) ? String(Math.round(cur.wind)) : '–', sub: 'km/h' };
    if (id === 'gust') return { title: 'Gió giật', value: f(cur.gust) ? String(Math.round(cur.gust)) : '–', sub: 'km/h' };
    if (id === 'humidity') return { title: 'Độ ẩm', value: pct(cur.humidity), sub: '' };
    if (id === 'rain') return { title: 'Mưa', value: pct(today.pop), sub: cur.rain > 0 ? cur.rain + ' mm' : '' };
    if (id === 'uv') return { title: 'UV', value: f(today.uv) ? String(Math.round(today.uv)) : '–', sub: uvText(today.uv) };
    if (id === 'aqi') { const b = aqiBand(air && air.aqi); return { title: 'AQI', value: air ? String(Math.round(air.aqi)) : '–', sub: air ? b.text : 'chưa có', bar: air ? b.color : '' }; }
    if (id === 'vis') return { title: 'Tầm nhìn', value: f(cur.vis) ? (cur.vis >= 10000 ? String(Math.round(cur.vis / 1000)) : (cur.vis / 1000).toFixed(1)) : '–', sub: 'km' };
    if (id === 'pressure') return { title: 'Áp suất', value: f(cur.pressure) ? String(Math.round(cur.pressure)) : '–', sub: 'hPa' };
    if (id === 'sun') {
        const sd = sunDay(cur.time, today);
        if (!sd) return { title: 'Mặt trời', value: '–', sub: '' };
        if (sd.now < sd.rise) return { title: 'Mọc lúc', value: hm(sd.rise), sub: '' };
        if (sd.now <= sd.set) return { title: 'Lặn lúc', value: hm(sd.set), sub: 'còn ' + Math.floor(sd.left / 60) + 'g' + ('0' + (sd.left % 60)).slice(-2) };
        const nx = daily && daily[1] && mins(daily[1].sunrise);
        return { title: 'Mọc lúc', value: nx === null || nx === undefined ? '–' : hm(nx), sub: 'ngày mai' };
    }
    return { title: '', value: '', sub: '' };
}

module.exports = {
    setUnit, getUnit, TILES, BLOCKS, DEFAULT_SETTINGS, MAX_TILES, settingsOf, sunDay, hm, tileInfo, describe, viName, DOW, compass, deg, pct, kmh, uvText, aqiBand, tip, REGIONS, listFor, CITIES, HERE, DEFAULT_KEYS, MAX_PLACES, placesFor };
