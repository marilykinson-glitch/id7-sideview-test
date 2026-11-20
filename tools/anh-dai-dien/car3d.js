'use strict';
/**
 * car3d.js - the head unit's 3D vehicle (widgetasset/vehicles/<model>/vehicle: meshes, textures, effects) made to
 * show a photo instead of the model. The model is drawn by shaders that are plain text in effects.res:
 *
 *   every material of the car        its vertex shader ends by putting the vertex outside the picture: nothing drawn
 *   the ground under the car         (M_CAR_MGRO_GROUND, a flat mesh with the shadow texture TEX_MGRO_GROUND)
 *                                    becomes a picture that stands where the car is and always faces the camera,
 *                                    as large as the car at whatever distance the camera is; its texture is the photo
 *
 * The compositing quads (M_CAR_Quad_*) and the safe-area effect are left as they are. The shaders are changed by
 * adding lines at the end of main(), so that every uniform and attribute the effect declares is still used.
 * Node 8: no dependencies.
 */
const GROUND = 'M_CAR_MGRO_GROUND', TEXTURE = 'TEX_MGRO_GROUND_bitmap';
const KEEP = /Quad|SAFEAREA/;

/** The text with `lines` put before the closing brace of its last function (main). */
function atEnd(src, lines) {
    const at = src.lastIndexOf('}');
    if (at < 0) throw new Error('no closing brace');
    return src.slice(0, at) + lines + src.slice(at);
}

const hide = (vertex) => atEnd(vertex, '\tgl_Position = vec4(2., 2., 2., 1.);\n');

/**
 * The ground's vertex shader as a picture facing the camera. The mesh's texture coordinates run 0..1 over it, so
 * a corner is known from them alone. `box`: { x, y, z } the middle of the car in the model's units (cm), w and h
 * the picture's size there.
 */
function billboard(vertex, box) {
    if (!/\bu_MVPMatrix\b/.test(vertex) || !/\ba_TextureCoordinate\b/.test(vertex) || !/\buv\b/.test(vertex) || !/gl_Position/.test(vertex)) throw new Error('the ground shader is not the one known');
    const f = (v) => { const s = String(Math.round(v * 100) / 100); return s.indexOf('.') < 0 ? s + '.' : s; };
    return atEnd(vertex, [
        '\tvec3 pc_m = vec3(' + f(box.x) + ', ' + f(box.y) + ', ' + f(box.z) + ');',
        '\tvec4 pc_c = u_MVPMatrix * vec4(pc_m, 1.);',
        '\tvec4 pc_x = u_MVPMatrix * vec4(pc_m + vec3(1., 0., 0.), 1.);',
        '\tvec4 pc_y = u_MVPMatrix * vec4(pc_m + vec3(0., 1., 0.), 1.);',
        '\tvec4 pc_z = u_MVPMatrix * vec4(pc_m + vec3(0., 0., 1.), 1.);',
        '\tvec2 pc_n = pc_c.xy / pc_c.w;',
        '\tvec2 pc_a = vec2(2.6667, 1.);',                         // the picture is 8 : 3: one unit across is fewer pixels than one up
        '\tfloat pc_s = max(max(length((pc_x.xy / pc_x.w - pc_n) * pc_a), length((pc_y.xy / pc_y.w - pc_n) * pc_a)), length((pc_z.xy / pc_z.w - pc_n) * pc_a));',
        '\tvec2 pc_h = vec2(' + f(box.w / 2) + ', ' + f(box.h / 2) + ') * pc_s / pc_a;',
        '\tuv = a_TextureCoordinate;',
        '\tgl_Position = vec4(pc_n + (a_TextureCoordinate - vec2(0.5)) * 2. * pc_h, clamp(pc_c.z / pc_c.w, -0.99, 0.99), 1.);',
        '',
    ].join('\n'));
}

/** The ground's fragment shader showing its texture as it is (colours already multiplied by transparency). */
function photo(fragment) {
    const out = /\bFragData\b/.test(fragment) ? 'FragData[0]' : /\bgl_FragColor\b/.test(fragment) ? 'gl_FragColor' : '';
    const tex = /#version 300/.test(fragment) ? 'texture' : 'texture2D';
    if (!out || !/\btex0\b/.test(fragment) || !/\buv\b/.test(fragment) || !/\bu_Opacity\b/.test(fragment)) throw new Error('the ground shader is not the one known');
    return atEnd(fragment, '\t' + out + ' = ' + tex + '(tex0, uv) * max(u_Opacity, 1.);\n' + (out === 'FragData[0]' ? '\tFragData[1] = vec4(0.);\n' : ''));
}

/** Whether these two resource files (Res objects) are a vehicle this can change; the texture's size if so. */
function check(effects, bitmaps) {
    if (!effects.has(GROUND) || !bitmaps.has(TEXTURE)) return null;
    const t = bitmaps.texture(TEXTURE);
    if (!t.rgba || t.mips !== 1) return null;
    const s = effects.shaders(GROUND);
    billboard(s.vertex, { x: 0, y: 0, z: 0, w: 1, h: 1 }); photo(s.fragment);           // throws if not the shader known
    return { w: t.w, h: t.h };
}

/** The new effects.res: the car hidden, the ground a picture. `box` as in billboard(). */
function patchEffects(effects, box) {
    const replace = {};
    Object.keys(effects.byName).forEach((name) => {
        if (KEEP.test(name)) return;
        const s = effects.shaders(name);
        if (name === GROUND) replace[name] = effects.effectBlob(name, billboard(s.vertex, box), photo(s.fragment));
        else if (/gl_Position/.test(s.vertex)) replace[name] = effects.effectBlob(name, hide(s.vertex), s.fragment);
    });
    return effects.build(replace);
}

module.exports = { GROUND, TEXTURE, KEEP, hide, billboard, photo, check, patchEffects };
