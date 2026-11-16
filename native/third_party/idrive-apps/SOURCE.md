# Files from robertnisipeanu/idrive-apps

Copied from https://github.com/robertnisipeanu/idrive-apps at commit
`090dc8b78e7258c9a86ea53aee48f1560f20c4bd` (2026-11-16), each with its own
license header. Unchanged, except `avb_source.cpp` (2026-11-16): the receiver's name
can be set by the build (`AVB_RECEIVER_NAME`); the change is marked in the file.

| Path here | License | What |
|---|---|---|
| `waze-on-cluster/src/avb_source.*` | GPL-3.0-or-later, (C) Robert Nisipeanu | receiver on the head unit's IAS AVB media bus |
| `waze-on-cluster/src/rtp_h264.*` | GPL-3.0-or-later, (C) Robert Nisipeanu | RTP H.264 depacketiser |
| `waze-on-cluster/src/packet_queue.h` | GPL-3.0-or-later, (C) Robert Nisipeanu | receive thread to decode thread queue |
| `cluster-render/src/log.*` | GPL-3.0-or-later, (C) Robert Nisipeanu | logging |
| `cluster-render/client/*`, `cluster-render/include/cluster_render/*` | MPL-2.0, (C) Robert Nisipeanu | the cluster renderer's C++ client |

The license texts are `waze-on-cluster/LICENSE`, `cluster-render/LICENSE` and
`cluster-render/LICENSES/`.
