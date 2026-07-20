#undef NDEBUG
#include <algorithm>
#include <cstdlib>
#include <cassert>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <numeric>
#include <sstream>
#include <string>
#include <vector>

#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "runtime/core.hpp"
#include "solver/static_analysis.hpp"

#ifndef PS_REPO_ROOT
#error PS_REPO_ROOT is required
#endif

namespace {

std::string readFile(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    std::ostringstream out;
    out << input.rdbuf();
    return out.str();
}

std::shared_ptr<const puzzlescript::Game> compile(const std::string& source) {
    puzzlescript::compiler::DiagnosticSink diagnostics;
    const auto state = puzzlescript::compiler::parseSource(source, diagnostics);
    puzzlescript::LoadedGame loaded;
    const auto error = puzzlescript::compiler::lowerToRuntimeGame(
        state, loaded, nullptr, puzzlescript::compiler::LowerToRuntimeOptions{false});
    if (error != nullptr || loaded.information == nullptr) {
        std::cerr << "movement_layer_analysis: fixture compilation failed: "
                  << (error == nullptr ? "unknown" : error->message) << "\n";
        std::exit(1);
    }
    return loaded.information;
}

std::shared_ptr<const puzzlescript::Game> compileFixture(const char* name) {
    return compile(readFile(
        std::filesystem::path(PS_REPO_ROOT) / "native" / "tests" / "fixtures" / name));
}

void requireLayout(
    const puzzlescript::Game& game,
    const std::vector<int32_t>& expectedCollisionLayers
) {
    const auto analysis = puzzlescript::solver::analyzeMovementLayers(game);
    assert(analysis.movementToCollisionLayer == expectedCollisionLayers);
    assert(analysis.collisionToMovementLayer.size()
        == static_cast<size_t>(game.layerCount));
    for (int32_t collisionLayer = 0; collisionLayer < game.layerCount; ++collisionLayer) {
        const auto found = std::find(
            expectedCollisionLayers.begin(), expectedCollisionLayers.end(), collisionLayer);
        if (found == expectedCollisionLayers.end()) {
            assert(analysis.collisionToMovementLayer[static_cast<size_t>(collisionLayer)] == -1);
        } else {
            assert(analysis.collisionToMovementLayer[static_cast<size_t>(collisionLayer)]
                == std::distance(expectedCollisionLayers.begin(), found));
        }
    }
}

std::string manyMovementLayersSource() {
    std::ostringstream source;
    source << "title Generic Movement Layer Boundary\n\n"
        << "========\nOBJECTS\n========\n\n"
        << "Background\nblack\n0\n\n"
        << "Player\nwhite\n0\n\n";
    for (int index = 0; index < 12; ++index) {
        source << "M" << index << "\nred\n0\n\n";
    }
    source << "=======\nLEGEND\n=======\n\n"
        << ". = Background\nP = Background and Player\n\n"
        << "================\nCOLLISIONLAYERS\n================\n\n"
        << "Background\nPlayer\n";
    for (int index = 0; index < 12; ++index) {
        source << "M" << index << "\n";
    }
    source << "\n======\nRULES\n======\n\n";
    for (int index = 0; index < 12; ++index) {
        source << "right [ M" << index << " ] -> [ > M" << index << " ]\n";
    }
    source << "\n==============\nWINCONDITIONS\n==============\n\n"
        << "some Player on M0\n\n"
        << "=======\nLEVELS\n=======\n\nP\n";
    return source.str();
}

} // namespace

int main() {
    {
        const auto game = compileFixture("gbc_static_collision_layers.txt");
        requireLayout(*game, {6});
        // Positive and negative movement reads alone do not allocate lanes.
        assert(game->layerCount == 7);
    }
    {
        const auto game = compileFixture("gbc_action_movement_layer.txt");
        requireLayout(*game, {1, 2});
        const auto analysis = puzzlescript::solver::analyzeMovementLayers(*game);
        // Switch receives only RHS `action`, so it is a layer-level origin but
        // not a cardinal-origin object.
        assert((analysis.originatingObjects[0] & puzzlescript::maskBit(2)) == 0);
    }
    {
        const auto game = compileFixture("gbc_three_movement_layers.txt");
        requireLayout(*game, {1, 2, 3});
    }
    {
        const auto game = compileFixture("gbc_six_movement_layers.txt");
        requireLayout(*game, {1, 2, 3, 4, 5, 6});
    }
    {
        const auto game = compileFixture("gbc_seven_movement_layers.txt");
        requireLayout(*game, {1, 2, 3, 4, 5, 6, 7});
    }
    {
        const auto game = compile(manyMovementLayersSource());
        std::vector<int32_t> expected(13);
        std::iota(expected.begin(), expected.end(), 1);
        requireLayout(*game, expected);
    }
    return 0;
}
