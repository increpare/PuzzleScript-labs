#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace ps_probe {

struct EmbeddedGameBlob {
    const char* display_name;
    const char* source_name;
    const uint8_t* data;
    std::size_t size;
};

std::vector<EmbeddedGameBlob> list_embedded_games();

} // namespace ps_probe
