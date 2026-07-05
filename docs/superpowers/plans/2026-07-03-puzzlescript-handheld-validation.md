# PuzzleScript Handheld Validation Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first software slice for the PuzzleScript handheld: a native display/viewport fitting library plus a corpus report CLI that proves the 800x480 whole-board contract before firmware and PCB work.

**Architecture:** Add a small `native/src/handheld/` module that is independent of SDL and ESP-IDF. The module computes PuzzleScript handheld viewports and integer display fits from public runtime metadata, and a `puzzlescript_handheld_report` executable compiles games, loads each level, and emits JSON reports for source files or NDJSON corpus bundles.

**Tech Stack:** C++17, existing native PuzzleScript compiler/runtime C API, native CMake/CTest, existing `runtime/json` parser, existing Node corpus bundle script.

---

## Scope Check

The hardware spec spans independent work streams: display fitting, game library/cache, firmware runtime loop, USB storage, audio/haptics/LEDs, ESP32-P4 board bring-up, battery/power, and case/PCB design. This plan intentionally covers the first testable software slice only: display semantics and corpus validation on the host-native build.

This slice produces a working executable and tests. It does not add ESP-IDF firmware, PCB files, 3D case files, USB mass-storage firmware, audio/haptic firmware, or LED drivers. Those should each get separate implementation plans after this validation harness exists.

## File Structure

- Create `native/src/handheld/display_layout.hpp`
  - Owns display constants, screen metadata parsing, viewport computation, integer scale/fit computation, and JSON string helpers.
- Create `native/src/handheld/display_layout.cpp`
  - Implements pure layout logic with no compiler/runtime/session dependency.
- Create `native/src/handheld/report.hpp`
  - Declares report options and report entry points.
- Create `native/src/handheld/report.cpp`
  - Compiles source games, loads levels through the public C API, calls `display_layout`, builds JSON reports, and ingests optional NDJSON corpus bundles.
- Create `native/src/handheld/main.cpp`
  - Thin CLI argument parser for `puzzlescript_handheld_report`.
- Create `native/tests/handheld_display_layout.cpp`
  - Focused unit tests for parse, viewport, and fit behavior.
- Create `native/tests/handheld_report_smoke.cpp`
  - End-to-end smoke tests for one compiled game and one compile-error game.
- Modify `native/CMakeLists.txt`
  - Add `puzzlescript_handheld` static library, report executable, and two CTest tests.

## Task 1: Add Pure Display Layout Module

**Files:**
- Create: `native/src/handheld/display_layout.hpp`
- Create: `native/src/handheld/display_layout.cpp`
- Create: `native/tests/handheld_display_layout.cpp`
- Modify: `native/CMakeLists.txt`

- [ ] **Step 1: Write the failing layout tests**

Create `native/tests/handheld_display_layout.cpp`:

```cpp
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
```

- [ ] **Step 2: Wire the failing layout test into CMake**

Modify `native/CMakeLists.txt` after the existing `puzzlescript_simplify` target block:

```cmake
add_library(puzzlescript_handheld STATIC
  src/handheld/display_layout.cpp
)

target_include_directories(puzzlescript_handheld
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)
```

Add this near the other small C++ tests:

```cmake
add_executable(handheld_display_layout
  tests/handheld_display_layout.cpp
)

target_link_libraries(handheld_display_layout
  PRIVATE
    puzzlescript_handheld
)

target_include_directories(handheld_display_layout
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

add_test(
  NAME handheld_display_layout
  COMMAND handheld_display_layout
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)
```

- [ ] **Step 3: Run the test and verify it fails to build**

Run:

```bash
cmake -S native -B build/native
cmake --build build/native --target handheld_display_layout
```

Expected: build fails because `handheld/display_layout.hpp` does not exist.

- [ ] **Step 4: Add the display layout header**

Create `native/src/handheld/display_layout.hpp`:

```cpp
#pragma once

#include <optional>
#include <string>

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

struct Viewport {
    std::string mode = "full";
    int minX = 0;
    int minY = 0;
    int width = 0;
    int height = 0;
};

struct FitResult {
    int tilePixels = 0;
    int spriteScale = 0;
    int pixelWidth = 0;
    int pixelHeight = 0;
    int offsetX = 0;
    int offsetY = 0;
    bool degraded = false;
};

std::optional<ScreenSize> parseScreenSize(const char* value);
Viewport computeViewport(
    const LevelView& level,
    std::optional<PlayerPosition> player,
    std::optional<Viewport> previousViewport);
FitResult computeFit(const DisplaySpec& display, const Viewport& viewport);
std::string jsonEscape(std::string_view value);

} // namespace puzzlescript::handheld
```

