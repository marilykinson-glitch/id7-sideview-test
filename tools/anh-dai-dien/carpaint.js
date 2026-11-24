'use strict';
/**
 * carpaint.js - reads the car's live coding (/dev/shm/rawcodingdata), BMW's 2D carpaint colour
 * registry (VEHICLE_CARPAINT_colorregistry.pbc + variantregistry_ext_car.pbvar), the HeroVehicle
 * trimline mapping (hmi_script.lua) and each 2D vehicle bundle's scene.pbx, and shades the 2D
 * car bitmap + paint mask with the head unit's exact GLSL carpaint formula.
 * Node 8, no dependencies.
 */
const fs = require('fs');

const WHITE_PAINT = {
    name: 'alpin_white_U300',
    base: [0.8, 0.8, 0.85, 1.4],
    spec: [0.8, 0.8, 0.85, 8.5],
    refl: [1.1, 1.1, 1.1, 1.0],
};

const DEFAULT_PAINT = {
    name: 'DEFAULT',
    base: [0.216, 0.251, 0.347, 8.0],
    spec: [1.313, 1.373, 1.4, 10.0],
    refl: [0.823, 0.823, 0.823, 1.0],
};

/* CAFD 00003E52 (HU_MGU): 3000 HMI_SPEECH (0x000) byte 0x3c = VEHICLE_COLOUR, byte 0x3d = TRIM_LINE;
   3002 AUDIO_BROADCAST (0x12d) byte 0x1b = BAUREIHE. Extracted from HmiMain3D descriptors. */
