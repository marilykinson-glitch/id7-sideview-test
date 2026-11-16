# Building for the head unit without its toolchain

The MGU (iDrive 7) is x86-64 Linux with **glibc 2.27** and libstdc++ 6.0.24 (gcc 7.5, the
userland of Ubuntu 18.04). A program linked on a current distribution asks the loader for
symbol versions that unit does not have (`GLIBC_2.34`, `GLIBCXX_3.4.32`, ...) and never starts.
The usual answer is to build in an Ubuntu 18.04 container. `../build.sh` instead builds with
the host's own gcc and makes the result fit the unit:

| Piece | What it does |
|---|---|
| `abilists/` | glibc 2.27's own ABI lists (`sysdeps/unix/sysv/linux/x86_64/64/*.abilist`, tag `glibc-2.27`): every symbol and version the unit's glibc exports |
| `gen_glibc_stubs.py` | turns them into link-only stub libraries with the real SONAMEs. Linking against the stubs (and `-nostdlib`), the program can only bind what glibc 2.27 has, at the versions it has; anything else is a link error |
| `compat.c` | the few things a current libstdc++ and current headers pull in that 2.27 lacks (`__isoc23_strtol`, `stat` as a real function, `fcntl64`, `pthread_cond_clockwait`, `arc4random`, `_dl_find_object` for the unwinder, `__libc_single_threaded`, `atexit`), written with what 2.27 has |
| `start.S`, `csu.c` | the program's entry. Since glibc 2.34 the start file leaves running the constructors to the library; glibc 2.27 expects the program to pass an init function. Without these a C++ program would start on the unit with its static constructors never run |
| `ias_avb_stub.c` | a link-only stand-in for the unit's AVB bridge library (three C functions) |
| `check_abi.py` | after the link: the loader path, the needed libraries and every imported symbol and version checked against the ABI lists. The build fails if anything is not on the unit |

libstdc++ and libgcc are linked statically (the unit's libstdc++ is older than the compiler's),
FFmpeg's decoder too. What remains dynamic is glibc and the unit's AVB bridge, both C.

The tests (`../test/run.sh`) run this very binary under the build machine's loader: a newer
glibc still has every 2.27 symbol version, so what runs there has its constructors, threads,
exceptions and unwinding in order.

It was also run under a real glibc 2.27: glibc built from its `glibc-2.27` tag (it needs GNU awk
and `CFLAGS="-O2 -fcommon"` with a current gcc; `--disable-werror`), a fake AVB bridge linked
against the stubs, and

```sh
G=/path/to/glibc-2.27-build
SIDECAM_LOADER=$G/elf/ld.so \
SIDECAM_LIBPATH=$G:$G/nptl:$G/math:$G/rt:$G/dlfcn:<folder with that fake bridge> \
python3 test/e2e.py build/mgu-sidecam build/test
```

All of `test/e2e.py` passes there (0.3.0).

`abilists/` are data files of the GNU C Library 2.27 (LGPL-2.1-or-later, Copyright (C) Free
Software Foundation); only symbol names and versions are taken from them.
