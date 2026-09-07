#undef NDEBUG
#include <cassert>
#include <cstdlib>
#include <iostream>
#include <string>
#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "runtime/core.hpp"

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
    std::cout << "runtime_match_tuples: 6 cases passed in player and solver modes\n";
}