const COLOUR_BY_CODE = {
    0x01: 'alpin_white', 0x02: 'black_2', 0x03: 'carbonschwarz_metallic', 0x04: 'black_sapphire_metallic',
    0x05: 'kaschmirsilber_metallic', 0x06: 'melbournerot_metallic', 0x07: 'glaciersilber_metallic',
    0x08: 'imperialblau_brillianteffekt_metallic', 0x09: 'sophistograu_brillianteffekt_metallic',
    0x0a: 'mineralweiss_metallic', 0x0b: 'mineralgrau_metallic', 0x0c: 'singapur_grau_metallic',
    0x0d: 'estorilblau_2_metallic', 0x0e: 'sparkling_brown_metallic', 0x0f: 'jatoba_metallic',
    0x10: 'moonlight_silver_metallic', 0x11: 'flamencorot_brillianteffekt_metallic',
    0x12: 'sparkling_storm_brillianteffekt_metallic', 0x13: 'platinsilber_metallic', 0x14: 'atlantikgrau_metallic',
    0x15: 'mediterranblau_metallic', 0x16: 'brands_hatch_grey_metallic', 0x17: 'sonic_speed_blue_metallic',
    0x18: 'misano_blau_metallic', 0x19: 'snapper_rocks_blue_metallic', 0x1a: 'marina_bay_blau_metallic',
    0x1b: 'terrabraun_metallic', 0x1c: 'phytonicblau_metallic', 0x1d: 'sonnenstein_metallic',
    0x1e: 'galvanic_gold_metallic', 0x1f: 'sunset_orange_metallic', 0x20: 'vermontbronze_metallic',
    0x21: 'royal_burgundy_red_brillianteffekt', 0x22: 'magellangrau_metallic', 0x23: 'arktikgrau_brillianteffekt',
    0x24: 'donington_grau_metallic', 0x25: 'kastanienbronze_metallic', 0x26: 'atlaszeder_metallic',
    0x27: 'jucarobeige_metallic', 0x28: 'bluestone_metallic', 0x29: 'portimao_blau_metallic',
    0x2a: 'san_francisco_rot_metallic', 0x2b: 'blue_ridge_mountain_metallic', 0x2c: 'dravitgrau_metallic',
    0x2d: 'frozen_grey_2_metallic', 0x2e: 'barcelona_blau_metallic', 0x2f: 'manhattan_metallic',
    0x30: 'toronto_rot_metallic', 0x31: 'motegi_rot_metallic', 0x32: 'azuritschwarz_metallic',
    0x33: 'citrinschwarz_metallic', 0x34: 'rubinschwarz_metallic', 0x35: 'mondstein_metallic',
    0x36: 'alpinablau_2_metallic', 0x37: 'champagner_quarz_metallic', 0x38: 'alpinagruen_2_metallic',
    0x39: 'tansanitblau_metallic', 0x3a: 'pyritbraun_metallic', 0x3b: 'almandinbraun_metallic',
    0x3c: 'rhodonitsilber_metallic', 0x3d: 'frozen_brass_metallic', 0x3e: 'oxidgrau_metallic',
    0x3f: 'ametrin_metallic', 0x40: 'aventurinrot_2_metallic', 0x41: 'karmesinrot', 0x42: 'atacamagelb',
    0x43: 'long_beach_blue_metallic', 0x44: 'manhattengruen_metallic', 0x45: 'berningrau_bernsteineffekt_metallic',
    0x46: 'seaside_blue_metallic', 0x47: 'piemont_rot_metallic', 0x48: 'sao_paulo_yellow',
    0x49: 'storm_bay_metallic', 0x4a: 'isle_of_man_green_metallic', 0x4b: 'frozen_portimao_blue_metallic',
    0x4c: 'sanremo_green_metallic', 0x4d: 'premiere_silver', 0x4e: 'infinite_black', 0x4f: 'sapphire_black',
    0x50: 'tansanitblau_2_metallic', 0x51: 'olivin_2', 0x52: 'lyrical_copper', 0x53: 'black_kirsch',
    0x54: 'magma_red', 0x55: 'twilight_purple_RR', 0x56: 'dark_indigo', 0x57: 'black_solid',
    0x58: 'belladonna_purple', 0x59: 'imperial_jade', 0x5a: 'riverside_blau_metallic',
    0x5b: 'frozen_orange_metallic', 0x5c: 'almandinbraun_2_metallic', 0x5d: 'azuritschwarz_2_metallic',
    0x5e: 'champagner_quarz_2_metallic', 0x5f: 'citrinschwarz_2_metallic', 0x60: 'oxidgrau_2_metallic',
    0x61: 'rhodonitsilber_2_metallic', 0x62: 'frozen_brilliant_white_metallic', 0x63: 'frozen_bluestone_metallic',
    0x64: 'brooklyn_grau_metallic', 0x65: 'frozen_pure_grey', 0x66: 'skyscraper_grey',
    0x67: 'sparkling_kupfergrau_metallic', 0x68: 'thundernight_metallic', 0x69: 'aventurinrot_3_metallic',
    0x6a: 'nardograu', 0x6b: 'oxfordgruen_2', 0x6c: 'peridotgruen', 0x6d: 'pure_metal_silver',
    0x6e: 'rauchtopas', 0x6f: 'rosso_corsa', 0x70: 'alvitgrau_metallic', 0x71: 'arctic_race_blue_metallic',
    0x72: 'blue_lagoon_metallic', 0x73: 'brands_hatch_grey_frozen', 0x74: 'frozen_deep_green_metallic',
    0x75: 'frozen_portimao_blue_2_metallic', 0x76: 'frozen_tanzanite_blue_metallic', 0x77: 'macao_blau',
    0x78: 'frozen_pure_grey_2_metallic', 0x79: 'ametrin_2_metallic', 0x7a: 'san_marino_blau',
    0x7b: 'urban_green', 0x7c: 'velvetblau', 0x7d: 'verde_ermes_perl', 0x7e: 'violett_blau_2',
    0x7f: 'frozen_brooklyn_grey_metallic', 0x80: 'silbergrau', 0x81: 'aurora_diamant_gruen',
    0x82: 'brillantweiss', 0x83: 'british_racing_green', 0x84: 'daytonaviolett', 0x85: 'frozen_arctic_grey',
    0x86: 'frozen_black', 0x87: 'frozen_brilliant_white', 0x88: 'frozen_cashmere_silver',
    0x89: 'frozen_dark_brown', 0x8a: 'space_silver_metallic', 0x8b: 'utah_orange_metallic',
    0x8c: 'cape_york_green_metallic', 0x8d: 'frozen_deep_grey_metallic', 0x8e: 'flowing_mineral_grey',
    0x8f: 'mint_green', 0x90: 'frozen_dark_grey', 0x91: 'frozen_dark_silver', 0x92: 'frozen_marina_bay_blau',
    0x93: 'grigio_telesto', 0x94: 'hockenheim_silber', 0x95: 'imolarot_2', 0x96: 'kreide',
    0x97: 'laguna_seca_blau', 0x98: 'lime_rock_grey', 0x99: 'malachitgruen', 0x9a: 'm_zandvoort_blue',
    0x9b: 'dakar_yellow_2', 0x9c: 'liquid_copper_metallic', 0x9d: 'bohemian_red', 0x9e: 'pyritbraun_2_metallic',
    0x9f: 'scala_red', 0xa0: 'arctic_white', 0xa1: 'frozen_bronze', 0xa2: 'frozen_orange_2',
    0xa3: 'mexico_blau', 0xa4: 'santorinblau', 0xa5: 'orinoco', 0xa6: 'midnight_sapphire_2',
    0xa7: 'wildberry', 0xa8: 'twilight_purple', 0xa9: 'tramonto_bordeaux', 0xaa: 'graphite_2',
    0xab: 'vapour_violet', 0xac: 'iced_black_diamond', 0xad: 'satin_silver', 0xae: 'chartreuse',
    0xaf: 'frozen_solid_white', 0xb0: 'silver_2', 0xb1: 'speedgelb', 0xb2: 'javagruen_2',
    0xb3: 'zanzibar_2', 0xb4: 'gunmetal_2', 0xb5: 'bostongruen', 0xb6: 'feuerorange_3',
    0xb7: 'goodwoodgruen', 0xb8: 'modegrau', 0xb9: 'grauschwarz', 0xba: 'riviera_blue',
    0xbb: 'frozen_isle_of_man_green', 0xbc: 'frozen_carbon_black', 0xbd: 'bright_red',
    0xc0: 'jubilee_silver', 0xc1: 'atlantis', 0xc2: 'rubinrot_2', 0xc3: 'nachtblau',
    0xc4: 'maledivenblau_2', 0xc5: 'avusblau', 0xc6: 'stratusgrau', 0xc7: 'petrol_mica',
    0xc8: 'jerezschwarz', 0xc9: 'voodoo_blue', 0xcc: 'frozen_pure_red_metallic', 0xd0: 'anthracite',
    0xd1: 'le_mans_blau', 0xd2: 'miamiblau', 0xd3: 'nightgold_2_metallic', 0xd4: 'dark_grey_metallic',
    0xd5: 'bmw_i_blue_metallic', 0xd6: 'titan_bronze_metallic', 0xd7: 'mineral_red',
    0xd8: 'macadamia_metallic', 0xd9: 'salamanca_blue', 0xdc: 'veneziaviolett_metallic',
    0xe0: 'darkest_tungsten', 0xe1: 'brass_messing', 0xe2: 'sepia_violet_metallic', 0xe3: 'mora_metallic',
    0xe4: 'signal_green', 0xe5: 'sepang_bronze_metallic', 0xe6: 'enzian_blue', 0xe7: 'black_blue',
    0xe8: 'indianapolis_red_metallic', 0xe9: 'iguazu_blue', 0xec: 'verde_mantis', 0xf0: 'black_diamond',
    0xf1: 'mineral_white_metallic_matt', 0xf2: 'monteverde', 0xf3: 'wittering_blue', 0xf4: 'morganite',
    0xf5: 'tempest_grey', 0xf6: 'petra_gold', 0xf7: 'white_sands', 0xf8: 'english_white',
    0xf9: 'dark_emerald', 0xfc: 'malachite_green_dark_metallic',
};

