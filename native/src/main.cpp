// SPDX-License-Identifier: GPL-3.0-or-later
/* mgu-sidecam: a mirror camera's picture on the instrument cluster.
 *
 * Receives the camera unit's H.264 stream from the head unit's media bus,
 * decodes it, cuts the wanted camera out of the picture and hands it to the
 * cluster renderer (cluster-render, robertnisipeanu/idrive-apps) as a video
 * layer. It decides nothing about when: its parent (xinhan-cam.js) tells it
 * over stdin which view to show, from the turn signals the app reads.
 *
 * stdin, one flat JSON object a line:
 *   {"op":"view","side":"left"}         left | right | all | none; said again at least every 3 s
 *                                       while a view is wanted (else it goes: the parent is gone)
 *   {"op":"config","target":"map","w":512,"h":384,"x":-1,"y":-1,"fps":12,"klass":"overlay",
 *    "exclusive":1,"contend":1,"persist":1,
 *    "left":"0,500,500,500","left_rot":0,"left_flip":0,"left_sar":100, "right":..., "all":"0,0,1000,1000", ...}
 *                                       crops are x,y,w,h in 1/1000 of the picture; _rot degrees clockwise;
 *                                       _sar how wide a sample is shown, % of its height; x or y -1: centred
 *   {"op":"status"}                     a status line now
 *   {"op":"quit"}
 * stdout: {"ev":"status",...} lines, on every change and once a second.
 * stderr: the log (-v: more).
 *
 * A view is shown only while pictures keep coming: a picture older than
 * kFreshMs is never left on the cluster. End of stdin ends the program. */
#include <cerrno>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <poll.h>
#include <string>
#include <sys/eventfd.h>
#include <thread>
#include <unistd.h>
#include <vector>

#include "cluster_render/client.h"
#include "log.h"
#include "pipeline.h"

#ifndef SIDECAM_VERSION
#define SIDECAM_VERSION "dev"
#endif

using namespace sidecam;

