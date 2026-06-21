#include <cassert>
#include <fstream>
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

    assert(!program.objects.empty());
    assert(program.objects.front().id == 0);
    for (size_t i = 0; i < program.objects.size(); ++i) {
        assert(program.objects[i].layer >= 0);
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
