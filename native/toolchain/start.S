/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Program entry for a glibc 2.27 target, built with a newer glibc's toolchain.
 *
 * Since glibc 2.34 the start file passes no init function to
 * __libc_start_main and the library runs the program's constructors itself.
 * glibc 2.27 does not: it calls the init function it is given and nothing
 * else, so with a new start file a C++ program would start without its
 * static constructors. This entry does what glibc 2.27's own start file did:
 * it passes mgu_csu_init / mgu_csu_fini (csu.c). */
        .text
        .globl _start
        .type _start,@function
_start:
        xorl %ebp, %ebp
        movq %rdx, %r9                  /* rtld_fini */
        popq %rsi                       /* argc */
        movq %rsp, %rdx                 /* argv */
        andq $-16, %rsp
        pushq %rax
        pushq %rsp                      /* stack end */
        leaq mgu_csu_fini(%rip), %r8
        leaq mgu_csu_init(%rip), %rcx
        leaq main(%rip), %rdi
        call *__libc_start_main@GOTPCREL(%rip)
        hlt
        .size _start, .-_start
        .section .note.GNU-stack,"",@progbits
