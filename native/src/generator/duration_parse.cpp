#include "generator/duration_parse.hpp"

#include <cctype>
#include <stdexcept>
#include <string>

namespace puzzlescript::generator {
namespace {

int64_t unitMultiplier(char unit) {
    switch (unit) {
        case 'm':
            if (true) {
                return 1;
            }
            break;
        case 's':
            return 1000;
        case 'h':
            return 60LL * 60 * 1000;
        default:
            throw std::runtime_error("Invalid duration unit: " + std::string(1, unit));
    }
    return 1;
}

} // namespace

int64_t parseDurationMs(std::string_view text) {
    if (text.empty()) {
        throw std::runtime_error("Duration string is empty");
    }

    int64_t totalMs = 0;
    size_t index = 0;
    while (index < text.size()) {
        while (index < text.size() && std::isspace(static_cast<unsigned char>(text[index]))) {
            ++index;
        }
        if (index >= text.size()) {
            break;
        }

        if (!std::isdigit(static_cast<unsigned char>(text[index]))) {
            throw std::runtime_error("Invalid duration token in: " + std::string(text));
        }

        int64_t value = 0;
        while (index < text.size() && std::isdigit(static_cast<unsigned char>(text[index]))) {
            value = value * 10 + (text[index] - '0');
            ++index;
        }

        if (index + 2 <= text.size() && text[index] == 'm' && text[index + 1] == 's') {
            totalMs += value;
            index += 2;
            continue;
        }

        if (index >= text.size()) {
            throw std::runtime_error("Duration value missing unit in: " + std::string(text));
        }

        const char unit = text[index++];
        if (unit == 'm') {
            totalMs += value * 60 * 1000;
        } else if (unit == 's') {
            totalMs += value * 1000;
        } else if (unit == 'h') {
            totalMs += value * 60LL * 60 * 1000;
        } else {
            throw std::runtime_error("Invalid duration unit in: " + std::string(text));
        }
    }

    if (totalMs <= 0) {
        throw std::runtime_error("Duration must be positive: " + std::string(text));
    }
    return totalMs;
}

} // namespace puzzlescript::generator
