#include "handheld/display_layout.hpp"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <sstream>
#include <string_view>

namespace puzzlescript::handheld {
namespace {

int clampInt(int value, int low, int high) {
    return std::max(low, std::min(value, high));
}

int positiveOrOne(int value) {
    return std::max(1, value);
}

int drawMax(int minValue, int size, int levelSize) {
    return std::min(minValue + size, levelSize);
}

} // namespace

std::optional<ScreenSize> parseScreenSize(const char* value) {
    if (value == nullptr || *value == '\0') {
        return std::nullopt;
    }
    std::string text(value);
    text.erase(
        std::remove_if(text.begin(), text.end(), [](unsigned char ch) {
            return std::isspace(ch) != 0;
        }),
        text.end());
    const size_t separator = text.find_first_of("xX");
    if (separator == std::string::npos || separator == 0 || separator + 1 >= text.size()) {
        return std::nullopt;
    }
    const std::string widthText = text.substr(0, separator);
    const std::string heightText = text.substr(separator + 1);
    char* endA = nullptr;
    char* endB = nullptr;
    const long parsedW = std::strtol(widthText.c_str(), &endA, 10);
    const long parsedH = std::strtol(heightText.c_str(), &endB, 10);
    if ((endA != nullptr && *endA != '\0') || (endB != nullptr && *endB != '\0')) {
        return std::nullopt;
    }
    if (parsedW <= 0 || parsedH <= 0 || parsedW > 100000 || parsedH > 100000) {
        return std::nullopt;
    }
    return ScreenSize{static_cast<int>(parsedW), static_cast<int>(parsedH)};
}

Viewport computeViewport(
    const LevelView& level,
    std::optional<PlayerPosition> player,
    std::optional<Viewport> previousViewport) {
    const int levelW = positiveOrOne(level.width);
    const int levelH = positiveOrOne(level.height);
    const std::optional<ScreenSize> screen = level.flickscreen.has_value()
        ? level.flickscreen
        : level.zoomscreen;
    if (!screen.has_value()) {
        return Viewport{"full", 0, 0, levelW, levelH, levelW, levelH};
    }

    const int viewW = positiveOrOne(screen->width);
    const int viewH = positiveOrOne(screen->height);
    const std::string mode = level.flickscreen.has_value() ? "flickscreen" : "zoomscreen";

    if (!player.has_value()) {
        if (previousViewport.has_value()) {
            const int minX = clampInt(previousViewport->minX, 0, levelW);
            const int minY = clampInt(previousViewport->minY, 0, levelH);
            const int fallbackMaxX = drawMax(minX, viewW, levelW);
            const int fallbackMaxY = drawMax(minY, viewH, levelH);
            const int previousMaxX = previousViewport->maxX > previousViewport->minX
                ? previousViewport->maxX
                : fallbackMaxX;
            const int previousMaxY = previousViewport->maxY > previousViewport->minY
                ? previousViewport->maxY
                : fallbackMaxY;
            return Viewport{
                mode,
                minX,
                minY,
                viewW,
                viewH,
                clampInt(previousMaxX, minX, levelW),
                clampInt(previousMaxY, minY, levelH)};
        }
        return Viewport{mode, 0, 0, viewW, viewH, drawMax(0, viewW, levelW), drawMax(0, viewH, levelH)};
    }

    int minX = 0;
    int minY = 0;
    if (level.flickscreen.has_value()) {
        minX = (player->x / viewW) * viewW;
        minY = (player->y / viewH) * viewH;
    } else {
        minX = player->x - (viewW / 2);
        minY = player->y - (viewH / 2);
    }
    if (level.zoomscreen.has_value() && !level.flickscreen.has_value()) {
        minX = clampInt(minX, 0, levelW - viewW);
        minY = clampInt(minY, 0, levelH - viewH);
    }
    return Viewport{mode, minX, minY, viewW, viewH, drawMax(minX, viewW, levelW), drawMax(minY, viewH, levelH)};
}

FitResult computeFit(const DisplaySpec& display, const Viewport& viewport) {
    const int displayW = positiveOrOne(display.width);
    const int displayH = positiveOrOne(display.height);
    const int spritePixels = positiveOrOne(display.nativeSpritePixels);
    const int viewW = positiveOrOne(viewport.width);
    const int viewH = positiveOrOne(viewport.height);
    const int maxTile = std::max(1, std::min(displayW / viewW, displayH / viewH));

    FitResult result{};
    if (maxTile >= spritePixels) {
        result.spriteScale = std::max(1, maxTile / spritePixels);
        result.tilePixels = result.spriteScale * spritePixels;
        result.degraded = false;
    } else {
        result.spriteScale = 0;
        result.tilePixels = maxTile;
        result.degraded = true;
    }

    result.pixelWidth = viewW * result.tilePixels;
    result.pixelHeight = viewH * result.tilePixels;
    result.offsetX = (displayW - result.pixelWidth) / 2;
    result.offsetY = (displayH - result.pixelHeight) / 2;
    result.fits = result.pixelWidth <= displayW && result.pixelHeight <= displayH;
    return result;
}

std::string jsonEscape(std::string_view value) {
    std::ostringstream out;
    out << '"';
    for (const char ch : value) {
        switch (ch) {
            case '"': out << "\\\""; break;
            case '\\': out << "\\\\"; break;
            case '\n': out << "\\n"; break;
            case '\r': out << "\\r"; break;
            case '\t': out << "\\t"; break;
            default:
                if (static_cast<unsigned char>(ch) < 0x20) {
                    out << "\\u00";
                    const char* hex = "0123456789abcdef";
                    out << hex[(static_cast<unsigned char>(ch) >> 4) & 0xF];
                    out << hex[static_cast<unsigned char>(ch) & 0xF];
                } else {
                    out << ch;
                }
                break;
        }
    }
    out << '"';
    return out.str();
}

} // namespace puzzlescript::handheld
