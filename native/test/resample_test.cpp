// SPDX-License-Identifier: GPL-3.0-or-later
/* The cut, turn, mirror and scale of resample.cpp against pictures whose
 * right answer is known. */
#include <cstdio>
#include <cstdlib>
#include <vector>

#include "pair_tag.h"
#include "resample.h"

using namespace sidecam;

static int fails = 0;
#define CHECK(c) do { if (!(c)) { std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #c); fails++; } } while (0)

struct Pic {
    int w, h;
    std::vector<uint8_t> y, u, v;
    Pic(int w_, int h_) : w(w_), h(h_), y((size_t)w_ * h_), u((size_t)w_ * h_ / 4), v((size_t)w_ * h_ / 4) {}
    Planes planes(bool full) const
    {
        Planes p;
        p.y = y.data(); p.u = u.data(); p.v = v.data();
        p.y_stride = w; p.c_stride = w / 2; p.w = w; p.h = h; p.full_range = full;
        return p;
    }
};

/* Y of the output pixel (x, y) of an atlas ow wide */
static int Y(const std::vector<uint8_t> &a, int ow, int x, int y) { return a[(size_t)y * ow + x]; }
static int U(const std::vector<uint8_t> &a, int ow, int oh, int x, int y) { return a[(size_t)ow * oh + (size_t)(y / 2) * ow + x / 2]; }
static int V(const std::vector<uint8_t> &a, int ow, int oh, int x, int y) { return a[(size_t)ow * oh + (size_t)(y / 2) * ow + ow / 2 + x / 2]; }