- [ ] **Step 5: Add the display layout implementation**

Create `native/src/handheld/display_layout.cpp`:

```cpp
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
    char* endA = nullptr;
    char* endB = nullptr;
    const long parsedW = std::strtol(text.substr(0, separator).c_str(), &endA, 10);
    const long parsedH = std::strtol(text.substr(separator + 1).c_str(), &endB, 10);
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
        return Viewport{"full", 0, 0, levelW, levelH};
    }

    const int viewW = clampInt(screen->width, 1, levelW);
    const int viewH = clampInt(screen->height, 1, levelH);
    const std::string mode = level.flickscreen.has_value() ? "flickscreen" : "zoomscreen";

    if (!player.has_value()) {
        if (previousViewport.has_value()) {
            Viewport previous = *previousViewport;
            previous.mode = mode;
            previous.width = clampInt(previous.width, 1, viewW);
            previous.height = clampInt(previous.height, 1, viewH);
            previous.minX = clampInt(previous.minX, 0, levelW - previous.width);
            previous.minY = clampInt(previous.minY, 0, levelH - previous.height);
            return previous;
        }
        return Viewport{mode, 0, 0, viewW, viewH};
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
    minX = clampInt(minX, 0, levelW - viewW);
    minY = clampInt(minY, 0, levelH - viewH);
    return Viewport{mode, minX, minY, viewW, viewH};
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
```

- [ ] **Step 6: Run the layout test and verify it passes**

Run:

```bash
cmake --build build/native --target handheld_display_layout
ctest --test-dir build/native -R '^handheld_display_layout$' --output-on-failure
```

Expected: `100% tests passed` for `handheld_display_layout`.

- [ ] **Step 7: Commit the pure layout module**

Run:

```bash
git add native/CMakeLists.txt native/src/handheld/display_layout.hpp native/src/handheld/display_layout.cpp native/tests/handheld_display_layout.cpp
git commit -m "feat: add handheld display layout calculator"
```

## Task 2: Add Single-Source Handheld Report CLI

**Files:**
- Create: `native/src/handheld/report.hpp`
- Create: `native/src/handheld/report.cpp`
- Create: `native/src/handheld/main.cpp`
- Create: `native/tests/handheld_report_smoke.cpp`
- Modify: `native/CMakeLists.txt`

- [ ] **Step 1: Write the failing report smoke test**

Create `native/tests/handheld_report_smoke.cpp`:

```cpp
#undef NDEBUG
#include <cassert>
#include <string>

#include "handheld/report.hpp"

using puzzlescript::handheld::ReportOptions;
using puzzlescript::handheld::buildReportForSourceText;

namespace {

constexpr const char* kSimpleSource = R"(title Handheld Report Smoke
background_color #123456

========
OBJECTS
========

Background
black
00000
00000
00000
00000
00000

Player
white
11111
11111
11111
11111
11111

=======
LEGEND
=======
. = Background
P = Player

================
COLLISIONLAYERS
================
Background
Player

=======
LEVELS
=======
P..
...
)";

constexpr const char* kFlickscreenSource = R"(title Handheld Flickscreen Smoke
flickscreen 2x2

========
OBJECTS
========

Background
black
00000
00000
00000
00000
00000

Player
white
11111
11111
11111
11111
11111

=======
LEGEND
=======
. = Background
P = Player

================
COLLISIONLAYERS
================
Background
Player

=======
LEVELS
=======
....
....
..P.
....
)";

constexpr const char* kBrokenSource = R"(title Broken Handheld Smoke

=======
LEVELS
=======
P
)";

void requireContains(const std::string& haystack, const char* needle) {
    if (haystack.find(needle) == std::string::npos) {
        assert(false && "expected JSON fragment not found");
    }
}

void reportsFullLevelFit() {
    ReportOptions options{};
    const std::string json = buildReportForSourceText("simple.txt", kSimpleSource, options);
    requireContains(json, "\"source\":\"simple.txt\"");
    requireContains(json, "\"compile_ok\":true");
    requireContains(json, "\"background_color\":\"#123456\"");
    requireContains(json, "\"mode\":\"full\"");
    requireContains(json, "\"board_width\":3");
    requireContains(json, "\"board_height\":2");
    requireContains(json, "\"tile_pixels\":240");
    requireContains(json, "\"degraded\":false");
}

void reportsFlickscreenViewport() {
    ReportOptions options{};
    const std::string json = buildReportForSourceText("flick.txt", kFlickscreenSource, options);
    requireContains(json, "\"source\":\"flick.txt\"");
    requireContains(json, "\"compile_ok\":true");
    requireContains(json, "\"metadata\":{\"flickscreen\":\"2x2\"");
    requireContains(json, "\"mode\":\"flickscreen\"");
    requireContains(json, "\"viewport_width\":2");
    requireContains(json, "\"viewport_height\":2");
    requireContains(json, "\"tile_pixels\":240");
}

void reportsCompileFailure() {
    ReportOptions options{};
    const std::string json = buildReportForSourceText("broken.txt", kBrokenSource, options);
    requireContains(json, "\"source\":\"broken.txt\"");
    requireContains(json, "\"compile_ok\":false");
    requireContains(json, "\"diagnostics\":[");
}

} // namespace

int main() {
    reportsFullLevelFit();
    reportsFlickscreenViewport();
    reportsCompileFailure();
    return 0;
}
```

