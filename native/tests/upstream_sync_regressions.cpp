#undef NDEBUG
#include <cassert>
#include <iostream>
#include <filesystem>
#include <fstream>
#include <cstdlib>
#include <string>

#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "runtime/core.hpp"
#include "runtime/compiled_rules.hpp"

namespace {
using namespace puzzlescript;

std::string source(std::string metadata, std::string rules, std::string legend = "",
                   std::string sounds = "") {
    return "title Upstream runtime regressions\n" + metadata + R"(
objects

Background
black

Player
white

First
red

Second
green

Third
blue

Fourth
yellow

legend
. = Background
P = Player and First
)" + legend + "\nsounds\n" + sounds + R"(
collisionlayers
Background
Player
First, Second, Third, Fourth

rules
)" + rules + R"(
winconditions

levels
P..

P...
)";
}

LoadedGame compile(const std::string& text) {
    compiler::DiagnosticSink diagnostics;
    auto parsed = compiler::parseSource(text, diagnostics);
    for (const auto& diagnostic : diagnostics.diagnostics()) {
        if (diagnostic.severity == compiler::Severity::Error) {
            std::cerr << diagnostic.message << '\n';
            std::abort();
        }
    }
    LoadedGame loaded;
    auto error = compiler::lowerToRuntimeGame(parsed, loaded);
    assert(!error);
    attachLinkedCompiledRules(*std::const_pointer_cast<Game>(loaded.information), text);
    if (std::getenv("PUZZLESCRIPT_EXPECT_UPSTREAM_GENERATED")) {
        assert(loaded.information->specializedFullTurn);
    }
    return loaded;
}

bool diagnosticContains(const compiler::DiagnosticSink& diagnostics, const std::string& text) {
    for (const auto& diagnostic : diagnostics.diagnostics()) {
        if (diagnostic.message == text) return true;
    }
    return false;
}

void checkpointRegression() {
    const auto loaded = compile(source("run_rules_on_level_start\n", R"(
[ Third ] -> [ Fourth ]
[ Second ] -> [ Third ]
[ First ] -> [ Second ]
[ action Player ] -> [ Player ] checkpoint
[ left Player ] -> [ Player ] restart
)"));
    for (bool ruleRestart : {false, true}) {
        auto session = createFullState(loaded);
        assert(!loadLevel(*session, 0));
        // Fresh restarts must still initialize the raw level.
        const auto initialized = session->levelState.board.objects;
        restart(*session);
        assert(session->levelState.board.objects == initialized);
        step(*session, PS_INPUT_ACTION);
        const auto checkpoint = session->levelState.board.objects;
        assert(checkpoint != initialized);
        if (ruleRestart) step(*session, PS_INPUT_LEFT);
        else restart(*session);
        assert(session->levelState.board.objects == checkpoint);
        // Loading another raw level must discard checkpoint provenance.
        assert(!loadLevel(*session, 1));
        const auto nextInitialized = session->levelState.board.objects;
        restart(*session);
        assert(session->levelState.board.objects == nextInitialized);
    }
}

void messageRestartRegression() {
    auto loaded = compile(source("", "[ action Player ] -> [ right Player ] restart win message Try again\n"));
    auto session = createFullState(loaded);
    assert(!loadLevel(*session, 0));
    const auto before = session->levelState.board.objects;
    const auto result = step(*session, PS_INPUT_ACTION);
    assert(session->meta.textMode && session->meta.messageText == "Try again");
    assert(session->levelState.board.objects != before);
    assert(!result.restarted);
    const auto closed = step(*session, PS_INPUT_ACTION);
    assert(closed.restarted);
    assert(!session->meta.textMode);
    assert(session->levelState.board.objects == before);
    // Suppressed rule messages retain the test/solver immediate-restart path.
    session->meta.suppressRuleMessages = true;
    assert(step(*session, PS_INPUT_ACTION).restarted);
    assert(session->meta.currentLevelIndex == 0);
    assert(!session->meta.textMode && session->levelState.board.objects == before);
}

void messageWinRegression() {
    auto loaded = compile(source("", "[ action Player ] -> [ Player ] win message You won\n"));
    auto session = createFullState(loaded);
    assert(!loadLevel(*session, 0));
    const auto shown = step(*session, PS_INPUT_ACTION);
    assert(session->meta.textMode && session->meta.currentLevelIndex == 0);
    assert(!shown.won);
    const auto closed = step(*session, PS_INPUT_ACTION);
    assert(closed.won && closed.transitioned && session->meta.currentLevelIndex == 1);

    loaded = compile(source("run_rules_on_level_start\n", "[ First ] -> [ Second ] win message Welcome\n"));
    session = createFullState(loaded);
    assert(!loadLevel(*session, 0));
    assert(session->meta.textMode);
    const auto suppressed = step(*session, PS_INPUT_ACTION);
    assert(!suppressed.won && session->meta.currentLevelIndex == 0);
}

void parserRegression() {
    compiler::DiagnosticSink cycle;
    auto parsed = compiler::parseSource(source("", "", "a = b\nb = c\nc = a\n"), cycle);
    assert(diagnosticContains(cycle, "You can't define object C in terms of itself!"));
    for (const auto& synonym : parsed.legendSynonyms) assert(synonym.name != "c");

    for (const auto& [line, expected] : {
        std::pair{"action 12345", "Sound verb \"ACTION\" needs an entity before it, e.g. \"Player ACTION 12345\"."},
        std::pair{"up 12345", "Sound direction \"UP\" needs an entity and MOVE or CANTMOVE before it, e.g. \"Player MOVE UP 12345\"."},
        std::pair{"Player 12345", "Was expecting a sound verb here (e.g. MOVE, DESTROY, CANTMOVE, or the like), but found something else. Try \"PLAYER MOVE 12345\" or \"PLAYER ACTION 12345\"."},
    }) {
        compiler::DiagnosticSink diagnostics;
        compiler::parseSource(source("", "", "", line), diagnostics);
        assert(diagnosticContains(diagnostics, expected));
    }
}
} // namespace

int main(int argc, char** argv) {
    const std::string selected = argc > 1 ? argv[1] : "all";
    if (selected == "emit-sources") {
        assert(argc == 3);
        std::filesystem::create_directories(argv[2]);
        std::ofstream(std::filesystem::path(argv[2]) / "checkpoint.txt") << source("run_rules_on_level_start\n", R"(
[ Third ] -> [ Fourth ]
[ Second ] -> [ Third ]
[ First ] -> [ Second ]
[ action Player ] -> [ Player ] checkpoint
[ left Player ] -> [ Player ] restart
)");
        std::ofstream(std::filesystem::path(argv[2]) / "restart-message.txt") << source("", "[ action Player ] -> [ right Player ] restart win message Try again\n");
        std::ofstream(std::filesystem::path(argv[2]) / "win-message.txt") << source("", "[ action Player ] -> [ Player ] win message You won\n");
        std::ofstream(std::filesystem::path(argv[2]) / "startup-win-message.txt") << source("run_rules_on_level_start\n", "[ First ] -> [ Second ] win message Welcome\n");
        return 0;
    }
    if (selected == "all" || selected == "checkpoint") checkpointRegression();
    if (selected == "all" || selected == "restart-message") messageRestartRegression();
    if (selected == "all" || selected == "win-message") messageWinRegression();
    if (selected == "all" || selected == "parser") parserRegression();
}