const TRIM_BY_CODE = {
    0x00: 'base', 0x01: 'm_sportpaket', 0x02: 'sportpaket', 0x03: 'm_carbon_exterieurpaket',
    0x04: 'xline', 0x05: 'm_sport_x_paket', 0x06: 'chrome_line_exterieur', 0x07: 'luxury_line',
    0x08: 'sport_line', 0x09: 'alpina_package', 0x0a: 'modell_v12_excellence',
    0x0b: 'm_sportpaket_inkl_int_design_pure_excellence', 0x0c: 'exterieurdesign_pure_excellence',
    0x0d: 'exterieurdesign_pure_experience', 0x0e: 'individual_ext_line_alu_satiniert',
    0x0f: 'individual_hochglanz_shadow_line', 0x10: 'm_sportbremse', 0x11: 'm_aerodynamikpaket',
    0x12: 'm_heckspoiler', 0x13: 'm_carbondach', 0x14: 'einstiegsleisten_bmw_individual',
    0x15: 'aluminium_trittbrett', 0x16: 'indiv_dachreling_hochgl_shadow_line', 0x17: 'dachreling_schwarz',
    0x18: 'dachreling_aluminium_satiniert', 0x19: 'bmw_laserlicht', 0x1a: 'xenon_licht',
    0x1b: 'adaptives_kurvenlicht', 0x1c: 'adaptiver_led_scheinwerfer', 0x1d: 'led_nebelscheinwerfer',
    0x1e: 'nebelscheinwerfer', 0x1f: 'spiegelkappen_schwarz', 0x20: 'clubsport',
    0x21: 'm_sport_package_pro', 0x22: 'm_competition',
};

