/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Link-only stand-in for the head unit's IAS AVB bridge
 * (/usr/lib/libias-media_transport-avb_ufipc_bridge.so.1): the three C
 * functions the receiver uses, so the program records the right DT_NEEDED.
 * Never shipped; the head unit has the real library. */
void *ias_avbbridge_create_receiver(const char *receiver, const char *stream) { (void)receiver; (void)stream; return 0; }
int ias_avbbridge_register_H264_cb(void *handle, void *cb, void *user) { (void)handle; (void)cb; (void)user; return -1; }
void ias_avbbridge_destroy_receiver(void *handle) { (void)handle; }