- [ ] **Step 2: Add CMake targets for the report module and failing test**

Extend the `puzzlescript_handheld` library in `native/CMakeLists.txt`:

```cmake
add_library(puzzlescript_handheld STATIC
  src/handheld/display_layout.cpp
  src/handheld/report.cpp
)

target_include_directories(puzzlescript_handheld
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_link_libraries(puzzlescript_handheld
  PUBLIC
    puzzlescript_native
    puzzlescript_compiler
)
```

Add the CLI target near `puzzlescript_simplify`:

```cmake
add_executable(puzzlescript_handheld_report
  src/handheld/main.cpp
)

target_link_libraries(puzzlescript_handheld_report
  PRIVATE
    puzzlescript_handheld
)

target_include_directories(puzzlescript_handheld_report
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)
```

Add the report smoke test near the layout test:

```cmake
add_executable(handheld_report_smoke
  tests/handheld_report_smoke.cpp
)

target_link_libraries(handheld_report_smoke
  PRIVATE
    puzzlescript_handheld
)

target_include_directories(handheld_report_smoke
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

add_test(
  NAME handheld_report_smoke
  COMMAND handheld_report_smoke
  WORKING_DIRECTORY ${PUZZLESCRIPT_REPO_ROOT}
)
```

- [ ] **Step 3: Run the report smoke test and verify it fails to build**

Run:

```bash
cmake --build build/native --target handheld_report_smoke
```

Expected: build fails because `handheld/report.hpp` does not exist.

- [ ] **Step 4: Add the report header**

Create `native/src/handheld/report.hpp`:

```cpp
#pragma once

#include <filesystem>
#include <string>
#include <vector>

#include "handheld/display_layout.hpp"

namespace puzzlescript::handheld {

struct ReportOptions {
    DisplaySpec display;
    bool includePassingGames = true;
};

struct SourceInput {
    std::string name;
    std::string source;
};

std::string readTextFile(const std::filesystem::path& path);
std::string buildReportForSourceText(
    const std::string& sourceName,
    const std::string& sourceText,
    const ReportOptions& options);
std::string buildReportForSources(
    const std::vector<SourceInput>& sources,
    const ReportOptions& options);

} // namespace puzzlescript::handheld
```

- [ ] **Step 5: Add the first report implementation**

Create `native/src/handheld/report.cpp`:

```cpp
#include "handheld/report.hpp"

#include <fstream>
#include <memory>
#include <optional>
#include <sstream>
#include <stdexcept>

#include "puzzlescript/compiler.h"
#include "puzzlescript/puzzlescript.h"

namespace puzzlescript::handheld {
namespace {

struct CompileResultHandle {
    ps_compile_result* value = nullptr;
    ~CompileResultHandle() { ps_free_compile_result(value); }
};

struct GameHandle {
    const ps_game* value = nullptr;
    ~GameHandle() { ps_free_game(const_cast<ps_game*>(value)); }
};

struct CompilerResultHandle {
    ps_compiler_result* value = nullptr;
    ~CompilerResultHandle() { ps_compiler_result_free(value); }
};

struct SessionHandle {
    ps_full_state* value = nullptr;
    ~SessionHandle() { ps_full_state_destroy(value); }
};

struct ErrorHandle {
    ps_error* value = nullptr;
    ~ErrorHandle() { ps_free_error(value); }
};

std::optional<PlayerPosition> currentPlayer(ps_full_state* state) {
    int32_t x = 0;
    int32_t y = 0;
    if (ps_full_state_first_player_position(state, &x, &y)) {
        return PlayerPosition{x, y};
    }
    return std::nullopt;
}

void appendDiagnosticsJson(std::ostream& out, const std::string& sourceText) {
    CompilerResultHandle diagnostics{ps_compiler_compile_source_diagnostics(sourceText.c_str(), sourceText.size())};
    out << "[";
    const size_t count = ps_compiler_result_diagnostic_count(diagnostics.value);
    for (size_t index = 0; index < count; ++index) {
        const ps_diagnostic* diagnostic = ps_compiler_result_diagnostic(diagnostics.value, index);
        if (index > 0) {
            out << ",";
        }
        out << "{\"severity\":" << static_cast<int>(diagnostic->severity)
            << ",\"line\":" << diagnostic->line
            << ",\"message\":" << jsonEscape(diagnostic->message ? diagnostic->message : "")
            << "}";
    }
    out << "]";
}

void appendMetadataJson(std::ostream& out, const ps_game* game) {
    out << "{";
    bool first = true;
    for (const char* key : {"flickscreen", "zoomscreen", "realtime_interval", "noaction", "norestart", "noundo"}) {
        if (!ps_game_has_metadata(game, key)) {
            continue;
        }
        if (!first) {
            out << ",";
        }
        first = false;
        out << jsonEscape(key) << ":" << jsonEscape(ps_game_metadata_value(game, key));
    }
    out << "}";
}

void appendLevelJson(
    std::ostream& out,
    const ps_game* game,
    ps_full_state* state,
    int32_t levelIndex,
    std::optional<Viewport>& previousViewport,
    const ReportOptions& options) {
    ErrorHandle error{};
    if (!ps_full_state_load_level(state, levelIndex, &error.value)) {
        out << "{\"index\":" << levelIndex
            << ",\"load_ok\":false"
            << ",\"error\":" << jsonEscape(ps_error_message(error.value))
            << "}";
        return;
    }

    ps_full_state_status_info status{};
    ps_full_state_status(state, &status);
    const LevelView level{
        status.width,
        status.height,
        parseScreenSize(ps_game_metadata_value(game, "flickscreen")),
        parseScreenSize(ps_game_metadata_value(game, "zoomscreen")),
    };
    const Viewport viewport = computeViewport(level, currentPlayer(state), previousViewport);
    previousViewport = viewport;
    const FitResult fit = computeFit(options.display, viewport);

    out << "{\"index\":" << levelIndex
        << ",\"load_ok\":true"
        << ",\"mode\":" << jsonEscape(viewport.mode)
        << ",\"board_width\":" << status.width
        << ",\"board_height\":" << status.height
        << ",\"viewport_x\":" << viewport.minX
        << ",\"viewport_y\":" << viewport.minY
        << ",\"viewport_width\":" << viewport.width
        << ",\"viewport_height\":" << viewport.height
        << ",\"tile_pixels\":" << fit.tilePixels
        << ",\"sprite_scale\":" << fit.spriteScale
        << ",\"pixel_width\":" << fit.pixelWidth
        << ",\"pixel_height\":" << fit.pixelHeight
        << ",\"offset_x\":" << fit.offsetX
        << ",\"offset_y\":" << fit.offsetY
        << ",\"degraded\":" << (fit.degraded ? "true" : "false")
        << "}";
}

} // namespace

std::string readTextFile(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        throw std::runtime_error("Failed to open file: " + path.string());
    }
    std::ostringstream buffer;
    buffer << input.rdbuf();
    return buffer.str();
}

std::string buildReportForSourceText(
    const std::string& sourceName,
    const std::string& sourceText,
    const ReportOptions& options) {
    std::ostringstream out;
    out << "{"
        << "\"source\":" << jsonEscape(sourceName)
        << ",\"display\":{\"width\":" << options.display.width
        << ",\"height\":" << options.display.height
        << ",\"native_sprite_pixels\":" << options.display.nativeSpritePixels
        << "}";

    CompileResultHandle compile{};
    if (!ps_compile_source(sourceText.c_str(), sourceText.size(), &compile.value)) {
        out << ",\"compile_ok\":false,\"diagnostics\":";
        appendDiagnosticsJson(out, sourceText);
        out << "}";
        return out.str();
    }

    GameHandle game{ps_compile_result_game(compile.value)};
    if (game.value == nullptr) {
        out << ",\"compile_ok\":false,\"diagnostics\":";
        appendDiagnosticsJson(out, sourceText);
        out << "}";
        return out.str();
    }
    out << ",\"compile_ok\":true"
        << ",\"background_color\":" << jsonEscape(ps_game_background_color(game.value))
        << ",\"metadata\":";
    appendMetadataJson(out, game.value);

    SessionHandle session{};
    ErrorHandle error{};
    if (!ps_full_state_create(game.value, &session.value, &error.value)) {
        out << ",\"session_ok\":false,\"error\":" << jsonEscape(ps_error_message(error.value)) << "}";
        return out.str();
    }

    out << ",\"session_ok\":true,\"levels\":[";
    std::optional<Viewport> previousViewport;
    const int32_t levelCount = ps_game_level_count(game.value);
    for (int32_t levelIndex = 0; levelIndex < levelCount; ++levelIndex) {
        if (levelIndex > 0) {
            out << ",";
        }
        appendLevelJson(out, game.value, session.value, levelIndex, previousViewport, options);
    }
    out << "]}";
    return out.str();
}

std::string buildReportForSources(
    const std::vector<SourceInput>& sources,
    const ReportOptions& options) {
    std::ostringstream out;
    out << "{\"games\":[";
    for (size_t index = 0; index < sources.size(); ++index) {
        if (index > 0) {
            out << ",";
        }
        out << buildReportForSourceText(sources[index].name, sources[index].source, options);
    }
    out << "]}";
    return out.str();
}

} // namespace puzzlescript::handheld
```

