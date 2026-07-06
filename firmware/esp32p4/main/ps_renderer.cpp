#include "ps_renderer.hpp"

#include <algorithm>
#include <cctype>
#include <cstddef>
#include <cstdlib>
#include <cstring>
#include <new>
#include <optional>
#include <vector>

#include "handheld/display_layout.hpp"
#include "probe_config.hpp"
#include "ps_framebuffer.hpp"

namespace ps_probe {
namespace {

constexpr int kNativeSpritePixels = 5;
constexpr std::size_t kMaxLayerCellEntries = 1024 * 1024;
constexpr uint16_t kMagenta = 0xF81F;
constexpr uint16_t kTransparent = 0;

struct ParsedColor {
    uint16_t value = kMagenta;
    bool transparent = false;
};

bool asciiEqualIgnoreCase(const char* a, const char* b) {
    if (a == nullptr || b == nullptr) {
        return false;
    }
    while (*a != '\0' && *b != '\0') {
        if (std::tolower(static_cast<unsigned char>(*a)) != std::tolower(static_cast<unsigned char>(*b))) {
            return false;
        }
        ++a;
        ++b;
    }
    return *a == '\0' && *b == '\0';
}

int hexValue(char ch) {
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

ParsedColor parseRgb565Color(const char* color) {
    if (color == nullptr || *color == '\0') {
        return ParsedColor{kMagenta, false};
    }
    if (asciiEqualIgnoreCase(color, "transparent")) {
        return ParsedColor{kTransparent, true};
    }
    if (color[0] == '#') {
        const std::size_t length = std::strlen(color + 1);
        if (length == 3) {
            const int r = hexValue(color[1]);
            const int g = hexValue(color[2]);
            const int b = hexValue(color[3]);
            if (r >= 0 && g >= 0 && b >= 0) {
                return ParsedColor{
                    rgb565(static_cast<uint8_t>((r << 4) | r), static_cast<uint8_t>((g << 4) | g), static_cast<uint8_t>((b << 4) | b)),
                    false};
            }
        }
        if (length == 6) {
            const int r0 = hexValue(color[1]);
            const int r1 = hexValue(color[2]);
            const int g0 = hexValue(color[3]);
            const int g1 = hexValue(color[4]);
            const int b0 = hexValue(color[5]);
            const int b1 = hexValue(color[6]);
            if (r0 >= 0 && r1 >= 0 && g0 >= 0 && g1 >= 0 && b0 >= 0 && b1 >= 0) {
                return ParsedColor{
                    rgb565(
                        static_cast<uint8_t>((r0 << 4) | r1),
                        static_cast<uint8_t>((g0 << 4) | g1),
                        static_cast<uint8_t>((b0 << 4) | b1)),
                    false};
            }
        }
        return ParsedColor{kMagenta, false};
    }

    struct NamedColor {
        const char* name;
        uint8_t r;
        uint8_t g;
        uint8_t b;
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
        if (asciiEqualIgnoreCase(color, named.name)) {
            return ParsedColor{rgb565(named.r, named.g, named.b), false};
        }
    }
    return ParsedColor{kMagenta, false};
}

void fillRect(uint16_t* pixels, int left, int top, int width, int height, uint16_t color) {
    if (width <= 0 || height <= 0) {
        return;
    }
    for (int y = 0; y < height; ++y) {
        uint16_t* row = pixels + static_cast<std::size_t>(top + y) * kNativeWidth + left;
        std::fill(row, row + width, color);
    }
}

std::optional<uint16_t> objectRepresentativeColor(const ps_game* game, int32_t objectId) {
    for (int sy = 0; sy < kNativeSpritePixels; ++sy) {
        for (int sx = 0; sx < kNativeSpritePixels; ++sx) {
            const int32_t colorIndex = ps_game_object_sprite_value(game, objectId, sx, sy);
            if (colorIndex < 0) {
                continue;
            }
            const ParsedColor color = parseRgb565Color(ps_game_object_color(game, objectId, static_cast<std::size_t>(colorIndex)));
            if (!color.transparent) {
                return color.value;
            }
        }
    }
    return std::nullopt;
}

bool checkedLayerCellCount(int width, int height, int layers, std::size_t* outCount) {
    if (outCount != nullptr) {
        *outCount = 0;
    }
    if (width <= 0 || height <= 0 || layers <= 0) {
        return false;
    }
    const std::size_t w = static_cast<std::size_t>(width);
    const std::size_t h = static_cast<std::size_t>(height);
    const std::size_t l = static_cast<std::size_t>(layers);
    if (w > kMaxLayerCellEntries / h) {
        return false;
    }
    const std::size_t cells = w * h;
    if (cells > kMaxLayerCellEntries / l) {
        return false;
    }
    const std::size_t total = cells * l;
    if (total > kMaxLayerCellEntries) {
        return false;
    }
    if (outCount != nullptr) {
        *outCount = total;
    }
    return true;
}

} // namespace

RenderResult render_level_to_native_framebuffer(
    const ps_game* game,
    const ps_full_state* state,
    uint16_t* native_pixels,
    int native_width,
    int native_height) {
    RenderResult result{false, 0, 0, 0, 0};
    if (game == nullptr || state == nullptr || native_pixels == nullptr
        || native_width != kNativeWidth || native_height != kNativeHeight) {
        return result;
    }

    try {
        ps_full_state_status_info status{};
        ps_full_state_status(state, &status);
        result.board_width = status.width;
        result.board_height = status.height;

        if (status.text_mode || status.width <= 0 || status.height <= 0) {
            fill_target_800x480_diagnostic(
                native_pixels,
                static_cast<std::size_t>(kNativeWidth) * static_cast<std::size_t>(kNativeHeight));
            result.ok = true;
            return result;
        }

        const int layerCount = ps_game_layer_count(game);
        std::size_t layerCellCount = 0;
        if (!checkedLayerCellCount(status.width, status.height, layerCount, &layerCellCount)) {
            return result;
        }

        std::vector<int32_t> layerCells(layerCellCount, -1);
        const std::size_t written = ps_full_state_layer_cell_object_ids(state, layerCells.data(), layerCells.size());
        if (written != layerCells.size()) {
            return result;
        }

        std::optional<puzzlescript::handheld::PlayerPosition> player;
        int32_t playerX = 0;
        int32_t playerY = 0;
        if (ps_full_state_first_player_position(state, &playerX, &playerY)) {
            player = puzzlescript::handheld::PlayerPosition{playerX, playerY};
        }

        const puzzlescript::handheld::LevelView level{
            status.width,
            status.height,
            puzzlescript::handheld::parseScreenSize(ps_game_metadata_value(game, "flickscreen")),
            puzzlescript::handheld::parseScreenSize(ps_game_metadata_value(game, "zoomscreen"))};
        const puzzlescript::handheld::Viewport viewport =
            puzzlescript::handheld::computeViewport(level, player, std::nullopt);
        const puzzlescript::handheld::FitResult fit =
            puzzlescript::handheld::computeFit(
                puzzlescript::handheld::DisplaySpec{kTargetWidth, kTargetHeight, kNativeSpritePixels},
                viewport);
        result.tile_pixels = fit.tilePixels;
        result.sprite_scale = fit.spriteScale;
        if (!fit.fits || fit.tilePixels <= 0) {
            return result;
        }

        const ParsedColor background = parseRgb565Color(ps_game_background_color(game));
        const uint16_t backgroundColor = background.transparent ? rgb565(0, 0, 0) : background.value;
        const uint16_t borderColor = rgb565(0, 0, 0);
        std::fill(
            native_pixels,
            native_pixels + static_cast<std::size_t>(kNativeWidth) * static_cast<std::size_t>(kNativeHeight),
            borderColor);

        const int targetX = (kNativeWidth - kTargetWidth) / 2;
        const int targetY = (kNativeHeight - kTargetHeight) / 2;
        fillRect(native_pixels, targetX, targetY, kTargetWidth, kTargetHeight, backgroundColor);

        const int boardX = targetX + fit.offsetX;
        const int boardY = targetY + fit.offsetY;
        const int minX = std::max(0, viewport.minX);
        const int minY = std::max(0, viewport.minY);
        const int maxX = std::min(status.width, viewport.maxX);
        const int maxY = std::min(status.height, viewport.maxY);

        for (int y = minY; y < maxY; ++y) {
            for (int x = minX; x < maxX; ++x) {
                const int cellLeft = boardX + (x - viewport.minX) * fit.tilePixels;
                const int cellTop = boardY + (y - viewport.minY) * fit.tilePixels;
                if (fit.degraded) {
                    uint16_t color = backgroundColor;
                    for (int layer = layerCount - 1; layer >= 0; --layer) {
                        const std::size_t offset =
                            static_cast<std::size_t>(layer) * static_cast<std::size_t>(status.width) * static_cast<std::size_t>(status.height)
                            + static_cast<std::size_t>(y) * static_cast<std::size_t>(status.width)
                            + static_cast<std::size_t>(x);
                        const int32_t objectId = layerCells[offset];
                        if (objectId >= 0) {
                            const std::optional<uint16_t> representative = objectRepresentativeColor(game, objectId);
                            if (representative.has_value()) {
                                color = *representative;
                                break;
                            }
                        }
                    }
                    fillRect(native_pixels, cellLeft, cellTop, fit.tilePixels, fit.tilePixels, color);
                    continue;
                }

                for (int layer = 0; layer < layerCount; ++layer) {
                    const std::size_t offset =
                        static_cast<std::size_t>(layer) * static_cast<std::size_t>(status.width) * static_cast<std::size_t>(status.height)
                        + static_cast<std::size_t>(y) * static_cast<std::size_t>(status.width)
                        + static_cast<std::size_t>(x);
                    const int32_t objectId = layerCells[offset];
                    if (objectId < 0) {
                        continue;
                    }
                    for (int sy = 0; sy < kNativeSpritePixels; ++sy) {
                        for (int sx = 0; sx < kNativeSpritePixels; ++sx) {
                            const int32_t colorIndex = ps_game_object_sprite_value(game, objectId, sx, sy);
                            if (colorIndex < 0) {
                                continue;
                            }
                            const ParsedColor color =
                                parseRgb565Color(ps_game_object_color(game, objectId, static_cast<std::size_t>(colorIndex)));
                            if (color.transparent) {
                                continue;
                            }
                            fillRect(
                                native_pixels,
                                cellLeft + sx * fit.spriteScale,
                                cellTop + sy * fit.spriteScale,
                                fit.spriteScale,
                                fit.spriteScale,
                                color.value);
                        }
                    }
                }
            }
        }

        result.ok = true;
        return result;
    } catch (const std::bad_alloc&) {
        return result;
    }
}

} // namespace ps_probe
