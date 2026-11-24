// SPDX-License-Identifier: GPL-3.0-or-later
#include "resample.h"

#include <cmath>
#include <cstdio>
#include <cstring>

namespace sidecam {

bool parse_crop(const std::string &text, ViewSpec *v)
{
    int x, y, w, h;
    char tail;
    if (std::sscanf(text.c_str(), "%d,%d,%d,%d%c", &x, &y, &w, &h, &tail) != 4)
        return false;
    if (x < 0 || y < 0 || w < 50 || h < 50 || x + w > 1000 || y + h > 1000)
        return false;
    v->x = x;
    v->y = y;
    v->w = w;
    v->h = h;
    return true;
}

void black_atlas(uint8_t *atlas, int w, int h)
{
    std::memset(atlas, 0, (size_t)w * h);
    std::memset(atlas + (size_t)w * h, 128, (size_t)w * (h / 2));
}

namespace {

/* Studio levels to full range, as the atlas shader expects. */
struct RangeTables {
    uint8_t y[256], c[256];
    RangeTables()
    {
        for (int i = 0; i < 256; i++) {
            int a = (int)std::lround((i - 16) * 255.0 / 219.0);
            int b = (int)std::lround((i - 128) * 255.0 / 224.0) + 128;
            y[i] = (uint8_t)(a < 0 ? 0 : a > 255 ? 255 : a);
            c[i] = (uint8_t)(b < 0 ? 0 : b > 255 ? 255 : b);
        }
    }
};
const RangeTables &range_tables()
{
    static const RangeTables t;
    return t;
}

inline int even_down(int v) { return v & ~1; }

}  // namespace

/* The taps of one plane: its source rect (px0, py0, psw, psh) onto a content
 * rect of dw x dh. */
void Resampler::plane_taps(std::vector<Tap> *taps, int px0, int py0, int psw, int psh, int dw, int dh) const
{
    taps->resize((size_t)dw * dh);
    const int rot = ((view_.rot % 360) + 360) % 360;
    for (int j = 0; j < dh; j++) {
        for (int i = 0; i < dw; i++) {
            double u = (i + 0.5) / dw, v = (j + 0.5) / dh;
            if (view_.flip)
                u = 1.0 - u;
            double su, sv;
            switch (rot) {
            case 90: su = v; sv = 1.0 - u; break;
            case 180: su = 1.0 - u; sv = 1.0 - v; break;
            case 270: su = 1.0 - v; sv = u; break;
            default: su = u; sv = v; break;
            }
            double x = px0 + su * psw - 0.5, y = py0 + sv * psh - 0.5;
            /* inside the rect, with a neighbour to the right and below */
            const double xmax = px0 + psw - 1, ymax = py0 + psh - 1;
            if (x < px0) x = px0;
            if (y < py0) y = py0;
            if (x > xmax) x = xmax;
            if (y > ymax) y = ymax;
            int xi = (int)x, yi = (int)y;
            int fx = (int)((x - xi) * 256.0), fy = (int)((y - yi) * 256.0);
            if (xi >= px0 + psw - 1) { xi = px0 + psw - 2; fx = 255; }
            if (yi >= py0 + psh - 1) { yi = py0 + psh - 2; fy = 255; }
            if (fx > 255) fx = 255;
            if (fy > 255) fy = 255;
            Tap &t = (*taps)[(size_t)j * dw + i];
            t.x = (uint16_t)xi;
            t.y = (uint16_t)yi;
            t.fx = (uint8_t)fx;
            t.fy = (uint8_t)fy;
        }
    }
}

/* The disc inscribed in a dw x dh rect: full inside, a soft edge one pixel wide, a rim rim_px wide
 * just inside the edge. */
void Resampler::disc(std::vector<uint8_t> *mask, std::vector<uint8_t> *rim, int dw, int dh, double rim_px) const
{
    mask->assign((size_t)dw * dh, 0);
    rim->assign((size_t)dw * dh, 0);
    const double cx = dw / 2.0, cy = dh / 2.0, r = (dw < dh ? dw : dh) / 2.0 - 1.0;
    for (int j = 0; j < dh; j++)
        for (int i = 0; i < dw; i++) {
            const double d = std::sqrt((i + 0.5 - cx) * (i + 0.5 - cx) + (j + 0.5 - cy) * (j + 0.5 - cy));
            double a = r - d + 0.5;                 /* 1 inside, 0 outside, a ramp across the edge */
            a = a < 0 ? 0 : a > 1 ? 1 : a;
            (*mask)[(size_t)j * dw + i] = (uint8_t)std::lround(a * 255);
            double k = d - (r - rim_px) + 0.5;      /* the rim: from r - rim_px outwards */
            k = k < 0 ? 0 : k > 1 ? 1 : k;
            (*rim)[(size_t)j * dw + i] = (uint8_t)std::lround(k * 255);
        }
}

bool Resampler::build(int src_w, int src_h, const ViewSpec &v, int out_w, int out_h)
{
    src_w_ = src_h_ = 0;   /* nothing matches until the tables are whole */
    if (src_w < 32 || src_h < 32 || src_w > 4096 || src_h > 4096 || (src_w & 1) || (src_h & 1))
        return false;
    if (out_w < 16 || out_h < 16 || out_w > 1920 || out_h > 720 || (out_w & 3) || (out_h & 1))
        return false;
    view_ = v;
    /* the part of the picture, on even luma samples, at least 16x16 */
    int sx = even_down((int)((int64_t)src_w * v.x / 1000));
    int sy = even_down((int)((int64_t)src_h * v.y / 1000));
    int sw = even_down((int)((int64_t)src_w * v.w / 1000));
    int sh = even_down((int)((int64_t)src_h * v.h / 1000));
    if (sx + sw > src_w) sw = even_down(src_w - sx);
    if (sy + sh > src_h) sh = even_down(src_h - sy);
    if (sw < 16 || sh < 16)
        return false;
    const int rot = ((v.rot % 360) + 360) % 360;
    if (rot != 0 && rot != 90 && rot != 180 && rot != 270)
        return false;
    if (v.sar < 25 || v.sar > 400)
        return false;
    /* its shape on the display: the samples sar % as wide as high, then the turn */
    const double shown_w = sw * (v.sar / 100.0);
    const double cw = (rot == 90 || rot == 270) ? (double)sh : shown_w, ch = (rot == 90 || rot == 270) ? shown_w : (double)sh;
    /* the largest picture of that shape in the output, on even samples */
    double scale = (double)out_w / cw;
    if ((double)out_h / ch < scale)
        scale = (double)out_h / ch;
    dw_ = even_down((int)std::lround(cw * scale));
    dh_ = even_down((int)std::lround(ch * scale));
    if (dw_ > out_w) dw_ = out_w;
    if (dh_ > out_h) dh_ = out_h;
    if (dw_ < 2 || dh_ < 2)
        return false;
    ox_ = even_down((out_w - dw_) / 2);
    oy_ = even_down((out_h - dh_) / 2);
    plane_taps(&y_taps_, sx, sy, sw, sh, dw_, dh_);
    plane_taps(&c_taps_, sx / 2, sy / 2, sw / 2, sh / 2, dw_ / 2, dh_ / 2);
    y_mask_.clear();
    c_mask_.clear();
    if (v.round) {
        const double rim = (dw_ < dh_ ? dw_ : dh_) / 96.0 + 1.0;    /* 4 px on a 288 disc, 6 on 480 */
        disc(&y_mask_, &y_rim_, dw_, dh_, rim);
        disc(&c_mask_, &c_rim_, dw_ / 2, dh_ / 2, rim / 2);
    }
    out_w_ = out_w;
    out_h_ = out_h;
    src_w_ = src_w;
    src_h_ = src_h;
    return true;
}

namespace {

inline uint8_t sample(const uint8_t *plane, int stride, unsigned x, unsigned y, unsigned fx, unsigned fy)
{
    const uint8_t *p = plane + (size_t)y * stride + x;
    const unsigned top = p[0] * (256 - fx) + p[1] * fx;
    const unsigned bot = p[stride] * (256 - fx) + p[stride + 1] * fx;
    return (uint8_t)((top * (256 - fy) + bot * fy + 32768) >> 16);
}

}  // namespace

void Resampler::run(const Planes &p, uint8_t *atlas) const
{
    if (!src_w_ || p.w != src_w_ || p.h != src_h_)
        return;
    const RangeTables &rt = range_tables();
    const bool stretch = !p.full_range;
    black_atlas(atlas, out_w_, out_h_);
    /* Y */
    {
        const Tap *t = y_taps_.data();
        for (int j = 0; j < dh_; j++) {
            uint8_t *o = atlas + (size_t)(oy_ + j) * out_w_ + ox_;
            for (int i = 0; i < dw_; i++, t++) {
                uint8_t v = sample(p.y, p.y_stride, t->x, t->y, t->fx, t->fy);
                if (stretch)
                    v = rt.y[v];
                if (!y_mask_.empty()) {
                    /* the rim (a light grey, dimmed at night) over the picture, then black outside the disc */
                    const size_t m = (size_t)j * dw_ + i;
                    const unsigned k = y_rim_[m], a = y_mask_[m];
                    const unsigned rl = view_.rim < 0 ? 0u : view_.rim > 255 ? 255u : (unsigned)view_.rim;
                    v = (uint8_t)(((v * (255 - k) + rl * k) / 255) * a / 255);
                }
                o[i] = v;
            }
        }
    }
    /* U on the left half, V on the right half, below Y */
    {
        const int cw = out_w_ / 2, cdw = dw_ / 2, cdh = dh_ / 2, cox = ox_ / 2, coy = oy_ / 2;
        uint8_t *base = atlas + (size_t)out_w_ * out_h_;
        const Tap *t = c_taps_.data();
        for (int j = 0; j < cdh; j++) {
            uint8_t *ou = base + (size_t)(coy + j) * out_w_ + cox;
            uint8_t *ov = ou + cw;
            for (int i = 0; i < cdw; i++, t++) {
                int a = sample(p.u, p.c_stride, t->x, t->y, t->fx, t->fy);
                int b = sample(p.v, p.c_stride, t->x, t->y, t->fx, t->fy);
                if (stretch) {
                    a = rt.c[a];
                    b = rt.c[b];
                }
                if (!c_mask_.empty()) {
                    /* no colour in the rim or outside the disc */
                    const size_t m = (size_t)j * cdw + i;
                    const int keep = (255 - c_rim_[m]) * c_mask_[m] / 255;
                    a = 128 + (a - 128) * keep / 255;
                    b = 128 + (b - 128) * keep / 255;
                }
                ou[i] = (uint8_t)a;
                ov[i] = (uint8_t)b;
            }
        }
    }
}

}  // namespace sidecam
