'use strict';
/**
 * car3d.js - the head unit's 3D vehicle (widgetasset/vehicles/<model>/vehicle: meshes, textures, effects) made to
 * show a photo instead of the model. The model is drawn by shaders that are plain text in effects.res:
 *
 *   every material of the car        its vertex shader ends by putting the vertex outside the picture: nothing drawn
 *   the body paint                   (M_CAR_MCP1_CARPAINT1) becomes a picture that stands where the car is and always
 *                                    faces the camera, as large as the car at whatever distance the camera is
 *
 * The body is used because it is always drawn, into the layer the car is seen through. Several meshes share its
 * shader (doors, lids), each with its own place and texture, so the picture is made by one mesh only: the largest,
 * known in the shader by where its first eight vertices are (two rectangles, one for each way a triangle may be
 * culled). Every other vertex is put outside the picture.
 *
 * The paint's one own texture (TEX_MCP1_CARPAINT1, 1024 x 1024, one channel) carries the photo as brightness in
 * its upper half and, at half size below it, the two colour differences and the transparency (see pack()).
 *
 * The compositing quads (M_CAR_Quad_*) and the safe-area effect are left as they are. The shaders are changed by
 * adding lines at the end of main(), with what was there still used, so that no uniform or attribute disappears.
 * The head unit keeps compiled shaders by the effect's id (/var/opt/target/shader-cache): they must be removed
 * after effects.res changes, or the old ones are used.
 * Node 8: no dependencies.
 */
const BODY = 'M_CAR_MCP1_CARPAINT1', TEXTURE = 'TEX_MCP1_CARPAINT1_bitmap';
const KEEP = /Quad|SAFEAREA/;
const SIDE = 1024, PW = 1024, PH = 512;                             // the texture; the photo in it

