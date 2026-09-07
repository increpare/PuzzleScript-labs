#undef NDEBUG
#include <cassert>
#include <cstdlib>
#include <iostream>
#include <string>
#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "runtime/core.hpp"
#if PS_SPATIAL_MATCH_CACHE
#include "runtime/spatial_match_cache.hpp"
#endif

namespace {
const std::string prefix = R"(title Match tuple regression

OBJECTS

Background
black

Player
white

Alpha
red

Beta
blue

Gamma
green

LEGEND
. = Background
P = Player
a = Alpha
b = Beta
c = Gamma
X = Alpha or Beta

SOUNDS

COLLISIONLAYERS
Background
Alpha, Beta, Gamma
Player

RULES
)";

void check(const char* label, const std::string& rules, const std::string& initial,
           const std::string& expected) {
    const std::string source = prefix + rules + "\n\nWINCONDITIONS\n\nLEVELS\n\n"
        + initial + "\n\n" + expected + "\n";
    puzzlescript::compiler::DiagnosticSink diagnostics;
    const auto parsed = puzzlescript::compiler::parseSource(source, diagnostics);
    puzzlescript::LoadedGame game;
    const auto error = puzzlescript::compiler::lowerToRuntimeGame(parsed, game);
    assert(!error && game.information);
    for (bool solver : {false, true}) {
        puzzlescript::RuntimeStepOptions options{
            .playableUndo = !solver, .emitAudio = false, .solverMode = solver,
            .againPolicy = puzzlescript::AgainPolicy::Drain};
        auto actual = puzzlescript::createFullStateWithLoadedLevelSeed(game, "tuple-regression");
        auto wanted = puzzlescript::createFullStateWithLoadedLevelSeed(game, "tuple-regression");
        assert(!puzzlescript::loadLevel(*actual, 0, options));
        assert(!puzzlescript::loadLevel(*wanted, 1, options));
        const auto original = actual->levelState.board.objects;
        const auto verify = [&] {
            puzzlescript::turn(*actual, PS_INPUT_ACTION, options);
            if (actual->levelState.board.objects != wanted->levelState.board.objects) {
                std::cerr << label << " failed in " << (solver ? "solver" : "player") << " mode\n";
                std::abort();
            }
        };
        verify();
        if (!solver && original != wanted->levelState.board.objects) {
            assert(puzzlescript::undo(*actual));
            assert(actual->levelState.board.objects == original);
            verify();
        }
        assert(puzzlescript::restart(*actual, options));
        assert(actual->levelState.board.objects == original);
        verify();
    }
}
}

int main() {
#if PS_SPATIAL_MATCH_CACHE
    // A spreading marker forces repeat collections with both disappearing and
    // newly enabled negative matches. Crossing a mask word and using rectangular
    // boards exercises cache coordinates independently of the ordinary matcher.
    for (bool enabled : {false, true}) {
        puzzlescript::setSpatialMatchCacheEnabled(enabled);
        puzzlescript::resetSpatialMatchStats();
        const std::string playerRow = "\nP" + std::string(127, '.');
        check("right propagation", "right [ Alpha | no Alpha ] -> [ Alpha | Alpha ]",
              "a" + std::string(127, '.') + playerRow, std::string(128, 'a') + playerRow);
        check("left propagation", "left [ Alpha | no Alpha ] -> [ Alpha | Alpha ]",
              std::string(127, '.') + "a" + playerRow, std::string(128, 'a') + playerRow);
        std::string down = "a..\n", up, filled;
        for (int y = 0; y < 80; ++y) {
            filled += "a..\n";
            if (y) down += "...\n";
            up += y == 79 ? "a..\n" : "...\n";
        }
        // Put the player on a separate column so its movement cannot affect the
        // propagation; an object may share the player's cell on another layer.
        down[2] = up[2] = filled[2] = 'P';
        check("down propagation", "down [ Alpha | no Alpha ] -> [ Alpha | Alpha ]", down, filled);
        check("up propagation", "up [ Alpha | no Alpha ] -> [ Alpha | Alpha ]", up, filled);
        if (enabled) assert(puzzlescript::spatialMatchStats().cachedCollections > 0);
    }
#endif
    // The trailing rule consumes action only after every tuple has been visited,
    // preventing another group pass from hiding a wrong first-pass result.
    const std::string stop = "\n+ [ action Player ] -> [ Player ]";
    // Row zero must advance fastest. Reversing the order yields abbP instead.
    check("Cartesian order", "right [ Alpha ] [ X ] [ action Player ] -> [ Beta ] [ Alpha ] [ action Player ]" + stop, "aabP", "bbaP");
    // An earlier tuple destroys matches from both rows. Applying stale tuples
    // without revalidation yields bbcP instead of consuming all three Alphas.
    check("overlap invalidation", "right [ Alpha ] [ Alpha ] [ action Player ] -> [ Beta ] [ Gamma ] [ action Player ]" + stop, "aaaP", "cccP");
    check("cross-row property capture", "right [ X ] [ Gamma ] [ action Player ] -> [ ] [ X ] [ action Player ]" + stop, "abccP", "..abP");
    check("empty row match", "right [ Alpha ] [ Gamma ] [ action Player ] -> [ Beta ] [ Alpha ] [ action Player ]" + stop, "aabP", "aabP");
    check("ellipsis property capture", "right [ X | ... | Gamma ] [ action Player ] -> [ | ... | X ] [ action Player ]" + stop, "a.cP", "..aP");
    check("single-row property capture", "right [ action Player | X | Gamma ] -> [ Player | | X ]", "Pac", "P.a");
    std::cout << "runtime_match_tuples: 6 tuple cases passed in player and solver modes\n";
#if PS_SPATIAL_MATCH_CACHE
    std::cout << "spatial cache: 4 propagation cases passed with cache off/on, in player and solver modes\n";
#endif
}