const BAUREIHE_BY_CODE = {
    0x0d: 'F13', 0x0f: 'F15', 0x10: 'RR04', 0x11: 'F16', 0x12: 'F18', 0x13: 'G08BEV',
    0x14: 'F20', 0x15: 'F21', 0x16: 'F22', 0x17: 'F23', 0x18: 'G08BEVLCI', 0x19: 'F25',
    0x1a: 'F26', 0x20: 'G26BEV', 0x21: 'G11', 0x22: 'G12', 0x23: 'G05', 0x24: 'G06',
    0x25: 'G07', 0x26: 'G14', 0x27: 'G15', 0x28: 'G16', 0x29: 'G07LCI', 0x2a: 'G20',
    0x2b: 'G21', 0x2c: 'G22', 0x2d: 'G23', 0x2e: 'G24', 0x2f: 'G26', 0x30: 'G30',
    0x31: 'G31', 0x32: 'G38', 0x33: 'G32', 0x34: 'G30LCI', 0x35: 'G31LCI', 0x36: 'G32LCI',
    0x37: 'G38LCI', 0x38: 'F90LCI', 0x39: 'F97LCI', 0x3a: 'G28', 0x3b: 'G29', 0x3c: 'J29',
    0x3d: 'F98LCI', 0x3e: 'G82', 0x40: 'F30', 0x41: 'F31', 0x42: 'F32', 0x43: 'F33',
    0x44: 'F34', 0x45: 'F35', 0x46: 'F36', 0x47: 'G09', 0x48: 'G18', 0x49: 'G20LCI',
    0x4a: 'G83', 0x50: 'G21LCI', 0x51: 'G28BEV', 0x52: 'F52', 0x53: 'G28LCI', 0x54: 'F54',
    0x55: 'F55', 0x56: 'F56', 0x57: 'F57', 0x58: 'G81', 0x59: 'G87', 0x5a: 'F60',
    0x5b: 'F95', 0x5c: 'F96', 0x5d: 'G80', 0x60: 'I01', 0x61: 'I12', 0x62: 'I20',
    0x63: 'U06', 0x64: 'U11', 0x65: 'G01', 0x66: 'G02', 0x67: 'G08', 0x6a: 'F93',
    0x6b: 'G60', 0x6c: 'G61', 0x6d: 'G68', 0x70: 'F45', 0x71: 'F46', 0x72: 'F47',
    0x73: 'F48', 0x74: 'F49', 0x7a: 'G70', 0x7b: 'G42', 0x80: 'F80', 0x82: 'F82',
    0x83: 'F83', 0x85: 'F85', 0x86: 'F86', 0x87: 'F87', 0x88: 'F97', 0x89: 'F98',
    0x90: 'RR05', 0x91: 'RR11', 0x92: 'RR12', 0x94: 'RR14',
};

/* Stem aliases where va_VEHICLE_COLOUR_<stem> differs in spelling from CARPAINT_BASE_<stem>_<CODE>. */
const PAINT_STEM_ALIASES = {
    sao_paulo_yellow: 'sao_paulo_gelb',
    isle_of_man_green_metallic: 'isle_of_man_gruen_metallic',
    frozen_marina_bay_blau: 'frozen_marina_bay_blue',
    frozen_portimao_blue_metallic: 'frozen_portimao_blau_metallic',
    misano_blau_metallic: 'sonic_misano_blau_metallic',
    blue_lagoon_metallic: 'blue_bay_lagoon_metallic',
    brands_hatch_grey_frozen: 'frozen_brands_hatch_grey_metallic',
    frozen_pure_grey_2_metallic: 'frozen_pure_grey_2',
    atacamagelb: 'atacama_gelb',
    berningrau_bernsteineffekt_metallic: 'berninagrau_bernsteineffekt_metallic',
};