/** The text with `lines` put before the closing brace of its last function (main). */
function atEnd(src, lines) {
    const at = src.lastIndexOf('}');
    if (at < 0) throw new Error('no closing brace');
    return src.slice(0, at) + lines + src.slice(at);
}
/** The text with `lines` put before main(). */
function beforeMain(src, lines) {
    const m = /void\s+main\s*\(/.exec(src);
    if (!m) throw new Error('no main');
    return src.slice(0, m.index) + lines + src.slice(m.index);
}

const hide = (vertex) => atEnd(vertex, '\tgl_Position = vec4(2., 2., 2., 1.);\n');

/**
 * The first eight vertices of the mesh that will carry the picture: `attributes` is meshes.res.attributes (parsed),
 * `payload(id)` gives an array's bytes. null if there is no such mesh.
 */
function marks(attributes, payload) {
    let best = null;
    attributes.forEach((a) => { if (a.name === 'a_Position' && /_MCP1_/.test(a.mesh) && (!best || Number(a.count) > Number(best.count))) best = a; });
    if (!best || Number(best.count) < 8) return null;
    const p = payload(best.id), out = [];
    if (!p || p.length < 96) return null;
    for (let i = 0; i < 8; i++) out.push([p.readFloatLE(i * 12), p.readFloatLE(i * 12 + 4), p.readFloatLE(i * 12 + 8)]);
    for (let i = 0; i < 8; i++) for (let j = 0; j < i; j++) if (Math.hypot(out[i][0] - out[j][0], out[i][1] - out[j][1], out[i][2] - out[j][2]) < 0.1) return null;
    return out;
}

/**
 * The body's vertex shader as a picture facing the camera. `box`: { x, y, z } the middle of the car in the model's
 * units (cm), w and h the picture's size there; `at`: marks().
 */
function billboard(vertex, box, at) {
    if (!/#version 300 es/.test(vertex) || !/\bu_MVPMatrix\b/.test(vertex) || !/\ba_Position\b/.test(vertex) || !/gl_Position/.test(vertex) || /\bpc_uv\b/.test(vertex)) throw new Error('the body shader is not the one known');
    const f = (v) => { const s = String(Math.round(v * 100) / 100); return s.indexOf('.') < 0 ? s + '.' : s; };
    const g = (v) => { const s = String(Math.round(v * 10000) / 10000); return s.indexOf('.') < 0 ? s + '.' : s; };
    const corner = [0, 1, 2, 3, 1, 0, 3, 2];                       // vertices 0..3 one rectangle, 4..7 the same one the other way round
    return atEnd(beforeMain(vertex, 'out mediump vec2 pc_uv;\n'), [
        '\tvec3 pc_m = vec3(' + f(box.x) + ', ' + f(box.y) + ', ' + f(box.z) + ');',
        '\tvec4 pc_c = u_MVPMatrix * vec4(pc_m, 1.);',
        '\tvec4 pc_x = u_MVPMatrix * vec4(pc_m + vec3(1., 0., 0.), 1.);',
        '\tvec4 pc_y = u_MVPMatrix * vec4(pc_m + vec3(0., 1., 0.), 1.);',
        '\tvec4 pc_z = u_MVPMatrix * vec4(pc_m + vec3(0., 0., 1.), 1.);',
        '\tvec2 pc_n = pc_c.xy / pc_c.w;',
        '\tvec2 pc_a = vec2(2.6667, 1.);',                         // the picture is 8 : 3: one unit across is fewer pixels than one up
        '\tfloat pc_s = max(max(length((pc_x.xy / pc_x.w - pc_n) * pc_a), length((pc_y.xy / pc_y.w - pc_n) * pc_a)), length((pc_z.xy / pc_z.w - pc_n) * pc_a));',
        '\tvec2 pc_h = vec2(' + f(box.w / 2) + ', ' + f(box.h / 2) + ') * pc_s / pc_a;',
        '\tint pc_i = -1;',
    ].concat(at.map((p, i) => '\tif (distance(a_Position, vec3(' + g(p[0]) + ', ' + g(p[1]) + ', ' + g(p[2]) + ')) < 0.03) pc_i = ' + corner[i] + ';'),
    /\bu_CameraWorldPosition\b/.test(vertex) ? ['\tif (u_CameraWorldPosition.z < 0.) pc_i = -1;'] : [], [   // the pass that draws the floor's reflection looks from below: no second picture
        '\tpc_uv = vec2((pc_i == 1 || pc_i == 2) ? 1. : 0., pc_i >= 2 ? 1. : 0.);',
        '\tgl_Position = pc_i < 0 ? vec4(2., 2., 2., 1.) : vec4(pc_n + (pc_uv - vec2(0.5)) * 2. * pc_h, clamp(pc_c.z / pc_c.w, -0.99, 0.99), 1.);',
        '',
    ]).join('\n'));
}

/** The names of the compiled shaders the head unit keeps for these effects (its cache: the id's bytes backwards, .bin). */
function cacheNames(effects) {
    return Object.keys(effects.byName).map((n) => Buffer.from(effects.byName[n].hash).reverse().toString('hex') + '.bin');
}

/** The body's fragment shader showing the photo packed in its texture. */
function photo(fragment) {
    if (!/#version 300 es/.test(fragment) || !/\bFragData\b/.test(fragment) || !/\bDiffuseTex\b/.test(fragment) || !/\bu_fadeToBlack\b/.test(fragment) || /\bpc_uv\b/.test(fragment)) throw new Error('the body shader is not the one known');
    const t = 0.5 / SIDE, n = (v) => v.toFixed(6);
    return atEnd(beforeMain(fragment, 'in mediump vec2 pc_uv;\n'), [
        '\tvec2 pc_q = clamp(pc_uv, 0., 1.);',
        '\tfloat pc_l = texture(DiffuseTex, vec2(mix(' + n(t) + ', ' + n(1 - t) + ', pc_q.x), mix(' + n(0.5 + t) + ', ' + n(1 - t) + ', pc_q.y))).r;',
        '\tvec2 pc_p = vec2(mix(' + n(t) + ', ' + n(0.5 - t) + ', pc_q.x), mix(' + n(t) + ', ' + n(0.25 - t) + ', pc_q.y));',
        '\tfloat pc_b = texture(DiffuseTex, pc_p).r - 0.5;',
        '\tfloat pc_r = texture(DiffuseTex, pc_p + vec2(0.5, 0.)).r - 0.5;',
        '\tif (texture(DiffuseTex, pc_p + vec2(0., 0.25)).r < 0.5) discard;',
        '\tvec3 pc_o = clamp(vec3(pc_l + 1.402 * pc_r, pc_l - 0.344136 * pc_b - 0.714136 * pc_r, pc_l + 1.772 * pc_b), 0., 1.);',
        '\tif (u_fadeToBlack < 2.) FragData[0] = vec4(pc_o, 1.);',                      // u_fadeToBlack is 0..1: always; what was computed above stays used
        '',
    ].join('\n'));
}

/**
 * The texture's pixels for a photo: `rgba` PW x PH, rows from the top. One byte a pixel, rows from the bottom up:
 * the upper half is the brightness; below it, at half size, blue difference | red difference, and above those the
 * transparency.
 */
function pack(rgba) {
    if (rgba.length !== PW * PH * 4) throw new Error('the photo is not ' + PW + ' x ' + PH);
    const out = Buffer.alloc(SIDE * SIDE), hw = PW / 2, hh = PH / 2;
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
        const i = (y * PW + x) * 4;
        out[(SIDE - 1 - y) * SIDE + x] = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
    }
    for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let k = 0; k < 4; k++) { const i = ((y * 2 + (k >> 1)) * PW + x * 2 + (k & 1)) * 4; r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; a += rgba[i + 3]; }
        r /= 4; g /= 4; b /= 4; a /= 4;
        const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
        out[(hh - 1 - y) * SIDE + x] = clamp(128 - 0.168736 * r - 0.331264 * g + 0.5 * b);
        out[(hh - 1 - y) * SIDE + hw + x] = clamp(128 + 0.5 * r - 0.418688 * g - 0.081312 * b);
        out[(PH - 1 - y) * SIDE + x] = clamp(a);
    }
    return out;
}

