#pragma once

#include <cstdint>

namespace ps_probe {

enum class Phase : uint8_t {
    Boot,
    DisplayInit,
    StorageInit,
    LoadSourceFlash,
    CompileSource,
    CreateRuntime,
    LoadLevel,
    RenderFrame,
    RunInputTrace,
    UnloadGame,
    LoadSourceSd,
    SimulationCorpus,
};

struct FramebufferPolicy {
    const char* mode;
    int width;
    int height;
    int buffer_count;
    int bytes_per_pixel;
};

class PhaseTimer {
public:
    explicit PhaseTimer(Phase phase);
    int64_t elapsed_ms() const;

private:
    Phase phase_;
    int64_t start_us_;
};

const char* phase_name(Phase phase);
void instrumentation_init();
void set_active_phase(Phase phase);
void set_active_source(const char* source);
void set_framebuffer_policy(const FramebufferPolicy& policy);
void emit_phase_result(Phase phase, const char* status, const char* detail, int64_t elapsed_ms);
void emit_boot_summary();
void emit_json_event(const char* json);

} // namespace ps_probe
