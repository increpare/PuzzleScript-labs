#include <cassert>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>

#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "puzzlescript/puzzlescript.h"
#include "runtime/compiled_rules.hpp"
#include "runtime/core.hpp"

namespace {

constexpr const char* kSource = R"(title Native API Test
author Tests
text_color #ffffff
background_color #000000

========
OBJECTS
========

Background
black
00000
00000
00000
00000
00000

Player
white
.000.
.0.0.
.000.
..0..
..0..

=======
LEGEND
=======

. = Background
P = Player

======
SOUNDS
======

startgame 111111
sfx0 222222

================
COLLISIONLAYERS
================

Background
Player

======
RULES
======

[ > Player | Background ] -> [ Background | Player ] sfx0
[ Action Player ] -> [ Player ] checkpoint message Hello native player

=======
LEVELS
=======

P.
)";

struct CompileHandle {
    ps_compile_result* result = nullptr;
    ~CompileHandle() { ps_free_compile_result(result); }
};

struct SessionHandle {
    ps_full_state* state = nullptr;
    ~SessionHandle() { ps_full_state_destroy(state); }
};

std::string readTextFile(const char* path) {
    std::ifstream input(path, std::ios::binary);
    assert(input.good());
    std::ostringstream buffer;
    buffer << input.rdbuf();
    return buffer.str();
}

std::string readCompiledRulesSourceText(const char* path) {
    return readTextFile(path);
}

void require(bool condition, const char* message) {
    if (!condition) {
        std::cerr << message << "\n";
        std::abort();
    }
}

std::string serializedState(const SessionHandle& session) {
    char* raw = ps_full_state_serialize_test_string(session.state);
    const std::string value = raw ? raw : "";
    ps_string_free(raw);
    return value;
}

void drainInterpreterSolverAgain(SessionHandle& session) {
    for (int pass = 0; pass < 500 && ps_full_state_pending_again(session.state); ++pass) {
        (void)ps_full_state_turn_with_options(session.state, PS_INPUT_TICK, true);
    }
}

void drainCompiledCompactSolverAgain(SessionHandle& session) {
    for (int pass = 0; pass < 500 && ps_full_state_pending_again(session.state); ++pass) {
        bool handled = false;
        (void)ps_full_state_turn_compiled_compact(session.state, PS_INPUT_TICK, true, &handled);
        require(handled, "compiled compact tick was not handled");
    }
}

void assertSolverStatesEqual(const SessionHandle& interpreter, const SessionHandle& compiled, const char* label) {
    const std::string interpreterSerialized = serializedState(interpreter);
    const std::string compiledSerialized = serializedState(compiled);
    if (interpreterSerialized != compiledSerialized) {
        std::cerr << "compiled compact solver path mismatch after " << label
                  << "\ninterpreter:\n" << interpreterSerialized
                  << "\ncompiled:\n" << compiledSerialized << "\n";
        std::abort();
    }
}

void assertPersistentStateMatches(
    const puzzlescript::FullState& interpreter,
    const puzzlescript::PersistentLevelState& compact,
    const char* label
) {
    if (interpreter.levelState.board.objects != compact.board.objects) {
        const size_t count = std::min(interpreter.levelState.board.objects.size(), compact.board.objects.size());
        for (size_t index = 0; index < count; ++index) {
            if (interpreter.levelState.board.objects[index] != compact.board.objects[index]) {
                std::cerr << "fresh-scratch compact solver path mismatch after " << label
                          << " word=" << index
                          << " compact=" << compact.board.objects[index]
                          << " interpreter=" << interpreter.levelState.board.objects[index]
                          << "\n";
                size_t printed = 0;
                for (size_t diffIndex = 0; diffIndex < count && printed < 40; ++diffIndex) {
                    if (interpreter.levelState.board.objects[diffIndex] != compact.board.objects[diffIndex]) {
                        std::cerr << "diff word=" << diffIndex
                                  << " compact=" << compact.board.objects[diffIndex]
                                  << " interpreter=" << interpreter.levelState.board.objects[diffIndex]
                                  << "\n";
                        ++printed;
                    }
                }
                std::abort();
            }
        }
        std::cerr << "fresh-scratch compact solver path size mismatch after " << label
                  << " compact=" << compact.board.objects.size()
                  << " interpreter=" << interpreter.levelState.board.objects.size()
                  << "\n";
        std::abort();
    }
    if (interpreter.levelState.rng.valid != compact.rng.valid
        || interpreter.levelState.rng.i != compact.rng.i
        || interpreter.levelState.rng.j != compact.rng.j
        || interpreter.levelState.rng.s != compact.rng.s) {
        std::cerr << "fresh-scratch compact solver rng mismatch after " << label << "\n";
        std::abort();
    }
}

