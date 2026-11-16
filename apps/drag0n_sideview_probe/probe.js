'use strict';

const control = {
    BLINKEN_AUS: 0,
    TIPP_BLINKEN_LINKS_EIN: 1,
    TIPP_BLINKEN_RECHTS_EIN: 2,
    DAUER_BLINKEN_LINKS_EIN: 3,
    DAUER_BLINKEN_RECHTS_EIN: 4,
    BEIDSEITIGES_BLINKEN_EIN: 8,
};
const directions = { 0: 'OFF', 1: 'LEFT', 2: 'RIGHT', 3: 'LEFT', 4: 'RIGHT', 8: 'HAZARD' };
const activeDirections = { 0: 'OFF', 6: 'HAZARD', 7: 'LEFT', 8: 'RIGHT', 9: 'LEFT', 10: 'RIGHT' };

function field(value, key) {
    if (!value || typeof value !== 'object') return undefined;
    if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
    for (const child of Object.values(value)) {
        const found = field(child, key);
        if (found !== undefined) return found;
    }
    return undefined;
}

function decode(value) {
    const command = field(value, 'controlIndicateDirection');
    const active = field(value, 'activeFunctionIndicateDirection');
    const commanded = directions[Object.prototype.hasOwnProperty.call(control, command) ? control[command] : command];
    const observed = activeDirections[active]
        || (/^(?:DAUERBLINKEN|TIPPBLINKEN)_LINKS$/.test(active) ? 'LEFT' : undefined)
        || (/^(?:DAUERBLINKEN|TIPPBLINKEN)_RECHTS$/.test(active) ? 'RIGHT' : undefined)
        || (active === 'WARNBLINKEN_MANUELL' ? 'HAZARD' : undefined);
    const direction = commanded && commanded !== 'OFF' ? commanded : observed || commanded;
    return { direction, raw: String(command == null ? '-' : command) + ' / ' + String(active == null ? '-' : active) };
}

function cameraNames(catalog) {
    const names = new Set();
    const qualified = /\bde\.bmw\.[a-zA-Z0-9_.]+/g;
    const related = /camera|surround.?view|panorama.?view|flank.?view|park(?:ing)?.{0,4}assist|trsvc|\bicam\d*\b/i;
    function scan(value) {
        if (typeof value === 'string') {
            for (const name of value.match(qualified) || []) {
                if (related.test(name)) names.add(name);
            }
        } else if (value && typeof value === 'object') {
            for (const [key, child] of Object.entries(value)) {
                scan(key);
                scan(child);
            }
        }
    }
    scan(catalog);
    return Array.from(names).sort();
}

module.exports = { decode, cameraNames };