- [ ] **Step 6: Add the CLI main**

Create `native/src/handheld/main.cpp`:

```cpp
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

#include "handheld/report.hpp"

namespace {

void printUsage() {
    std::cerr
        << "Usage: puzzlescript_handheld_report [--display WIDTHxHEIGHT] --source GAME.txt [--source GAME2.txt]\n"
        << "       puzzlescript_handheld_report [--display WIDTHxHEIGHT] GAME.txt [GAME2.txt]\n";
}

puzzlescript::handheld::DisplaySpec parseDisplay(const std::string& value) {
    const auto parsed = puzzlescript::handheld::parseScreenSize(value.c_str());
    if (!parsed.has_value()) {
        throw std::runtime_error("Invalid --display value: " + value);
    }
    return puzzlescript::handheld::DisplaySpec{parsed->width, parsed->height, 5};
}

} // namespace

int main(int argc, char** argv) {
    try {
        puzzlescript::handheld::ReportOptions options{};
        std::vector<std::filesystem::path> paths;
        for (int index = 1; index < argc; ++index) {
            const std::string arg = argv[index];
            if (arg == "--help" || arg == "-h") {
                printUsage();
                return 0;
            }
            if (arg == "--display") {
                if (index + 1 >= argc) {
                    throw std::runtime_error("--display requires WIDTHxHEIGHT");
                }
                options.display = parseDisplay(argv[++index]);
                continue;
            }
            if (arg == "--source") {
                if (index + 1 >= argc) {
                    throw std::runtime_error("--source requires a file path");
                }
                paths.emplace_back(argv[++index]);
                continue;
            }
            paths.emplace_back(arg);
        }
        if (paths.empty()) {
            printUsage();
            return 2;
        }
        std::vector<puzzlescript::handheld::SourceInput> sources;
        sources.reserve(paths.size());
        for (const auto& path : paths) {
            sources.push_back(puzzlescript::handheld::SourceInput{
                path.string(),
                puzzlescript::handheld::readTextFile(path),
            });
        }
        std::cout << puzzlescript::handheld::buildReportForSources(sources, options) << "\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "puzzlescript_handheld_report: " << error.what() << "\n";
        return 1;
    }
}
```

- [ ] **Step 7: Run the report smoke test and verify it passes**

Run:

```bash
cmake --build build/native --target handheld_report_smoke puzzlescript_handheld_report
ctest --test-dir build/native -R '^handheld_report_smoke$' --output-on-failure
```

Expected: `100% tests passed` for `handheld_report_smoke`.

- [ ] **Step 8: Manually smoke the CLI on Sokoban**

Run:

```bash
build/native/puzzlescript_handheld_report --display 800x480 src/demo/sokoban_basic.txt
```

