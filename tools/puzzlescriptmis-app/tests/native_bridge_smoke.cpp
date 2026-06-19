#include "native_bridge/NativeGameBridge.h"

#include <algorithm>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) {
        std::cerr << "native_bridge_smoke: " << message << "\n";
        std::exit(1);
    }
}

const psbridge::ObjectInfo* findObjectByName(const std::vector<psbridge::ObjectInfo>& objects, const std::string& name) {
    const auto it = std::find_if(objects.begin(), objects.end(), [&](const psbridge::ObjectInfo& object) {
        return object.name == name;
    });
    return it == objects.end() ? nullptr : &*it;
}

const psbridge::GlyphInfo* findGlyph(const std::vector<psbridge::GlyphInfo>& glyphs, const std::string& glyphName) {
    const auto it = std::find_if(glyphs.begin(), glyphs.end(), [&](const psbridge::GlyphInfo& glyph) {
        return glyph.glyph == glyphName;
    });
    return it == glyphs.end() ? nullptr : &*it;
}

const psbridge::LegendInfo* findLegend(const std::vector<psbridge::LegendInfo>& legends, const std::string& legendName) {
    const auto it = std::find_if(legends.begin(), legends.end(), [&](const psbridge::LegendInfo& legend) {
        return legend.name == legendName;
    });
    return it == legends.end() ? nullptr : &*it;
}

bool hasNonEmptyCell(const psbridge::LayerGrid& grid) {
    return std::any_of(grid.displayObjectIds.begin(), grid.displayObjectIds.end(), [](int32_t displayId) {
        return displayId != 0;
    });
}

bool sameGrid(const psbridge::LayerGrid& lhs, const psbridge::LayerGrid& rhs) {
    return lhs.layerCount == rhs.layerCount
        && lhs.width == rhs.width
        && lhs.height == rhs.height
        && lhs.displayObjectIds == rhs.displayObjectIds;
}

} // namespace

int main() {
    const std::string source = R"(title native bridge smoke

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

Robot
green
00000
00000
00000
00000
00000

Hat
red
00000
00000
00000
00000
00000

=======
LEGEND
=======
. = Background
P = Player
Alias = Player
Duo = Player and Hat
Actor = Player or Robot

================
COLLISIONLAYERS
================
Background
Player, Robot, Hat

=======
LEVELS
=======
P.
)";

    psbridge::NativeGameBridge bridge;
    require(bridge.compileSource(source), bridge.lastDiagnostic().message.c_str());
    require(bridge.hasGame(), "bridge should retain a compiled game");
    require(bridge.levelCount() == 1, "expected one level");
    require(bridge.objectCount() >= 2, "expected at least background and player objects");
    require(bridge.layerCount() >= 2, "expected two collision layers");

    const auto objects = bridge.objects();
    const psbridge::ObjectInfo* player = findObjectByName(objects, "player");
    require(player != nullptr, "expected player object info");
    require(player->displayId == player->nativeId + 1, "expected display id to be native id plus one");
    const psbridge::ObjectInfo* robot = findObjectByName(objects, "robot");
    require(robot != nullptr, "expected robot object info");
    const psbridge::ObjectInfo* hat = findObjectByName(objects, "hat");
    require(hat != nullptr, "expected hat object info");

    const auto glyphs = bridge.glyphs();
    const psbridge::GlyphInfo* playerGlyph = findGlyph(glyphs, "P");
    require(playerGlyph != nullptr, "expected P glyph info");
    require(
        std::find(playerGlyph->displayObjectIds.begin(), playerGlyph->displayObjectIds.end(), player->displayId)
            != playerGlyph->displayObjectIds.end(),
        "expected P glyph to include player display id");

    const auto synonyms = bridge.legends(psbridge::LegendKind::Synonym);
    const psbridge::LegendInfo* alias = findLegend(synonyms, "alias");
    require(alias != nullptr, "expected alias synonym info");
    require(alias->displayObjectIds.size() == 1 && alias->displayObjectIds[0] == player->displayId, "expected alias to map player");

    const auto aggregates = bridge.legends(psbridge::LegendKind::Aggregate);
    const psbridge::LegendInfo* duo = findLegend(aggregates, "duo");
    require(duo != nullptr, "expected duo aggregate info");
    require(
        std::find(duo->displayObjectIds.begin(), duo->displayObjectIds.end(), player->displayId) != duo->displayObjectIds.end()
            && std::find(duo->displayObjectIds.begin(), duo->displayObjectIds.end(), hat->displayId) != duo->displayObjectIds.end(),
        "expected duo to include player and hat");

    const auto properties = bridge.legends(psbridge::LegendKind::Property);
    const psbridge::LegendInfo* actor = findLegend(properties, "actor");
    require(actor != nullptr, "expected actor property info");
    require(
        std::find(actor->displayObjectIds.begin(), actor->displayObjectIds.end(), player->displayId) != actor->displayObjectIds.end()
            && std::find(actor->displayObjectIds.begin(), actor->displayObjectIds.end(), robot->displayId) != actor->displayObjectIds.end(),
        "expected actor to include player and robot");

    psbridge::LayerGrid grid = bridge.currentLayerGrid();
    require(grid.width == 2, "expected grid width 2");
    require(grid.height == 1, "expected grid height 1");
    require(grid.layerCount >= 2, "expected grid layer count >= 2");
    require(hasNonEmptyCell(grid), "expected non-empty display ids in current grid");

    bool won = false;
    bool changed = false;
    require(bridge.step(PS_INPUT_RIGHT, &won, &changed), "expected right step to execute");
    require(changed, "expected right step to report a changed board");

    grid = bridge.currentLayerGrid();
    require(grid.width == 2, "expected grid width 2 after step");
    require(grid.height == 1, "expected grid height 1 after step");
    require(hasNonEmptyCell(grid), "expected non-empty display ids after step");

    const psbridge::Status status = bridge.status();
    require(status.width == 2, "expected status width 2 after step");
    require(status.height == 1, "expected status height 1 after step");

    require(bridge.undo(), "expected undo to succeed");
    const psbridge::LayerGrid initialGrid = bridge.currentLayerGrid();
    bool blockedWon = false;
    bool blockedChanged = false;
    require(bridge.step(PS_INPUT_LEFT, &blockedWon, &blockedChanged), "expected blocked left step to execute");
    require(sameGrid(initialGrid, bridge.currentLayerGrid()), "expected blocked left step to leave the board unchanged");

    require(bridge.restart(), "expected restart to succeed");

    return 0;
}
