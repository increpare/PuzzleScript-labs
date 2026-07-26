// Regression coverage for GBC cart foundation Task 3, Finding 1:
// session_internal.h must be self-protecting -- it needs to pull in
// generated_namespace.h *before* its own include of puzzlescript/gbc.h,
// rather than relying on whichever translation unit reaches it first having
// already done so (which is how the ordering bug stayed dormant: core.c
// pre-includes generated_namespace.h itself, compact_facade.c/facade_rules.c
// pull in puzzlescript/gbc.h via their own facade headers first, and
// specialized_turn.h never calls a gbc.h-only-declared renamed function).
//
// This file deliberately makes session_internal.h the very first header
// included, under PS_GBC_GENERATED_BUILD with a non-empty symbol prefix
// supplied by the fixture export in CMakeLists.txt. It then calls
// ps_gbc_board(), which puzzlescript/gbc.h declares and nothing else
// redeclares. If session_internal.h's own #include "puzzlescript/gbc.h"
// ever runs before generated_namespace.h again, that declaration gets
// captured unprefixed, while every subsequent occurrence of the
// ps_gbc_board token in this translation unit -- including this call -- is
// still macro-rewritten to the prefixed name. That is a hard compile error
// (call to an undeclared, implicitly-declared function), not a silent
// divergence: this file only needs to build and run to prove the header
// ordering is fixed.
#include "session_internal.h"

#include <stddef.h>
#include <stdio.h>

int main(void) {
    const void* board = ps_gbc_board(NULL);
    if (board != NULL) {
        fprintf(stderr, "ps_gbc_board(NULL) should return NULL\n");
        return 1;
    }
    return 0;
}