Expected: stdout is one JSON object containing `"games"`, `"compile_ok":true`, `"levels"`, `"tile_pixels"`, and `"degraded":false` for the small Sokoban level.

- [ ] **Step 9: Commit the single-source report CLI**

Run:

```bash
git add native/CMakeLists.txt native/src/handheld/report.hpp native/src/handheld/report.cpp native/src/handheld/main.cpp native/tests/handheld_report_smoke.cpp
git commit -m "feat: add handheld display report cli"
```

## Task 3: Add NDJSON Corpus Input And Summary Counters

**Files:**
- Modify: `native/src/handheld/report.hpp`
- Modify: `native/src/handheld/report.cpp`
- Modify: `native/src/handheld/main.cpp`
- Modify: `native/tests/handheld_report_smoke.cpp`

- [ ] **Step 1: Extend the smoke test with NDJSON corpus input**

Append this helper and test to `native/tests/handheld_report_smoke.cpp`:

```cpp
void reportsCorpusSummary() {
    const std::string ndjson =
        std::string("{\"index\":0,\"name\":\"simple\",\"source\":") +
        puzzlescript::handheld::jsonEscape(kSimpleSource) +
        "}\n" +
        std::string("{\"index\":1,\"name\":\"broken\",\"source\":") +
        puzzlescript::handheld::jsonEscape(kBrokenSource) +
        "}\n";
    const auto sources = puzzlescript::handheld::loadSourcesFromNdjsonText("inline.ndjson", ndjson);
    assert(sources.size() == 2);
    ReportOptions options{};
    const std::string json = puzzlescript::handheld::buildReportForSources(sources, options);
    requireContains(json, "\"game_count\":2");
    requireContains(json, "\"compile_failures\":1");
    requireContains(json, "\"compiled_games\":1");
    requireContains(json, "\"degraded_levels\":0");
}
```

Add the call to `main()`:

```cpp
int main() {
    reportsFullLevelFit();
    reportsFlickscreenViewport();
    reportsCompileFailure();
    reportsCorpusSummary();
    return 0;
}
```

- [ ] **Step 2: Run the smoke test and verify it fails**

Run:

```bash
cmake --build build/native --target handheld_report_smoke
```

Expected: build fails because `loadSourcesFromNdjsonText` is not declared.

- [ ] **Step 3: Add NDJSON declarations**

Add to `native/src/handheld/report.hpp`:

```cpp
std::vector<SourceInput> loadSourcesFromNdjsonText(
    const std::string& label,
    const std::string& ndjsonText);
std::vector<SourceInput> loadSourcesFromNdjsonFile(const std::filesystem::path& path);
```

- [ ] **Step 4: Add summary tracking and NDJSON loading implementation**

In `native/src/handheld/report.cpp`, add this include:

```cpp
#include "runtime/json.hpp"
```

Replace `buildReportForSources` with:

```cpp
std::string buildReportForSources(
    const std::vector<SourceInput>& sources,
    const ReportOptions& options) {
    std::vector<std::string> reports;
    reports.reserve(sources.size());
    size_t compiledGames = 0;
    size_t compileFailures = 0;
    size_t degradedLevels = 0;

    for (const auto& source : sources) {
        std::string report = buildReportForSourceText(source.name, source.source, options);
        if (report.find("\"compile_ok\":true") != std::string::npos) {
            ++compiledGames;
        } else {
            ++compileFailures;
        }
        size_t search = 0;
        while ((search = report.find("\"degraded\":true", search)) != std::string::npos) {
            ++degradedLevels;
            search += 15;
        }
        reports.push_back(std::move(report));
    }

    std::ostringstream out;
    out << "{\"summary\":{\"game_count\":" << sources.size()
        << ",\"compiled_games\":" << compiledGames
        << ",\"compile_failures\":" << compileFailures
        << ",\"degraded_levels\":" << degradedLevels
        << "},\"games\":[";
    for (size_t index = 0; index < reports.size(); ++index) {
        if (index > 0) {
            out << ",";
        }
        out << reports[index];
    }
    out << "]}";
    return out.str();
}
```

Add below it:

```cpp
std::vector<SourceInput> loadSourcesFromNdjsonText(
    const std::string& label,
    const std::string& ndjsonText) {
    std::vector<SourceInput> sources;
    std::istringstream lines(ndjsonText);
    std::string line;
    int lineNumber = 0;
    while (std::getline(lines, line)) {
        ++lineNumber;
        if (line.empty()) {
            continue;
        }
        const puzzlescript::json::Value parsed = puzzlescript::json::parse(line);
        if (!parsed.isObject()) {
            throw std::runtime_error(label + ":" + std::to_string(lineNumber) + ": expected JSON object");
        }
        const auto& object = parsed.asObject();
        const auto nameIt = object.find("name");
        const auto sourceIt = object.find("source");
        if (nameIt == object.end() || !nameIt->second.isString()) {
            throw std::runtime_error(label + ":" + std::to_string(lineNumber) + ": missing string field name");
        }
        if (sourceIt == object.end() || !sourceIt->second.isString()) {
            throw std::runtime_error(label + ":" + std::to_string(lineNumber) + ": missing string field source");
        }
        sources.push_back(SourceInput{nameIt->second.asString(), sourceIt->second.asString()});
    }
    return sources;
}

std::vector<SourceInput> loadSourcesFromNdjsonFile(const std::filesystem::path& path) {
    return loadSourcesFromNdjsonText(path.string(), readTextFile(path));
}
```

- [ ] **Step 5: Add `--corpus-ndjson` support to the CLI**

Modify `native/src/handheld/main.cpp` usage:

```cpp
std::cerr
    << "Usage: puzzlescript_handheld_report [--display WIDTHxHEIGHT] --source GAME.txt [--source GAME2.txt]\n"
    << "       puzzlescript_handheld_report [--display WIDTHxHEIGHT] --corpus-ndjson bundle.ndjson\n"
    << "       puzzlescript_handheld_report [--display WIDTHxHEIGHT] GAME.txt [GAME2.txt]\n";
```

Add a second path vector:

```cpp
std::vector<std::filesystem::path> corpusBundles;
```

Add argument parsing:

```cpp
if (arg == "--corpus-ndjson") {
    if (index + 1 >= argc) {
        throw std::runtime_error("--corpus-ndjson requires a file path");
    }
    corpusBundles.emplace_back(argv[++index]);
    continue;
}
```

Change the empty-input check:

```cpp
if (paths.empty() && corpusBundles.empty()) {
    printUsage();
    return 2;
}
```

After loading explicit source paths, append bundle sources:

```cpp
for (const auto& path : corpusBundles) {
    auto loaded = puzzlescript::handheld::loadSourcesFromNdjsonFile(path);
    sources.insert(sources.end(), loaded.begin(), loaded.end());
}
```

- [ ] **Step 6: Run smoke tests**

Run:

```bash
cmake --build build/native --target handheld_report_smoke puzzlescript_handheld_report
ctest --test-dir build/native -R '^handheld_(display_layout|report_smoke)$' --output-on-failure
```

Expected: both handheld tests pass.

- [ ] **Step 7: Run a small corpus bundle through the CLI**

Run:

```bash
node scripts/build_parser_corpus_bundle.js testdata > build/handheld_testdata.bundle.ndjson
build/native/puzzlescript_handheld_report --display 800x480 --corpus-ndjson build/handheld_testdata.bundle.ndjson
```

Expected: stdout is a JSON object with `"summary"`, `"game_count"`, `"compiled_games"`, `"compile_failures"`, and `"degraded_levels"`. The command may take noticeable time because it compiles many games; it should complete without crashing.

- [ ] **Step 8: Commit NDJSON corpus support**

Run:

```bash
git add native/src/handheld/report.hpp native/src/handheld/report.cpp native/src/handheld/main.cpp native/tests/handheld_report_smoke.cpp
git commit -m "feat: add handheld corpus report input"
```

## Task 4: Add Makefile Convenience Target And Documentation

**Files:**
- Modify: `Makefile`
- Create: `docs/superpowers/notes/2026-07-03-handheld-validation-usage.md`

- [ ] **Step 1: Inspect existing native targets**

Run:

```bash
rg "native|ctest|solver" Makefile
```

Expected: existing targets show how this repo invokes CMake and native binaries.

- [ ] **Step 2: Add a Make target for the handheld report**

Add to `Makefile` near the other native helper targets:

```make
.PHONY: handheld_report
handheld_report: build/native/puzzlescript_handheld_report
	node scripts/build_parser_corpus_bundle.js testdata > build/handheld_testdata.bundle.ndjson
	build/native/puzzlescript_handheld_report --display 800x480 --corpus-ndjson build/handheld_testdata.bundle.ndjson > build/handheld_report.json
	@echo "Wrote build/handheld_report.json"
```

