#undef NDEBUG  // keep assert() live under the Release -DNDEBUG build
#include <algorithm>
#include <cassert>
#include <string>
#include <vector>

#include "runtime/core.hpp"
#include "solver/static_analysis.hpp"

namespace {

bool contains(const std::vector<std::string>& values, const std::string& needle) {
    return std::find(values.begin(), values.end(), needle) != values.end();
}

} // namespace

int main() {
    const std::string runtimeIr = R"json({
      "schema_version": 1,
      "document": {"command":["loadLevel",0],"error_count":0,"errors":[],"input_file":"","random_seed":""},
      "game": {
        "strides": {"object": 1, "movement": 1, "layers": 4},
        "object_count": 4,
        "colors": {"foreground": "#ffffff", "background": "#000000"},
        "background": {"id": 0, "layer": 0},
        "metadata_pairs": [],
        "id_dict": ["background", "locked", "open", "player"],
        "player_mask": {"aggregate": false, "mask": [8]},
        "static_analysis_extras": {
          "written_objects": [2],
          "movement_mentioned_objects": [4]
        },
        "objects": [
          {"name":"background","id":0,"layer":0,"colors":["#000000"],"spritematrix":[[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]]},
          {"name":"locked","id":1,"layer":1,"colors":["#be2633"],"spritematrix":[[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]]},
          {"name":"open","id":2,"layer":1,"colors":["#1d57f7"],"spritematrix":[[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]]},
          {"name":"player","id":3,"layer":2,"colors":["#ffffff"],"spritematrix":[[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]]}
        ],
        "levels": [],
        "winconditions": [],
        "sfx_events": {},
        "sfx_creation_masks": [],
        "sfx_destruction_masks": [],
        "sfx_movement_masks": [],
        "sfx_movement_failure_masks": []
      }
    })json";

    puzzlescript::LoadedGame loadedGame;
    const auto error = puzzlescript::loadGameFromJson(runtimeIr, loadedGame);
    assert(error == nullptr);
    assert(loadedGame.information != nullptr);

    const puzzlescript::Game& game = *loadedGame.information;
    assert(game.hasStaticAnalysisExtraWrittenObjects);
    assert(game.hasStaticAnalysisExtraMovementMentionedObjects);

    const auto analysis = puzzlescript::solver::analyzeStaticObjects(game);
    assert((analysis.writtenObjects[0] & puzzlescript::maskBit(1)) != 0);
    assert((analysis.movementMentionedObjects[0] & puzzlescript::maskBit(2)) != 0);

    const auto staticNames = puzzlescript::solver::staticObjectNames(game, analysis.staticObjects);
    assert(contains(staticNames, "background"));
    assert(!contains(staticNames, "locked"));
    assert(!contains(staticNames, "open"));
    assert(!contains(staticNames, "player"));

    return 0;
}
