#include "ps_audio.hpp"

#include "board_audio.hpp"

#include "player/sfxr.hpp"

#include <algorithm>
#include <map>
#include <vector>
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

namespace ps_probe {
namespace {

constexpr const char* kTag = "ps_audio";
constexpr int kAudioQueueDepth = 4;
constexpr int kAudioTaskStackWords = 24576;

struct AudioRequest {
    int32_t seed = 0;
};

QueueHandle_t g_audio_queue = nullptr;
TaskHandle_t g_audio_task = nullptr;
std::map<int32_t, std::vector<int16_t>> g_pcm_cache;

const std::vector<int16_t>* pcm_from_seed(int32_t seed) {
    auto found = g_pcm_cache.find(seed);
    if (found != g_pcm_cache.end()) {
        return &found->second;
    }

    std::vector<float> floats;
    try {
        floats = puzzlescript::player::generateSfxrFromSeed(seed, board::kAudioSampleRate);
    } catch (const std::exception& ex) {
        ESP_LOGE(kTag, "sfxr synthesis failed for seed %ld: %s", static_cast<long>(seed), ex.what());
        return nullptr;
    } catch (...) {
        ESP_LOGE(kTag, "sfxr synthesis failed for seed %ld", static_cast<long>(seed));
        return nullptr;
    }

    if (floats.empty()) {
        return nullptr;
    }

    std::vector<int16_t> pcm(floats.size());
    for (std::size_t i = 0; i < floats.size(); ++i) {
        const float clamped = std::clamp(floats[i], -1.0f, 1.0f);
        pcm[i] = static_cast<int16_t>(clamped * 32767.0f);
    }

    auto inserted = g_pcm_cache.emplace(seed, std::move(pcm));
    return &inserted.first->second;
}

void audio_task_main(void*) {
    AudioRequest request{};
    while (true) {
        if (xQueueReceive(g_audio_queue, &request, portMAX_DELAY) != pdTRUE) {
            continue;
        }
        if (!board::audio_ready()) {
            continue;
        }

        const std::vector<int16_t>* pcm = pcm_from_seed(request.seed);
        if (pcm == nullptr || pcm->empty()) {
            continue;
        }

        ESP_LOGD(kTag, "playing seed %ld (%u samples)", static_cast<long>(request.seed), static_cast<unsigned>(pcm->size()));

        const std::size_t chunk = 512;
        for (std::size_t offset = 0; offset < pcm->size(); offset += chunk) {
            const std::size_t count = std::min(chunk, pcm->size() - offset);
            const esp_err_t err = board::play_pcm16_mono(pcm->data() + offset, count);
            if (err != ESP_OK) {
                ESP_LOGW(kTag, "playback failed for seed %ld: %s", static_cast<long>(request.seed), esp_err_to_name(err));
                break;
            }
        }
    }
}

void enqueue_seed(int32_t seed) {
    if (!board::audio_ready() || g_audio_queue == nullptr || seed == 0) {
        return;
    }
    const AudioRequest request{seed};
    if (xQueueSend(g_audio_queue, &request, 0) != pdTRUE) {
        ESP_LOGW(kTag, "audio queue full, dropping seed %ld", static_cast<long>(seed));
    }
}

void play_named_seed(const ps_game* game, const char* sound_name) {
    if (game == nullptr || sound_name == nullptr) {
        return;
    }
    int32_t seed = 0;
    if (ps_game_sound_seed(game, sound_name, &seed)) {
        enqueue_seed(seed);
    }
}

} // namespace

void player_audio_init() {
    if (g_audio_task != nullptr) {
        return;
    }

    const esp_err_t err = board::init_audio();
    if (err != ESP_OK) {
        ESP_LOGW(kTag, "board audio init failed: %s", esp_err_to_name(err));
        return;
    }

    g_audio_queue = xQueueCreate(kAudioQueueDepth, sizeof(AudioRequest));
    if (g_audio_queue == nullptr) {
        ESP_LOGE(kTag, "audio queue alloc failed");
        return;
    }

    if (xTaskCreate(audio_task_main, "ps_audio", kAudioTaskStackWords, nullptr, 3, &g_audio_task) != pdPASS) {
        ESP_LOGE(kTag, "audio task create failed");
        vQueueDelete(g_audio_queue);
        g_audio_queue = nullptr;
        return;
    }

    ESP_LOGI(kTag, "audio playback task ready");
}

void player_audio_play_named(const ps_game* game, const char* sound_name) {
    play_named_seed(game, sound_name);
}

void player_audio_play_step_events(const ps_step_result& result) {
    if (!board::audio_ready()) {
        return;
    }
    for (std::size_t i = 0; i < result.audio_event_count; ++i) {
        enqueue_seed(result.audio_events[i].seed);
    }
    for (std::size_t i = 0; i < result.ui_audio_event_count; ++i) {
        enqueue_seed(result.ui_audio_events[i].seed);
    }
}

} // namespace ps_probe
