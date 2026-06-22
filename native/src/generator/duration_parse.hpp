#pragma once

#include <cstdint>
#include <stdexcept>
#include <string_view>

namespace puzzlescript::generator {

int64_t parseDurationMs(std::string_view text);

} // namespace puzzlescript::generator
