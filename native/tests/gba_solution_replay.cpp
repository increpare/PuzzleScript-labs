#include "generated_game.hpp"
#include "puzzlescript/compiler.h"
#include "puzzlescript/gba.h"
#include "puzzlescript/puzzlescript.h"
#include "runtime/c_api_internal.hpp"

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <filesystem>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

namespace {

using FullStatePtr = std::unique_ptr<ps_full_state, decltype(&ps_full_state_destroy)>;
using GamePtr = std::unique_ptr<ps_game, decltype(&ps_free_game)>;

struct ReplayContext {
    ps_full_state* native = nullptr;
    ps_gba_session* gba = nullptr;
    int32_t objectCount = 0;
    int32_t level = -1;
    int32_t inputStep = -1;
    int32_t againTick = -1;
    int32_t messageConfirms = 0;
    int32_t totalAgainTicks = 0;
    size_t audioEventCount = 0;
    size_t uiAudioEventCount = 0;
    int32_t audioMismatchCount = 0;
    std::string firstAudioMismatch;
    bool nativeWon = false;
    bool gbaWon = false;
};

std::string jsonEscape(std::string_view value) {
    std::string output;
    output.reserve(value.size() + 8);
    for (const unsigned char c : value) {
        switch (c) {
            case '\\': output += "\\\\"; break;
            case '"': output += "\\\""; break;
            case '\b': output += "\\b"; break;
            case '\f': output += "\\f"; break;
            case '\n': output += "\\n"; break;
            case '\r': output += "\\r"; break;
            case '\t': output += "\\t"; break;
            default:
                if (c < 0x20) {
                    constexpr char digits[] = "0123456789abcdef";
                    output += "\\u00";
                    output.push_back(digits[(c >> 4U) & 0x0fU]);
                    output.push_back(digits[c & 0x0fU]);
                } else {
                    output.push_back(static_cast<char>(c));
                }
                break;
        }
    }
    return output;
}

int fail(const ReplayContext& context, std::string_view phase, std::string_view reason,
    int32_t x = -1, int32_t y = -1, int32_t object = -1) {
    std::cout << "{\"status\":\"fail\",\"level\":" << context.level
              << ",\"input_step\":" << context.inputStep
              << ",\"again_tick\":" << context.againTick
              << ",\"phase\":\"" << jsonEscape(phase)
              << "\",\"reason\":\"" << jsonEscape(reason) << "\"";
    if (x >= 0) std::cout << ",\"x\":" << x;
    if (y >= 0) std::cout << ",\"y\":" << y;
    if (object >= 0) std::cout << ",\"object\":" << object;
    std::cout << ",\"native_won\":" << (context.nativeWon ? "true" : "false")
              << ",\"gba_won\":" << (context.gbaWon ? "true" : "false")
              << ",\"total_again_ticks\":" << context.totalAgainTicks
              << ",\"audio_mismatches\":" << context.audioMismatchCount;
    if (!context.firstAudioMismatch.empty()) {
        std::cout << ",\"first_audio_mismatch\":\""
                  << jsonEscape(context.firstAudioMismatch) << "\"";
    }
    std::cout << "}\n";
    return 1;
}

bool parseInput(std::string token, ps_input& output) {
    token.erase(std::remove_if(token.begin(), token.end(), [](unsigned char c) {
        return std::isspace(c) != 0;
    }), token.end());
    std::transform(token.begin(), token.end(), token.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    if (token == "up" || token == "u" || token == "0") output = PS_INPUT_UP;
    else if (token == "left" || token == "l" || token == "1") output = PS_INPUT_LEFT;
    else if (token == "down" || token == "d" || token == "2") output = PS_INPUT_DOWN;
    else if (token == "right" || token == "r" || token == "3") output = PS_INPUT_RIGHT;
    else if (token == "action" || token == "a" || token == "4") output = PS_INPUT_ACTION;
    else if (token == "tick" || token == "t" || token == "5") output = PS_INPUT_TICK;
    else return false;
    return true;
}

bool parseInputs(std::string_view text, std::vector<ps_input>& inputs, std::string& error) {
    size_t offset = 0;
    while (offset <= text.size()) {
        const size_t comma = text.find(',', offset);
        const size_t end = comma == std::string_view::npos ? text.size() : comma;
        std::string token(text.substr(offset, end - offset));
        if (!token.empty()) {
            ps_input input{};
            if (!parseInput(token, input)) {
                error = "unknown input token: " + token;
                return false;
            }
            inputs.push_back(input);
        }
        if (comma == std::string_view::npos) break;
        offset = comma + 1;
    }
    return true;
}

bool stepCoreResultsEqual(const ps_step_result& nativeResult, const ps_step_result& gbaResult,
    std::string& reason) {
    if (nativeResult.changed != gbaResult.changed) {
        reason = "step changed flag differs: native=" + std::to_string(nativeResult.changed)
            + " gba=" + std::to_string(gbaResult.changed)
            + "; current native/gba won=" + std::to_string(nativeResult.won) + "/"
            + std::to_string(gbaResult.won)
            + " transitioned=" + std::to_string(nativeResult.transitioned) + "/"
            + std::to_string(gbaResult.transitioned)
            + " restarted=" + std::to_string(nativeResult.restarted) + "/"
            + std::to_string(gbaResult.restarted);
    } else if (nativeResult.won != gbaResult.won) {
        reason = "step won flag differs: native=" + std::to_string(nativeResult.won)
            + " gba=" + std::to_string(gbaResult.won);
    } else if (nativeResult.transitioned != gbaResult.transitioned) {
        reason = "step transitioned flag differs: native=" + std::to_string(nativeResult.transitioned)
            + " gba=" + std::to_string(gbaResult.transitioned);
    } else if (nativeResult.restarted != gbaResult.restarted) {
        reason = "step restarted flag differs: native=" + std::to_string(nativeResult.restarted)
            + " gba=" + std::to_string(gbaResult.restarted);
    } else return true;
    return false;
}

bool audioResultsEqual(const ps_step_result& nativeResult, const ps_step_result& gbaResult,
    std::string& reason) {
    const auto audioSummary = [](const ps_audio_event* events, size_t count) {
        std::ostringstream output;
        output << "[";
        for (size_t index = 0; index < count; ++index) {
            if (index > 0) output << ",";
            output << "(" << events[index].seed << ","
                << (events[index].kind != nullptr ? events[index].kind : "") << ")";
        }
        output << "]";
        return output.str();
    };
    if (nativeResult.audio_event_count != gbaResult.audio_event_count) {
        reason = "audio event count differs: native="
            + std::to_string(nativeResult.audio_event_count) + " gba="
            + std::to_string(gbaResult.audio_event_count) + " native_events="
            + audioSummary(nativeResult.audio_events, nativeResult.audio_event_count)
            + " gba_events=" + audioSummary(gbaResult.audio_events, gbaResult.audio_event_count);
    } else if (nativeResult.ui_audio_event_count != gbaResult.ui_audio_event_count) {
        reason = "UI audio event count differs: native="
            + std::to_string(nativeResult.ui_audio_event_count) + " gba="
            + std::to_string(gbaResult.ui_audio_event_count) + " native_events="
            + audioSummary(nativeResult.ui_audio_events, nativeResult.ui_audio_event_count)
            + " gba_events=" + audioSummary(gbaResult.ui_audio_events, gbaResult.ui_audio_event_count);
    } else {
        for (size_t index = 0; index < nativeResult.audio_event_count; ++index) {
            const ps_audio_event& nativeEvent = nativeResult.audio_events[index];
            const ps_audio_event& gbaEvent = gbaResult.audio_events[index];
            const char* nativeKind = nativeEvent.kind != nullptr ? nativeEvent.kind : "";
            const char* gbaKind = gbaEvent.kind != nullptr ? gbaEvent.kind : "";
            if (nativeEvent.seed != gbaEvent.seed || std::strcmp(nativeKind, gbaKind) != 0) {
                reason = "audio event " + std::to_string(index) + " differs: native=("
                    + std::to_string(nativeEvent.seed) + "," + nativeKind + ") gba=("
                    + std::to_string(gbaEvent.seed) + "," + gbaKind + ")";
                return false;
            }
        }
        for (size_t index = 0; index < nativeResult.ui_audio_event_count; ++index) {
            const ps_audio_event& nativeEvent = nativeResult.ui_audio_events[index];
            const ps_audio_event& gbaEvent = gbaResult.ui_audio_events[index];
            const char* nativeKind = nativeEvent.kind != nullptr ? nativeEvent.kind : "";
            const char* gbaKind = gbaEvent.kind != nullptr ? gbaEvent.kind : "";
            if (nativeEvent.seed != gbaEvent.seed || std::strcmp(nativeKind, gbaKind) != 0) {
                reason = "UI audio event " + std::to_string(index) + " differs: native=("
                    + std::to_string(nativeEvent.seed) + "," + nativeKind + ") gba=("
                    + std::to_string(gbaEvent.seed) + "," + gbaKind + ")";
                return false;
            }
        }
        return true;
    }
    return false;
}

void recordAudioMismatch(ReplayContext& context, const ps_step_result& nativeResult,
    const ps_step_result& gbaResult, std::string_view phase) {
    context.audioEventCount += gbaResult.audio_event_count;
    context.uiAudioEventCount += gbaResult.ui_audio_event_count;
    std::string mismatch;
    if (audioResultsEqual(nativeResult, gbaResult, mismatch)) return;
    ++context.audioMismatchCount;
    if (context.firstAudioMismatch.empty()) {
        context.firstAudioMismatch = std::string(phase)
            + " input_step=" + std::to_string(context.inputStep)
            + " again_tick=" + std::to_string(context.againTick)
            + ": " + mismatch;
    }
}

bool statesEqual(const ReplayContext& context, std::string& reason,
    int32_t& mismatchX, int32_t& mismatchY, int32_t& mismatchObject) {
    ps_full_state_status_info nativeStatus{};
    ps_gba_status gbaStatus{};
    ps_full_state_status(context.native, &nativeStatus);
    ps_gba_status_get(context.gba, &gbaStatus);

    if (nativeStatus.mode != gbaStatus.mode) {
        reason = "mode differs: native=" + std::to_string(nativeStatus.mode)
            + " gba=" + std::to_string(gbaStatus.mode);
        return false;
    }
    if (nativeStatus.mode != PS_FULL_STATE_MODE_TITLE
        && nativeStatus.current_level_index != gbaStatus.current_level) {
        reason = "current level differs: native=" + std::to_string(nativeStatus.current_level_index)
            + " gba=" + std::to_string(gbaStatus.current_level);
        return false;
    }
    if (nativeStatus.mode != PS_FULL_STATE_MODE_LEVEL) return true;
    if (nativeStatus.width != gbaStatus.width || nativeStatus.height != gbaStatus.height) {
        reason = "dimensions differ: native=" + std::to_string(nativeStatus.width) + "x"
            + std::to_string(nativeStatus.height) + " gba=" + std::to_string(gbaStatus.width)
            + "x" + std::to_string(gbaStatus.height);
        return false;
    }
    int32_t differenceCount = 0;
    std::ostringstream differenceSummary;
    for (int32_t x = 0; x < nativeStatus.width; ++x) {
        for (int32_t y = 0; y < nativeStatus.height; ++y) {
            for (int32_t object = 0; object < context.objectCount; ++object) {
                const bool nativeHas = ps_full_state_cell_has_object(context.native, x, y, object);
                const bool gbaHas = ps_gba_cell_has_object(context.gba, x, y, object);
                if (nativeHas != gbaHas) {
                    if (differenceCount == 0) {
                        mismatchX = x;
                        mismatchY = y;
                        mismatchObject = object;
                    }
                    const char* objectName = object < ps_gba_generated_game.object_count
                        ? ps_gba_generated_game.objects[object].name : nullptr;
                    if (differenceCount < 16) {
                        if (differenceCount > 0) differenceSummary << "; ";
                        differenceSummary << "(" << x << "," << y << ") "
                            << (objectName != nullptr ? objectName : "object") << "#" << object
                            << (nativeHas ? " native-only" : " GBA-only");
                    }
                    ++differenceCount;
                }
            }
        }
    }
    if (differenceCount > 0) {
        reason = "cell objects differ (" + std::to_string(differenceCount) + "): "
            + differenceSummary.str();
        if (differenceCount > 16) reason += "; ...";
        return false;
    }
    // Report board differences before RNG differences. A different random cursor is
    // often a consequence of an earlier rule-semantic divergence, and the cells
    // identify that primary fault much more directly.
    const auto& nativeRng = context.native->impl->levelState.rng;
    ps_gba_rng_state gbaRng{};
    ps_gba_random_state_get(context.gba, &gbaRng);
    if (nativeRng.valid != gbaRng.valid || nativeRng.i != gbaRng.i || nativeRng.j != gbaRng.j) {
        reason = "random state cursor differs: native=(" + std::to_string(nativeRng.valid)
            + "," + std::to_string(nativeRng.i) + "," + std::to_string(nativeRng.j)
            + ") gba=(" + std::to_string(gbaRng.valid) + "," + std::to_string(gbaRng.i)
            + "," + std::to_string(gbaRng.j) + ")";
        return false;
    }
    for (size_t index = 0; index < nativeRng.s.size(); ++index) {
        if (nativeRng.s[index] != gbaRng.s[index]) {
            reason = "random state table differs at byte " + std::to_string(index)
                + ": native=" + std::to_string(nativeRng.s[index])
                + " gba=" + std::to_string(gbaRng.s[index]);
            return false;
        }
    }
    return true;
}

bool isMessage(const ReplayContext& context) {
    ps_full_state_status_info nativeStatus{};
    ps_gba_status gbaStatus{};
    ps_full_state_status(context.native, &nativeStatus);
    ps_gba_status_get(context.gba, &gbaStatus);
    return nativeStatus.mode == PS_FULL_STATE_MODE_MESSAGE
        && gbaStatus.mode == PS_FULL_STATE_MODE_MESSAGE;
}

std::string resetKernelDiagnostic(const ReplayContext& context, ps_input input) {
    ps_gba_status status{};
    ps_gba_status_get(context.gba, &status);
    const ps_gba_game_view* game = ps_gba_game(context.gba);
    const uint32_t* board = ps_gba_board_words(context.gba);
    if (game == nullptr || board == nullptr || game->turn_kernel == nullptr
        || status.width <= 0 || status.height <= 0) return "";
    const size_t wordCount = static_cast<size_t>(status.width)
        * static_cast<size_t>(status.height) * game->object_word_count;
    std::vector<uint32_t> copy(board, board + wordCount);
    std::vector<uint32_t> turnSnapshot(wordCount);
    std::vector<uint32_t> probeSnapshot(wordCount);
    std::vector<uint32_t> objectCellIndex(
        std::max<uint32_t>(1U, game->object_cell_index_word_count));
    ps_gba_rng_state rng{};
    ps_gba_random_state_get(context.gba, &rng);
    const ps_gba_kernel_result probe = game->turn_kernel(
        copy.data(), static_cast<uint32_t>(copy.size()),
        turnSnapshot.data(), probeSnapshot.data(), static_cast<uint32_t>(wordCount),
        objectCellIndex.data(), static_cast<uint32_t>(objectCellIndex.size()),
        static_cast<uint16_t>(status.width), static_cast<uint16_t>(status.height),
        static_cast<uint16_t>(status.current_level), input, &rng, true, false);
    return "; reset-kernel handled=" + std::to_string(probe.handled)
        + " discard=" + std::to_string(probe.discard)
        + " changed=" + std::to_string(probe.changed)
        + " won=" + std::to_string(probe.won)
        + " transitioned=" + std::to_string(probe.transitioned)
        + " restarted=" + std::to_string(probe.restarted);
}

bool settleStartupAgain(ReplayContext& context, std::string& reason,
    int32_t& x, int32_t& y, int32_t& object) {
    // ps_full_state_load_level deliberately drains startup `again`; the GBA
    // exposes it to VBlank.  Settle only the GBA here before the initial check.
    ps_gba_status status{};
    for (int tick = 0; tick < 500; ++tick) {
        ps_gba_status_get(context.gba, &status);
        if (!status.pending_again) return statesEqual(context, reason, x, y, object);
        context.againTick = tick;
        const ps_step_result result = ps_gba_step(context.gba, PS_INPUT_TICK);
        context.gbaWon = context.gbaWon || result.won;
        ++context.totalAgainTicks;
    }
    reason = "GBA startup again loop exceeded 500 ticks";
    return false;
}

bool settleTurnAgain(ReplayContext& context, std::string& reason,
    int32_t& x, int32_t& y, int32_t& object) {
    for (int tick = 0; tick < 500; ++tick) {
        const bool nativeAgain = ps_full_state_pending_again(context.native);
        ps_gba_status gbaStatus{};
        ps_gba_status_get(context.gba, &gbaStatus);
        if (nativeAgain != gbaStatus.pending_again) {
            reason = "pending again differs";
            return false;
        }
        if (!nativeAgain) return true;
        context.againTick = tick;
        const ps_step_result nativeResult = ps_full_state_turn(context.native, PS_INPUT_TICK);
        const ps_step_result gbaResult = ps_gba_step(context.gba, PS_INPUT_TICK);
        context.nativeWon = context.nativeWon || nativeResult.won;
        context.gbaWon = context.gbaWon || gbaResult.won;
        ++context.totalAgainTicks;
        if (!stepCoreResultsEqual(nativeResult, gbaResult, reason)) return false;
        recordAudioMismatch(context, nativeResult, gbaResult, "again");
        if (!statesEqual(context, reason, x, y, object)) return false;
    }
    reason = "again loop exceeded 500 ticks";
    return false;
}

} // namespace

int main(int argc, char** argv) {
    ReplayContext context;
    if (argc != 4 && argc != 5) {
        return fail(context, "arguments",
            "usage: puzzlescript_gba_solution_replay GAME.txt LEVEL comma-separated-inputs [--allow-incomplete]");
    }
    const bool allowIncomplete = argc == 5 && std::strcmp(argv[4], "--allow-incomplete") == 0;
    if (argc == 5 && !allowIncomplete) {
        return fail(context, "arguments", "unknown fourth argument");
    }
    try {
        context.level = std::stoi(argv[2]);
    } catch (...) {
        return fail(context, "arguments", "level must be an integer");
    }

    std::ifstream sourceFile(argv[1], std::ios::binary);
    if (!sourceFile) return fail(context, "compile", "could not open source file");
    const std::string source((std::istreambuf_iterator<char>(sourceFile)),
        std::istreambuf_iterator<char>());

    std::vector<ps_input> inputs;
    std::string reason;
    if (!parseInputs(argv[3], inputs, reason)) return fail(context, "arguments", reason);

    ps_compile_result* rawCompile = nullptr;
    if (!ps_compile_source(source.data(), source.size(), &rawCompile)) {
        const ps_error* error = ps_compile_result_error(rawCompile);
        reason = error != nullptr ? ps_error_message(error) : "native source compile failed";
        ps_free_error(const_cast<ps_error*>(error));
        ps_free_compile_result(rawCompile);
        return fail(context, "compile", reason);
    }
    ps_game* rawGame = const_cast<ps_game*>(ps_compile_result_game(rawCompile));
    ps_free_compile_result(rawCompile);
    GamePtr nativeGame(rawGame, ps_free_game);
    if (!nativeGame) return fail(context, "compile", "compiler returned no game");

    context.objectCount = ps_game_object_count(nativeGame.get());
    if (context.objectCount != ps_gba_generated_game.object_count) {
        return fail(context, "initial", "generated and native object counts differ");
    }
    const std::string solverSeed = "solver:"
        + std::filesystem::path(argv[1]).filename().string()
        + ":" + std::to_string(context.level);
    ps_full_state* rawState = nullptr;
    ps_error* error = nullptr;
    if (!ps_full_state_create_with_loaded_level_seed(
            nativeGame.get(), solverSeed.c_str(), &rawState, &error)) {
        reason = error != nullptr ? ps_error_message(error) : "native session creation failed";
        ps_free_error(error);
        return fail(context, "initial", reason);
    }
    FullStatePtr nativeState(rawState, ps_full_state_destroy);
    context.native = nativeState.get();
    if (!ps_full_state_load_level(context.native, context.level, &error)) {
        reason = error != nullptr ? ps_error_message(error) : "native level load failed";
        ps_free_error(error);
        return fail(context, "initial", reason);
    }

    const size_t arenaBytes = ps_gba_session_required_bytes(&ps_gba_generated_game);
    std::vector<uint8_t> arena(arenaBytes);
    context.gba = ps_gba_session_init(arena.data(), arena.size(), &ps_gba_generated_game);
    if (context.gba == nullptr || context.level < 0
        || context.level >= ps_gba_generated_game.level_count
        || !ps_gba_load_level_with_seed(
            context.gba, static_cast<uint16_t>(context.level), solverSeed.c_str())) {
        return fail(context, "initial", "GBA level load failed");
    }

    int32_t mismatchX = -1;
    int32_t mismatchY = -1;
    int32_t mismatchObject = -1;
    context.againTick = -1;
    if (!settleStartupAgain(context, reason, mismatchX, mismatchY, mismatchObject)) {
        return fail(context, "initial", reason, mismatchX, mismatchY, mismatchObject);
    }

    ps_full_state_status_info nativeStartupStatus{};
    ps_gba_status gbaStartupStatus{};
    ps_full_state_status(context.native, &nativeStartupStatus);
    ps_gba_status_get(context.gba, &gbaStartupStatus);
    const bool nativeStartupWon = nativeStartupStatus.current_level_index != context.level
        || nativeStartupStatus.mode == PS_FULL_STATE_MODE_TITLE;
    const bool gbaStartupWon = gbaStartupStatus.current_level != context.level
        || gbaStartupStatus.completed;
    context.nativeWon = context.nativeWon || nativeStartupWon;
    context.gbaWon = context.gbaWon || gbaStartupWon;
    if (nativeStartupWon != gbaStartupWon) {
        return fail(context, "initial", "only one runtime completed the level during startup");
    }
    if (nativeStartupWon && gbaStartupWon) {
        if (context.audioMismatchCount != 0) {
            return fail(context, "audio", context.firstAudioMismatch);
        }
        std::cout << "{\"status\":\"pass\",\"level\":" << context.level
                  << ",\"inputs\":0,\"solver_inputs\":" << inputs.size()
                  << ",\"startup_won\":true"
                  << ",\"again_ticks\":" << context.totalAgainTicks
                  << ",\"message_confirms\":0"
                  << ",\"audio_events\":" << context.audioEventCount
                  << ",\"ui_audio_events\":" << context.uiAudioEventCount
                  << ",\"audio_mismatches\":" << context.audioMismatchCount;
        if (!context.firstAudioMismatch.empty()) {
            std::cout << ",\"first_audio_mismatch\":\""
                      << jsonEscape(context.firstAudioMismatch) << "\"";
        }
        std::cout << "}\n";
        return 0;
    }

    for (size_t step = 0; step < inputs.size(); ++step) {
        context.inputStep = static_cast<int32_t>(step);
        context.againTick = -1;
        const ps_step_result nativeResult = ps_full_state_turn(context.native, inputs[step]);
        const ps_step_result gbaResult = ps_gba_step(context.gba, inputs[step]);
        context.nativeWon = context.nativeWon || nativeResult.won;
        context.gbaWon = context.gbaWon || gbaResult.won;
        if (!stepCoreResultsEqual(nativeResult, gbaResult, reason)) {
            reason += resetKernelDiagnostic(context, inputs[step]);
            return fail(context, "input", reason);
        }
        recordAudioMismatch(context, nativeResult, gbaResult, "input");
        if (!statesEqual(context, reason, mismatchX, mismatchY, mismatchObject)) {
            return fail(context, "input", reason, mismatchX, mismatchY, mismatchObject);
        }
        if (!settleTurnAgain(context, reason, mismatchX, mismatchY, mismatchObject)) {
            return fail(context, "again", reason, mismatchX, mismatchY, mismatchObject);
        }

        // Solver mode suppresses rule messages.  In actual player mode both
        // runtimes display them, so acknowledge matching messages on both sides
        // and continue replaying the solver's remaining gameplay inputs.
        if (!context.nativeWon && !context.gbaWon && isMessage(context)) {
            ++context.messageConfirms;
            const ps_step_result nativeConfirm = ps_full_state_turn(context.native, PS_INPUT_ACTION);
            const ps_step_result gbaConfirm = ps_gba_step(context.gba, PS_INPUT_ACTION);
            if (!stepCoreResultsEqual(nativeConfirm, gbaConfirm, reason)) {
                return fail(context, "message_confirm", reason,
                    mismatchX, mismatchY, mismatchObject);
            }
            recordAudioMismatch(context, nativeConfirm, gbaConfirm, "message_confirm");
            if (!statesEqual(context, reason, mismatchX, mismatchY, mismatchObject)) {
                return fail(context, "message_confirm", reason,
                    mismatchX, mismatchY, mismatchObject);
            }
        }
    }

    if (!context.nativeWon && !allowIncomplete) return fail(context, "complete", "native replay did not win");
    if (!context.gbaWon && !allowIncomplete) return fail(context, "complete", "GBA replay did not win");
    if (context.nativeWon != context.gbaWon) {
        return fail(context, "complete", "only one runtime completed the level");
    }
    if (context.audioMismatchCount != 0) {
        return fail(context, "audio", context.firstAudioMismatch);
    }
    std::cout << "{\"status\":\"pass\",\"level\":" << context.level
              << ",\"inputs\":" << inputs.size()
              << ",\"startup_won\":false"
              << ",\"completed\":" << (context.nativeWon ? "true" : "false")
              << ",\"again_ticks\":" << context.totalAgainTicks
              << ",\"message_confirms\":" << context.messageConfirms
              << ",\"audio_events\":" << context.audioEventCount
              << ",\"ui_audio_events\":" << context.uiAudioEventCount
              << ",\"audio_mismatches\":" << context.audioMismatchCount;
    if (!context.firstAudioMismatch.empty()) {
        std::cout << ",\"first_audio_mismatch\":\""
                  << jsonEscape(context.firstAudioMismatch) << "\"";
    }
    std::cout << "}\n";
    return 0;
}
