#undef NDEBUG
#include <cassert>
#include <optional>
#include <string>
#include <string_view>

#include "handheld/display_layout.hpp"

using puzzlescript::handheld::DisplaySpec;
using puzzlescript::handheld::FitResult;
using puzzlescript::handheld::LevelView;
using puzzlescript::handheld::PlayerPosition;
using puzzlescript::handheld::Viewport;
using puzzlescript::handheld::computeFit;
using puzzlescript::handheld::computeViewport;
using puzzlescript::handheld::parseScreenSize;

namespace {

void require(bool condition, const char* message) {
    if (!condition) {
        assert(false && message);
    }
}

void parsesScreenSizes() {
    const auto parsed = parseScreenSize("11x9");
    require(parsed.has_value(), "11x9 should parse");
    require(parsed->width == 11, "parsed width");
    require(parsed->height == 9, "parsed height");
    require(!parseScreenSize("").has_value(), "empty metadata should not parse");
    require(!parseScreenSize("abc").has_value(), "nonsense metadata should not parse");
    require(!parseScreenSize("0x8").has_value(), "zero width should not parse");
}

void fullLevelViewportWithoutCameraMetadata() {
    const LevelView level{49, 42, std::nullopt, std::nullopt};
    const Viewport viewport = computeViewport(level, std::nullopt, std::nullopt);
    require(viewport.mode == "full", "full mode");
    require(viewport.minX == 0 && viewport.minY == 0, "full origin");
    require(viewport.width == 49 && viewport.height == 42, "full dimensions");
}

void flickscreenUsesTilePages() {
    const LevelView level{33, 253, parseScreenSize("11x11"), std::nullopt};
    const PlayerPosition player{17, 24};
    const Viewport viewport = computeViewport(level, player, std::nullopt);
    require(viewport.mode == "flickscreen", "flickscreen mode");
    require(viewport.minX == 11, "flickscreen page x");
    require(viewport.minY == 22, "flickscreen page y");
    require(viewport.width == 11 && viewport.height == 11, "flickscreen dimensions");
}

void zoomscreenCentersAndClamps() {
    const LevelView level{30, 20, std::nullopt, parseScreenSize("11x9")};
    const PlayerPosition player{28, 19};
    const Viewport viewport = computeViewport(level, player, std::nullopt);
    require(viewport.mode == "zoomscreen", "zoomscreen mode");
    require(viewport.minX == 19, "zoomscreen clamps x at right edge");
    require(viewport.minY == 11, "zoomscreen clamps y at bottom edge");
    require(viewport.width == 11 && viewport.height == 9, "zoomscreen dimensions");
}

void flickscreenWinsOverZoomscreen() {
    const LevelView level{40, 30, parseScreenSize("8x8"), parseScreenSize("11x9")};
    const PlayerPosition player{9, 9};
    const Viewport viewport = computeViewport(level, player, std::nullopt);
    require(viewport.mode == "flickscreen", "flickscreen has precedence");
    require(viewport.width == 8 && viewport.height == 8, "flickscreen size used");
}

void lastViewportUsedWhenPlayerMissing() {
    const LevelView level{30, 20, parseScreenSize("11x9"), std::nullopt};
    const Viewport previous{"flickscreen", 11, 9, 11, 9};
    const Viewport viewport = computeViewport(level, std::nullopt, previous);
    require(viewport.mode == "flickscreen", "last viewport mode preserved");
    require(viewport.minX == 11 && viewport.minY == 9, "last viewport origin preserved");
    require(viewport.width == 11 && viewport.height == 9, "last viewport dimensions preserved");
}

void fitsNormalCorpusOutlierAtNativeMinimumOrBetter() {
    const DisplaySpec display{800, 480, 5};
    const FitResult fit = computeFit(display, Viewport{"full", 0, 0, 49, 42});
    require(fit.tilePixels == 10, "49x42 fits at 10 px per tile");
    require(fit.spriteScale == 2, "10 px tile is 2x native sprite scale");
    require(!fit.degraded, "49x42 should not be degraded");
    require(fit.pixelWidth == 490 && fit.pixelHeight == 420, "fit pixel dimensions");
    require(fit.offsetX == 155 && fit.offsetY == 30, "fit centering");
}

void fitsViewportAtLargestCleanIntegerScale() {
    const DisplaySpec display{800, 480, 5};
    const FitResult fit = computeFit(display, Viewport{"flickscreen", 0, 0, 11, 11});
    require(fit.tilePixels == 40, "11x11 viewport fits at 40 px");
    require(fit.spriteScale == 8, "40 px tile is 8x native sprite scale");
    require(!fit.degraded, "11x11 should not be degraded");
    require(fit.offsetX == 180 && fit.offsetY == 20, "11x11 centered");
}

void degradesOnlyWhenNativeTileCannotFit() {
    const DisplaySpec display{800, 480, 5};
    const FitResult fit = computeFit(display, Viewport{"full", 0, 0, 170, 253});
    require(fit.tilePixels == 1, "degraded tile uses largest whole-board pixel scale");
    require(fit.spriteScale == 0, "degraded fit has no native sprite multiple");
    require(fit.degraded, "170x253 cannot fit native 5 px tiles");
    require(fit.pixelWidth == 170 && fit.pixelHeight == 253, "degraded dimensions still whole board");
}

} // namespace

int main() {
    parsesScreenSizes();
    fullLevelViewportWithoutCameraMetadata();
    flickscreenUsesTilePages();
    zoomscreenCentersAndClamps();
    flickscreenWinsOverZoomscreen();
    lastViewportUsedWhenPlayerMissing();
    fitsNormalCorpusOutlierAtNativeMinimumOrBetter();
    fitsViewportAtLargestCleanIntegerScale();
    degradesOnlyWhenNativeTileCannotFit();
    return 0;
}
