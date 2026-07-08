#include "ps_dot_font.hpp"

#include <algorithm>
#include <cctype>
#include <map>
#include <string>
#include <vector>

#include "esp_log.h"

namespace ps_probe {
namespace {

constexpr const char* kTag = "ps_dot_font";

extern const uint8_t _binary_font_js_start[] asm("_binary_font_js_start");
extern const uint8_t _binary_font_js_end[] asm("_binary_font_js_end");

using GlyphRows = std::vector<std::string>;

std::map<char, GlyphRows> g_glyphs;
bool g_ready = false;

std::string trim_line(std::string value) {
    while (!value.empty() && std::isspace(static_cast<unsigned char>(value.front())) != 0) {
        value.erase(value.begin());
    }
    while (!value.empty() && std::isspace(static_cast<unsigned char>(value.back())) != 0) {
        value.pop_back();
    }
    return value;
}

bool parse_font_js(const char* data, std::size_t size) {
    const char* cur = data;
    const char* end = data + size;
    std::string line;

    auto read_line = [&]() {
        line.clear();
        while (cur < end && *cur != '\n' && *cur != '\r') {
            line.push_back(*cur++);
        }
        while (cur < end && (*cur == '\n' || *cur == '\r')) {
            ++cur;
        }
    };

    while (cur < end) {
        read_line();
        if (line.empty()) {
            continue;
        }

        const std::size_t q1 = line.find('\'');
        if (q1 == std::string::npos) {
            continue;
        }
        const std::size_t q2 = line.find('\'', q1 + 1);
        if (q2 == std::string::npos || q2 != q1 + 2) {
            continue;
        }
        if (line.find('`', q2) == std::string::npos) {
            continue;
        }

        const char key = line[q1 + 1];
        GlyphRows rows;
        while (cur < end) {
            read_line();
            if (line.empty()) {
                continue;
            }
            const std::size_t end_tick = line.find('`');
            if (end_tick != std::string::npos) {
                const std::string row = trim_line(line.substr(0, end_tick));
                if (!row.empty()) {
                    rows.push_back(row);
                }
                break;
            }
            const std::string row = trim_line(line);
            if (!row.empty()) {
                rows.push_back(row);
            }
        }

        if (!rows.empty()) {
            g_glyphs[key] = std::move(rows);
        }
    }

    return !g_glyphs.empty();
}

const GlyphRows* lookup_glyph(char ch) {
    auto it = g_glyphs.find(ch);
    if (it != g_glyphs.end()) {
        return &it->second;
    }
    const char lower = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    it = g_glyphs.find(lower);
    if (it != g_glyphs.end()) {
        return &it->second;
    }
    return nullptr;
}

} // namespace

bool dot_font_init() {
    if (g_ready) {
        return true;
    }

    g_glyphs.clear();
    const std::size_t font_size =
        static_cast<std::size_t>(_binary_font_js_end - _binary_font_js_start);
    if (!parse_font_js(reinterpret_cast<const char*>(_binary_font_js_start), font_size)) {
        ESP_LOGW(kTag, "font.js parse failed, using minimal fallback");
        g_glyphs['X'] = {
            "10001", "01010", "00100", "00100", "00100", "00100",
            "00100", "00100", "00100", "01010", "10001", "00000"};
    } else {
        ESP_LOGI(kTag, "loaded %u glyphs from font.js (%u bytes)", static_cast<unsigned>(g_glyphs.size()), static_cast<unsigned>(font_size));
    }

    g_ready = true;
    return true;
}

bool dot_font_ready() {
    return g_ready;
}

void dot_font_draw_glyph(
    uint16_t* pixels,
    int width,
    int height,
    int x,
    int y,
    char ch,
    uint16_t color,
    int scale_x,
    int scale_y) {
    if (!g_ready || pixels == nullptr || scale_x <= 0 || scale_y <= 0) {
        return;
    }
    const GlyphRows* glyph = lookup_glyph(ch);
    if (glyph == nullptr) {
        return;
    }
    for (int row = 0; row < static_cast<int>(glyph->size()); ++row) {
        const std::string& row_data = (*glyph)[static_cast<std::size_t>(row)];
        for (int col = 0; col < static_cast<int>(row_data.size()); ++col) {
            if (row_data[static_cast<std::size_t>(col)] != '1') {
                continue;
            }
            for (int sy = 0; sy < scale_y; ++sy) {
                for (int sx = 0; sx < scale_x; ++sx) {
                    const int px = x + col * scale_x + sx;
                    const int py = y + row * scale_y + sy;
                    if (px < 0 || py < 0 || px >= width || py >= height) {
                        continue;
                    }
                    pixels[py * width + px] = color;
                }
            }
        }
    }
}

} // namespace ps_probe