/* Built-in mirror of initTrimlineConfig(baureihe) from /mnt/dataro/dataro1/hmi/bmw/id7/script/hmi_script.lua (0..11 -> 'A'..'L'). */
const TRIM_RULES = {
    F90LCI: { clubsport: 'L' },
    G82: { m_competition: 'K', clubsport: 'L' },
    G15: { m_sportpaket: 'E', sportpaket: 'E', m_carbon_exterieurpaket: 'F', luxury_line: 'B', m_aerodynamikpaket: 'E' },
    G14: { m_sportpaket: 'E', sportpaket: 'E', m_carbon_exterieurpaket: 'F', luxury_line: 'B', m_aerodynamikpaket: 'E' },
    G05: { m_sportpaket: 'E', sportpaket: 'E', xline: 'G', m_aerodynamikpaket: 'E' },
    F15: { m_sportpaket: 'E', sportpaket: 'E', xline: 'G', m_aerodynamikpaket: 'E' },
    G29: { m_sportpaket: 'E', sportpaket: 'E', sport_line: 'C', m_aerodynamikpaket: 'J' },
    G07: { m_sportpaket: 'E', sportpaket: 'E', m_carbon_exterieurpaket: 'B', xline: 'B', m_sport_x_paket: 'B', luxury_line: 'B', sport_line: 'B', alpina_package: 'B', m_aerodynamikpaket: 'E' },
    G20: { m_sportpaket: 'E', sportpaket: 'E', luxury_line: 'B', sport_line: 'C', m_aerodynamikpaket: 'J' },
    G28: { m_sportpaket: 'E', sportpaket: 'E', luxury_line: 'B', sport_line: 'C', m_aerodynamikpaket: 'J' },
    F40: { m_sportpaket: 'E', sportpaket: 'E', luxury_line: 'B', sport_line: 'C', m_aerodynamikpaket: 'J' },
    G11: { m_sportpaket: 'E', sportpaket: 'E', luxury_line: 'B', m_aerodynamikpaket: 'E' },
    G12: { m_sportpaket: 'E', sportpaket: 'E', luxury_line: 'B', m_aerodynamikpaket: 'E' },
    G01: { m_sportpaket: 'E', sportpaket: 'E', xline: 'G', luxury_line: 'B', m_aerodynamikpaket: 'J' },
    G08: { m_sportpaket: 'E', sportpaket: 'E', xline: 'G', luxury_line: 'B', m_aerodynamikpaket: 'J' },
    G02: { m_sportpaket: 'E', sportpaket: 'E', xline: 'G', m_sport_x_paket: 'H', m_aerodynamikpaket: 'J' },
    G06: { m_sportpaket: 'E', sportpaket: 'E', xline: 'G', m_aerodynamikpaket: 'J' },
    G31: { _base: 'B', m_sportpaket: 'E', sportpaket: 'E', m_aerodynamikpaket: 'E' },
    G21: { _base: 'B', m_sportpaket: 'E', sportpaket: 'E', m_aerodynamikpaket: 'E' },
    G16: { _base: 'B', m_sportpaket: 'E', sportpaket: 'E', m_aerodynamikpaket: 'J' },
    G32: { m_sportpaket: 'E', sportpaket: 'E', luxury_line: 'B', sport_line: 'C', m_aerodynamikpaket: 'E' },
    F44: { m_sportpaket: 'E', sportpaket: 'E', m_carbon_exterieurpaket: 'E', xline: 'E', m_sport_x_paket: 'E', luxury_line: 'B', sport_line: 'C', alpina_package: 'E', m_aerodynamikpaket: 'J' },
    G30LCI: { m_sportpaket: 'E', luxury_line: 'B', m_aerodynamikpaket: 'J' },
    G31LCI: { m_sportpaket: 'E', luxury_line: 'B', m_aerodynamikpaket: 'J' },
    G32LCI: { m_sportpaket: 'E', luxury_line: 'B', m_aerodynamikpaket: 'J' },
    G38LCI: { m_sportpaket: 'E', luxury_line: 'B', m_aerodynamikpaket: 'J' },
    G01LCI: { m_sportpaket: 'E', sportpaket: 'E', m_aerodynamikpaket: 'J' },
    G02LCI: { m_sportpaket: 'E', sportpaket: 'E', m_aerodynamikpaket: 'J' },
    G22: { m_sportpaket: 'E', sportpaket: 'E', m_aerodynamikpaket: 'J' },
    G23: { m_sportpaket: 'E', sportpaket: 'E', m_aerodynamikpaket: 'J' },
    G26: { m_sportpaket: 'E', sportpaket: 'E', m_aerodynamikpaket: 'J' },
    G42: { m_sportpaket: 'E', sportpaket: 'E', m_aerodynamikpaket: 'J' },
    F90: {}, F91: {}, F92: {}, F93: {}, F95: {}, F96: {}, F97: {}, F97LCI: {}, F98: {}, F98LCI: {},
    G80: {}, G81: {}, G83: {}, G87: {}, G08LCI: {}, G08BEV: {}, G08BEVLCI: {}, G18: {},
    _default: { m_sportpaket: 'E', sportpaket: 'E', luxury_line: 'B', sport_line: 'C', m_aerodynamikpaket: 'E' },
};

/* ---------------- minimal protobuf wire reader ---------------- */
function readVarint(buf, pos) {
    let lo = 0, mul = 1;
    for (let i = 0; i < 10; i++) {
        if (pos >= buf.length) return null;
        const b = buf[pos++];
        if (i < 7) { lo += (b & 0x7f) * mul; mul *= 128; }
        if ((b & 0x80) === 0) return { val: lo, pos };
    }
    return null;
}

function iterFields(buf, onField) {
    let pos = 0;
    while (pos < buf.length) {
        const t = readVarint(buf, pos);
        if (!t || t.val <= 0) return false;
        pos = t.pos;
        const wt = t.val & 7, fn = Math.floor(t.val / 8);
        if (wt === 0) {
            const v = readVarint(buf, pos);
            if (!v) return false;
            pos = v.pos;
            onField(fn, wt, v.val);
        } else if (wt === 1) {
            if (pos + 8 > buf.length) return false;
            onField(fn, wt, buf.slice(pos, pos + 8));
            pos += 8;
        } else if (wt === 2) {
            const ln = readVarint(buf, pos);
            if (!ln || ln.val < 0 || ln.pos + ln.val > buf.length) return false;
            pos = ln.pos;
            onField(fn, wt, buf.slice(pos, pos + ln.val));
            pos += ln.val;
        } else if (wt === 5) {
            if (pos + 4 > buf.length) return false;
            onField(fn, wt, buf.slice(pos, pos + 4));
            pos += 4;
        } else {
            return false;
        }
    }
    return true;
}

