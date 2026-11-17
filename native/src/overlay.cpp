/* SPDX-License-Identifier: GPL-3.0-or-later */
#include "overlay.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

#include <algorithm>
#include <vector>

namespace sidecam {

namespace {

const double kPi = 3.14159265358979323846;
inline double rad(double d) { return d * kPi / 180.0; }

struct Color {
    uint8_t y, u, v;
};
/* BT.601 limited range, as the camera's pictures */
Color rgb(int r, int g, int b)
{
    Color c;
    c.y = (uint8_t)std::min(235.0, std::max(16.0, 16 + 0.257 * r + 0.504 * g + 0.098 * b));
    c.u = (uint8_t)std::min(240.0, std::max(16.0, 128 - 0.148 * r - 0.291 * g + 0.439 * b));
    c.v = (uint8_t)std::min(240.0, std::max(16.0, 128 + 0.439 * r - 0.368 * g - 0.071 * b));
    return c;
}

struct Surface {
    uint8_t *y, *uv;
    int w, h;
    int clip0 = 0, clip1 = 1 << 30;   /* columns drawn into (inclusive) */
};

/* One row of pixels x0..x1 (inclusive) blended with c at alpha a (0..256). */
void span(const Surface &s, int row, int x0, int x1, const Color &c, int a)
{
    if (row < 0 || row >= s.h || a <= 0)
        return;
    x0 = std::max(x0, std::max(0, s.clip0));
    x1 = std::min(x1, std::min(s.w - 1, s.clip1));
    if (x0 > x1)
        return;
    uint8_t *p = s.y + (size_t)row * s.w;
    for (int x = x0; x <= x1; x++)
        p[x] = (uint8_t)((p[x] * (256 - a) + c.y * a) >> 8);
    if (row & 1)
        return;
    uint8_t *q = s.uv + (size_t)(row / 2) * s.w;
    const int half = s.w / 2;
    for (int x = x0 / 2; x <= x1 / 2 && x < half; x++) {
        q[x] = (uint8_t)((q[x] * (256 - a) + c.u * a) >> 8);
        q[half + x] = (uint8_t)((q[half + x] * (256 - a) + c.v * a) >> 8);
    }
}

struct Pt {
    double x, y;
};

/* A filled triangle. */
void tri(const Surface &s, Pt a, Pt b, Pt c, const Color &col, int alpha)
{
    if (a.y > b.y) std::swap(a, b);
    if (b.y > c.y) std::swap(b, c);
    if (a.y > b.y) std::swap(a, b);
    const int y0 = std::max(0, (int)ceil(a.y)), y1 = std::min(s.h - 1, (int)floor(c.y));
    for (int y = y0; y <= y1; y++) {
        const double t = c.y > a.y ? (y - a.y) / (c.y - a.y) : 0;
        double xa = a.x + (c.x - a.x) * t, xb;
        if (y < b.y)
            xb = b.y > a.y ? a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y) : a.x;
        else
            xb = c.y > b.y ? b.x + (c.x - b.x) * (y - b.y) / (c.y - b.y) : b.x;
        if (xa > xb) std::swap(xa, xb);
        span(s, y, (int)ceil(xa), (int)floor(xb), col, alpha);
    }
}
void quad(const Surface &s, Pt a, Pt b, Pt c, Pt d, const Color &col, int alpha)
{
    tri(s, a, b, c, col, alpha);
    tri(s, a, c, d, col, alpha);
}
void rect(const Surface &s, int x, int y, int w, int h, const Color &col, int alpha)
{
    for (int r = y; r < y + h; r++)
        span(s, r, x, x + w - 1, col, alpha);
}
/* A line `width` pixels thick. */
void line(const Surface &s, Pt a, Pt b, double width, const Color &col, int alpha)
{
    const double dx = b.x - a.x, dy = b.y - a.y, len = sqrt(dx * dx + dy * dy);
    if (len < 0.5)
        return;
    const double nx = -dy / len * width / 2, ny = dx / len * width / 2;
    quad(s, {a.x + nx, a.y + ny}, {b.x + nx, b.y + ny}, {b.x - nx, b.y - ny}, {a.x - nx, a.y - ny}, col, alpha);
}

/* 5x7 letters for the card and the marks: the digits, a comma, "m" and "k" */
const char kGlyphs[] = "0123456789,mk";
const uint8_t kFont[][7] = {
    {0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E}, {0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E}, {0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F},
    {0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E}, {0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02}, {0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E},
    {0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E}, {0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08}, {0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E},
    {0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C}, {0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x08}, {0x00, 0x00, 0x1A, 0x15, 0x15, 0x15, 0x15},
    {0x10, 0x10, 0x12, 0x14, 0x18, 0x14, 0x12},
};
int text_width(const char *t, int k) { return (int)strlen(t) * 6 * k - k; }
void text(const Surface &s, int x, int y, const char *t, int k, const Color &col, int alpha)
{
    for (; *t; t++, x += 6 * k) {
        const char *g = strchr(kGlyphs, *t);
        if (!g || !*t)
            continue;
        const uint8_t *rows = kFont[g - kGlyphs];
        for (int r = 0; r < 7; r++)
            for (int c = 0; c < 5; c++)
                if (rows[r] & (0x10 >> c))
                    rect(s, x + c * k, y + r * k, k, k, col, alpha);
    }
}

/* ---------------- the road ---------------- */

struct Road {
    const Calib &c;
    int w, h;
    bool at(double x, double up, double z, Pt *p) const
    {
        double px, py;
        if (!project(c, w, h, x, up, z, &px, &py))
            return false;
        p->x = px;
        p->y = py;
        return true;
    }
};

/* A flat four-cornered piece of road. */
void ground_quad(const Surface &s, const Road &r, const double xs[4], const double zs[4], const Color &col, int alpha)
{
    Pt p[4];
    for (int i = 0; i < 4; i++)
        if (!r.at(xs[i], 0, zs[i], &p[i]))
            return;
    quad(s, p[0], p[1], p[2], p[3], col, alpha);
}

void draw_marks(const Surface &s, const Road &r)
{
    const Color yellow = rgb(255, 214, 0), white = rgb(255, 255, 255);
    const double half = 1.5;
    /* the lane's edges and the car's middle, in short pieces so a curved picture bends them */
    for (int side = -1; side <= 1; side++) {
        Pt prev;
        bool have = false;
        for (double z = 2.0; z <= 30.01; z += 1.0) {
            Pt p;
            const bool ok = r.at(side * half, 0, z, &p);
            if (ok && have)
                line(s, prev, p, side ? 3 : 1.5, side ? yellow : white, side ? 220 : 150);
            prev = p;
            have = ok;
        }
    }
    static const int kAt[] = {5, 10, 20};
    for (int i = 0; i < 3; i++) {
        Pt prev;
        bool have = false;
        for (double x = -half; x <= half + 0.01; x += 0.25) {
            Pt p;
            const bool ok = r.at(x, 0, kAt[i], &p);
            if (ok && have)
                line(s, prev, p, 3, yellow, 230);
            prev = p;
            have = ok;
        }
        Pt p;
        if (r.at(half + 0.25, 0, kAt[i], &p)) {
            char t[8];
            snprintf(t, sizeof t, "%dm", kAt[i]);
            text(s, (int)p.x + 4, (int)p.y - 7, t, 2, yellow, 256);
        }
    }
}

/* The way ahead: straight on for `straight` m, then an arc of `radius` m through `angle`
 * degrees (negative: to the left), then straight on. at(d): the point d m along it and the
 * way it heads there. */
struct Path {
    double straight, radius, angle;
    void at(double d, double *x, double *z, double *hx, double *hz) const
    {
        const double a = rad(fabs(angle)), sgn = angle < 0 ? -1 : 1;
        const double arc = radius * a;
        if (d <= straight || a < 1e-3) {
            *x = 0, *z = d, *hx = 0, *hz = 1;
            return;
        }
        const double on = std::min(d - straight, arc), th = on / radius;
        double cx = radius * (1 - cos(th)), cz = straight + radius * sin(th);
        double dx = sin(th), dz = cos(th);
        if (d - straight > arc) {
            cx += dx * (d - straight - arc);
            cz += dz * (d - straight - arc);
        }
        *x = sgn * cx, *z = cz, *hx = sgn * dx, *hz = dz;
    }
};

void draw_route(const Surface &s, const Road &r, const Overlay &o, int64_t t_ms)
{
    const Color blue = o.white ? rgb(245, 245, 245) : rgb(40, 150, 255), light = rgb(190, 225, 255);
    const bool turn = o.kind != kStraight && o.kind != kDestination && fabs(o.angle) >= 10;
    /* how far ahead the turn is drawn: an unknown or far distance shows the lane only */
    const double far = 70;
    const double to_turn = o.meters < 0 ? 1e9 : o.meters;
    Path path;
    path.radius = 7;
    path.angle = turn ? std::max(-150.0, std::min(150.0, o.angle)) : 0;
    path.straight = std::max(0.0, to_turn - path.radius);
    const double arc = path.radius * rad(fabs(path.angle));
    const double end = turn && to_turn < far ? path.straight + arc + 9 : std::min(far, to_turn);
    /* chevrons every 3 m, moving ahead at 6 m/s */
    const double gap = 3.0, phase = fmod((double)(t_ms % 100000) / 1000.0 * 6.0, gap);
    for (double d = 2.0 + phase; d < end; d += gap) {
        double x, z, hx, hz;
        path.at(d, &x, &z, &hx, &hz);
        if (z < 1.5)
            continue;
        /* a chevron: two bars from the wings back to a tip ahead */
        const double wing = 1.3, len = 1.6, thick = 0.9;
        const double nx = hz, nz = -hx;   /* to the right of the heading */
        const double tipx = x + hx * len, tipz = z + hz * len;
        const int alpha = (int)((o.white ? 170 : 230) * std::max(0.25, std::min(1.0, 1.15 - d / (end + 6))));
        for (int side = -1; side <= 1; side += 2) {
            const double xs[4] = {x + nx * wing * side, tipx, tipx - hx * thick, x + nx * wing * side - hx * thick};
            const double zs[4] = {z + nz * wing * side, tipz, tipz - hz * thick, z + nz * wing * side - hz * thick};
            ground_quad(s, r, xs, zs, blue, alpha);
        }
    }
    /* at the turn: a row of large arrows standing over the road, pointing into the new road, lit one after
     * another. Far away they would be a few pixels high, so they are made larger until they take up about a
     * fifth of the picture's height (at most five times their real size). */
    if (turn && to_turn < far) {
        double x, z, hx, hz;
        path.at(path.straight + arc + 1.5, &x, &z, &hx, &hz);
        double grow = 1;
        Pt a, b;
        if (r.at(x, 0.7, z, &a) && r.at(x, 3.1, z, &b)) {
            const double px = fabs(a.y - b.y);
            if (px > 0.5)
                grow = std::max(1.0, std::min(5.0, s.h * 0.2 / px));
        }
        const int count = 4, beat = (int)((t_ms / 180) % (count + 2));
        const Color &dim = o.white ? rgb(200, 200, 200) : blue, &lit = o.white ? rgb(255, 255, 255) : light;
        for (int i = count - 1; i >= 0; i--) {
            const double step = 2.6 * grow, len = 2.2 * grow, neck = 0.9 * grow;
            const double ax = x + hx * i * step, az = z + hz * i * step;
            const double lo = 0.7, mid = 0.7 + 1.2 * grow, hi = 0.7 + 2.4 * grow, shaft = 0.45 * grow;
            Pt back_lo, back_hi, neck_lo, neck_hi, tip, fin_lo, fin_hi;
            if (!r.at(ax, mid - shaft, az, &back_lo) || !r.at(ax, mid + shaft, az, &back_hi) ||
                !r.at(ax + hx * neck, mid - shaft, az + hz * neck, &neck_lo) || !r.at(ax + hx * neck, mid + shaft, az + hz * neck, &neck_hi) ||
                !r.at(ax + hx * len, mid, az + hz * len, &tip) || !r.at(ax + hx * neck, lo, az + hz * neck, &fin_lo) ||
                !r.at(ax + hx * neck, hi, az + hz * neck, &fin_hi))
                continue;
            const bool on = i == beat || i + 1 == beat;
            quad(s, back_lo, back_hi, neck_hi, neck_lo, on ? lit : dim, on ? 250 : 170);
            tri(s, fin_lo, fin_hi, tip, on ? lit : dim, on ? 250 : 170);
        }
    }
}

/* The turn as BMW's own Augmented View marks it: a band of white chevrons on black, flat on the picture,
 * at the place of the turn and pointing into it; small while the turn is far, larger as it comes near, the
 * chevrons running along the band. */
void draw_band(const Surface &s0, const Road &r, const Overlay &o, int64_t t_ms)
{
    if (o.kind == kStraight || o.kind == kDestination || fabs(o.angle) < 10 || o.meters < 0 || o.meters > 90)
        return;
    const int dir = o.angle < 0 ? -1 : 1;
    Pt p;
    if (!r.at(0, 1.0, std::max(6.0, o.meters), &p))
        p = {s0.w / 2.0, s0.h * 0.45};
    const double bh = s0.h * std::max(0.085, std::min(0.2, 0.215 - 0.0018 * o.meters));
    const int n = 4;
    const double cw = bh * 0.72, len = n * cw + bh * 0.3;
    /* the band starts a little before the turn's place and runs into the turn; kept inside the picture */
    double x0 = p.x - len / 2 - dir * len * 0.15, y0 = p.y - bh / 2;
    x0 = std::max(s0.w * 0.03, std::min(s0.w * 0.97 - len, x0));
    y0 = std::max(s0.h * 0.12, std::min(s0.h * 0.8 - bh, y0));
    const Color black = rgb(10, 10, 10), white = rgb(255, 255, 255);
    rect(s0, (int)x0, (int)y0, (int)len, (int)bh, black, 256);
    Surface s = s0;
    s.clip0 = (int)x0;
    s.clip1 = (int)(x0 + len) - 1;
    const double phase = fmod((double)(t_ms % 100000) / 1000.0 * 1.6, 1.0) * cw;   /* 1.6 chevrons a second */
    const double thick = cw * 0.56, ym = y0 + bh / 2, in = bh * 0.1;
    for (int i = -1; i <= n; i++) {
        /* the chevron's back edge at xb, its point bh/2 further along the way it points */
        const double xb = dir > 0 ? x0 + i * cw + phase : x0 + len - i * cw - phase;
        const double a = xb, b = xb + dir * thick, tip = dir * (bh / 2 - in);
        quad(s, {a, y0 + in}, {b, y0 + in}, {b + tip, ym}, {a + tip, ym}, white, 256);
        quad(s, {a, y0 + bh - in}, {b, y0 + bh - in}, {b + tip, ym}, {a + tip, ym}, white, 256);
    }
}

/* The picture's left and right edges fade to black, as the camera does between the cluster's dials. */
void draw_fade(const Surface &s)
{
    const int band = s.w * 14 / 100;
    const Color black = rgb(0, 0, 0);
    for (int x = 0; x < band; x += 2) {
        const int a = 235 * (band - x) / band;
        for (int row = 0; row < s.h; row++) {
            span(s, row, x, x + 1, black, a);
            span(s, row, s.w - 2 - x, s.w - 1 - x, black, a);
        }
    }
}

/* The card: the turn's arrow and the distance. */
void draw_card(const Surface &s, const Overlay &o)
{
    const int k = s.w >= 480 ? 3 : 2;
    char dist[16] = "";
    if (o.meters >= 0) {
        if (o.meters >= 1000)
            snprintf(dist, sizeof dist, "%d,%dkm", (int)(o.meters / 1000), (int)(fmod(o.meters, 1000) / 100));
        else
            snprintf(dist, sizeof dist, "%dm", o.meters >= 100 ? (int)(o.meters / 50 + 0.5) * 50 : (int)(o.meters / 10 + 0.5) * 10);
    }
    const int icon = 14 * k, pad = 4 * k;
    const int cw = pad + icon + (dist[0] ? pad + text_width(dist, k) : 0) + pad, ch = icon + 2 * pad;
    /* at the top: in the middle (BMW's style), else in the left corner */
    const int x0 = o.style == 0 ? (s.w - cw) / 2 : 3 * k, y0 = 3 * k;
    rect(s, x0, y0, cw, ch, rgb(8, 12, 20), 190);
    if (o.style != 0)
        rect(s, x0, y0 + ch - k, cw, k, o.white ? rgb(255, 255, 255) : rgb(40, 150, 255), 256);
    const Color white = rgb(255, 255, 255);
    /* the arrow: a shaft up from the bottom, then a head turned by the turn's angle */
    const double cx = x0 + pad + icon / 2.0, cy = y0 + pad + icon / 2.0, u = icon / 14.0;
    if (o.kind == kDestination) {
        /* a flag */
        rect(s, (int)(cx - 4 * u), (int)(cy - 6 * u), (int)(1.6 * u + 1), (int)(12 * u), white, 256);
        tri(s, {cx - 2.4 * u, cy - 6 * u}, {cx + 5 * u, cy - 3 * u}, {cx - 2.4 * u, cy}, white, 256);
    } else {
        const double a = rad(o.kind == kStraight ? 0 : std::max(-150.0, std::min(150.0, o.angle)));
        const double dx = sin(a), dy = -cos(a);                   /* the head's way */
        const double jx = cx - dx * 1.5 * u, jy = cy + 1.5 * u;   /* where the shaft bends */
        line(s, {jx, cy + 6 * u}, {jx, jy - 0.8 * u}, 2.4 * u, white, 256);
        const double ex = jx + dx * 5.5 * u, ey = jy + dy * 5.5 * u;
        line(s, {jx, jy}, {ex, ey}, 2.4 * u, white, 256);
        const double px = -dy, py = dx;
        tri(s, {ex + dx * 3.2 * u, ey + dy * 3.2 * u}, {ex + px * 3 * u, ey + py * 3 * u}, {ex - px * 3 * u, ey - py * 3 * u}, white, 256);
        if (o.kind == kRoundabout) {
            /* a ring at the bend */
            for (int i = 0; i < 12; i++) {
                const double a0 = rad(i * 30.0), a1 = rad(i * 30.0 + 30.0), rr = 2.6 * u;
                line(s, {jx + cos(a0) * rr, jy + sin(a0) * rr}, {jx + cos(a1) * rr, jy + sin(a1) * rr}, 1.2 * u, white, 256);
            }
        }
    }
    if (dist[0])
        text(s, x0 + pad + icon + pad, y0 + (ch - 7 * k) / 2, dist, k, white, 256);
}

}  // namespace

