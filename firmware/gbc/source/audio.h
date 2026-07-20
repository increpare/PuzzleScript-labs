#ifndef PUZZLESCRIPT_GBC_AUDIO_H
#define PUZZLESCRIPT_GBC_AUDIO_H

#include <gb/gb.h>

#include "puzzlescript/gbc.h"

void audioInitialize(void) BANKED;
void audioPlaySeed(int32_t seed) BANKED;
void audioPlayEvents(const ps_step_result* result) BANKED;
void audioPlayNamed(ps_gbc_named_sound sound) BANKED;

#if defined(PS_GBC_AUTOTEST)
extern uint16_t gAudioPlayCount;
extern int32_t gAudioLastSeed;
#endif

#endif
