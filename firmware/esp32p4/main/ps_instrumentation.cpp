#include "ps_instrumentation.hpp"

#include <cinttypes>
#include <cstddef>
#include <cstring>

#include "esp_chip_info.h"
#include "esp_err.h"
#include "esp_flash.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "probe_config.hpp"

namespace ps_probe {
namespace {

constexpr const char* kTag = "ps_probe";
constexpr size_t kJsonStringBufferBytes = 256;
constexpr size_t kActiveSourceBufferBytes = 256;
Phase g_active_phase = Phase::Boot;
char g_active_source[kActiveSourceBufferBytes]{};
FramebufferPolicy g_framebuffer_policy{"none", 0, 0, 0, 2};

class EscapedJsonString {
public:
    explicit EscapedJsonString(const char* value) {
        append(value == nullptr ? "" : value);
    }

    const char* c_str() const {
        return buffer_;
    }

private:
    void append(const char* value) {
        static constexpr char kHex[] = "0123456789ABCDEF";
        size_t out = 0;
        for (const unsigned char* cursor = reinterpret_cast<const unsigned char*>(value); *cursor != '\0'; ++cursor) {
            const unsigned char ch = *cursor;
            const char* replacement = nullptr;
            size_t replacement_len = 0;
            char control_escape[6]{'\\', 'u', '0', '0', kHex[ch >> 4], kHex[ch & 0x0f]};

            switch (ch) {
                case '"': replacement = "\\\""; replacement_len = 2; break;
                case '\\': replacement = "\\\\"; replacement_len = 2; break;
                case '\n': replacement = "\\n"; replacement_len = 2; break;
                case '\r': replacement = "\\r"; replacement_len = 2; break;
                case '\t': replacement = "\\t"; replacement_len = 2; break;
                default:
                    if (ch < 0x20) {
                        replacement = control_escape;
                        replacement_len = sizeof(control_escape);
                    }
                    break;
            }

            if (replacement != nullptr) {
                if (out + replacement_len >= sizeof(buffer_)) {
                    break;
                }
                for (size_t i = 0; i < replacement_len; ++i) {
                    buffer_[out++] = replacement[i];
                }
            } else {
                if (out + 1 >= sizeof(buffer_)) {
                    break;
                }
                buffer_[out++] = static_cast<char>(ch);
            }
        }
        buffer_[out] = '\0';
    }

