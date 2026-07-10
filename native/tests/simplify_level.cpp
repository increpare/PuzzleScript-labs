#undef NDEBUG

#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "runtime/compiled_rules.hpp"
#include "search/difficulty.hpp"
#include "search/simplify.hpp"

#include <cassert>
#include <cctype>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

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
        puzzlescript::attachLinkedCompiledRules(
            *std::const_pointer_cast<puzzlescript::Game>(loadedGame.information), source);
    }
    return loadedGame;
}

puzzlescript::LoadedGame loadSokobanFixture() {
    return compileSource(readFixture("src/demo/sokoban_basic.txt") + "\n");
}

int32_t objectIdByName(const puzzlescript::Game& game, const std::string& lowerName) {
    for (int32_t id = 0; id < game.objectCount; ++id) {
        std::string name = game.idDict[static_cast<size_t>(id)];
        for (char& ch : name) {
            ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
        }
        if (name == lowerName) {
            return id;
        }
    }
    return -1;
}

int32_t countOccupiedCells(const puzzlescript::Game& game, const puzzlescript::LevelTemplate& level) {
    const std::vector<int32_t> grid = puzzlescript::search::levelTemplateToLayerCellObjectIds(game, level);
    int32_t count = 0;
    for (int32_t cell : grid) {
        if (cell >= 0) {
            ++count;
        }
    }
    return count;
}

puzzlescript::LevelTemplate levelWithCell(
    const puzzlescript::Game& game,
    const puzzlescript::LevelTemplate& base,
    int32_t layer,
    int32_t x,
    int32_t y,
    int32_t objectId) {
    std::vector<int32_t> grid = puzzlescript::search::levelTemplateToLayerCellObjectIds(game, base);
    const size_t offset = static_cast<size_t>(layer * base.width * base.height + y * base.width + x);
    grid[offset] = objectId;
    return puzzlescript::search::levelTemplateFromLayerCellObjectIds(
        game, base.width, base.height, grid);
}

bool cellHasObject(
    const puzzlescript::Game& game,
    const puzzlescript::LevelTemplate& level,
    int32_t layer,
    int32_t x,
    int32_t y,
    int32_t objectId) {
    const std::vector<int32_t> grid = puzzlescript::search::levelTemplateToLayerCellObjectIds(game, level);
    const size_t offset = static_cast<size_t>(layer * level.width * level.height + y * level.width + x);
    return grid[offset] == objectId;
}

bool findPlayerCell(
    const puzzlescript::Game& game,
    const puzzlescript::LevelTemplate& level,
    int32_t& layer,
    int32_t& x,
    int32_t& y) {
    const int32_t playerId = objectIdByName(game, "player");
    const std::vector<int32_t> grid = puzzlescript::search::levelTemplateToLayerCellObjectIds(game, level);
    for (size_t index = 0; index < grid.size(); ++index) {
        if (grid[index] != playerId) {
            continue;
        }
        const size_t plane = static_cast<size_t>(level.width * level.height);
        layer = static_cast<int32_t>(index / plane);
        const size_t within = index % plane;
        y = static_cast<int32_t>(within / static_cast<size_t>(level.width));
        x = static_cast<int32_t>(within % static_cast<size_t>(level.width));
        return true;
    }
    return false;
}

puzzlescript::LevelTemplate buildCustomGridLevel(
    const puzzlescript::Game& game,
    int32_t width,
    int32_t height,
    const std::vector<int32_t>& layer0Cells,
    const std::vector<int32_t>& layer1Cells,
    const std::vector<int32_t>& layer2Cells) {
    const size_t plane = static_cast<size_t>(width * height);
    assert(layer0Cells.size() == plane && layer1Cells.size() == plane && layer2Cells.size() == plane);
    std::vector<int32_t> grid(static_cast<size_t>(game.layerCount) * plane, -1);
    for (int32_t layer = 0; layer < game.layerCount; ++layer) {
        const std::vector<int32_t>* source = &layer0Cells;
        if (layer == 1) {
            source = &layer1Cells;
        } else if (layer == 2) {
            source = &layer2Cells;
        }
        for (size_t tile = 0; tile < plane; ++tile) {
            grid[static_cast<size_t>(layer) * plane + tile] = (*source)[tile];
        }
    }
    return puzzlescript::search::levelTemplateFromLayerCellObjectIds(game, width, height, grid);
}

