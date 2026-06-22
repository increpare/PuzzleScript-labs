#undef NDEBUG

#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "generator/spec_parser.hpp"
#include "runtime/compiled_rules.hpp"

#include <cassert>
#include <fstream>
#include <sstream>
#include <string>

namespace {

std::string readFixture(const char* relPath) {
    std::ifstream in(relPath);
    std::stringstream buffer;
    buffer << in.rdbuf();
    return buffer.str();
}

puzzlescript::LoadedGame loadSokobanFixture() {
    const std::string source = readFixture("src/demo/sokoban_basic.txt") + "\n";
    puzzlescript::compiler::DiagnosticSink diagnostics;
    const auto state = puzzlescript::compiler::parseSource(source, diagnostics);
    puzzlescript::LoadedGame loadedGame;
    if (auto error = puzzlescript::compiler::lowerToRuntimeGame(state, loadedGame)) {
        throw std::runtime_error(error->message);
    }
    if (loadedGame.information) {
        puzzlescript::attachLinkedCompiledRules(*std::const_pointer_cast<puzzlescript::Game>(loadedGame.information), source);
    }
    return loadedGame;
}

} // namespace

int main() {
    const puzzlescript::LoadedGame loaded = loadSokobanFixture();
    assert(loaded.information);

    const std::string singleBlock = R"(
dimensions: 3x2
take: 1
name: solo

choose 1 [ no wall ] -> [ player ]
)";
    const auto blocks = puzzlescript::generator::parseLevelSetSpec(singleBlock, *loaded.information);
    assert(blocks.size() == 1);
    assert(blocks[0].header.width == 3);
    assert(blocks[0].header.height == 2);
    assert(blocks[0].header.take == 1);
    assert(blocks[0].header.name == "solo");
    assert(blocks[0].ruleLines.size() == 1);
    assert(blocks[0].initLevel.width == 3);
    assert(blocks[0].initLevel.height == 2);

    const auto presetBlocks = puzzlescript::generator::parseLevelSetSpec(
        readFixture("src/tests/generator_presets/sokoban_levelset_tiny.gen"),
        *loaded.information);
    assert(presetBlocks.size() == 2);
    assert(presetBlocks[0].header.name == "tiny");
    assert(presetBlocks[1].header.name == "small");
    return 0;
}