    char buffer_[kJsonStringBufferBytes]{};
};

void append_heap(const char* name, uint32_t caps) {
    multi_heap_info_t info{};
    heap_caps_get_info(&info, caps);
    const EscapedJsonString escaped_source(g_active_source);
    ESP_LOGI(kTag,
             "{\"event\":\"heap\",\"phase\":\"%s\",\"source\":\"%s\",\"region\":\"%s\",\"free\":%zu,\"allocated\":%zu,\"largest_free_block\":%zu,\"minimum_free\":%zu,\"allocated_blocks\":%zu,\"free_blocks\":%zu,\"total_blocks\":%zu}",
             phase_name(g_active_phase),
             escaped_source.c_str(),
             name,
             info.total_free_bytes,
             info.total_allocated_bytes,
             info.largest_free_block,
             info.minimum_free_bytes,
             info.allocated_blocks,
             info.free_blocks,
             info.total_blocks);
}

void alloc_failed_hook(size_t requested_size, uint32_t caps, const char* function_name) {
    ESP_EARLY_LOGE(
        kTag,
        "alloc_failed phase=%s requested=%lu caps=%" PRIu32 " fn=%s",
        phase_name(g_active_phase),
        static_cast<unsigned long>(requested_size),
        caps,
        function_name != nullptr ? function_name : "?");
}

} // namespace

PhaseTimer::PhaseTimer(Phase phase) : phase_(phase), start_us_(esp_timer_get_time()) {
    set_active_phase(phase_);
}

int64_t PhaseTimer::elapsed_ms() const {
    return (esp_timer_get_time() - start_us_) / 1000;
}

const char* phase_name(Phase phase) {
    switch (phase) {
        case Phase::Boot: return "BOOT";
        case Phase::DisplayInit: return "DISPLAY_INIT";
        case Phase::StorageInit: return "STORAGE_INIT";
        case Phase::LoadSourceFlash: return "LOAD_SOURCE_FLASH";
        case Phase::CompileSource: return "COMPILE_SOURCE";
        case Phase::CreateRuntime: return "CREATE_RUNTIME";
        case Phase::LoadLevel: return "LOAD_LEVEL";
        case Phase::RenderFrame: return "RENDER_FRAME";
        case Phase::RunInputTrace: return "RUN_INPUT_TRACE";
        case Phase::UnloadGame: return "UNLOAD_GAME";
        case Phase::LoadSourceSd: return "LOAD_SOURCE_SD";
        case Phase::SimulationCorpus: return "SIMULATION_CORPUS";
    }
    return "UNKNOWN";
}

void instrumentation_init() {
    heap_caps_register_failed_alloc_callback(alloc_failed_hook);
}

void set_active_phase(Phase phase) {
    g_active_phase = phase;
}

void set_active_source(const char* source) {
    const char* value = source == nullptr ? "" : source;
    std::strncpy(g_active_source, value, sizeof(g_active_source) - 1);
    g_active_source[sizeof(g_active_source) - 1] = '\0';
}

void set_framebuffer_policy(const FramebufferPolicy& policy) {
    g_framebuffer_policy = policy;
}

void emit_phase_result(Phase phase, const char* status, const char* detail, int64_t elapsed_ms) {
    set_active_phase(phase);
    const EscapedJsonString escaped_status(status);
    const EscapedJsonString escaped_source(g_active_source);
    const EscapedJsonString escaped_detail(detail);
    const EscapedJsonString escaped_fb_mode(g_framebuffer_policy.mode);
    ESP_LOGI(kTag,
             "{\"event\":\"phase\",\"phase\":\"%s\",\"source\":\"%s\",\"status\":\"%s\",\"detail\":\"%s\",\"elapsed_ms\":%" PRId64 ",\"fb_mode\":\"%s\",\"fb_width\":%d,\"fb_height\":%d,\"fb_count\":%d,\"fb_bpp\":%d}",
             phase_name(phase),
             escaped_source.c_str(),
             escaped_status.c_str(),
             escaped_detail.c_str(),
             elapsed_ms,
             escaped_fb_mode.c_str(),
             g_framebuffer_policy.width,
             g_framebuffer_policy.height,
             g_framebuffer_policy.buffer_count,
             g_framebuffer_policy.bytes_per_pixel);
    append_heap("internal", MALLOC_CAP_INTERNAL);
    append_heap("spiram", MALLOC_CAP_SPIRAM);
    append_heap("8bit", MALLOC_CAP_8BIT);
}

void emit_boot_summary() {
    esp_chip_info_t chip{};
    esp_chip_info(&chip);
    uint32_t flash_size = 0;
    const esp_err_t flash_probe = esp_flash_get_size(nullptr, &flash_size);
    const EscapedJsonString escaped_flash_status(flash_probe == ESP_OK ? "ok" : esp_err_to_name(flash_probe));
    const EscapedJsonString escaped_idf(esp_get_idf_version());
    ESP_LOGI(kTag,
             "{\"event\":\"boot\",\"cores\":%d,\"revision\":%d,\"flash_bytes\":%" PRIu32 ",\"flash_status\":\"%s\",\"target_width\":%d,\"target_height\":%d,\"idf\":\"%s\",\"reset_reason\":%d}",
             chip.cores,
             chip.revision,
             flash_size,
             escaped_flash_status.c_str(),
             kTargetWidth,
             kTargetHeight,
             escaped_idf.c_str(),
             static_cast<int>(esp_reset_reason()));
}

void emit_json_event(const char* json) {
    if (json == nullptr) {
        return;
    }
    ESP_LOGI(kTag, "%s", json);
}

} // namespace ps_probe
