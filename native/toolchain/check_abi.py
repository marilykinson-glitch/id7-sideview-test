#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Checks that a program can start on the head unit (glibc 2.27, MGU iDrive 7).

  check_abi.py <program> <abilists dir> [name=SONAME:sym,sym ...]

Fails unless: its loader is /lib/ld-linux-x86-64.so.2; it needs only glibc's
libraries and the extra ones named; it uses no DT_RELR; and every symbol it
imports is in glibc 2.27's ABI lists with that very version, or is one of the
named extra library's symbols.
"""
import os
import re
import subprocess
import sys

GLIBC = {'libc.so.6': 'libc', 'libpthread.so.0': 'libpthread', 'libm.so.6': 'libm', 'libdl.so.2': 'libdl',
         'librt.so.1': 'librt', 'ld-linux-x86-64.so.2': 'ld'}


def run(*a):
    return subprocess.run(a, check=True, stdout=subprocess.PIPE, universal_newlines=True).stdout


def main():
    prog, lists = sys.argv[1], sys.argv[2]
    extra = {}
    for spec in sys.argv[3:]:
        soname, syms = spec.split(':', 1)
        extra[soname] = set(syms.split(','))
    have = set()   # (name, version)
    for lib in GLIBC.values():
        for line in open(os.path.join(lists, lib + '.abilist')):
            p = line.split()
            if len(p) >= 3 and p[2] != 'A':
                have.add((p[1], p[0]))
    bad = []
    interp = re.search(r'Requesting program interpreter: ([^\]]+)\]', run('readelf', '-lW', prog))
    if not interp or interp.group(1) != '/lib/ld-linux-x86-64.so.2':
        bad.append('loader is %s' % (interp.group(1) if interp else 'missing'))
    dyn = run('readelf', '-dW', prog)
    needed = re.findall(r'\(NEEDED\)\s+Shared library: \[([^\]]+)\]', dyn)
    for n in needed:
        if n not in GLIBC and n not in extra:
            bad.append('needs %s' % n)
    if re.search(r'\((RELR|RELRSZ|RELRENT)\)', dyn):
        bad.append('uses DT_RELR (glibc 2.36)')
    extra_syms = set().union(*extra.values()) if extra else set()
    imports = 0
    for line in run('readelf', '--dyn-syms', '-W', prog).splitlines():
        p = line.split()
        if len(p) < 8 or p[6] != 'UND' or not p[7]:
            continue
        imports += 1
        name, _, ver = p[7].partition('@')
        weak = p[4] == 'WEAK'
        if ver:
            if (name, ver) not in have:
                bad.append('imports %s@%s, not in glibc 2.27' % (name, ver))
        elif name not in extra_syms and not weak:
            bad.append('imports %s (no version, in no known library)' % name)
    vers = sorted(set(re.findall(r'GLIBC_[0-9.]+', run('readelf', '-VW', prog))),
                  key=lambda v: [int(x) for x in v[6:].split('.')])
    if bad:
        print('%s: NOT for the head unit:' % prog)
        for b in bad:
            print('  ' + b)
        sys.exit(1)
    print('%s: ok for glibc 2.27: %d imports, newest %s, needs %s' % (prog, imports, vers[-1] if vers else '-',
                                                                  ' '.join(needed)))


if __name__ == '__main__':
    main()
