#include <cassert>
#include <fstream>
#include <set>
#include <sstream>
#include <string>

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

    const std::string json = puzzlescript::compiler::serializeSemanticProgramJson(program);
    assert(json.find("\"semantic_program\"") != std::string::npos);
    assert(json.find("\"collision_layers\"") != std::string::npos);

    return 0;
}
