#undef NDEBUG

#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "generator/generation_rules.hpp"
#include "generator/level_rows.hpp"
#include "generator/templatize.hpp"
#include "runtime/compiled_rules.hpp"

#include <cassert>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>

namespace {

std::string readFile(const char* path) {
    std::ifstream in(path);
    if (!in) {
        throw std::runtime_error(std::string("Unable to read fixture: ") + path);
    }
    std::stringstream buffer;
    buffer << in.rdbuf();
    return buffer.str();
}

puzzlescript::LoadedGame loadGame(const std::string& source) {
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

int32_t objectIdByName(const puzzlescript::Game& game, const std::string& targetName) {
    for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
        std::string name = game.idDict[static_cast<size_t>(objectId)];
        for (char& ch : name) {
            ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
        }
        if (name == targetName) {
            return objectId;
        }
    }
    throw std::runtime_error("Object not found: " + targetName);
}

std::map<int32_t, int32_t> countObjects(const puzzlescript::Game& game, const puzzlescript::LevelTemplate& level) {
    std::map<int32_t, int32_t> counts;
    const int32_t tileCount = level.width * level.height;
    for (int32_t tile = 0; tile < tileCount; ++tile) {
        const size_t base = static_cast<size_t>(tile * game.strideObject);
        for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
            const uint32_t word = puzzlescript::maskWordIndex(static_cast<uint32_t>(objectId));
            if (word >= game.wordCount) {
                continue;
            }
            if ((level.objects[base + word] & puzzlescript::maskBit(static_cast<uint32_t>(objectId))) == 0) {
                continue;
            }
            if (objectId == game.backgroundId) {
                continue;
            }
            ++counts[objectId];
        }
    }
    return counts;
}

} // namespace

int main() {
    const std::string source = readFile("src/demo/microban.txt");
    const puzzlescript::LoadedGame loaded = loadGame(source);
    const auto& game = *loaded.information;

    size_t sourceLevelIndex = 0;
    for (; sourceLevelIndex < game.levels.size(); ++sourceLevelIndex) {
        if (!game.levels[sourceLevelIndex].isMessage) {
            break;
        }
    }
    assert(sourceLevelIndex < game.levels.size());

    puzzlescript::generator::TemplatizeOptions options;
    options.take = 1;
    options.globalSeed = 1;
    options.levelIndex = static_cast<int32_t>(sourceLevelIndex);
    const auto blocks = puzzlescript::generator::templatizeGame(game, options);
    assert(!blocks.empty());
    const auto& block = blocks.front();

    puzzlescript::compiler::DiagnosticSink diagnostics;
    const auto parserState = puzzlescript::compiler::parseSource(source, diagnostics);
    puzzlescript::generator::NameResolver resolver(game, parserState);
    const auto program = puzzlescript::generator::compileGenerationProgram(block.ruleLines, game, resolver);
    const puzzlescript::LevelTemplate init = puzzlescript::generator::synthesizeBackgroundGrid(game, block.width, block.height);
    const std::map<int32_t, int32_t> expected = countObjects(game, game.levels[sourceLevelIndex]);

    const int32_t targetId = objectIdByName(game, "target");
    const int32_t crateId = objectIdByName(game, "crate");
    std::cerr << "expected targets=" << expected.at(targetId) << " crates=" << expected.at(crateId) << "\n";
    std::cerr << "rules:\n";
    for (const std::string& rule : block.ruleLines) {
        std::cerr << "  " << rule << "\n";
    }

    const uint64_t blockSeed = block.seed.value_or(1);
    uint64_t mismatches = 0;
    uint64_t successes = 0;
    for (uint64_t sampleId = 0; sampleId < 50000; ++sampleId) {
        const uint64_t sampleSeed = puzzlescript::generator::splitmix64(
            blockSeed ^ (sampleId + 0x9e3779b97f4a7c15ULL));
        puzzlescript::generator::Rng rng(sampleSeed);
        puzzlescript::LevelTemplate generated = init;
        if (!puzzlescript::generator::applyProgram(program, init, game, rng, generated)) {
            continue;
        }
        ++successes;
        const auto actual = countObjects(game, generated);
        if (actual != expected) {
            ++mismatches;
            if (mismatches <= 5) {
                std::cerr << "mismatch sampleId=" << sampleId << " seed=" << sampleSeed
                          << " targets=" << actual.count(targetId) << " crates=" << actual.count(crateId)
                          << "\n";
            }
        }
    }
    std::cerr << "successes=" << successes << " mismatches=" << mismatches << "\n";
    assert(mismatches == 0);

    puzzlescript::generator::Rng verifyRng(puzzlescript::generator::splitmix64(blockSeed ^ 0x9e3779b97f4a7c15ULL));
    puzzlescript::LevelTemplate verifyLevel = init;
    assert(puzzlescript::generator::applyProgram(program, init, game, verifyRng, verifyLevel));
    const auto rows = puzzlescript::generator::levelTemplateToRows(game, verifyLevel);
    int32_t combinedCells = 0;
    int32_t atGlyphs = 0;
    const int32_t tileCount = verifyLevel.width * verifyLevel.height;
    for (int32_t tile = 0; tile < tileCount; ++tile) {
        bool hasTarget = false;
        bool hasCrate = false;
        const size_t base = static_cast<size_t>(tile * game.strideObject);
        for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
            const uint32_t word = puzzlescript::maskWordIndex(static_cast<uint32_t>(objectId));
            if (word >= game.wordCount) {
                continue;
            }
            if ((verifyLevel.objects[base + word] & puzzlescript::maskBit(static_cast<uint32_t>(objectId))) == 0) {
                continue;
            }
            std::string name = game.idDict[static_cast<size_t>(objectId)];
            for (char& ch : name) {
                ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
            }
            if (name == "target") {
                hasTarget = true;
            } else if (name == "crate") {
                hasCrate = true;
            }
        }
        if (hasTarget && hasCrate) {
            ++combinedCells;
        }
    }
    for (const std::string& row : rows) {
        for (char ch : row) {
            if (ch == '@') {
                ++atGlyphs;
            }
        }
    }
    std::cerr << "combinedCells=" << combinedCells << " atGlyphs=" << atGlyphs << "\n";
    assert(combinedCells == atGlyphs);

    return 0;
}