bool project(const Calib &c, int w, int h, double x, double up, double z, double *px, double *py)
{
    /* into the camera's axes: right, down, ahead */
    double X = x - c.shift, Y = c.height - up, Z = z;
    const double yw = rad(c.yaw), cy = cos(yw), sy = sin(yw);
    double X1 = X * cy - Z * sy, Z1 = X * sy + Z * cy;
    const double p = rad(c.pitch), cp = cos(p), sp = sin(p);
    const double Y2 = Y * cp - Z1 * sp, Z2 = Y * sp + Z1 * cp;
    if (Z2 < 0.05)
        return false;
    const double k = std::max(0.0, std::min(1.0, c.curve / 100.0));
    const double r = sqrt(X1 * X1 + Y2 * Y2), th = atan2(r, Z2);
    if (th > rad(88))
        return false;
    const double half = rad(std::max(30.0, std::min(200.0, c.fov)) / 2);
    const double tan_half = half < rad(85) ? tan(half) : tan(rad(85));
    const double f = (w / 2.0) / ((1 - k) * tan_half + k * half);
    const double rho = f * ((1 - k) * tan(th) + k * th);
    const double ux = r > 1e-9 ? X1 / r : 0, uy = r > 1e-9 ? Y2 / r : 0;
    *px = w / 2.0 + ux * rho;
    *py = h / 2.0 + uy * rho;
    return *px > -2.0 * w && *px < 3.0 * w && *py > -2.0 * h && *py < 3.0 * h;
}

void draw_overlay(uint8_t *atlas, int w, int h, const Overlay &o, int64_t t_ms)
{
    if (w < 64 || h < 64 || (o.mode == kArOff && !o.fade))
        return;
    Surface s;
    s.y = atlas;
    s.uv = atlas + (size_t)w * h;
    s.w = w;
    s.h = h;
    Road r = {o.calib, w, h};
    if (o.fade)
        draw_fade(s);
    if (o.mode == kArOff)
        return;
    if (o.mode == kArMarks) {
        draw_marks(s, r);
        return;
    }
    if (o.style == 0)
        draw_band(s, r, o, t_ms);
    else
        draw_route(s, r, o, t_ms);
    if (o.card)
        draw_card(s, o);
}

}  // namespace sidecam