void runCompiledCompactSolverFreshScratchRegression(const std::string& source) {
    puzzlescript::compiler::DiagnosticSink diagnostics;
    const auto parserState = puzzlescript::compiler::parseSource(source, diagnostics);
    puzzlescript::LoadedGame loadedGame;
    if (auto error = puzzlescript::compiler::lowerToRuntimeGame(parserState, loadedGame)) {
        std::cerr << "fresh-scratch source failed: " << error->message << "\n";
        std::abort();
    }
    require(loadedGame.information != nullptr, "fresh-scratch lowering produced no game");
    puzzlescript::attachLinkedCompiledRules(
        *std::const_pointer_cast<puzzlescript::Game>(loadedGame.information),
        source
    );
    const puzzlescript::Game& game = *loadedGame.information;
    require(game.specializedCompactTurn != nullptr, "fresh-scratch compact backend was not attached");
    require(game.specializedCompactTurn->step != nullptr, "fresh-scratch compact backend has no step");
    require(game.specializedCompactTurn->nativeKernel, "fresh-scratch compact backend is not native");

    constexpr puzzlescript::RuntimeStepOptions kSolverStepOptions{
        .playableUndo = false,
        .emitAudio = false,
        .solverMode = true,
        .againPolicy = puzzlescript::AgainPolicy::Drain,
    };
    std::unique_ptr<puzzlescript::FullState> interpreter =
        puzzlescript::createFullStateWithLoadedLevelSeed(loadedGame, "solver:It gets its Feet Wet.txt:1");
    require(interpreter != nullptr, "fresh-scratch failed to create session");
    interpreter->meta.suppressRuleMessages = true;
    puzzlescript::RuntimeStepOptions loadOptions;
    loadOptions.playableUndo = false;
    loadOptions.emitAudio = false;
    loadOptions.solverMode = true;
    loadOptions.againPolicy = puzzlescript::AgainPolicy::Yield;
    if (auto error = puzzlescript::loadLevel(*interpreter, 1, loadOptions)) {
        std::cerr << "fresh-scratch failed to load level: " << error->message << "\n";
        std::abort();
    }

    puzzlescript::PersistentLevelState compact;
    compact.board.objects = interpreter->levelState.board.objects;
    compact.rng = interpreter->levelState.rng;
    const puzzlescript::SpecializedCompactTurnContext context{
        puzzlescript::LevelDimensions{
            interpreter->meta.levelDimensions.width,
            interpreter->meta.levelDimensions.height,
        },
        interpreter->meta.currentLevelIndex,
    };
    assertPersistentStateMatches(*interpreter, compact, "load");

    constexpr ps_input kInputs[] = {PS_INPUT_UP, PS_INPUT_ACTION, PS_INPUT_UP};
    constexpr const char* kLabels[] = {"up", "up,action", "up,action,up"};
    for (size_t index = 0; index < 3; ++index) {
        (void)puzzlescript::turn(*interpreter, kInputs[index], kSolverStepOptions);

        puzzlescript::Scratch scratch;
        const puzzlescript::SpecializedCompactTurnOutcome outcome = game.specializedCompactTurn->step(
            game,
            compact,
            scratch,
            context,
            kInputs[index],
            kSolverStepOptions
        );
        require(outcome.handled, "fresh-scratch compact turn was not handled");
        require(!outcome.discard, "fresh-scratch compact turn unexpectedly discarded");
        assertPersistentStateMatches(*interpreter, compact, kLabels[index]);
    }
}

