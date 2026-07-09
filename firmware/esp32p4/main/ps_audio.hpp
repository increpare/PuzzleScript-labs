#pragma once

#include "puzzlescript/puzzlescript.h"

namespace ps_probe {

void player_audio_init();
void player_audio_play_named(const ps_game* game, const char* sound_name);
void player_audio_play_step_events(const ps_step_result& result);

} // namespace ps_probe
