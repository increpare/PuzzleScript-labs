#include "ps_ui_draw.hpp"

#include <algorithm>
#include <cctype>
#include <cstring>

namespace ps_probe {
namespace {

constexpr uint16_t kUiBackground = 0x1082;
constexpr uint16_t kUiText = 0xFFFF;
constexpr uint16_t kUiAccent = 0x34BF;

// 5x7 font columns for: " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-"
static const char kFontChars[] = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-";
static const uint8_t kFontRows[][5] = {
    {0x00, 0x00, 0x00, 0x00, 0x00},             // space
    {0x7C, 0x12, 0x11, 0x12, 0x7C},             // A
    {0x7F, 0x49, 0x49, 0x49, 0x36},             // B
    {0x3E, 0x41, 0x41, 0x41, 0x22},             // C
    {0x7F, 0x41, 0x41, 0x22, 0x1C},             // D
    {0x7F, 0x49, 0x49, 0x49, 0x41},             // E
    {0x7F, 0x09, 0x09, 0x09, 0x01},             // F
    {0x3E, 0x41, 0x41, 0x51, 0x72},             // G
    {0x7F, 0x08, 0x08, 0x08, 0x7F},             // H
    {0x00, 0x41, 0x7F, 0x41, 0x00},             // I
    {0x20, 0x40, 0x41, 0x3F, 0x01},             // J
    {0x7F, 0x08, 0x14, 0x22, 0x41},             // K
    {0x7F, 0x40, 0x40, 0x40, 0x40},             // L
    {0x7F, 0x02, 0x0C, 0x02, 0x7F},             // M
    {0x7F, 0x04, 0x08, 0x10, 0x7F},             // N
    {0x3E, 0x41, 0x41, 0x41, 0x3E},             // O
    {0x7F, 0x09, 0x09, 0x09, 0x06},             // P
    {0x3E, 0x41, 0x51, 0x21, 0x5E},             // Q
    {0x7F, 0x09, 0x19, 0x29, 0x46},             // R
    {0x46, 0x49, 0x49, 0x49, 0x31},             // S
    {0x01, 0x01, 0x7F, 0x01, 0x01},             // T
    {0x3F, 0x40, 0x40, 0x40, 0x3F},             // U
    {0x1F, 0x20, 0x40, 0x20, 0x1F},             // V
    {0x3F, 0x40, 0x38, 0x40, 0x3F},             // W
    {0x63, 0x14, 0x08, 0x14, 0x63},             // X
    {0x07, 0x08, 0x70, 0x08, 0x07},             // Y
    {0x61, 0x51, 0x49, 0x45, 0x43},             // Z
    {0x3E, 0x51, 0x49, 0x45, 0x3E},             // 0
    {0x00, 0x42, 0x7F, 0x40, 0x00},             // 1
    {0x42, 0x61, 0x51, 0x49, 0x46},             // 2
    {0x21, 0x41, 0x45, 0x4B, 0x31},             // 3
    {0x18, 0x14, 0x12, 0x7F, 0x10},             // 4
    {0x27, 0x45, 0x45, 0x45, 0x39},             // 5
    {0x3C, 0x4A, 0x49, 0x49, 0x30},             // 6
    {0x01, 0x71, 0x09, 0x05, 0x03},             // 7
    {0x36, 0x49, 0x49, 0x49, 0x36},             // 8
    {0x06, 0x49, 0x49, 0x29, 0x1E},             // 9
    {0x00, 0x00, 0x60, 0x60, 0x00},             // .
    {0x00, 0x00, 0x5F, 0x00, 0x00},             // -
};

const uint8_t* lookup_glyph(char ch) {
    if (ch >= 'a' && ch <= 'z') {
        ch = static_cast<char>(std::toupper(static_cast<unsigned char>(ch)));
    }
    const char* found = std::strchr(kFontChars, ch);
    if (found == nullptr) {
        found = std::strchr(kFontChars, '?');
        if (found == nullptr) {
            return kFontRows[0];
        }
        ch = '?';
        found = std::strchr(kFontChars, ch);
    }
    const std::size_t index = static_cast<std::size_t>(found - kFontChars);
    static_assert(sizeof(kFontChars) - 1 == sizeof(kFontRows) / sizeof(kFontRows[0]), "font table size mismatch");
    if (index >= sizeof(kFontRows) / sizeof(kFontRows[0])) {
        return kFontRows[0];
    }
    return kFontRows[index];
}

void set_pixel(uint16_t* pixels, int width, int height, int x, int y, uint16_t color) {
    if (x < 0 || y < 0 || x >= width || y >= height) {
        return;
    }
    pixels[y * width + x] = color;
}

uint16_t blend_rgb565(uint16_t bg, uint16_t fg, uint8_t alpha) {
    const uint8_t beta = static_cast<uint8_t>(4 - alpha);
    const uint32_t blended =
        ((((bg & 0xF81F) * beta + (fg & 0xF81F) * alpha) >> 2) & 0xF81F)
        | ((((bg & 0x07E0) * beta + (fg & 0x07E0) * alpha) >> 2) & 0x07E0);
    return static_cast<uint16_t>(blended);
}

} // namespace

void ui_fill_rect(uint16_t* pixels, int width, int height, int x, int y, int w, int h, uint16_t color) {
    const int x1 = std::max(0, x);
    const int y1 = std::max(0, y);
    const int x2 = std::min(width, x + w);
    const int y2 = std::min(height, y + h);
    for (int row = y1; row < y2; ++row) {
        for (int col = x1; col < x2; ++col) {
            pixels[row * width + col] = color;
        }
    }
}

void ui_dim_rect(uint16_t* pixels, int width, int height, int x, int y, int w, int h, uint16_t tint, int strength) {
    const int strength_clamped = std::max(1, std::min(strength, 3));
    const int x1 = std::max(0, x);
    const int y1 = std::max(0, y);
    const int x2 = std::min(width, x + w);
    const int y2 = std::min(height, y + h);
    for (int row = y1; row < y2; ++row) {
        uint16_t* row_pixels = pixels + row * width;
        for (int col = x1; col < x2; ++col) {
            row_pixels[col] = blend_rgb565(row_pixels[col], tint, static_cast<uint8_t>(strength_clamped));
        }
    }
}

void ui_draw_text(uint16_t* pixels, int width, int height, int x, int y, const char* text, uint16_t color, int scale) {
    if (text == nullptr) {
        return;
    }
    int cursor_x = x;
    for (const char* ch = text; *ch != '\0'; ++ch) {
        const uint8_t* glyph = lookup_glyph(*ch);
        for (int col = 0; col < 5; ++col) {
            const uint8_t column = glyph[col];
            for (int row = 0; row < 7; ++row) {
                if ((column & (1U << row)) == 0) {
                    continue;
                }
                for (int sy = 0; sy < scale; ++sy) {
                    for (int sx = 0; sx < scale; ++sx) {
                        set_pixel(
                            pixels,
                            width,
                            height,
                            cursor_x + col * scale + sx,
                            y + row * scale + sy,
                            color);
                    }
                }
            }
        }
        cursor_x += 6 * scale;
    }
}

void ui_draw_centered_text(
    uint16_t* pixels,
    int width,
    int height,
    int y,
    const char* text,
    uint16_t color,
    int scale) {
    if (text == nullptr) {
        return;
    }
    const int text_width = static_cast<int>(std::strlen(text)) * 6 * scale;
    const int x = std::max(0, (width - text_width) / 2);
    ui_draw_text(pixels, width, height, x, y, text, color, scale);
}

} // namespace ps_probe