void runCompiledCompactSolverPathRegression(const char* sourcePath) {
    const std::string source = readCompiledRulesSourceText(sourcePath);
    runCompiledCompactSolverFreshScratchRegression(source);

    CompileHandle compiled;
    if (!ps_compile_source(source.data(), source.size(), &compiled.result)) {
        const ps_error* error = ps_compile_result_error(compiled.result);
        std::cerr << "compiled compact solver path source failed: " << ps_error_message(error) << "\n";
        std::abort();
    }

    const ps_game* game = ps_compile_result_game(compiled.result);
    require(game != nullptr, "compiled compact solver path produced no game");
    SessionHandle interpreter;
    SessionHandle compact;
    ps_error* error = nullptr;
    require(ps_full_state_create(game, &interpreter.state, &error), "failed to create interpreter session");
    require(ps_full_state_create(game, &compact.state, &error), "failed to create compact session");
    require(ps_full_state_load_level(interpreter.state, 1, &error), "failed to load interpreter level");
    require(ps_full_state_load_level(compact.state, 1, &error), "failed to load compact level");
    assertSolverStatesEqual(interpreter, compact, "load");

    constexpr ps_input kInputs[] = {PS_INPUT_UP, PS_INPUT_ACTION, PS_INPUT_UP};
    constexpr const char* kLabels[] = {"up", "up,action", "up,action,up"};
    for (size_t index = 0; index < 3; ++index) {
        (void)ps_full_state_turn_with_options(interpreter.state, kInputs[index], true);
        drainInterpreterSolverAgain(interpreter);

        bool handled = false;
        (void)ps_full_state_turn_compiled_compact(compact.state, kInputs[index], true, &handled);
        require(handled, "compiled compact solver path input was not handled");
        drainCompiledCompactSolverAgain(compact);
        assertSolverStatesEqual(interpreter, compact, kLabels[index]);
    }

    ps_free_game(const_cast<ps_game*>(game));
}