namespace {

const int64_t kFreshMs = 800;       /* a picture older than this is not shown */
const int64_t kHeartbeatMs = 3000;  /* a view not asked for again this long goes */
const int64_t kJoinRetryMs = 2000;
const int64_t kStatusMs = 1000;
const int64_t kRefusedMs = 2000;    /* after the renderer refuses the layer, not asked again this long */

volatile sig_atomic_t g_quit = 0;
void on_signal(int) { g_quit = 1; }

struct Config {
    std::string target = "map";
    std::string klass = "overlay";
    int x = -1, y = -1;
    bool exclusive = true, contend = true, persist = true;
    Output out;
};

struct App {
    Config cfg;
    Pipeline pipe;
    cr::Client *cr = nullptr;
    uint32_t layer = 0;
    int layer_w = 0, layer_h = 0, layer_x = 0, layer_y = 0;
    bool layer_visible = false;
    std::string layer_state = "none", layer_reason, target_state, target_holder, cr_error;
    uint32_t gen = 1;
    View view = kNone;
    int64_t view_ms = 0;             /* when the view was last asked for */
    bool shown = false;              /* the layer is visible with this view's pictures */
    std::string why = "no view asked for";
    int64_t shown_ms = 0;
    uint64_t frames_sent = 0;
    bool dirty = true;               /* a status line is due */
    int target_w = 0, target_h = 0;
    bool layer_due = true;           /* the layer is to be made (again) */
    int64_t refused_ms = -100000;    /* when the renderer last refused the layer or showing it */
    std::vector<uint8_t> atlas;
};

bool target_size(const std::string &targets, const std::string &name, int *w, int *h)
{
    /* "map:1088x480,panel:1920x720,hud:800x480" */
    size_t at = 0;
    while (at < targets.size()) {
        size_t end = targets.find(',', at);
        if (end == std::string::npos)
            end = targets.size();
        const std::string part = targets.substr(at, end - at);
        const size_t colon = part.find(':');
        if (colon != std::string::npos && part.substr(0, colon) == name)
            return std::sscanf(part.c_str() + colon + 1, "%dx%d", w, h) == 2;
        at = end + 1;
    }
    return false;
}

std::string num(long long v) { return std::to_string(v); }

void emit_status(App &a)
{
    const Stats s = a.pipe.stats();
    const int64_t now = cld::now_ms();
    std::vector<std::pair<std::string, std::string>> kv;
    auto str = [&kv](const char *k, const std::string &v) { kv.emplace_back(k, cr::json_quote(v)); };
    auto n = [&kv](const char *k, long long v) { kv.emplace_back(k, num(v)); };
    str("ev", "status");
    str("version", SIDECAM_VERSION);
    str("avb", s.avb);
    n("packets", (long long)s.packets);
    n("bytes", (long long)s.bytes);
    n("lost", (long long)s.lost);
    n("dropped", (long long)s.dropped);
    n("access_units", (long long)s.access_units);
    n("pictures", (long long)s.pictures);
    n("corrupt", (long long)s.corrupt);
    n("keyframes", (long long)s.keyframes);
    n("decode_errors", (long long)s.decode_errors);
    n("restarts", (long long)s.restarts);
    n("picture_w", s.w);
    n("picture_h", s.h);
    n("full_range", s.full_range ? 1 : 0);
    n("picture_age_ms", s.picture_ms < 0 ? -1 : now - s.picture_ms);
    n("decode_us", s.decode_us);
    n("view_us", s.view_us);
    str("sei", s.sei);
    str("cr", a.cr && a.cr->connected() ? "connected" : "connecting");
    str("backend", a.cr ? a.cr->backend : "");
    str("targets", a.cr ? a.cr->targets : "");
    str("target", a.cfg.target);
    str("target_state", a.target_state);
    str("target_holder", a.target_holder);
    str("layer", a.layer_state);
    str("layer_reason", a.layer_reason);
    str("cr_error", a.cr_error);
    n("layer_w", a.layer_w);
    n("layer_h", a.layer_h);
    n("layer_x", a.layer_x);
    n("layer_y", a.layer_y);
    str("view", view_name(a.view));
    n("shown", a.shown ? 1 : 0);
    str("why", a.shown ? "" : a.why);
    n("frames_sent", (long long)a.frames_sent);
    std::printf("%s\n", cr::json_object(kv).c_str());
    std::fflush(stdout);
    a.dirty = false;
}

cr::LayerOptions layer_options(const App &a, bool visible)
{
    cr::LayerOptions lo;
    lo.target = a.cfg.target;
    lo.klass = a.cfg.klass;
    lo.z = 900;
    lo.x = a.layer_x;
    lo.y = a.layer_y;
    lo.w = (unsigned)a.layer_w;   /* drawn at the frame's own size: such a video can share a display buffer */
    lo.h = (unsigned)a.layer_h;
    lo.visible = visible;
    lo.exclusive = a.cfg.exclusive;
    lo.contend = a.cfg.contend;
    return lo;
}

void drop_layer(App &a)
{
    if (a.layer && a.cr)
        a.cr->drop(a.layer);
    a.layer = 0;
    a.layer_visible = false;
    a.layer_state = "none";
    a.layer_reason.clear();
    a.shown = false;
}

/* The layer for the current setting; false with a.why while it cannot be. */
bool make_layer(App &a, bool visible)
{
    if (!a.cr || !a.cr->connected()) {
        a.why = "the cluster renderer is not connected";
        return false;
    }
    int tw = 0, th = 0;
    if (!target_size(a.cr->targets, a.cfg.target, &tw, &th)) {
        a.why = "the cluster renderer has no target " + a.cfg.target;
        return false;
    }
    a.target_w = tw;
    a.target_h = th;
    int w = a.cfg.out.w, h = a.cfg.out.h;
    if (w > tw || h > th) {
        a.why = "the view is larger than the target";
        return false;
    }
    int x = a.cfg.x < 0 ? (tw - w) / 2 : a.cfg.x, y = a.cfg.y < 0 ? (th - h) / 2 : a.cfg.y;
    if (x + w > tw) x = tw - w;
    if (y + h > th) y = th - h;
    x &= ~1;   /* even: so the video can share a buffer (PROTOCOL.md) */
    y &= ~1;
    a.layer_w = w;
    a.layer_h = h;
    a.layer_x = x;
    a.layer_y = y;
    cr::VideoOptions vo;
    vo.w = (unsigned)w;
    vo.h = (unsigned)h;
    vo.fps = a.cfg.out.fps ? a.cfg.out.fps : 15;
    vo.stall_ms = 2000;
    a.cr_error.clear();
    a.layer = a.cr->video(layer_options(a, visible), vo);
    a.layer_visible = visible;
    a.layer_state = "made";
    a.layer_due = false;
    log_info("layer %u on %s: %dx%d at %d,%d, %u fps%s", a.layer, a.cfg.target.c_str(), w, h, x, y, vo.fps,
             visible ? "" : " (hidden)");
    return a.layer != 0;
}

void set_visible(App &a, bool on)
{
    if (!a.layer || a.layer_visible == on)
        return;
    a.cr->set(a.layer, layer_options(a, on));
    a.layer_visible = on;
}

void hide(App &a, const std::string &why)
{
    if (a.shown)
        log_info("hidden after %lld ms: %s", (long long)(cld::now_ms() - a.shown_ms), why.c_str());
    if (a.why != why)
        a.dirty = true;
    a.why = why;
    if (!a.shown && !a.layer_visible)
        return;
    a.shown = false;
    a.dirty = true;
    if (!a.layer)
        return;
    if (!a.cfg.persist) {
        drop_layer(a);
        return;
    }
    set_visible(a, false);
    /* the picture the layer keeps: black, so the next view never starts with this one */
    if (a.cr && a.cr->connected()) {
        std::vector<uint8_t> black(atlas_bytes(a.layer_w, a.layer_h));
        black_atlas(black.data(), a.layer_w, a.layer_h);
        a.cr->frame(a.layer, black.data(), black.size(), 0);
    }
}

long to_long(const cr::Json &j, const char *k, long dflt)
{
    auto it = j.find(k);
    if (it == j.end() || it->second.empty())
        return dflt;
    char *end = nullptr;
    const long v = std::strtol(it->second.c_str(), &end, 10);
    return end && *end == 0 ? v : dflt;
}

void apply_config(App &a, const cr::Json &j)
{
    Config c = a.cfg;
    auto s = [&j](const char *k, std::string *out) {
        auto it = j.find(k);
        if (it != j.end() && !it->second.empty())
            *out = it->second;
    };
    s("target", &c.target);
    s("klass", &c.klass);
    if (c.klass != "ambient" && c.klass != "content" && c.klass != "overlay" && c.klass != "alert")
        c.klass = "overlay";
    c.x = (int)to_long(j, "x", c.x);
    c.y = (int)to_long(j, "y", c.y);
    c.exclusive = to_long(j, "exclusive", c.exclusive) != 0;
    c.contend = to_long(j, "contend", c.contend) != 0;
    c.persist = to_long(j, "persist", c.persist) != 0;
    int w = (int)to_long(j, "w", c.out.w), h = (int)to_long(j, "h", c.out.h);
    w &= ~3;
    h &= ~1;
    if (w >= 64 && w <= 1920 && h >= 64 && h <= 720) {
        c.out.w = w;
        c.out.h = h;
    }
    const long fps = to_long(j, "fps", c.out.fps);
    if (fps >= 1 && fps <= 30)
        c.out.fps = (unsigned)fps;
    static const char *const names[] = {nullptr, "left", "right", "all"};
    for (int v = kLeft; v < kViews; v++) {
        ViewSpec &vs = c.out.views[v];
        auto it = j.find(names[v]);
        if (it != j.end() && !parse_crop(it->second, &vs))
            log_warn("config: %s \"%s\" is not x,y,w,h in 1/1000 inside the picture: kept as it was", names[v],
                     it->second.c_str());
        const long rot = to_long(j, (std::string(names[v]) + "_rot").c_str(), vs.rot);
        if (rot == 0 || rot == 90 || rot == 180 || rot == 270)
            vs.rot = (int)rot;
        vs.flip = to_long(j, (std::string(names[v]) + "_flip").c_str(), vs.flip) != 0;
        const long sar = to_long(j, (std::string(names[v]) + "_sar").c_str(), vs.sar);
        if (sar >= 25 && sar <= 400)
            vs.sar = (int)sar;
    }
    const bool layer_changed = c.target != a.cfg.target || c.klass != a.cfg.klass || c.x != a.cfg.x || c.y != a.cfg.y ||
                               c.exclusive != a.cfg.exclusive || c.contend != a.cfg.contend ||
                               c.persist != a.cfg.persist || c.out.w != a.cfg.out.w || c.out.h != a.cfg.out.h ||
                               c.out.fps != a.cfg.out.fps;
    a.cfg = c;
    a.gen = a.pipe.set_output(c.out);
    if (layer_changed) {
        hide(a, "the setting changed");
        drop_layer(a);
        a.layer_due = true;
    }
    a.dirty = true;
    log_info("config: %s %dx%d at %d,%d, %u fps, %s%s%s%s", c.target.c_str(), c.out.w, c.out.h, c.x, c.y, c.out.fps,
             c.klass.c_str(), c.exclusive ? ", exclusive" : "", c.contend ? ", contend" : "",
             c.persist ? ", layer kept" : ", layer made for each view");
}

void on_line(App &a, const std::string &line)
{
    cr::Json j;
    if (line.empty() || !cr::parse_json(line, &j))
        return;
    const std::string op = j["op"];
    if (op == "view") {
        const View v = view_from(j["side"]);
        a.view_ms = cld::now_ms();
        if (v != a.view) {
            log_info("view: %s", view_name(v));
            a.view = v;
            a.pipe.set_view(v);
            a.dirty = true;
            if (v == kNone)
                hide(a, "no view asked for");
            else
                a.shown = false;   /* until this view's first picture is in the layer */
        }
    } else if (op == "config") {
        apply_config(a, j);
    } else if (op == "status") {
        a.dirty = true;
    } else if (op == "quit") {
        g_quit = 1;
    }
}

void usage()
{
    std::fprintf(stderr,
                 "usage: mgu-sidecam [--stream NAME] [--socket PATH] [--file capture.rtp] [--loop] [-v]\n"
                 "  --stream NAME   the media-bus stream (default media_transport.avb_streaming.1)\n"
                 "  --socket PATH   the cluster renderer's socket\n"
                 "  --file FILE     RTP packets from a file instead of the bus, each behind a 2-byte\n"
                 "                  big-endian length, 15 pictures a second (tests)\n"
                 "  --loop          the file again when it ends\n"
                 "  --version\n");
}

/* The test feeder: a file of length-prefixed RTP packets at the stream's pace
 * (a new RTP timestamp is a new picture: 66 ms). */
void feed_file(Pipeline *pipe, std::string path, bool loop)
{
    do {
        FILE *f = std::fopen(path.c_str(), "rb");
        if (!f) {
            log_error("file %s: %s", path.c_str(), std::strerror(errno));
            return;
        }
        std::vector<uint8_t> pkt;
        uint32_t ts = 0;
        bool have_ts = false;
        unsigned char len[2];
        while (!g_quit && std::fread(len, 1, 2, f) == 2) {
            const size_t n = (size_t)len[0] << 8 | len[1];
            pkt.resize(n);
            if (!n || std::fread(pkt.data(), 1, n, f) != n)
                break;
            if (n >= 12) {
                const uint32_t t = (uint32_t)pkt[4] << 24 | pkt[5] << 16 | pkt[6] << 8 | pkt[7];
                if (have_ts && t != ts)
                    usleep(66000);
                ts = t;
                have_ts = true;
            }
            pipe->push(pkt.data(), n);
        }
        std::fclose(f);
    } while (loop && !g_quit);
}

}  // namespace