Add this variable near the existing `PUZZLESCRIPT_SIMPLIFY` assignment:

```make
PUZZLESCRIPT_HANDHELD_REPORT := $(BUILD_DIR)/native/puzzlescript_handheld_report
```

Add this target near `build_simplify`:

```make
$(PUZZLESCRIPT_HANDHELD_REPORT): $(CMAKE_CACHE) native/CMakeLists.txt native/src/handheld/display_layout.cpp native/src/handheld/report.cpp native/src/handheld/main.cpp
	$(CMAKE) -S . -B $(BUILD_DIR) -DPS_MASK_WORD_BITS=64
	$(CMAKE) --build $(BUILD_DIR) --target puzzlescript_handheld_report
```

- [ ] **Step 3: Add usage documentation**

Create `docs/superpowers/notes/2026-07-03-handheld-validation-usage.md`:

```markdown
# Handheld Validation Harness Usage

The handheld validation harness is the first software slice for the PuzzleScript
hardware handheld. It checks the 800x480 display contract from
`docs/superpowers/specs/2026-07-03-puzzlescript-handheld-design.md`.

## Build

```bash
cmake -S native -B build/native
cmake --build build/native --target puzzlescript_handheld_report
```

## Single Game

```bash
build/native/puzzlescript_handheld_report --display 800x480 src/demo/sokoban_basic.txt
```

The output is JSON with one `games` array. Each game contains compile status,
background color, selected handheld metadata, and per-level display fits.

## Test Corpus

```bash
node scripts/build_parser_corpus_bundle.js testdata > build/handheld_testdata.bundle.ndjson
build/native/puzzlescript_handheld_report --display 800x480 --corpus-ndjson build/handheld_testdata.bundle.ndjson > build/handheld_report.json
```

The `summary.degraded_levels` count is the first number to watch. A degraded
level means the whole board is still shown, but it cannot fit at the native
5-pixel PuzzleScript sprite cell size on an 800x480 display. The host report
keeps this as data for auditing; product firmware should treat such levels as
too large for the display rather than silently fractional-downsampling them.

## Semantics Checked

- No `flickscreen` or `zoomscreen`: fit the full level.
- `flickscreen`: fit the declared tile page containing the player.
- `zoomscreen`: fit the declared viewport centered around the player and clamped
  to the level.
- `flickscreen` has precedence when both metadata values exist.
- Borders are implied to use the game background color.
```

- [ ] **Step 4: Run the convenience target**

Run:

```bash
make handheld_report
```

Expected: `build/handheld_report.json` exists and contains a JSON object with `"summary"` and `"games"`.

- [ ] **Step 5: Run all handheld validation tests**

Run:

```bash
ctest --test-dir build/native -R '^handheld_' --output-on-failure
```

Expected: `handheld_display_layout` and `handheld_report_smoke` pass.

- [ ] **Step 6: Commit the target and documentation**

Run:

```bash
git add Makefile docs/superpowers/notes/2026-07-03-handheld-validation-usage.md
git commit -m "docs: add handheld validation usage"
```

## Self-Review Checklist

- Spec coverage:
  - Display whole-board rule is covered by `computeViewport` and `computeFit`.
  - `flickscreen` and `zoomscreen` viewport behavior is covered by unit tests and report output.
  - 800x480 integer scaling is covered by unit tests and CLI display options.
  - Corpus-first validation is covered by `--corpus-ndjson` and `make handheld_report`.
  - Background color is reported for future LED/glow work.
  - Compile failure reporting is covered by `handheld_report_smoke`.
- Deferred to separate plans:
  - Track 0 no-hardware feasibility: peak-memory audit, rv32/32-bit portability,
    runtime binary-size budget, and compile-time measurements.
  - ESP32-P4 firmware shell and power states.
  - Library UI, cache format, saves, and USB mass-storage mode.
  - Audio, haptics, and RGB LED drivers.
  - Dev-kit wiring, custom PCB, battery/power board, and 3D case.
- Placeholder scan:
  - The implementation plan contains no unresolved placeholder markers or unexpanded "write tests" steps.
- Type consistency:
  - `DisplaySpec`, `ScreenSize`, `LevelView`, `Viewport`, `FitResult`, `ReportOptions`, and `SourceInput` are introduced before use.
  - `loadSourcesFromNdjsonText` is added to the header before C++ tests depend on it.
