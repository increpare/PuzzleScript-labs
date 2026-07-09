#pragma once

#include <cstddef>
#include <cstdint>

#include "esp_err.h"

namespace ps_probe::board {

constexpr int kAudioSampleRate = 22050;

esp_err_t init_audio();
bool audio_ready();
esp_err_t play_pcm16_mono(const int16_t* samples, std::size_t sample_count);
void set_audio_volume(int volume_percent);

} // namespace ps_probe::board
