#pragma once

#include <optional>
#include <string>
#include <string_view>

namespace puzzlescript::handheld {

struct DisplaySpec {
    int width = 800;
    int height = 480;
    int nativeSpritePixels = 5;
};

struct ScreenSize {
    int width = 0;
    int height = 0;
};

struct PlayerPosition {
    int x = 0;
    int y = 0;
};

struct LevelView {
    int width = 0;
    int height = 0;
    std::optional<ScreenSize> flickscreen;
    std::optional<ScreenSize> zoomscreen;
};

// `width`/`height` are the declared camera dimensions used for display fitting.
// `minX`/`minY` are the camera/page origin. `maxX`/`maxY` are exclusive level
// draw bounds clamped to the current level, matching PuzzleScript's mini/maxi
// and minj/maxj rendering contract.
struct Viewport {
    std::string mode = "full";
    int minX = 0;
    int minY = 0;
    int width = 0;
    int height = 0;
    int maxX = 0;
    int maxY = 0;
};

struct FitResult {
    int tilePixels = 0;
    int spriteScale = 0;
    int pixelWidth = 0;
    int pixelHeight = 0;
    int offsetX = 0;
    int offsetY = 0;
    bool degraded = false;
    bool fits = true;
};

std::optional<ScreenSize> parseScreenSize(const char* value);
Viewport computeViewport(
    const LevelView& level,
    std::optional<PlayerPosition> player,
    std::optional<Viewport> previousViewport);
FitResult computeFit(const DisplaySpec& display, const Viewport& viewport);
std::string jsonEscape(std::string_view value);

} // namespace puzzlescript::handheld