int main(int argc, char **argv)
{
    std::string stream = "media_transport.avb_streaming.1", socket_path = cr::kDefaultSocket, file;
    bool loop_file = false;
    for (int i = 1; i < argc; i++) {
        const std::string arg = argv[i];
        if (arg == "--stream" && i + 1 < argc) stream = argv[++i];
        else if (arg == "--socket" && i + 1 < argc) socket_path = argv[++i];
        else if (arg == "--file" && i + 1 < argc) file = argv[++i];
        else if (arg == "--loop") loop_file = true;
        else if (arg == "-v") cld::log_verbose = 1;
        else if (arg == "--version") { std::printf("%s\n", SIDECAM_VERSION); return 0; }
        else { usage(); return 2; }
    }
    cld::log_name = "mgu-sidecam";
    signal(SIGTERM, on_signal);
    signal(SIGINT, on_signal);
    signal(SIGPIPE, SIG_IGN);

    App a;
    /* the mirror cameras of the all-cameras picture: its lower half (the app sends what the car has) */
    parse_crop("0,500,500,500", &a.cfg.out.views[kLeft]);
    parse_crop("500,500,500,500", &a.cfg.out.views[kRight]);
    a.gen = a.pipe.set_output(a.cfg.out);

    const int wake = eventfd(0, EFD_NONBLOCK | EFD_CLOEXEC);
    std::string err;
    log_info("mgu-sidecam %s, %s", SIDECAM_VERSION, H264Decoder::version().c_str());
    if (!a.pipe.start(wake, &err)) {
        log_error("decoder: %s", err.c_str());
        return 1;
    }
    std::thread feeder;
    if (!file.empty())
        feeder = std::thread(feed_file, &a.pipe, file, loop_file);

    cr::Client client("xinhan-cam", socket_path);
    a.cr = &client;
    client.on_ready = [&a] {
        log_info("cluster renderer: backend %s, targets %s", a.cr->backend.c_str(), a.cr->targets.c_str());
        a.dirty = true;
        /* the client makes the layer again by itself; a layer never made is made in the loop */
    };
    client.on_layer = [&a](uint32_t ref, const std::string &state, const std::string &reason) {
        if (ref != a.layer)
            return;
        if (state != a.layer_state || reason != a.layer_reason)
            log_info("layer: %s%s%s", state.c_str(), reason.empty() ? "" : ": ", reason.c_str());
        a.layer_state = state;
        a.layer_reason = reason;
        a.dirty = true;
    };
    client.on_target = [&a](const std::string &target, const std::string &state, const std::string &holder,
                            const std::string &reason) {
        if (target != a.cfg.target)
            return;
        (void)reason;
        a.target_state = state;
        a.target_holder = holder;
        a.dirty = true;
    };
    client.on_error = [&a](const std::string &op, uint32_t ref, const std::string &reason) {
        log_warn("cluster renderer refused %s (ref %u): %s", op.c_str(), ref, reason.c_str());
        a.cr_error = op + ": " + reason;
        if (ref && ref == a.layer && (op == "layer" || op == "set")) {
            /* not made, or not shown: asked again with a view, kRefusedMs later at the earliest */
            a.refused_ms = cld::now_ms();
            if (op == "layer") {
                a.cr->drop(ref);   /* the client forgets it too */
                a.layer = 0;
            }
            a.layer_visible = false;
            a.layer_state = "refused";
            a.layer_reason = reason;
            if (a.shown)
                log_info("hidden: the cluster renderer refused the layer");
            a.shown = false;
            a.why = "the cluster renderer refused: " + reason;
        }
        a.dirty = true;
    };

    fcntl(STDIN_FILENO, F_SETFL, fcntl(STDIN_FILENO, F_GETFL) | O_NONBLOCK);
    std::string in;
    int64_t join_ms = 0, status_ms = 0;
    bool was_connected = false;

    while (!g_quit) {
        struct pollfd fds[3];
        fds[0].fd = STDIN_FILENO;
        fds[0].events = POLLIN;
        fds[1].fd = wake;
        fds[1].events = POLLIN;
        fds[2].fd = client.fd();
        fds[2].events = (short)(client.fd() >= 0 ? (client.wants_write() ? POLLIN | POLLOUT : POLLIN) : 0);
        fds[0].revents = fds[1].revents = fds[2].revents = 0;
        poll(fds, 3, 50);
        const int64_t now = cld::now_ms();

        if (fds[1].revents & POLLIN) {
            uint64_t v;
            ssize_t n = read(wake, &v, sizeof v);
            (void)n;
        }
        if (fds[0].revents & (POLLIN | POLLHUP | POLLERR)) {
            char buf[4096];
            for (;;) {
                const ssize_t n = read(STDIN_FILENO, buf, sizeof buf);
                if (n > 0) {
                    in.append(buf, (size_t)n);
                    continue;
                }
                if (n == 0) {
                    log_info("stdin closed: the parent is gone");
                    g_quit = 1;
                }
                break;
            }
            size_t nl;
            while ((nl = in.find('\n')) != std::string::npos) {
                on_line(a, in.substr(0, nl));
                in.erase(0, nl + 1);
            }
            if (in.size() > 65536)
                in.clear();
        }

        client.poll(now);
        if (client.connected() != was_connected) {
            was_connected = client.connected();
            a.dirty = true;
            if (!was_connected) {
                /* the service went: its layers went with it; the client makes ours again, hidden or
                 * not as last set, and the pictures follow */
                a.shown = false;
                a.target_state.clear();
            }
        }

        /* the bus, until it lets us in */
        if (file.empty() && !a.pipe.joined() && now - join_ms >= kJoinRetryMs) {
            join_ms = now;
            if (!a.pipe.join(stream, &err))
                log_debug("avb: %s (again in %lld ms)", err.c_str(), (long long)kJoinRetryMs);
            a.dirty = true;
        }

        /* a view nobody asks for any more */
        if (a.view != kNone && now - a.view_ms > kHeartbeatMs) {
            log_warn("view %s not asked for again in %lld ms: dropped", view_name(a.view), (long long)kHeartbeatMs);
            a.view = kNone;
            a.pipe.set_view(kNone);
            hide(a, "the app stopped asking");
        }

        /* the layer, kept hidden between views when persist */
        if (client.connected() && !a.layer && a.layer_due && a.cfg.persist)
            make_layer(a, false);

        const Stats st = a.pipe.stats();
        const bool fresh = st.picture_ms >= 0 && now - st.picture_ms <= kFreshMs;
        if (a.view != kNone) {
            if (!fresh) {
                hide(a, st.picture_ms < 0 ? "no camera picture yet" : "the camera pictures stopped");
            } else if (!client.connected()) {
                hide(a, "the cluster renderer is not connected");
            } else {
                AtlasMeta meta;
                while (a.pipe.take(&a.atlas, &meta)) {
                    if (meta.view != a.view || meta.gen != a.gen)
                        continue;
                    if (now - a.refused_ms < kRefusedMs)
                        continue;
                    if (!a.layer && !make_layer(a, true)) {
                        a.dirty = true;
                        break;
                    }
                    if (meta.w != a.layer_w || meta.h != a.layer_h)
                        continue;
                    if (client.frame(a.layer, &a.atlas, meta.id)) {
                        a.frames_sent++;
                        if (!a.layer_visible)
                            set_visible(a, true);
                        if (!a.shown) {
                            a.shown = true;
                            a.shown_ms = now;
                            a.dirty = true;
                            log_info("view %s shown", view_name(a.view));
                        }
                    }
                }
            }
        } else {
            AtlasMeta meta;
            while (a.pipe.take(&a.atlas, &meta)) {
            }
        }

        if (a.dirty || now - status_ms >= kStatusMs) {
            status_ms = now;
            emit_status(a);
        }
    }

    g_quit = 1;
    if (a.layer)
        client.drop(a.layer);
    client.poll(cld::now_ms());
    a.pipe.stop();
    if (feeder.joinable())
        feeder.join();
    log_info("bye");
    return 0;
}