int main()
{
    /* a 2x2 mosaic: quadrant q has Y 40+50q, U 60+20q, V 200-30q */
    Pic m(1280, 960);
    for (int y = 0; y < 960; y++)
        for (int x = 0; x < 1280; x++)
            m.y[(size_t)y * 1280 + x] = (uint8_t)(40 + 50 * ((y >= 480) * 2 + (x >= 640)));
    for (int y = 0; y < 480; y++)
        for (int x = 0; x < 640; x++) {
            const int q = (y >= 240) * 2 + (x >= 320);
            m.u[(size_t)y * 640 + x] = (uint8_t)(60 + 20 * q);
            m.v[(size_t)y * 640 + x] = (uint8_t)(200 - 30 * q);
        }
    ViewSpec crop;
    CHECK(parse_crop("0,500,500,500", &crop));
    CHECK(crop.x == 0 && crop.y == 500 && crop.w == 500 && crop.h == 500);
    ViewSpec bad;
    CHECK(!parse_crop("600,0,500,500", &bad));
    CHECK(!parse_crop("0,0,10,500", &bad));
    CHECK(!parse_crop("a,b", &bad));
    CHECK(!parse_crop("0,0,500,500,1", &bad));

    /* each quadrant, same shape as the output: the whole output is that quadrant, full range kept as it is */
    const char *crops[4] = {"0,0,500,500", "500,0,500,500", "0,500,500,500", "500,500,500,500"};
    for (int q = 0; q < 4; q++) {
        ViewSpec v;
        CHECK(parse_crop(crops[q], &v));
        Resampler r;
        CHECK(r.build(1280, 960, v, 512, 384));
        CHECK(r.matches(1280, 960, v, 512, 384));
        CHECK(!r.matches(1280, 720, v, 512, 384));
        CHECK(r.content_w() == 512 && r.content_h() == 384 && r.content_x() == 0 && r.content_y() == 0);
        std::vector<uint8_t> a(atlas_bytes(512, 384));
        r.run(m.planes(true), a.data());
        for (int y = 0; y < 384; y += 7)
            for (int x = 0; x < 512; x += 5) {
                CHECK(Y(a, 512, x, y) == 40 + 50 * q);
                CHECK(U(a, 512, 384, x, y) == 60 + 20 * q);
                CHECK(V(a, 512, 384, x, y) == 200 - 30 * q);
            }
    }
    /* studio levels are stretched: 16 -> 0, 235 -> 255, chroma 128 stays */
    {
        Pic p(64, 64);
        for (auto &b : p.y) b = 16;
        for (auto &b : p.u) b = 128;
        for (auto &b : p.v) b = 240;
        Resampler r;
        CHECK(r.build(64, 64, ViewSpec(), 64, 64));
        std::vector<uint8_t> a(atlas_bytes(64, 64));
        r.run(p.planes(false), a.data());
        CHECK(Y(a, 64, 10, 10) == 0 && U(a, 64, 64, 10, 10) == 128 && V(a, 64, 64, 10, 10) == 255);
        for (auto &b : p.y) b = 235;
        r.run(p.planes(false), a.data());
        CHECK(Y(a, 64, 10, 10) == 255);
    }
    /* turns and the mirror: a picture whose left half is dark and top half has low U
     * (Y: 50 left, 200 right; U: 60 top, 180 bottom) */
    {
        Pic p(640, 480);
        for (int y = 0; y < 480; y++)
            for (int x = 0; x < 640; x++)
                p.y[(size_t)y * 640 + x] = x < 320 ? 50 : 200;
        for (int y = 0; y < 240; y++)
            for (int x = 0; x < 320; x++) {
                p.u[(size_t)y * 320 + x] = y < 120 ? 60 : 180;
                p.v[(size_t)y * 320 + x] = 128;
            }
        std::vector<uint8_t> a(atlas_bytes(640, 480));
        ViewSpec v;
        Resampler r;
        /* 0: as it is */
        CHECK(r.build(640, 480, v, 640, 480));
        r.run(p.planes(true), a.data());
        CHECK(Y(a, 640, 100, 240) == 50 && Y(a, 640, 500, 240) == 200);
        CHECK(U(a, 640, 480, 320, 60) == 60 && U(a, 640, 480, 320, 400) == 180);
        /* mirrored: dark on the right */
        v.flip = true;
        CHECK(r.build(640, 480, v, 640, 480));
        r.run(p.planes(true), a.data());
        CHECK(Y(a, 640, 100, 240) == 200 && Y(a, 640, 500, 240) == 50);
        CHECK(U(a, 640, 480, 320, 60) == 60);
        /* 180: dark on the right, low U at the bottom */
        v.flip = false;
        v.rot = 180;
        CHECK(r.build(640, 480, v, 640, 480));
        r.run(p.planes(true), a.data());
        CHECK(Y(a, 640, 100, 240) == 200 && Y(a, 640, 500, 240) == 50);
        CHECK(U(a, 640, 480, 320, 60) == 180 && U(a, 640, 480, 320, 400) == 60);
        /* 90 clockwise: the picture's left edge is on top; a 3:4 picture in a 640x480 output is 360x480, centred */
        v.rot = 90;
        CHECK(r.build(640, 480, v, 640, 480));
        CHECK(r.content_w() == 360 && r.content_h() == 480 && r.content_x() == 140 && r.content_y() == 0);
        r.run(p.planes(true), a.data());
        CHECK(Y(a, 640, 320, 100) == 50 && Y(a, 640, 320, 400) == 200);     /* dark (left) on top */
        CHECK(U(a, 640, 480, 460, 240) == 60 && U(a, 640, 480, 180, 240) == 180);   /* the top went to the right */
        CHECK(Y(a, 640, 20, 240) == 0 && U(a, 640, 480, 20, 240) == 128);  /* the bars are black */
        CHECK(Y(a, 640, 620, 240) == 0);
        /* 270: the left edge at the bottom, the top on the left */
        v.rot = 270;
        CHECK(r.build(640, 480, v, 640, 480));
        r.run(p.planes(true), a.data());
        CHECK(Y(a, 640, 320, 100) == 200 && Y(a, 640, 320, 400) == 50);
        CHECK(U(a, 640, 480, 180, 240) == 60 && U(a, 640, 480, 460, 240) == 180);
    }
    /* a wide part in a 4:3 output: bars above and below */
    {
        Pic p(1280, 960);
        for (auto &b : p.y) b = 100;
        for (auto &b : p.u) b = 128;
        for (auto &b : p.v) b = 128;
        ViewSpec v;
        CHECK(parse_crop("0,500,1000,500", &v));   /* 1280x480 */
        Resampler r;
        CHECK(r.build(1280, 960, v, 512, 384));
        CHECK(r.content_w() == 512 && r.content_h() == 192 && r.content_y() == 96);
        std::vector<uint8_t> a(atlas_bytes(512, 384));
        r.run(p.planes(true), a.data());
        CHECK(Y(a, 512, 256, 10) == 0 && Y(a, 512, 256, 190) == 100 && Y(a, 512, 256, 380) == 0);
    }
    /* a picture squeezed to half its width: sar 200 shows a 640x480 part as 8:3 */
    {
        Pic p(1280, 960);
        for (auto &b : p.y) b = 90;
        for (auto &b : p.u) b = 128;
        for (auto &b : p.v) b = 128;
        ViewSpec v;
        CHECK(parse_crop("0,500,500,500", &v));
        v.sar = 200;
        Resampler r;
        CHECK(r.build(1280, 960, v, 1024, 384));
        CHECK(r.content_w() == 1024 && r.content_h() == 384);
        CHECK(r.build(1280, 960, v, 512, 384));
        CHECK(r.content_w() == 512 && r.content_h() == 192 && r.content_y() == 96);
        v.rot = 90;
        CHECK(r.build(1280, 960, v, 512, 384));     /* 3:8 turned: 144x384 */
        CHECK(r.content_w() == 144 && r.content_h() == 384);
        v.sar = 1000;
        CHECK(!r.build(1280, 960, v, 512, 384));
    }
    /* round: a disc with a light rim, black and colourless around it */
    {
        Pic p(480, 480);
        for (auto &b : p.y) b = 90;
        for (auto &b : p.u) b = 60;
        for (auto &b : p.v) b = 200;
        ViewSpec v;
        v.round = true;
        Resampler r;
        CHECK(r.build(480, 480, v, 384, 384));
        std::vector<uint8_t> a(atlas_bytes(384, 384));
        r.run(p.planes(true), a.data());
        CHECK(Y(a, 384, 192, 192) == 90 && U(a, 384, 384, 192, 192) == 60 && V(a, 384, 384, 192, 192) == 200);   /* the middle */
        CHECK(Y(a, 384, 192, 60) == 90 && Y(a, 384, 60, 192) == 90);                                              /* well inside */
        CHECK(Y(a, 384, 2, 2) == 0 && U(a, 384, 384, 2, 2) == 128 && V(a, 384, 384, 2, 2) == 128);              /* a corner */
        CHECK(Y(a, 384, 381, 381) == 0 && Y(a, 384, 30, 30) == 0);
        CHECK(Y(a, 384, 192, 3) == 200 && U(a, 384, 384, 192, 3) == 128);                                        /* the rim, top */
        CHECK(Y(a, 384, 380, 192) == 200 && Y(a, 384, 3, 192) == 200 && Y(a, 384, 192, 380) == 200);
        CHECK(Y(a, 384, 192, 12) == 90);                                                                         /* past the rim */
        /* dimmed night rim: rim = 95 changes the rebuild signature and dims the ring to Y = 95 */
        ViewSpec night = v;
        night.rim = 95;
        CHECK(!r.matches(480, 480, night, 384, 384));
        CHECK(r.build(480, 480, night, 384, 384));
        r.run(p.planes(true), a.data());
        CHECK(Y(a, 384, 192, 3) == 95 && Y(a, 384, 380, 192) == 95 && U(a, 384, 384, 192, 3) == 128);
        ViewSpec sq;
        CHECK(!r.matches(480, 480, sq, 384, 384));                                                               /* round is part of the view */
        CHECK(r.build(480, 480, sq, 384, 384));
        r.run(p.planes(true), a.data());
        CHECK(Y(a, 384, 2, 2) == 90);
    }
    /* sizes it refuses */
    {
        Resampler r;
        CHECK(!r.build(1280, 960, ViewSpec(), 510, 384));   /* width not a multiple of 4 */
        CHECK(!r.build(1280, 960, ViewSpec(), 512, 383));
        CHECK(!r.build(16, 16, ViewSpec(), 512, 384));
        CHECK(!r.build(1280, 960, ViewSpec(), 2048, 384));
        ViewSpec v;
        v.rot = 45;
        CHECK(!r.build(1280, 960, v, 512, 384));
        CHECK(!r.matches(1280, 960, v, 512, 384));
    }
    /* the two pictures that come by turns, told apart by the SEI byte that alternates */
    {
        PairTagger t;
        /* byte 0 the same, byte 1 a counter, byte 2 the tag (09 / 0a), byte 3 the same */
        const char *tag[2] = {"09", "0a"};
        int right = 0, n = 0;
        for (int i = 0; i < 40; i++) {
            char sei[16];
            std::snprintf(sei, sizeof sei, "aa%02x%s55", i, tag[i & 1]);
            const int c = t.classify(sei);
            if (i >= 6) { n++; right += c == (i & 1); }
        }
        CHECK(n == 34 && right == 34);
        CHECK(t.mode() == "sei@2");
        /* the same answers when it starts on the other picture */
        PairTagger u;
        right = 0;
        for (int i = 1; i < 40; i++) {
            char sei[16];
            std::snprintf(sei, sizeof sei, "aa%02x%s55", i, tag[i & 1]);
            const int c = u.classify(sei);
            if (i >= 7) right += c == (i & 1);
        }
        CHECK(right == 33);
        /* a picture lost, of either kind, once or twice in a row: not one picture wrong after it
         * (0.7.5 and before: the next 5 were told by counting, the wrong way round) */
        for (int lost = 20; lost <= 21; lost++) {
            for (int run = 1; run <= 2; run++) {
                PairTagger v;
                int wrong = 0;
                for (int i = 0; i < 60; i++) {
                    if (i >= lost && i < lost + run) continue;
                    char sei[16];
                    std::snprintf(sei, sizeof sei, "aa%02x%s55", i, tag[i & 1]);
                    const int c = v.classify(sei);
                    if (i >= 6) wrong += c != (i & 1);
                }
                CHECK(wrong == 0);
                CHECK(v.mode() == "sei@2");
            }
        }
        /* an SEI missing for a picture once learnt: counted on from the last one, then the byte again */
        {
            PairTagger y;
            int wrong = 0;
            for (int i = 0; i < 30; i++) {
                char sei[16];
                std::snprintf(sei, sizeof sei, "aa%02x%s55", i, tag[i & 1]);
                const int c = y.classify(i == 15 ? "" : sei);
                if (i >= 6) wrong += c != (i & 1);
            }
            CHECK(wrong == 0);
        }
        /* no SEI, or none that alternates: by counting, the first picture 0 */
        PairTagger w;
        CHECK(w.classify("") == 0 && w.classify("") == 1 && w.classify("") == 0);
        CHECK(w.mode() == "count");
        PairTagger x;
        for (int i = 0; i < 10; i++) { char sei[16]; std::snprintf(sei, sizeof sei, "aa%02x0955", i); CHECK(x.classify(sei) == (i & 1)); }
        CHECK(x.mode() == "count");
    }
    std::printf(fails ? "resample_test: %d FAILED\n" : "resample_test: ok\n", fails);
    return fails ? 1 : 0;
}