puzzlescript::LevelTemplate buildBlockingShortcutLevel(
    const puzzlescript::Game& game,
    int32_t crateId,
    int32_t& blockerX,
    int32_t& blockerY) {
    const int32_t width = 8;
    const int32_t height = 5;
    const int32_t wallId = objectIdByName(game, "wall");
    const int32_t backgroundId = objectIdByName(game, "background");
    const int32_t playerId = objectIdByName(game, "player");
    const int32_t targetId = objectIdByName(game, "target");
    const size_t plane = static_cast<size_t>(width * height);
    std::vector<int32_t> layer0(plane, backgroundId);
    std::vector<int32_t> layer1(plane, -1);
    std::vector<int32_t> layer2(plane, -1);
    auto set = [&](int32_t x, int32_t y, int32_t layer, int32_t id) {
        std::vector<int32_t>* cells = &layer0;
        if (layer == 1) {
            cells = &layer1;
        } else if (layer == 2) {
            cells = &layer2;
        }
        (*cells)[static_cast<size_t>(y * width + x)] = id;
    };
    for (int32_t y = 0; y < height; ++y) {
        for (int32_t x = 0; x < width; ++x) {
            const bool border = x == 0 || y == 0 || x == width - 1 || y == height - 1;
            if (border) {
                set(x, y, 2, wallId);
            }
        }
    }
    set(1, 1, 2, playerId);
    set(2, 2, 2, crateId);
    blockerX = 2;
    blockerY = 2;
    set(3, 3, 2, crateId);
    set(6, 3, 1, targetId);
    return buildCustomGridLevel(game, width, height, layer0, layer1, layer2);
}

puzzlescript::LevelTemplate buildBisectionLevel(
    const puzzlescript::Game& game,
    int32_t crateId,
    int32_t& blockerX,
    int32_t& blockerY) {
    const int32_t width = 8;
    const int32_t height = 5;
    const int32_t wallId = objectIdByName(game, "wall");
    const int32_t backgroundId = objectIdByName(game, "background");
    const int32_t playerId = objectIdByName(game, "player");
    const int32_t targetId = objectIdByName(game, "target");
    const size_t plane = static_cast<size_t>(width * height);
    std::vector<int32_t> layer0(plane, backgroundId);
    std::vector<int32_t> layer1(plane, -1);
    std::vector<int32_t> layer2(plane, -1);
    auto set = [&](int32_t x, int32_t y, int32_t layer, int32_t id) {
        std::vector<int32_t>* cells = &layer0;
        if (layer == 1) {
            cells = &layer1;
        } else if (layer == 2) {
            cells = &layer2;
        }
        (*cells)[static_cast<size_t>(y * width + x)] = id;
    };
    for (int32_t y = 0; y < height; ++y) {
        for (int32_t x = 0; x < width; ++x) {
            const bool border = x == 0 || y == 0 || x == width - 1 || y == height - 1;
            if (border) {
                set(x, y, 2, wallId);
            }
        }
    }
    set(1, 1, 2, playerId);
    set(2, 2, 2, crateId);
    blockerX = 2;
    blockerY = 2;
    set(3, 3, 2, crateId);
    set(6, 3, 1, targetId);
    set(6, 1, 2, crateId);
    set(1, 3, 2, crateId);
    return buildCustomGridLevel(game, width, height, layer0, layer1, layer2);
}

puzzlescript::LoadedGame loadHeroFixture() {
    std::string source = readFixture("src/demo/sokoban_basic.txt");
    const size_t objectsStart = source.find("OBJECTS");
    const size_t legendStart = source.find("LEGEND", objectsStart);
    const size_t objectName = source.find("\nPlayer\n", objectsStart);
    if (objectName != std::string::npos && objectName < legendStart) {
        source.replace(objectName + 1, 6, "Hero");
    }
    size_t pos = 0;
    while ((pos = source.find("P = Player", pos)) != std::string::npos) {
        source.replace(pos, 10, "H = Hero\nPlayer = Hero");
        pos += 22;
    }
    pos = 0;
    while ((pos = source.find("[ > Player |", pos)) != std::string::npos) {
        source.replace(pos, 12, "[ > Hero |");
        pos += 10;
    }
    pos = 0;
    while ((pos = source.find("Player, Wall", pos)) != std::string::npos) {
        source.replace(pos, 12, "Hero, Wall");
        pos += 10;
    }
    const size_t levelsIndex = source.find("LEVELS");
    if (levelsIndex != std::string::npos) {
        for (size_t index = levelsIndex; index < source.size(); ++index) {
            if (source[index] == 'P') {
                source[index] = 'H';
            }
        }
    }
    return compileSource(source + "\n");
}

} // namespace

