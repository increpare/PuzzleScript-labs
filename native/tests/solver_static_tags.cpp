#undef NDEBUG
#include <cassert>
#include <iostream>
#include "compiler/parser.hpp"
#include "compiler/lower_to_runtime.hpp"
#include "solver/static_analysis.hpp"

using namespace puzzlescript;
LoadedGame compile(const std::string& rules, const std::string& metadata = "", const std::string& board = "Pat.") {
    const std::string source = "title Static Tags\n" + metadata + R"(
OBJECTS

Background .
black

Player P
white

A a
red

B b
blue

Token t
yellow

Flag f
green

LEGEND
Thing = A or B

SOUNDS

COLLISIONLAYERS
Background
Player
A, B
Token
Flag

RULES
)" + rules + "\n\nWINCONDITIONS\nsome A\n\nLEVELS\n" + board + "\n";
    compiler::DiagnosticSink diagnostics;
    const auto parsed = compiler::parseSource(source, diagnostics);
    LoadedGame loaded;
    assert(!compiler::lowerToRuntimeGame(parsed, loaded));
    return loaded;
}
bool transient(const LoadedGame& loaded) {
    const auto& game = *loaded.information;
    const auto analysis = solver::analyzeSolverHashProjection(game);
    for (const auto& object : game.objectsById) if (object.name == "token") {
        return (analysis.transientObjects[maskWordIndex(object.id)] & maskBit(object.id)) != 0;
    }
    assert(false); return false;
}
int main() {
    assert(!transient(compile("[ A ] -> [ A Token ]\nlate [ Token Flag ] -> [ Flag ]", "", "Pa..")));
    assert(!transient(compile("[ A ] -> [ A Token ]\nlate [ Token no Flag ] -> [ ]", "", "Pa..")));
    assert(transient(compile("[ A ] -> [ A Token ]\nlate [ Token ] -> [ ]", "", "Pa..")));
    assert(!transient(compile("[ A ] -> [ A Token ]\nlate [ Token ] -> [ ]\nlate [ A ] -> [ A Token ]", "", "Pa..")));
    assert(!transient(compile("[ A ] -> [ A Token ]\nlate random [ Token ] -> [ ]", "", "Pa..")));
    assert(!transient(compile("[ A ] -> [ A Token ]\nlate [ Token ] -> [ ]", "", "Pat.")));
    assert(solver::actionInputIsUnnecessary(*compile("[ > Player | A ] -> [ > Player | > A ]").information));
    assert(!solver::actionInputIsUnnecessary(*compile("[ action Player | A ] -> [ action Player | B ]").information));
    assert(!solver::actionInputIsUnnecessary(*compile("[ A ] -> [ B ]").information));
    assert(!solver::actionInputIsUnnecessary(*compile("[ A ] -> [ > A ]").information));
    for (const auto& command : {"again", "win", "cancel", "restart", "checkpoint", "message wait"}) {
        assert(!solver::actionInputIsUnnecessary(*compile(std::string("[ Player ] -> ") + command).information));
    }
    assert(!solver::actionInputIsUnnecessary(*compile("random [ Player ] -> [ Player ]").information));
    assert(solver::actionInputIsUnnecessary(*compile("[ action Player ] -> win", "noaction\n").information));
    std::cout << "Static solver tags: projection and ACTION canaries passed\n";
}