/* ---------------- caches for immutable /mnt/dataro files ---------------- */
const cache = {};
function cachedFile(file, parse) {
    if (Buffer.isBuffer(file)) return parse(file);
    if (!file) return null;
    let st;
    try { st = fs.statSync(file); } catch (e) { return null; }
    const k = file + '|' + st.size + '|' + st.mtime.getTime();
    if (cache[k]) return cache[k];
    try {
        const res = parse(fs.readFileSync(file));
        cache[k] = res;
        return res;
    } catch (e) { return null; }
}

/** Parses VEHICLE_CARPAINT_colorregistry.pbc -> { <paintKey>: { name, base, spec, refl } }. */
function readColorRegistry(fileOrBuf) {
    return cachedFile(fileOrBuf, (buf) => {
        const out = {};
        iterFields(buf, (fn, wt, sub) => {
            if (fn !== 1 || wt !== 2) return;
            let full = '', vec = null;
            iterFields(sub, (sfn, swt, ssub) => {
                if (sfn === 1 && swt === 2) {
                    if (ssub.slice(0, 9).toString('latin1') === 'CARPAINT_') full = ssub.toString('latin1');
                    else iterFields(ssub, (nfn, nwt, nsub) => { if (nfn === 2 && nwt === 2) full = nsub.toString('latin1'); });
                } else if ((sfn === 6 || sfn === 2) && swt === 2) {
                    iterFields(ssub, (vfn, vwt, vsub) => {
                        if (vfn === 6 && vwt === 2) {
                            const f4 = [0, 0, 0, 0];
                            iterFields(vsub, (cfn, cwt, cval) => {
                                if (cfn >= 1 && cfn <= 4 && cwt === 5) f4[cfn - 1] = cval.readFloatLE(0);
                            });
                            vec = f4;
                        }
                    });
                }
            });
            const m = /^CARPAINT_(BASE|SPEC|REFL)_(.+)$/.exec(full);
            if (!m || !vec) return;
            const kind = m[1].toLowerCase(), id = m[2];
            if (!out[id]) out[id] = { name: id, base: null, spec: null, refl: null };
            out[id][kind] = vec;
        });
        return out;
    });
}

/** Parses variantregistry_ext_car.pbvar -> { <colourStem>: <paintKey> } ('' -> 'DEFAULT'). */
function readVariantRegistry(fileOrBuf) {
    return cachedFile(fileOrBuf, (buf) => {
        const out = {};
        iterFields(buf, (fn, wt, sub) => {
            if (fn !== 1 || wt !== 2) return;
            let cond = '', prop = '', val = '';
            iterFields(sub, (sfn, swt, ssub) => {
                if (sfn === 1 && swt === 2) {
                    iterFields(ssub, (cfn, cwt, csub) => {
                        if (cwt === 2) cond = csub.toString('latin1');
                    });
                } else if (sfn === 2 && swt === 2) {
                    iterFields(ssub, (afn, awt, asub) => {
                        if (awt !== 2) return;
                        if (afn === 1) {
                            iterFields(asub, (ifn, iwt, isub) => { if (iwt === 2) prop = isub.toString('latin1'); });
                        } else if (afn === 3) {
                            iterFields(asub, (ifn, iwt, isub) => {
                                if (iwt === 2) iterFields(isub, (jfn, jwt, jsub) => { if (jwt === 2) val = jsub.toString('latin1'); });
                            });
                        }
                    });
                }
            });
            if (prop === 'CARPAINT_BASE' && /^CARPAINT_BASE_/.test(val)) {
                const stem = cond.replace(/^va_VEHICLE_COLOUR_/, '');
                out[stem] = val.slice(14);
            }
        });
        return out;
    });
}

/** Resolves a coded colour stem (e.g. 'marina_bay_blau_metallic') to { name, base, spec, refl }. */
function resolvePaint(colourStem, colorRegFile, variantRegFile) {
    const reg = readColorRegistry(colorRegFile);
    if (!reg || !Object.keys(reg).length) return WHITE_PAINT;
    const vmap = readVariantRegistry(variantRegFile) || {};
    const stem = String(colourStem || '').replace(/^va_VEHICLE_COLOUR_/, '');
    const valid = (p) => p && p.base && p.spec && p.refl;
    if (stem) {
        if (vmap[stem] && valid(reg[vmap[stem]])) return reg[vmap[stem]];
        const cands = [stem];
        if (PAINT_STEM_ALIASES[stem]) cands.push(PAINT_STEM_ALIASES[stem]);
        if (/_2_metallic$/.test(stem)) cands.push(stem.replace(/_2_metallic$/, 'II_metallic'));
        const keys = Object.keys(reg);
        for (let i = 0; i < cands.length; i++) {
            const c = cands[i];
            if (valid(reg[c])) return reg[c];
            const pref = c + '_';
            for (let k = 0; k < keys.length; k++) {
                if (keys[k].indexOf(pref) === 0 && /^[A-Z0-9]{4}$/.test(keys[k].slice(pref.length)) && valid(reg[keys[k]])) {
                    return reg[keys[k]];
                }
            }
        }
    }
    if (vmap[''] && valid(reg[vmap['']])) return reg[vmap['']];
    if (valid(reg.DEFAULT)) return reg.DEFAULT;
    return DEFAULT_PAINT;
}

