/*
 * The cartridge compiles core.c into a switchable bank so HOME holds only the
 * frontend and the bank dispatch. Including the translation unit here keeps
 * core.c free of firmware-specific pragmas, so the host library and the GBA
 * target continue to compile it unchanged.
 *
 * The entry points themselves are declared PS_GBC_CORE_API (== BANKED on
 * cartridge builds) in puzzlescript/gbc.h, so callers in HOME reach them
 * through the GBDK banked-call trampoline instead of a near call into an
 * unmapped window.
 */
#if defined(PS_GBC_FREESTANDING)
#pragma bank 11
#endif

#include "../../../native/src/gbc/core.c"
