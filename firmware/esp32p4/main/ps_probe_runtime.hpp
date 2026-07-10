#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace ps_probe {

struct SourceProbeInput {
    const char* name;
    const char* text;
    std::size_t size;
    bool render;
    bool run_input_trace;
};

void run_embedded_sokoban_probe(uint16_t* framebuffer);
void run_embedded_broken_probe();
void run_sd_probe_if_available(uint16_t* framebuffer);
void run_named_sd_probe_if_available(const char* basename, uint16_t* framebuffer);

} // namespace ps_probe
