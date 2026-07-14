#pragma once

#include <cstdint>

namespace pocket_card {

enum class Phase : uint8_t { Boot, LoadIr, CreateRuntime, LoadLevel, AmbientLed, InputTrace, Unload };

int64_t now_ms();
const char* phase_name(Phase phase);
void probe_log_init();
void emit_boot_summary();

// status and detail must be controlled, single-line constants: they are emitted as JSON strings.
void emit_phase(Phase phase, const char* status, const char* detail, int64_t elapsed_ms);

} // namespace pocket_card
