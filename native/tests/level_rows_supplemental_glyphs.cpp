#undef NDEBUG

#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "compiler/parser_glyphs.hpp"
#include "generator/level_rows.hpp"
#include "generator/output_writer.hpp"
#include "runtime/compiled_rules.hpp"
#include "search/difficulty.hpp"

#include <algorithm>
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

puzzlescript::LoadedGame compileSource(const std::string& source) {
    puzzlescript::compiler::DiagnosticSink diagnostics;
    const auto state = puzzlescript::compiler::parseSource(source, diagnostics);
    puzzlescript::LoadedGame loadedGame;
    if (auto error = puzzlescript::compiler::lowerToRuntimeGame(state, loadedGame)) {
        throw std::runtime_error(error->message);
    }
    if (loadedGame.information) {
        puzzlescript::compiler::publishParserGlyphs(
            *std::const_pointer_cast<puzzlescript::Game>(loadedGame.information), state);
        puzzlescript::attachLinkedCompiledRules(
            *std::const_pointer_cast<puzzlescript::Game>(loadedGame.information), source);
    }
    return loadedGame;
}

} // namespace

int main() {
    const puzzlescript::LoadedGame loaded = compileSource(readFixture("src/demo/sokoban_basic.txt") + "\n");
    assert(loaded.information);
  puzzlescript::Game game = *loaded.information;
    const puzzlescript::LevelTemplate& level = game.levels.front();

    game.glyphOrder.erase(
        std::remove(game.glyphOrder.begin(), game.glyphOrder.end(), "@"),
        game.glyphOrder.end());
    game.glyphMaskTable.erase(
        std::remove_if(
            game.glyphMaskTable.begin(),
            game.glyphMaskTable.end(),
            [](const puzzlescript::Game::NamedMaskEntry& entry) {
                return entry.name == "@";
            }),
        game.glyphMaskTable.end());
    assert(!puzzlescript::generator::canLosslesslySerializeLevel(game, level));

    const auto added = puzzlescript::generator::ensureSupplementalGlyphs(game, level);
    assert(!added.empty());
    assert(puzzlescript::generator::canLosslesslySerializeLevel(game, level));

    const std::string source = readFixture("src/demo/sokoban_basic.txt");
    const std::string patched = puzzlescript::generator::appendLegendEntries(source, added);
    assert(patched.find(added.front().legendLine) != std::string::npos);

    const puzzlescript::LoadedGame reloaded = compileSource(patched + "\n");
    assert(reloaded.information);
    assert(puzzlescript::generator::canLosslesslySerializeLevel(*reloaded.information, reloaded.information->levels.front()));

    return 0;
}