/** Reads /dev/shm/rawcodingdata (libcoding.so layout: flags at 0x28, payload at 0x2c). */
function readRawCoding(fileOrBuf) {
    let buf = null;
    try { buf = Buffer.isBuffer(fileOrBuf) ? fileOrBuf : (fileOrBuf ? fs.readFileSync(fileOrBuf) : null); } catch (e) { buf = null; }
    if (!buf || buf.length < 0x6a || (buf[0x28] & 0x09) !== 0x09) {
        return { valid: false, colourCode: 0, colour: '', trimCode: 0, trimLine: '', baureiheCode: 0, baureihe: '' };
    }
    const colourCode = buf[0x2c + 0x3c];
    const trimCode = buf[0x2c + 0x3d];
    const baureiheCode = buf.length > 0x174 ? buf[0x2c + 0x12d + 0x1b] : 0;
    return {
        valid: true,
        colourCode,
        colour: COLOUR_BY_CODE[colourCode] || '',
        trimCode,
        trimLine: TRIM_BY_CODE[trimCode] || 'base',
        baureiheCode,
        baureihe: BAUREIHE_BY_CODE[baureiheCode] || '',
    };
}

/** Parses hmi_script.lua's initTrimlineConfig(baureihe) when present, falling back to TRIM_RULES. */
function readLuaTrimRules(luaFile) {
    return cachedFile(luaFile, (buf) => {
        const src = buf.toString('utf8');
        const idx = src.indexOf('function initTrimlineConfig');
        if (idx < 0) return null;
        const body = src.slice(idx, Math.min(src.length, idx + 32000));
        const out = {};
        const blocks = body.split(/if\s*\(/);
        for (let i = 1; i < blocks.length; i++) {
            const blk = blocks[i];
            const endIf = blk.indexOf('return');
            const seg = endIf >= 0 ? blk.slice(0, endIf) : blk;
            const models = [];
            const mre = /va_BAUREIHE_([A-Za-z0-9_]+)/g;
            let mm;
            while ((mm = mre.exec(seg.split('then')[0] || '')) !== null) models.push(mm[1]);
            if (!models.length) continue;
            const map = {};
            const tre = /trimline\[baureihe\]\["([^"]+)"\]\s*=\s*(\d+)/g;
            let tm;
            while ((tm = tre.exec(seg)) !== null) {
                const n = Number(tm[2]);
                if (n >= 0 && n <= 25) map[tm[1]] = String.fromCharCode(65 + n);
            }
            models.forEach((m) => { out[m] = map; });
        }
        return out;
    });
}

function resolveHeroTrim(model, trimLine, luaFile) {
    const cleanModel = String(model || '').replace(/^[a-z0-9]+-/, '');
    const tl = !trimLine || trimLine === 'not_defined' ? 'base' : String(trimLine);
    const lua = readLuaTrimRules(luaFile);
    if (lua && lua[cleanModel]) {
        return lua[cleanModel][tl] || lua[cleanModel].base || 'A';
    }
    const rule = TRIM_RULES[cleanModel] || TRIM_RULES._default;
    const base = rule._base || 'A';
    if (tl === 'base') return base;
    return rule[tl] || base;
}

/**
 * Parses <model>/vehicle2D_{big,small}/scene.pbx to map each vehicle_hero_Trim<X> node to its exact
 * ShadingGroup and { pic (tex0), mask (tex1) } bitmap keys in bitmaps.res.
 */
