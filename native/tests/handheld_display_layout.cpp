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
using puzzlescript::handheld::jsonEscape;
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
    require(viewport.maxX == 49 && viewport.maxY == 42, "full draw bounds");
}

void flickscreenUsesTilePages() {
    const LevelView level{33, 253, parseScreenSize("11x11"), std::nullopt};
    const PlayerPosition player{17, 24};
    const Viewport viewport = computeViewport(level, player, std::nullopt);
    require(viewport.mode == "flickscreen", "flickscreen mode");
    require(viewport.minX == 11, "flickscreen page x");
    require(viewport.minY == 22, "flickscreen page y");
    require(viewport.width == 11 && viewport.height == 11, "flickscreen dimensions");
    require(viewport.maxX == 22 && viewport.maxY == 33, "flickscreen draw bounds");
}

void flickscreenEdgePageKeepsDeclaredCameraSize() {
    const LevelView level{16, 7, parseScreenSize("11x5"), std::nullopt};
    const PlayerPosition player{15, 2};
    const Viewport viewport = computeViewport(level, player, std::nullopt);
    require(viewport.mode == "flickscreen", "flickscreen edge mode");
    require(viewport.minX == 11 && viewport.minY == 0, "flickscreen edge origin");
    require(viewport.width == 11 && viewport.height == 5, "flickscreen edge camera dimensions");
    require(viewport.maxX == 16 && viewport.maxY == 5, "flickscreen edge draw bounds");

    const FitResult fit = computeFit(DisplaySpec{800, 480, 5}, viewport);
    require(fit.tilePixels == 70, "edge page fit uses declared camera width");
}

void zoomscreenCentersAndClamps() {
    const LevelView level{30, 20, std::nullopt, parseScreenSize("11x9")};
    const PlayerPosition player{28, 19};
    const Viewport viewport = computeViewport(level, player, std::nullopt);
    require(viewport.mode == "zoomscreen", "zoomscreen mode");
    require(viewport.minX == 19, "zoomscreen clamps x at right edge");
    require(viewport.minY == 11, "zoomscreen clamps y at bottom edge");
    require(viewport.width == 11 && viewport.height == 9, "zoomscreen dimensions");
    require(viewport.maxX == 30 && viewport.maxY == 20, "zoomscreen draw bounds");
}

void zoomscreenCanBeLargerThanLevel() {
    const LevelView level{8, 4, std::nullopt, parseScreenSize("11x9")};
    const PlayerPosition player{3, 2};
    const Viewport viewport = computeViewport(level, player, std::nullopt);
    require(viewport.mode == "zoomscreen", "oversized zoomscreen mode");
    require(viewport.minX == 0 && viewport.minY == 0, "oversized zoomscreen origin");
    require(viewport.width == 11 && viewport.height == 9, "oversized zoomscreen camera dimensions");
    require(viewport.maxX == 8 && viewport.maxY == 4, "oversized zoomscreen draw bounds");
}

void flickscreenWinsOverZoomscreen() {
    const LevelView level{40, 30, parseScreenSize("8x8"), parseScreenSize("11x9")};
    const PlayerPosition player{9, 9};
    const Viewport viewport = computeViewport(level, player, std::nullopt);
    require(viewport.mode == "flickscreen", "flickscreen has precedence");
    require(viewport.width == 8 && viewport.height == 8, "flickscreen size used");
}

void lastViewportUsedWhenPlayerMissing() {
    const LevelView level{16, 7, parseScreenSize("11x5"), std::nullopt};
    const Viewport previous{"flickscreen", 11, 5, 11, 5, 22, 10};
    const Viewport viewport = computeViewport(level, std::nullopt, previous);
    require(viewport.mode == "flickscreen", "last viewport mode preserved");
    require(viewport.minX == 11 && viewport.minY == 5, "last viewport origin preserved");
    require(viewport.width == 11 && viewport.height == 5, "last viewport uses current camera dimensions");
    require(viewport.maxX == 16 && viewport.maxY == 7, "last viewport draw bounds clamped");
}

void fitsNormalCorpusOutlierAtNativeMinimumOrBetter() {
    const DisplaySpec display{800, 480, 5};
    const FitResult fit = computeFit(display, Viewport{"full", 0, 0, 49, 42});
    require(fit.tilePixels == 10, "49x42 fits at 10 px per tile");
    require(fit.spriteScale == 2, "10 px tile is 2x native sprite scale");
    require(!fit.degraded, "49x42 should not be degraded");
    require(fit.fits, "49x42 should fit display");
    require(fit.pixelWidth == 490 && fit.pixelHeight == 420, "fit pixel dimensions");
    require(fit.offsetX == 155 && fit.offsetY == 30, "fit centering");
}

void fitsViewportAtLargestCleanIntegerScale() {
    const DisplaySpec display{800, 480, 5};
    const FitResult fit = computeFit(display, Viewport{"flickscreen", 0, 0, 11, 11});
    require(fit.tilePixels == 40, "11x11 viewport fits at 40 px");
    require(fit.spriteScale == 8, "40 px tile is 8x native sprite scale");
    require(!fit.degraded, "11x11 should not be degraded");
    require(fit.fits, "11x11 should fit display");
    require(fit.offsetX == 180 && fit.offsetY == 20, "11x11 centered");
}

void degradesOnlyWhenNativeTileCannotFit() {
    const DisplaySpec display{800, 480, 5};
    const FitResult fit = computeFit(display, Viewport{"full", 0, 0, 170, 253});
    require(fit.tilePixels == 1, "degraded tile uses largest whole-board pixel scale");
    require(fit.spriteScale == 0, "degraded fit has no native sprite multiple");
    require(fit.degraded, "170x253 cannot fit native 5 px tiles");
    require(fit.fits, "170x253 still fits display with 1 px tiles");
    require(fit.pixelWidth == 170 && fit.pixelHeight == 253, "degraded dimensions still whole board");
}

void impossibleViewportIsReported() {
    const DisplaySpec display{4, 4, 5};
    const FitResult fit = computeFit(display, Viewport{"full", 0, 0, 10, 10, 10, 10});
    require(fit.tilePixels == 1, "impossible fit still reports minimum whole-pixel tile");
    require(fit.pixelWidth == 10 && fit.pixelHeight == 10, "impossible fit dimensions expose overflow");
    require(fit.degraded, "impossible fit is degraded");
    require(!fit.fits, "impossible fit should be flagged");
}

void escapesJsonStrings() {
    const std::string value = std::string("quote\" slash\\ line\n tab\t ctrl") + static_cast<char>(0x01);
    const std::string escaped = jsonEscape(value);
    require(
        escaped == "\"quote\\\" slash\\\\ line\\n tab\\t ctrl\\u0001\"",
        "json escape should cover special and control characters");
}

} // namespace

int main() {
    parsesScreenSizes();
    fullLevelViewportWithoutCameraMetadata();
    flickscreenUsesTilePages();
    flickscreenEdgePageKeepsDeclaredCameraSize();
    zoomscreenCentersAndClamps();
    zoomscreenCanBeLargerThanLevel();
    flickscreenWinsOverZoomscreen();
    lastViewportUsedWhenPlayerMissing();
    fitsNormalCorpusOutlierAtNativeMinimumOrBetter();
    fitsViewportAtLargestCleanIntegerScale();
    degradesOnlyWhenNativeTileCannotFit();
    impossibleViewportIsReported();
    escapesJsonStrings();
    return 0;
}
