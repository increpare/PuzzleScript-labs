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

bool hasNonEmptyCell(const psbridge::LayerGrid& grid) {
    return std::any_of(grid.displayObjectIds.begin(), grid.displayObjectIds.end(), [](int32_t displayId) {
        return displayId != 0;
    });
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

    const auto glyphs = bridge.glyphs();
    const psbridge::GlyphInfo* playerGlyph = findGlyph(glyphs, "P");
    require(playerGlyph != nullptr, "expected P glyph info");
    require(
        std::find(playerGlyph->displayObjectIds.begin(), playerGlyph->displayObjectIds.end(), player->displayId)
            != playerGlyph->displayObjectIds.end(),
        "expected P glyph to include player display id");

    psbridge::LayerGrid grid = bridge.currentLayerGrid();
    require(grid.width == 2, "expected grid width 2");
    require(grid.height == 1, "expected grid height 1");
    require(grid.layerCount >= 2, "expected grid layer count >= 2");
    require(hasNonEmptyCell(grid), "expected non-empty display ids in current grid");

    bool won = false;
    require(bridge.step(PS_INPUT_RIGHT, &won), "expected right step to execute");

    grid = bridge.currentLayerGrid();
    require(grid.width == 2, "expected grid width 2 after step");
    require(grid.height == 1, "expected grid height 1 after step");
    require(hasNonEmptyCell(grid), "expected non-empty display ids after step");

    const psbridge::Status status = bridge.status();
    require(status.width == 2, "expected status width 2 after step");
    require(status.height == 1, "expected status height 1 after step");

    require(bridge.undo(), "expected undo to succeed");
    require(bridge.restart(), "expected restart to succeed");

    return 0;
}