function readSceneTrims(scenePbxFile) {
    return cachedFile(scenePbxFile, (buf) => {
        const trimToSg = {}, sgToTex = {};
        const walkNode = (nb) => {
            let name = '';
            const meshes = [], children = [];
            iterFields(nb, (fn, wt, val) => {
                if (fn === 1 && wt === 2) name = val.toString('latin1');
                else if (fn === 11 && wt === 2) meshes.push(val);
                else if (fn === 10 && wt === 2) children.push(val);
            });
            const m = /vehicle_hero_Trim([A-Za-z0-9]+)$/.exec(name);
            if (m && meshes.length) {
                const tr = m[1].toUpperCase();
                meshes.forEach((mb) => iterFields(mb, (mfn, mwt, mval) => {
                    if (mfn === 3 && mwt === 2 && !trimToSg[tr]) trimToSg[tr] = mval.toString('latin1');
                }));
            }
            children.forEach(walkNode);
        };
        iterFields(buf, (fn, wt, val) => {
            if (fn === 1 && wt === 2) walkNode(val);
            else if (fn === 3 && wt === 2) {
                iterFields(val, (rfn, rwt, rval) => {
                    if (rfn !== 1 || rwt !== 2) return;
                    let sg = '', tex0 = '', tex1 = '';
                    iterFields(rval, (sfn, swt, sval) => {
                        if (sfn === 1 && swt === 2) sg = sval.toString('latin1');
                        else if (sfn === 4 && swt === 2) {
                            let bmp = '', slot = '';
                            iterFields(sval, (tfn, twt, tval) => {
                                if (tfn === 2 && twt === 2) bmp = tval.toString('latin1');
                                else if (tfn === 9 && twt === 2) slot = tval.toString('latin1');
                            });
                            if (slot === 'tex0') tex0 = bmp;
                            else if (slot === 'tex1') tex1 = bmp;
                        }
                    });
                    if (sg && tex0) sgToTex[sg] = { pic: tex0, mask: tex1 };
                });
            }
        });
        const byTrim = {}, trimOfPic = {}, picOfMask = {};
        Object.keys(trimToSg).sort().forEach((tr) => {
            const pair = sgToTex[trimToSg[tr]];
            if (!pair || !pair.pic) return;
            byTrim[tr] = pair;
            if (!trimOfPic[pair.pic]) trimOfPic[pair.pic] = tr;
            if (pair.mask && !picOfMask[pair.mask]) picOfMask[pair.mask] = pair.pic;
        });
        return { byTrim, trimOfPic, picOfMask };
    });
}

/**
 * Exact CPU implementation of BMW's 2D carpaint fragment shader (fx_welcome_G15_TRIMA_HALF1.frag):
 *   diff = BASE.rgb^2 * r^BASE.w
 *   spec = SPEC.rgb^2 * g^(2 * SPEC.w / 12.5)
 *   refl = REFL.rgb^2 * b^2
 *   out_premult.rgb = sqrt(clamp(pic.rgb^2 * (1 - mask.a) + (diff + spec + refl) * mask.a, 0, 1))
 */
function shadeCarpaint(pic, mask, paint) {
    const p = paint && paint.base && paint.spec && paint.refl ? paint : WHITE_PAINT;
    const out = Buffer.alloc(pic.length);
    const br2 = p.base[0] * p.base[0], bg2 = p.base[1] * p.base[1], bb2 = p.base[2] * p.base[2], bw = p.base[3];
    const sr2 = p.spec[0] * p.spec[0], sg2 = p.spec[1] * p.spec[1], sb2 = p.spec[2] * p.spec[2], sw = (2 * p.spec[3]) / 12.5;
    const rr2 = p.refl[0] * p.refl[0], rg2 = p.refl[1] * p.refl[1], rb2 = p.refl[2] * p.refl[2];
    for (let i = 0; i < pic.length; i += 4) {
        const a = pic[i + 3];
        if (!a) continue;
        const ma = mask[i + 3] / 255, ima = 1 - ma;
        let cpR = 0, cpG = 0, cpB = 0;
        if (ma > 0) {
            const mr = mask[i] / 255, mg = mask[i + 1] / 255, mb = mask[i + 2] / 255;
            const df = mr > 0 ? Math.pow(mr, bw) : 0;
            const sf = mg > 0 ? Math.pow(mg, sw) : 0;
            const rf = mb * mb;
            cpR = (br2 * df + sr2 * sf + rr2 * rf) * ma;
            cpG = (bg2 * df + sg2 * sf + rg2 * rf) * ma;
            cpB = (bb2 * df + sb2 * sf + rb2 * rf) * ma;
        }
        const pr = pic[i] / 255, pg = pic[i + 1] / 255, pb = pic[i + 2] / 255;
        const vR = Math.sqrt(Math.min(1, pr * pr * ima + cpR)) * 255;
        const vG = Math.sqrt(Math.min(1, pg * pg * ima + cpG)) * 255;
        const vB = Math.sqrt(Math.min(1, pb * pb * ima + cpB)) * 255;
        out[i] = Math.min(255, Math.round((vR * 255) / a));
        out[i + 1] = Math.min(255, Math.round((vG * 255) / a));
        out[i + 2] = Math.min(255, Math.round((vB * 255) / a));
        out[i + 3] = a;
    }
    return out;
}

module.exports = {
    WHITE_PAINT,
    DEFAULT_PAINT,
    COLOUR_BY_CODE,
    TRIM_BY_CODE,
    BAUREIHE_BY_CODE,
    readColorRegistry,
    readVariantRegistry,
    resolvePaint,
    readRawCoding,
    resolveHeroTrim,
    readSceneTrims,
    shadeCarpaint,
};
