/* SPDX-License-Identifier: GPL-3.0-or-later */
/* What a program built with a newer glibc's headers and libstdc++ uses that
 * glibc 2.27 (the head unit's) does not have, written with what it has.
 * Linked into the program; mgu-link.sh fails on any other missing symbol. */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <link.h>
#include <pthread.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

/* ---- C23 number parsing (glibc 2.38 headers redirect strtol and scanf) ---- */
extern long old_strtol(const char *, char **, int) __asm__("strtol");
extern unsigned long old_strtoul(const char *, char **, int) __asm__("strtoul");
extern long long old_strtoll(const char *, char **, int) __asm__("strtoll");
extern unsigned long long old_strtoull(const char *, char **, int) __asm__("strtoull");
extern int old_vsscanf(const char *, const char *, va_list) __asm__("vsscanf");
extern int old_vfscanf(FILE *, const char *, va_list) __asm__("vfscanf");

long __isoc23_strtol(const char *s, char **e, int b) { return old_strtol(s, e, b); }
unsigned long __isoc23_strtoul(const char *s, char **e, int b) { return old_strtoul(s, e, b); }
long long __isoc23_strtoll(const char *s, char **e, int b) { return old_strtoll(s, e, b); }
unsigned long long __isoc23_strtoull(const char *s, char **e, int b) { return old_strtoull(s, e, b); }
int __isoc23_vsscanf(const char *s, const char *f, va_list ap) { return old_vsscanf(s, f, ap); }
int __isoc23_vfscanf(FILE *fp, const char *f, va_list ap) { return old_vfscanf(fp, f, ap); }
int __isoc23_sscanf(const char *s, const char *f, ...)
{
    va_list ap;
    va_start(ap, f);
    int r = old_vsscanf(s, f, ap);
    va_end(ap);
    return r;
}
int __isoc23_fscanf(FILE *fp, const char *f, ...)
{
    va_list ap;
    va_start(ap, f);
    int r = old_vfscanf(fp, f, ap);
    va_end(ap);
    return r;
}

/* ---- stat family: real functions since 2.33, wrappers of __xstat before ---- */
struct stat;
extern int __xstat(int, const char *, struct stat *);
extern int __lxstat(int, const char *, struct stat *);
extern int __fxstat(int, int, struct stat *);
extern int __fxstatat(int, int, const char *, struct stat *, int);
#define MGU_STAT_VER 1 /* _STAT_VER_LINUX on x86-64 */
int stat(const char *p, struct stat *st) { return __xstat(MGU_STAT_VER, p, st); }
int lstat(const char *p, struct stat *st) { return __lxstat(MGU_STAT_VER, p, st); }
int fstat(int fd, struct stat *st) { return __fxstat(MGU_STAT_VER, fd, st); }
int fstatat(int d, const char *p, struct stat *st, int fl) { return __fxstatat(MGU_STAT_VER, d, p, st, fl); }
int stat64(const char *p, struct stat *st) { return __xstat(MGU_STAT_VER, p, st); }
int lstat64(const char *p, struct stat *st) { return __lxstat(MGU_STAT_VER, p, st); }
int fstat64(int fd, struct stat *st) { return __fxstat(MGU_STAT_VER, fd, st); }
int fstatat64(int d, const char *p, struct stat *st, int fl) { return __fxstatat(MGU_STAT_VER, d, p, st, fl); }

/* ---- atexit: in libc_nonshared.a, which is the build machine's ---- */
extern int __cxa_atexit(void (*)(void *), void *, void *);
extern void *__dso_handle __attribute__((visibility("hidden")));
int atexit(void (*f)(void)) { return __cxa_atexit((void (*)(void *))f, NULL, &__dso_handle); }

/* ---- libstdc++: always threaded ---- */
char __libc_single_threaded = 0;

/* ---- libstdc++'s std::random_device ---- */
uint32_t arc4random(void)
{
    uint32_t v = 0;
    int fd = open("/dev/urandom", O_RDONLY | O_CLOEXEC);
    if (fd >= 0) {
        ssize_t n = read(fd, &v, sizeof v);
        (void)n;
        close(fd);
    }
    return v;
}

/* ---- condition variables and locks on a named clock (2.30) ---- */
static void to_realtime(clockid_t clk, const struct timespec *abs, struct timespec *out)
{
    struct timespec now_c, now_r;
    if (clk == CLOCK_REALTIME) {
        *out = *abs;
        return;
    }
    clock_gettime(clk, &now_c);
    clock_gettime(CLOCK_REALTIME, &now_r);
    int64_t ns = (int64_t)(abs->tv_sec - now_c.tv_sec) * 1000000000 + (abs->tv_nsec - now_c.tv_nsec);
    if (ns < 0)
        ns = 0;
    ns += (int64_t)now_r.tv_sec * 1000000000 + now_r.tv_nsec;
    out->tv_sec = (time_t)(ns / 1000000000);
    out->tv_nsec = (long)(ns % 1000000000);
}
int pthread_cond_clockwait(pthread_cond_t *c, pthread_mutex_t *m, clockid_t clk, const struct timespec *abs)
{
    struct timespec rt;
    to_realtime(clk, abs, &rt);
    return pthread_cond_timedwait(c, m, &rt);
}
int pthread_mutex_clocklock(pthread_mutex_t *m, clockid_t clk, const struct timespec *abs)
{
    struct timespec rt;
    to_realtime(clk, abs, &rt);
    return pthread_mutex_timedlock(m, &rt);
}

/* ---- the unwinder's object lookup (2.35): libgcc calls it with no way back
 * to dl_iterate_phdr, so it is that walk ---- */
struct find_ctx {
    uintptr_t pc;
    struct dl_find_object *out;
    int found;
};
static int find_cb(struct dl_phdr_info *info, size_t size, void *data)
{
    struct find_ctx *c = (struct find_ctx *)data;
    const ElfW(Phdr) *eh = NULL;
    uintptr_t lo = 0, hi = 0;
    int hit = 0;
    (void)size;
    for (int i = 0; i < info->dlpi_phnum; i++) {
        const ElfW(Phdr) *p = &info->dlpi_phdr[i];
        if (p->p_type == PT_LOAD) {
            uintptr_t a = info->dlpi_addr + p->p_vaddr, b = a + p->p_memsz;
            if (c->pc >= a && c->pc < b)
                hit = 1;
            if (!lo || a < lo)
                lo = a;
            if (b > hi)
                hi = b;
        } else if (p->p_type == PT_GNU_EH_FRAME) {
            eh = p;
        }
    }
    if (!hit)
        return 0;
    memset(c->out, 0, sizeof *c->out);
    c->out->dlfo_map_start = (void *)lo;
    c->out->dlfo_map_end = (void *)hi;
    c->out->dlfo_eh_frame = eh ? (void *)(info->dlpi_addr + eh->p_vaddr) : NULL;
    c->found = 1;
    return 1;
}
int _dl_find_object(void *pc, struct dl_find_object *out)
{
    struct find_ctx c = {(uintptr_t)pc, out, 0};
    dl_iterate_phdr(find_cb, &c);
    return c.found ? 0 : -1;
}

/* ---- fcntl64 (2.28): on x86-64 the same call as fcntl ---- */
extern int old_fcntl(int, int, ...) __asm__("fcntl");
int fcntl64(int fd, int cmd, ...)
{
    va_list ap;
    va_start(ap, cmd);
    void *arg = va_arg(ap, void *);
    va_end(ap);
    return old_fcntl(fd, cmd, arg);
}
