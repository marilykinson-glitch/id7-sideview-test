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

/** A temperature as the screen writes it: whole degrees, "–" when there is none. */
const deg = (v) => (v === null || v === undefined || !isFinite(v) ? '–' : Math.round(v) + '°');
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

/** Places to choose from: key, name, latitude, longitude. */
const CITIES = [
    ['hanoi', 'Hà Nội', 21.028, 105.854], ['hcm', 'TP. Hồ Chí Minh', 10.776, 106.701], ['danang', 'Đà Nẵng', 16.054, 108.202], ['haiphong', 'Hải Phòng', 20.845, 106.688],
    ['cantho', 'Cần Thơ', 10.045, 105.747], ['hue', 'Huế', 16.463, 107.585], ['nhatrang', 'Nha Trang', 12.239, 109.197], ['dalat', 'Đà Lạt', 11.940, 108.458],
    ['vungtau', 'Vũng Tàu', 10.346, 107.084], ['bienhoa', 'Biên Hòa', 10.957, 106.842], ['thudaumot', 'Thủ Dầu Một', 10.994, 106.650], ['halong', 'Hạ Long', 20.959, 107.043],
    ['vinh', 'Vinh', 18.679, 105.681], ['thanhhoa', 'Thanh Hóa', 19.807, 105.776], ['quynhon', 'Quy Nhơn', 13.782, 109.219], ['buonmathuot', 'Buôn Ma Thuột', 12.668, 108.038],
    ['pleiku', 'Pleiku', 13.983, 108.000], ['phanthiet', 'Phan Thiết', 10.933, 108.100], ['longxuyen', 'Long Xuyên', 10.386, 105.435], ['mytho', 'Mỹ Tho', 10.360, 106.360],
    ['rachgia', 'Rạch Giá', 10.012, 105.080], ['camau', 'Cà Mau', 9.177, 105.150], ['sapa', 'Sa Pa', 22.336, 103.844], ['langson', 'Lạng Sơn', 21.853, 106.761],
    ['haiduong', 'Hải Dương', 20.940, 106.333], ['namdinh', 'Nam Định', 20.420, 106.168], ['thainguyen', 'Thái Nguyên', 21.594, 105.848], ['viettri', 'Việt Trì', 21.322, 105.402],
    ['bacninh', 'Bắc Ninh', 21.186, 106.076], ['hoabinh', 'Hòa Bình', 20.813, 105.338], ['ninhbinh', 'Ninh Bình', 20.250, 105.975], ['donghoi', 'Đồng Hới', 17.469, 106.623],
    ['dongha', 'Đông Hà', 16.816, 107.100], ['tamky', 'Tam Kỳ', 15.573, 108.474], ['quangngai', 'Quảng Ngãi', 15.120, 108.804], ['tuyhoa', 'Tuy Hòa', 13.088, 109.093],
    ['phanrang', 'Phan Rang', 11.567, 108.989], ['tayninh', 'Tây Ninh', 11.310, 106.098], ['bentre', 'Bến Tre', 10.243, 106.375], ['vinhlong', 'Vĩnh Long', 10.254, 105.972],
    ['soctrang', 'Sóc Trăng', 9.603, 105.973], ['baclieu', 'Bạc Liêu', 9.285, 105.724], ['hagiang', 'Hà Giang', 22.823, 104.984], ['dienbien', 'Điện Biên', 21.386, 103.017],
    ['phuquoc', 'Phú Quốc', 10.227, 103.967], ['hoian', 'Hội An', 15.880, 108.338],
].map((c) => ({ key: c[0], name: c[1], lat: c[2], lon: c[3] }));
const HERE = { key: 'here', name: 'Vị trí hiện tại', lat: 0, lon: 0, here: true };
const DEFAULT_KEYS = ['here', 'hanoi', 'hcm', 'danang'];
const MAX_PLACES = 6;

/** The places for a list of keys, 'here' first if present; unknown keys are dropped. */
function placesFor(keys) {
    const out = [];
    (keys || []).forEach((k) => {
        const p = k === 'here' ? HERE : CITIES.filter((c) => c.key === k)[0];
        if (p && !out.some((x) => x.key === p.key)) out.push(Object.assign({}, p));
    });
    if (!out.length) return placesFor(DEFAULT_KEYS);
    return out.slice(0, MAX_PLACES);
}

module.exports = { describe, DOW, compass, deg, pct, kmh, uvText, aqiBand, CITIES, HERE, DEFAULT_KEYS, MAX_PLACES, placesFor };
