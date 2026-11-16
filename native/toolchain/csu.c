/* SPDX-License-Identifier: GPL-3.0-or-later */
/* The program's constructors, as glibc 2.27's csu/elf-init.c ran them (see
 * start.S): pre-init array, _init, init array. The destructors (.fini_array)
 * are run by the dynamic loader's _dl_fini through rtld_fini, so fini is
 * empty, as glibc's was. */
#include <stddef.h>

extern void (*__preinit_array_start[])(int, char **, char **) __attribute__((visibility("hidden")));
extern void (*__preinit_array_end[])(int, char **, char **) __attribute__((visibility("hidden")));
extern void (*__init_array_start[])(int, char **, char **) __attribute__((visibility("hidden")));
extern void (*__init_array_end[])(int, char **, char **) __attribute__((visibility("hidden")));
extern void _init(void);

void mgu_csu_init(int argc, char **argv, char **envp)
{
    size_t i, n = (size_t)(__preinit_array_end - __preinit_array_start);
    for (i = 0; i < n; i++)
        (*__preinit_array_start[i])(argc, argv, envp);
    _init();
    n = (size_t)(__init_array_end - __init_array_start);
    for (i = 0; i < n; i++)
        (*__init_array_start[i])(argc, argv, envp);
}

void mgu_csu_fini(void) {}
