#undef NDEBUG
#include <cassert>
#include <iostream>
#include <string>
#include <string_view>
#include <vector>

#include "handheld/report.hpp"

using puzzlescript::handheld::DisplaySpec;
using puzzlescript::handheld::ReportOptions;
using puzzlescript::handheld::SourceInput;
using puzzlescript::handheld::buildReportForSources;

namespace {

void require(bool condition, const char* message) {
    if (!condition) {
        assert(false && message);
    }
}

void requireContains(std::string_view text, std::string_view fragment) {
    if (text.find(fragment) == std::string_view::npos) {
        std::cerr << "missing fragment: " << fragment << "\nreport: " << text << "\n";
    }
    require(text.find(fragment) != std::string_view::npos, "missing expected JSON fragment");
}

std::string simpleSource() {
    return R"PS(
title simple
background_color #123456

OBJECTS

Background
black

Player
white

LEGEND

. = Background
P = Player

COLLISIONLAYERS

Background
Player

LEVELS

P..
...
)PS";
}

std::string flickscreenSource() {
    return R"PS(
title flick
flickscreen 2x2

OBJECTS

Background
black

Player
white

LEGEND

. = Background
P = Player

COLLISIONLAYERS

Background
Player

LEVELS

....
....
..P.
....
)PS";
}

std::string edgeFlickscreenSource() {
    return R"PS(
title flick edge
flickscreen 3x3

OBJECTS

Background
black

Player
white

LEGEND

. = Background
P = Player

COLLISIONLAYERS

Background
Player

LEVELS

.....
.....
.....
.....
....P
)PS";
}

std::string brokenSource() {
    return R"PS(
title broken

OBJECTS

Background
black

Player
white

LEGEND

. = Background
P = Player
B = Background and Player

COLLISIONLAYERS

Background
Player

RULES

[ no B ] -> [ ]

LEVELS

P
)PS";
}

void reportsSimpleFullLevel() {
    const std::string report = buildReportForSources(
        {SourceInput{"simple.txt", simpleSource()}},
        ReportOptions{DisplaySpec{800, 480, 5}, true});

    requireContains(report, R"JSON("source":"simple.txt")JSON");
    requireContains(report, R"JSON("compile_ok":true)JSON");
    requireContains(report, R"JSON("background_color":"#123456")JSON");
    requireContains(report, R"JSON("mode":"full")JSON");
    requireContains(report, R"JSON("board_width":3)JSON");
    requireContains(report, R"JSON("board_height":2)JSON");
    requireContains(report, R"JSON("tile_pixels":240)JSON");
    requireContains(report, R"JSON("degraded":false)JSON");
}

void reportsFlickscreenMetadataAndViewport() {
    const std::string report = buildReportForSources(
        {SourceInput{"flick.txt", flickscreenSource()}},
        ReportOptions{DisplaySpec{800, 480, 5}, true});

    requireContains(report, R"JSON("source":"flick.txt")JSON");
    requireContains(report, R"JSON("compile_ok":true)JSON");
    requireContains(report, R"JSON("metadata":{"flickscreen":"2x2")JSON");
    requireContains(report, R"JSON("mode":"flickscreen")JSON");
    requireContains(report, R"JSON("viewport_width":2)JSON");
    requireContains(report, R"JSON("viewport_height":2)JSON");
    requireContains(report, R"JSON("tile_pixels":240)JSON");
}

void reportsFlickscreenEdgePageBounds() {
    const std::string report = buildReportForSources(
        {SourceInput{"edge.txt", edgeFlickscreenSource()}},
        ReportOptions{DisplaySpec{800, 480, 5}, true});

    requireContains(report, R"JSON("source":"edge.txt")JSON");
    requireContains(report, R"JSON("mode":"flickscreen")JSON");
    requireContains(report, R"JSON("viewport_x":3)JSON");
    requireContains(report, R"JSON("viewport_y":3)JSON");
    requireContains(report, R"JSON("viewport_width":3)JSON");
    requireContains(report, R"JSON("viewport_height":3)JSON");
    requireContains(report, R"JSON("viewport_max_x":5)JSON");
    requireContains(report, R"JSON("viewport_max_y":5)JSON");
    requireContains(report, R"JSON("fits":true)JSON");
}

void reportsBrokenSourceDiagnostics() {
    const std::string report = buildReportForSources(
        {SourceInput{"broken.txt", brokenSource()}},
        ReportOptions{DisplaySpec{800, 480, 5}, true});

    requireContains(report, R"JSON("source":"broken.txt")JSON");
    requireContains(report, R"JSON("compile_ok":false)JSON");
    requireContains(report, R"JSON("diagnostics":[)JSON");
}

} // namespace

int main() {
    reportsSimpleFullLevel();
    reportsFlickscreenMetadataAndViewport();
    reportsFlickscreenEdgePageBounds();
    reportsBrokenSourceDiagnostics();
    return 0;
}
