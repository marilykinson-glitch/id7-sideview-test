/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Test stand-in for the head unit's IAS AVB bridge, with the real library's
 * SONAME: "receives" the RTP packets of the file named by SIDECAM_FAKE_AVB
 * (each behind a 2-byte big-endian length) and hands them to the callback on
 * a thread of its own, a new RTP timestamp every 66 ms, as the bus does.
 * SIDECAM_FAKE_AVB_FAIL=N: the first N create calls fail (the bus not up yet).
 * The file is played again when it ends. */
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

struct packet { uint32_t size; void *data; };
typedef void (*cb_t)(void *handle, const struct packet *pkt, void *user);
struct receiver { pthread_t thread; cb_t cb; void *user; volatile int run; int started; char file[512]; };
static int fails = -1;

static void *feed(void *arg)
{
    struct receiver *r = arg;
    unsigned char buf[65536], len[2];
    while (r->run) {
        FILE *f = fopen(r->file, "rb");
        uint32_t ts = 0;
        int have = 0;
        if (!f) { usleep(100000); continue; }
        while (r->run && fread(len, 1, 2, f) == 2) {
            size_t n = (size_t)len[0] << 8 | len[1];
            if (!n || fread(buf, 1, n, f) != n) break;
            if (n >= 12) {
                uint32_t t = (uint32_t)buf[4] << 24 | buf[5] << 16 | buf[6] << 8 | buf[7];
                if (have && t != ts) usleep(66000);
                ts = t; have = 1;
            }
            struct packet p = { (uint32_t)n, buf };
            r->cb(r, &p, r->user);
        }
        fclose(f);
    }
    return NULL;
}

void *ias_avbbridge_create_receiver(const char *receiver, const char *stream)
{
    const char *file = getenv("SIDECAM_FAKE_AVB");
    if (fails < 0) fails = getenv("SIDECAM_FAKE_AVB_FAIL") ? atoi(getenv("SIDECAM_FAKE_AVB_FAIL")) : 0;
    fprintf(stderr, "fake avb: create_receiver(%s, %s)%s\n", receiver, stream, fails > 0 ? " -> fails" : "");
    if (fails > 0) { fails--; return NULL; }
    if (!file) return NULL;
    struct receiver *r = calloc(1, sizeof *r);
    snprintf(r->file, sizeof r->file, "%s", file);
    return r;
}
int ias_avbbridge_register_H264_cb(void *handle, cb_t cb, void *user)
{
    struct receiver *r = handle;
    r->cb = cb; r->user = user; r->run = 1; r->started = 1;
    return pthread_create(&r->thread, NULL, feed, r);
}
void ias_avbbridge_destroy_receiver(void *handle)
{
    struct receiver *r = handle;
    if (!r) return;
    r->run = 0;
    if (r->started) pthread_join(r->thread, NULL);
    free(r);
}
