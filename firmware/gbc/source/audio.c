#pragma bank 1

#include <gb/gb.h>

#include "audio.h"
#include "generated_game.h"

#if defined(PS_GBC_AUTOTEST)
uint16_t gAudioPlayCount;
int32_t gAudioLastSeed;
#endif

static uint8_t gPulseChannel;

void audioInitialize(void) BANKED {
    NR52_REG = AUDENA_ON;
    NR50_REG = (uint8_t)(AUDVOL_VOL_LEFT(7U) | AUDVOL_VOL_RIGHT(7U));
    NR51_REG = (uint8_t)(
        AUDTERM_1_LEFT | AUDTERM_1_RIGHT
        | AUDTERM_2_LEFT | AUDTERM_2_RIGHT
        | AUDTERM_4_LEFT | AUDTERM_4_RIGHT);
    NR10_REG = 0U;
    NR12_REG = 0U;
    NR22_REG = 0U;
    NR42_REG = 0U;
    gPulseChannel = 0U;
#if defined(PS_GBC_AUTOTEST)
    gAudioPlayCount = 0U;
    gAudioLastSeed = 0;
#endif
}

void audioPlaySeed(int32_t seed) BANKED {
    const uint32_t value = (uint32_t)seed;
    const uint8_t family = (uint8_t)(value & 7U);
    const uint8_t duty = (uint8_t)((value >> 5U) & 3U);
    const uint8_t length = (uint8_t)(8U + ((value >> 11U) & 15U));
    const uint8_t volume = (uint8_t)(11U + ((value >> 17U) & 3U));
    const uint8_t envelope = (uint8_t)(1U + ((value >> 21U) & 3U));
    const uint16_t frequency = (uint16_t)(1050U + ((value >> 7U) & 0x02ffU));
#if defined(PS_GBC_AUTOTEST)
    ++gAudioPlayCount;
    gAudioLastSeed = seed;
#endif
    /*
     * PuzzleScript seeds normally drive SFXR. The GBC cannot afford PCM
     * samples, so map the same deterministic seed to its pulse/noise APU.
     * Alternating pulse channels allows two rapid events to overlap.
     */
    if (family == 2U || family == 3U || family == 6U || family == 7U) {
        NR41_REG = length;
        NR42_REG = (uint8_t)((volume << 4U) | envelope);
        NR43_REG = (uint8_t)(
            (((value >> 25U) & 7U) << 4U)
            | ((family & 1U) != 0U ? AUD4POLY_WIDTH_7BIT : AUD4POLY_WIDTH_15BIT)
            | ((value >> 2U) & 7U));
        NR44_REG = 0xc0U;
    } else if (gPulseChannel == 0U) {
        NR10_REG = (uint8_t)(
            (((value >> 27U) & 3U) << 4U)
            | ((family & 1U) != 0U ? AUD1SWEEP_DOWN : AUD1SWEEP_UP)
            | (1U + ((value >> 29U) & 3U)));
        NR11_REG = (uint8_t)((duty << 6U) | length);
        NR12_REG = (uint8_t)((volume << 4U) | envelope);
        NR13_REG = (uint8_t)frequency;
        NR14_REG = (uint8_t)(0xc0U | (frequency >> 8U));
        gPulseChannel = 1U;
    } else {
        NR21_REG = (uint8_t)((duty << 6U) | length);
        NR22_REG = (uint8_t)((volume << 4U) | envelope);
        NR23_REG = (uint8_t)frequency;
        NR24_REG = (uint8_t)(0xc0U | (frequency >> 8U));
        gPulseChannel = 0U;
    }
}

void audioPlayEvents(const ps_step_result* result) BANKED {
    size_t index;
    if (result == NULL) return;
    if (result->audio_event_count <= PS_GBC_MAX_AUDIO_EVENTS) {
        for (index = 0U; index < result->audio_event_count; ++index) {
            audioPlaySeed(result->audio_events[index].seed);
        }
    }
    if (result->ui_audio_event_count <= PS_GBC_MAX_AUDIO_EVENTS) {
        for (index = 0U; index < result->ui_audio_event_count; ++index) {
            audioPlaySeed(result->ui_audio_events[index].seed);
        }
    }
}

void audioPlayNamed(ps_gbc_named_sound sound) BANKED {
    uint8_t sound_id;
    if (sound >= PS_GBC_NAMED_SOUND_COUNT) return;
    sound_id = ps_gbc_generated_game.named_sound_ids[sound];
    if (sound_id == PS_GBC_NO_SOUND
        || sound_id >= ps_gbc_generated_game.sound_count) return;
    audioPlaySeed(ps_gbc_generated_game.sound_seeds[sound_id]);
}