void runCompiledCompactSolverDiscardRegression(const char* sourcePath) {
    const std::string source = readCompiledRulesSourceText(sourcePath);
    CompileHandle compiled;
    if (!ps_compile_source(source.data(), source.size(), &compiled.result)) {
        const ps_error* error = ps_compile_result_error(compiled.result);
        std::cerr << "compiled compact discard source failed: " << ps_error_message(error) << "\n";
        std::abort();
    }

    const ps_game* game = ps_compile_result_game(compiled.result);
    assert(game != nullptr);
    assert(ps_game_level_count(game) >= 2);
    assert(ps_game_object_count(game) >= 4);
    constexpr int32_t kPlayerId = 1;
    constexpr int32_t kCrateId = 2;
    constexpr int32_t kArmedId = 4;

    SessionHandle session;
    ps_error* error = nullptr;
    assert(ps_full_state_create(game, &session.state, &error));
    assert(ps_full_state_cell_has_object(session.state, 0, 0, kPlayerId));
    assert(!ps_full_state_cell_has_object(session.state, 1, 0, kCrateId));

    bool handled = false;
    const ps_step_result cancelResult = ps_full_state_turn_compiled_compact(session.state, PS_INPUT_RIGHT, true, &handled);
    assert(handled);
    assert(!cancelResult.changed);
    assert(ps_full_state_cell_has_object(session.state, 0, 0, kPlayerId));
    assert(!ps_full_state_cell_has_object(session.state, 1, 0, kCrateId));

    handled = false;
    const ps_step_result restartResult = ps_full_state_turn_compiled_compact(session.state, PS_INPUT_ACTION, true, &handled);
    assert(handled);
    assert(!restartResult.changed);
    assert(ps_full_state_cell_has_object(session.state, 0, 0, kPlayerId));
    assert(!ps_full_state_cell_has_object(session.state, 1, 0, kCrateId));

    SessionHandle movementSession;
    assert(ps_full_state_create(game, &movementSession.state, &error));
    assert(ps_full_state_load_level(movementSession.state, 1, &error));
    assert(ps_full_state_cell_has_object(movementSession.state, 0, 0, kPlayerId));
    assert(!ps_full_state_cell_has_object(movementSession.state, 1, 0, kPlayerId));
    assert(!ps_full_state_cell_has_object(movementSession.state, 0, 0, kCrateId));
    assert(ps_full_state_cell_has_object(movementSession.state, 1, 0, kCrateId));
    assert(!ps_full_state_cell_has_object(movementSession.state, 2, 0, kCrateId));

    handled = false;
    const ps_step_result clearOnlyResult =
        ps_full_state_turn_compiled_compact(movementSession.state, PS_INPUT_RIGHT, false, &handled);
    assert(handled);
    (void)clearOnlyResult;
    assert(ps_full_state_cell_has_object(movementSession.state, 0, 0, kPlayerId));
    assert(!ps_full_state_cell_has_object(movementSession.state, 1, 0, kPlayerId));
    assert(!ps_full_state_cell_has_object(movementSession.state, 0, 0, kCrateId));
    assert(ps_full_state_cell_has_object(movementSession.state, 1, 0, kCrateId));
    assert(!ps_full_state_cell_has_object(movementSession.state, 2, 0, kCrateId));

    SessionHandle againCancelSession;
    assert(ps_full_state_create(game, &againCancelSession.state, &error));
    assert(ps_full_state_load_level(againCancelSession.state, 2, &error));
    assert(ps_full_state_cell_has_object(againCancelSession.state, 0, 0, kPlayerId));
    assert(!ps_full_state_cell_has_object(againCancelSession.state, 0, 0, kArmedId));

    handled = false;
    const ps_step_result againCancelResult =
        ps_full_state_turn_compiled_compact(againCancelSession.state, PS_INPUT_LEFT, true, &handled);
    assert(handled);
    assert(againCancelResult.changed);
    assert(!ps_full_state_pending_again(againCancelSession.state));
    assert(ps_full_state_cell_has_object(againCancelSession.state, 0, 0, kPlayerId));
    assert(ps_full_state_cell_has_object(againCancelSession.state, 0, 0, kArmedId));

    SessionHandle propertyMovementSession;
    require(ps_full_state_create(game, &propertyMovementSession.state, &error), "failed to create property movement session");
    require(ps_full_state_load_level(propertyMovementSession.state, 3, &error), "failed to load property movement level");
    require(ps_full_state_cell_has_object(propertyMovementSession.state, 0, 0, kPlayerId), "property movement missing player at start");
    require(ps_full_state_cell_has_object(propertyMovementSession.state, 0, 1, kCrateId), "property movement missing crate at start");
    require(!ps_full_state_cell_has_object(propertyMovementSession.state, 0, 2, kCrateId), "property movement crate already at destination");

    handled = false;
    const ps_step_result propertyMovementResult =
        ps_full_state_turn_compiled_compact(propertyMovementSession.state, PS_INPUT_DOWN, false, &handled);
    require(handled, "property movement compact turn was not handled");
    require(propertyMovementResult.changed, "property movement compact turn did not change");
    require(!ps_full_state_cell_has_object(propertyMovementSession.state, 0, 0, kPlayerId), "property movement player stayed at source");
    require(ps_full_state_cell_has_object(propertyMovementSession.state, 0, 1, kPlayerId), "property movement player did not move");
    require(!ps_full_state_cell_has_object(propertyMovementSession.state, 0, 1, kCrateId), "property movement crate stayed in pushed cell");
    require(ps_full_state_cell_has_object(propertyMovementSession.state, 0, 2, kCrateId), "property movement crate did not move");

    ps_free_game(const_cast<ps_game*>(game));
}

} // namespace