int main() {
    const puzzlescript::LoadedGame loaded = loadSokobanFixture();
    assert(loaded.information);
    const puzzlescript::Game& game = *loaded.information;
    const puzzlescript::LevelTemplate& level = game.levels.front();
    assert(!level.isMessage);

    puzzlescript::search::DifficultyOptions diffOpts;
    diffOpts.timeoutMs = 5000;
    diffOpts.runSupplemental = true;
    const auto assessed = puzzlescript::search::assessGeneratedLevelDifficulty(loaded, level, diffOpts);
    assert(assessed.solved);
    assert(puzzlescript::search::replaySolutionWins(loaded, level, assessed.solution));

    puzzlescript::search::SimplifyOptions simpOpts;
    simpOpts.bfsTimeoutMs = 5000;
    const auto baseline = puzzlescript::search::simplifyLevel(loaded, level, assessed.solution, simpOpts);
    assert(baseline.complete);
    assert(baseline.optimalLength > 0);

    const int32_t crateId = objectIdByName(game, "crate");
    assert(crateId >= 0);
    const auto cluttered = levelWithCell(game, level, 2, 0, 0, crateId);
    const int32_t before = countOccupiedCells(game, cluttered);
    const auto simplified = puzzlescript::search::simplifyLevel(loaded, cluttered, assessed.solution, simpOpts);
    assert(simplified.complete);
    assert(simplified.objectsRemoved >= 1);
    assert(countOccupiedCells(game, simplified.level) < before);

    int32_t playerLayer = 0;
    int32_t playerX = 0;
    int32_t playerY = 0;
    assert(findPlayerCell(game, cluttered, playerLayer, playerX, playerY));
    int32_t outLayer = 0;
    int32_t outX = 0;
    int32_t outY = 0;
    assert(findPlayerCell(game, simplified.level, outLayer, outX, outY));
    assert(playerLayer == outLayer && playerX == outX && playerY == outY);

    const auto batchDecorated = levelWithCell(
        game,
        levelWithCell(game, level, 2, 5, 0, crateId),
        2,
        5,
        1,
        crateId);
    const int32_t batchBefore = countOccupiedCells(game, batchDecorated);
    const auto batchSimplified =
        puzzlescript::search::simplifyLevel(loaded, batchDecorated, assessed.solution, simpOpts);
    assert(batchSimplified.complete);
    assert(batchSimplified.objectsRemoved >= 2);
    assert(countOccupiedCells(game, batchSimplified.level) == batchBefore - batchSimplified.objectsRemoved);

    int32_t blockerX = 0;
    int32_t blockerY = 0;
    const auto blockingLevel = buildBlockingShortcutLevel(game, crateId, blockerX, blockerY);
    const auto blockingAssessed =
        puzzlescript::search::assessGeneratedLevelDifficulty(loaded, blockingLevel, diffOpts);
    assert(blockingAssessed.solved);
    const auto blockingSimplified = puzzlescript::search::simplifyLevel(
        loaded, blockingLevel, blockingAssessed.solution, simpOpts);
    assert(blockingSimplified.complete);
    assert(cellHasObject(game, blockingSimplified.level, 2, blockerX, blockerY, crateId));
    assert(blockingSimplified.bfsRejections > 0 || blockingSimplified.replayRejections > 0);

    int32_t bisectBlockerX = 0;
    int32_t bisectBlockerY = 0;
    const auto bisectionLevel = buildBisectionLevel(game, crateId, bisectBlockerX, bisectBlockerY);
    const int32_t bisectionBefore = countOccupiedCells(game, bisectionLevel);
    const auto bisectionSimplified = puzzlescript::search::simplifyLevel(
        loaded, bisectionLevel, blockingAssessed.solution, simpOpts);
    assert(bisectionSimplified.complete);
    assert(bisectionSimplified.objectsRemoved >= 2);
    assert(cellHasObject(game, bisectionSimplified.level, 2, bisectBlockerX, bisectBlockerY, crateId));
    assert(countOccupiedCells(game, bisectionSimplified.level) == bisectionBefore - bisectionSimplified.objectsRemoved);

    const puzzlescript::LoadedGame heroLoaded = loadHeroFixture();
    assert(heroLoaded.information);
    const puzzlescript::Game& heroGame = *heroLoaded.information;
    assert(heroGame.playerMask != puzzlescript::kNullMaskOffset);
    const puzzlescript::LevelTemplate& heroLevel = heroGame.levels.front();
    const auto heroAssessed =
        puzzlescript::search::assessGeneratedLevelDifficulty(heroLoaded, heroLevel, diffOpts);
    assert(heroAssessed.solved);
    const auto heroCluttered = levelWithCell(heroGame, heroLevel, 2, 3, 1, objectIdByName(heroGame, "crate"));
    const auto heroSimplified = puzzlescript::search::simplifyLevel(
        heroLoaded, heroCluttered, heroAssessed.solution, simpOpts);
    assert(heroSimplified.complete);
    assert(heroSimplified.objectsRemoved >= 1);

    puzzlescript::LevelTemplate stableLevel = batchSimplified.level;
    for (int pass = 0; pass < 8; ++pass) {
        const auto stableAssessed =
            puzzlescript::search::assessGeneratedLevelDifficulty(loaded, stableLevel, diffOpts);
        assert(stableAssessed.solved);
        const auto stablePass = puzzlescript::search::simplifyLevel(
            loaded, stableLevel, stableAssessed.solution, simpOpts);
        assert(stablePass.complete);
        if (stablePass.objectsRemoved == 0) {
            break;
        }
        stableLevel = stablePass.level;
    }
    const auto stableAssessed =
        puzzlescript::search::assessGeneratedLevelDifficulty(loaded, stableLevel, diffOpts);
    const auto idempotent = puzzlescript::search::simplifyLevel(
        loaded, stableLevel, stableAssessed.solution, simpOpts);
    assert(idempotent.complete);
    assert(idempotent.objectsRemoved == 0);

    return 0;
}
