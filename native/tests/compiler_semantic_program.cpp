#include <algorithm>
#include <cassert>
#include <fstream>
#include <set>
#include <sstream>
#include <string>
#include <vector>

#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "compiler/semantic_program.hpp"

namespace {

std::string readFixture(const char* relPath) {
    std::ifstream in(relPath);
    std::stringstream buffer;
    buffer << in.rdbuf();
    return buffer.str();
}

} // namespace

int main() {
    const std::string source = readFixture("src/demo/sokoban_basic.txt") + "\n";
    assert(!source.empty());

    puzzlescript::compiler::DiagnosticSink diagnostics;
    const auto state = puzzlescript::compiler::parseSource(source, diagnostics);
    puzzlescript::LoadedGame loadedGame;
    auto error = puzzlescript::compiler::lowerToRuntimeGame(state, loadedGame);
    assert(!error);
    assert(loadedGame.information);

    const auto program = puzzlescript::compiler::buildSemanticProgram(*loadedGame.information);

    // sokoban_basic is a single-layer-conforming fixture: every object sits on
    // exactly one collision layer (layer >= 0) and every name is unique. That
    // invariant is the SemanticProgram contract's precondition (enforced over the
    // corpus by semantic_program_parity_corpus_node.js), so these are deliberate
    // conformance checks, not accidental assumptions about all games.
    assert(!program.objects.empty());
    assert(program.objects.front().id == 0);
    std::set<std::string> seenNames;
    for (size_t i = 0; i < program.objects.size(); ++i) {
        assert(program.objects[i].layer >= 0);
        assert(seenNames.insert(program.objects[i].name).second);  // single layer => unique name
        if (i > 0) {
            assert(program.objects[i].id > program.objects[i - 1].id);
        }
    }

    assert(!program.collisionLayers.empty());
    for (const auto& layer : program.collisionLayers) {
        for (int32_t id : layer) {
            assert(id >= 0);
        }
    }

    // Resolved legends: sokoban has 5 synonyms and the aggregate "@" = Crate and
    // Target. Each legend resolves to a sorted set of base object ids; "@" must
    // resolve to {target, crate} on both the C++ and JS sides.
    assert(program.synonyms.size() == 5);
    assert(program.properties.empty());

    int32_t crateId = -1;
    int32_t targetId = -1;
    for (const auto& object : program.objects) {
        if (object.name == "crate") crateId = object.id;
        if (object.name == "target") targetId = object.id;
    }
    assert(crateId >= 0 && targetId >= 0);

    const puzzlescript::compiler::SemanticLegend* atLegend = nullptr;
    for (const auto& legend : program.aggregates) {
        if (legend.name == "@") atLegend = &legend;
    }
    assert(atLegend != nullptr);
    const std::vector<int32_t> expectedAt{
        std::min(crateId, targetId),
        std::max(crateId, targetId),
    };
    assert(atLegend->objectIds == expectedAt);

    // Resolved levels: sokoban_basic has 2 grid level templates (no messages),
    // level 0 is 6x7. Background fill means every cell contains the background
    // object, and each level has exactly one player cell.
    assert(program.levels.size() == 2);

    int32_t backgroundId = -1;
    int32_t playerId = -1;
    for (const auto& object : program.objects) {
        if (object.name == "background") backgroundId = object.id;
        if (object.name == "player") playerId = object.id;
    }
    assert(backgroundId >= 0 && playerId >= 0);

    assert(!program.levels[0].isMessage);
    assert(program.levels[0].width == 6);
    assert(program.levels[0].height == 7);

    for (const auto& level : program.levels) {
        assert(!level.isMessage);
        assert(level.cells.size() == static_cast<size_t>(level.width) * static_cast<size_t>(level.height));
        int playerCells = 0;
        for (const auto& cell : level.cells) {
            assert(std::find(cell.begin(), cell.end(), backgroundId) != cell.end());
            if (std::find(cell.begin(), cell.end(), playerId) != cell.end()) {
                ++playerCells;
            }
        }
        assert(playerCells == 1);
    }

    const std::string json = puzzlescript::compiler::serializeSemanticProgramJson(program);
    assert(json.find("\"semantic_program\"") != std::string::npos);
    assert(json.find("\"collision_layers\"") != std::string::npos);
    assert(json.find("\"legends\"") != std::string::npos);
    assert(json.find("\"aggregates\"") != std::string::npos);
    assert(json.find("\"levels\"") != std::string::npos);
    assert(json.find("\"cells\"") != std::string::npos);

    return 0;
}