int main() {
    if (const char* compactDiscardSource = std::getenv("PUZZLESCRIPT_COMPILED_COMPACT_DISCARD_SOURCE")) {
        runCompiledCompactSolverDiscardRegression(compactDiscardSource);
    }
    if (const char* compactSolverPathSource = std::getenv("PUZZLESCRIPT_COMPILED_COMPACT_SOLVER_PATH_SOURCE")) {
        runCompiledCompactSolverPathRegression(compactSolverPathSource);
    }

    CompileHandle compiled;
    if (!ps_compile_source(kSource, std::strlen(kSource), &compiled.result)) {
        const ps_error* error = ps_compile_result_error(compiled.result);
        std::cerr << "compile failed: " << ps_error_message(error) << "\n";
        return 1;
    }

    const ps_game* game = ps_compile_result_game(compiled.result);
    assert(game != nullptr);
    assert(ps_game_level_count(game) == 1);
    assert(ps_game_object_count(game) >= 2);
    assert(std::string(ps_game_metadata_value(game, "title")) == "Native API Test");
    assert(std::string(ps_game_metadata_value(game, "author")) == "Tests");
    assert(std::string(ps_game_foreground_color(game)) == "#ffffff");
    assert(std::string(ps_game_background_color(game)) == "#000000");
    int32_t seed = 0;
    assert(ps_game_sound_seed(game, "startgame", &seed));
    assert(seed == 111111);

    ps_object_info playerInfo{};
    assert(ps_game_object_info(game, 1, &playerInfo));
    assert(playerInfo.sprite_width == 5);
    assert(playerInfo.sprite_height == 5);
    assert(playerInfo.color_count == 1);
    assert(std::string(ps_game_object_color(game, 1, 0)) == "white");
    assert(ps_game_object_sprite_value(game, 1, 1, 0) == 0);

    SessionHandle session;
    ps_error* error = nullptr;
    assert(ps_full_state_create(game, &session.state, &error));
    assert(ps_full_state_cell_has_object(session.state, 0, 0, 1));

    const ps_step_result result = ps_full_state_turn(session.state, PS_INPUT_ACTION);
    assert(result.changed);
    ps_full_state_status_info status{};
    ps_full_state_status(session.state, &status);
    assert(status.mode == PS_FULL_STATE_MODE_MESSAGE);
    assert(std::string(ps_full_state_message_text(session.state)) == "Hello native player");

    const ps_step_result closeResult = ps_full_state_turn(session.state, PS_INPUT_ACTION);
    assert(closeResult.changed);
    ps_full_state_status(session.state, &status);
    assert(status.mode == PS_FULL_STATE_MODE_LEVEL);
    assert(std::string(ps_full_state_message_text(session.state)).empty());

    const ps_step_result moveResult = ps_full_state_turn(session.state, PS_INPUT_RIGHT);
    assert(moveResult.changed);
    assert(moveResult.audio_event_count == 1);
    assert(moveResult.audio_events[0].seed == 222222);

    // Solver mode: suppress message/sfx outputs and ignore checkpoint.
    // Move once (x=1), then ACTION would checkpoint+message; solver mode should do neither.
    assert(ps_full_state_cell_has_object(session.state, 1, 0, 1));
    const ps_step_result solverAction = ps_full_state_turn_with_options(session.state, PS_INPUT_ACTION, true);
    assert(solverAction.changed);
    ps_full_state_status(session.state, &status);
    assert(status.mode == PS_FULL_STATE_MODE_LEVEL);
    assert(std::string(ps_full_state_message_text(session.state)).empty());
    // Move again (x=2), then restart should go back to initial (x=0), not checkpointed (x=1).
    const ps_step_result move2 = ps_full_state_turn(session.state, PS_INPUT_RIGHT);
    assert(move2.changed);
    assert(ps_full_state_cell_has_object(session.state, 2, 0, 1));
    assert(ps_full_state_restart(session.state));
    assert(ps_full_state_cell_has_object(session.state, 0, 0, 1));

    ps_free_game(const_cast<ps_game*>(game));
    return 0;
}