/** Whether these two resource files (Res objects) are a vehicle this can change; the photo's size if so. */
function check(effects, bitmaps) {
    if (!effects.has(BODY) || !bitmaps.has(TEXTURE)) return null;
    const t = bitmaps.texture(TEXTURE);
    if (t.w !== SIDE || t.h !== SIDE || t.mips !== 1 || bitmaps.byName[TEXTURE].dec !== SIDE * SIDE) return null;
    const s = effects.shaders(BODY);
    try { billboard(s.vertex, { x: 0, y: 0, z: 0, w: 1, h: 1 }, []); photo(s.fragment); } catch (e) { return null; }
    return { w: PW, h: PH };
}

/** The new effects.res: the car hidden, the body a picture. `box` and `at` as in billboard(). */
function patchEffects(effects, box, at) {
    const replace = {};
    Object.keys(effects.byName).forEach((name) => {
        if (KEEP.test(name)) return;
        const s = effects.shaders(name);
        if (name === BODY) replace[name] = effects.effectBlob(name, billboard(s.vertex, box, at), photo(s.fragment));
        else if (/gl_Position/.test(s.vertex)) replace[name] = effects.effectBlob(name, hide(s.vertex), s.fragment);
    });
    return effects.build(replace);
}

/** The new bitmaps.res: the body's texture carrying the photo (`rgba` PW x PH, rows from the top). */
function patchBitmaps(bitmaps, rgba) {
    const replace = {};
    replace[TEXTURE] = bitmaps.textureBlob(TEXTURE, pack(rgba));
    return bitmaps.build(replace);
}

module.exports = { BODY, TEXTURE, KEEP, PW, PH, SIDE, hide, marks, billboard, cacheNames, photo, pack, check, patchEffects, patchBitmaps };
