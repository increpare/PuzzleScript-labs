#pragma once

#include <cstdint>
#include <cstring>

// Ambient-light policy from docs/superpowers/specs/2026-07-12-puzzlescript-pocket-card-design.md:
// the onboard RGB LED mirrors the current game's declared background color at
// approximately half brightness, and is fully off when the background is black.
// Unparseable colors also resolve to off: an ambient light should fail dark.
//
// This header is pure C++ (no ESP-IDF dependencies) so the policy can be unit
// tested on the host; native/tests/ambient_light_policy_tests.cpp covers it.

namespace pocket_card {

struct AmbientColor {
    uint8_t red = 0;
    uint8_t green = 0;
    uint8_t blue = 0;

    constexpr bool is_off() const { return red == 0 && green == 0 && blue == 0; }
};

namespace ambient_detail {

inline bool ascii_equal_ignore_case(const char* a, const char* b) {
    while (*a != '\0' && *b != '\0') {
        char ca = *a;
        char cb = *b;
        if (ca >= 'A' && ca <= 'Z') {
            ca = static_cast<char>(ca - 'A' + 'a');
        }
        if (cb >= 'A' && cb <= 'Z') {
            cb = static_cast<char>(cb - 'A' + 'a');
        }
        if (ca != cb) {
            return false;
        }
        ++a;
        ++b;
    }
    return *a == '\0' && *b == '\0';
}

inline int hex_value(char ch) {
    if (ch >= '0' && ch <= '9') {
        return ch - '0';
    }
    if (ch >= 'a' && ch <= 'f') {
        return 10 + ch - 'a';
    }
    if (ch >= 'A' && ch <= 'F') {
        return 10 + ch - 'A';
    }
    return -1;
}

struct ParsedRgb {
    uint8_t red = 0;
    uint8_t green = 0;
    uint8_t blue = 0;
    bool valid = false;
};

// Accepts the same color forms the renderer accepts for background_color:
// #RGB, #RRGGBB, and the PuzzleScript (Arne) palette names.
inline ParsedRgb parse_background_color(const char* color) {
    if (color == nullptr || *color == '\0') {
        return {};
    }
    if (color[0] == '#') {
        const std::size_t length = std::strlen(color + 1);
        if (length == 3) {
            const int r = hex_value(color[1]);
            const int g = hex_value(color[2]);
            const int b = hex_value(color[3]);
            if (r >= 0 && g >= 0 && b >= 0) {
                return ParsedRgb{
                    static_cast<uint8_t>((r << 4) | r),
                    static_cast<uint8_t>((g << 4) | g),
                    static_cast<uint8_t>((b << 4) | b),
                    true};
            }
        }
        if (length == 6) {
            const int r0 = hex_value(color[1]);
            const int r1 = hex_value(color[2]);
            const int g0 = hex_value(color[3]);
            const int g1 = hex_value(color[4]);
            const int b0 = hex_value(color[5]);
            const int b1 = hex_value(color[6]);
            if (r0 >= 0 && r1 >= 0 && g0 >= 0 && g1 >= 0 && b0 >= 0 && b1 >= 0) {
                return ParsedRgb{
                    static_cast<uint8_t>((r0 << 4) | r1),
                    static_cast<uint8_t>((g0 << 4) | g1),
                    static_cast<uint8_t>((b0 << 4) | b1),
                    true};
            }
        }
        return {};
    }

    struct NamedColor {
        const char* name;
        uint8_t red;
        uint8_t green;
        uint8_t blue;
    };
    static constexpr NamedColor kArneColors[] = {
        {"black", 0x00, 0x00, 0x00},       {"white", 0xff, 0xff, 0xff},
        {"grey", 0x9d, 0x9d, 0x9d},        {"gray", 0x9d, 0x9d, 0x9d},
        {"darkgrey", 0x69, 0x71, 0x75},    {"darkgray", 0x69, 0x71, 0x75},
        {"lightgrey", 0xcc, 0xcc, 0xcc},   {"lightgray", 0xcc, 0xcc, 0xcc},
        {"red", 0xbe, 0x26, 0x33},         {"darkred", 0x73, 0x29, 0x30},
        {"lightred", 0xe0, 0x6f, 0x8b},    {"brown", 0xa4, 0x64, 0x22},
        {"darkbrown", 0x49, 0x3c, 0x2b},   {"lightbrown", 0xee, 0xb6, 0x2f},
        {"orange", 0xeb, 0x89, 0x31},      {"yellow", 0xf7, 0xe2, 0x6b},
        {"green", 0x44, 0x89, 0x1a},       {"darkgreen", 0x2f, 0x48, 0x4e},
        {"lightgreen", 0xa3, 0xce, 0x27},  {"blue", 0x1d, 0x57, 0xf7},
        {"darkblue", 0x1b, 0x26, 0x32},    {"lightblue", 0xb2, 0xdc, 0xef},
        {"purple", 0x34, 0x2a, 0x97},      {"pink", 0xde, 0x65, 0xe2},
    };
    for (const NamedColor& named : kArneColors) {
        if (ascii_equal_ignore_case(color, named.name)) {
            return ParsedRgb{named.red, named.green, named.blue, true};
        }
    }
    return {};
}

// Round-to-nearest halving keeps very dark (but non-black) backgrounds from
// silently extinguishing the LED at channel value 1.
inline uint8_t half_brightness(uint8_t channel) {
    return static_cast<uint8_t>((channel + 1) / 2);
}

} // namespace ambient_detail

inline AmbientColor ambient_color_for_background(const char* background_color) {
    const ambient_detail::ParsedRgb parsed = ambient_detail::parse_background_color(background_color);
    if (!parsed.valid) {
        return {};
    }
    if (parsed.red == 0 && parsed.green == 0 && parsed.blue == 0) {
        return {};
    }
    return AmbientColor{
        ambient_detail::half_brightness(parsed.red),
        ambient_detail::half_brightness(parsed.green),
        ambient_detail::half_brightness(parsed.blue)};
}

} // namespace pocket_card
