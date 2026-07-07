#include "simulation/corpus_runner.hpp"

#include "puzzlescript/compiler.h"
#include "puzzlescript/puzzlescript.h"
#include "runtime/json.hpp"

#include <chrono>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <memory>
#include <optional>
#include <stdexcept>
#include <unordered_map>

namespace puzzlescript::simulation {
namespace {

int64_t elapsedMicrosSince(const std::chrono::steady_clock::time_point& started_at) {
    return std::chrono::duration_cast<std::chrono::microseconds>(
               std::chrono::steady_clock::now() - started_at)
        .count();
}

int64_t usToMs(int64_t micros) {
    return micros / 1000;
}

bool sessionCreateForGame(
    ps_game* game,
    const std::optional<std::string>& loaded_level_seed,
    ps_full_state** out_session,
    ps_error** out_error
) {
    if (loaded_level_seed.has_value()) {
        return ps_full_state_create_with_loaded_level_seed(
            game,
            loaded_level_seed->c_str(),
            out_session,
            out_error);
    }
    return ps_full_state_create(game, out_session, out_error);
}

std::optional<ps_input> parseInputToken(const std::string& token) {
    if (token == "up") {
        return PS_INPUT_UP;
    }
    if (token == "left") {
        return PS_INPUT_LEFT;
    }
    if (token == "down") {
        return PS_INPUT_DOWN;
    }
    if (token == "right") {
        return PS_INPUT_RIGHT;
    }
    if (token == "action") {
        return PS_INPUT_ACTION;
    }
    if (token == "tick") {
        return PS_INPUT_TICK;
    }
    try {
        size_t consumed = 0;
        int32_t input_value = std::stoi(token, &consumed);
        if (consumed != token.size()) {
            return std::nullopt;
        }
        if (input_value < 0) {
            input_value = 0;
        }
        if (input_value > static_cast<int32_t>(PS_INPUT_TICK)) {
            input_value = static_cast<int32_t>(PS_INPUT_TICK);
        }
        return static_cast<ps_input>(input_value);
    } catch (...) {
        return std::nullopt;
    }
}

int64_t jsonToInt64(const puzzlescript::json::Value& value) {
    if (value.isInteger()) {
        return value.asInteger();
    }
    if (value.isDouble()) {
        return static_cast<int64_t>(value.asDouble());
    }
    if (value.isString()) {
        try {
            size_t consumed = 0;
            const int64_t parsed = std::stoll(value.asString(), &consumed);
            if (consumed == value.asString().size()) {
                return parsed;
            }
        } catch (...) {
        }
    }
    return 0;
}

bool drainAgain(ps_full_state* session) {
    for (int pass = 0; pass < 500 && ps_full_state_pending_again(session); ++pass) {
        (void)ps_full_state_turn(session, PS_INPUT_TICK);
    }
    return true;
}

bool replayInputTokens(ps_full_state* session, const std::vector<std::string>& tokens) {
    if (session == nullptr) {
        return false;
    }
    for (const std::string& token : tokens) {
        if (token == "undo") {
            (void)ps_full_state_undo(session);
            continue;
        }
        if (token == "restart") {
            (void)ps_full_state_restart(session);
            if (!drainAgain(session)) {
                return false;
            }
            continue;
        }
        const auto input = parseInputToken(token);
        if (!input.has_value()) {
            return false;
        }
        (void)ps_full_state_turn(session, *input);
        if (!drainAgain(session)) {
            return false;
        }
    }
    return true;
}

std::vector<std::string> inputTokensFromJsonArray(const puzzlescript::json::Value& root) {
    if (!root.isArray()) {
        throw std::runtime_error("inputs must be a JSON array");
    }
    std::vector<std::string> tokens;
    tokens.reserve(root.asArray().size());
    for (const auto& value : root.asArray()) {
        if (value.isString()) {
            tokens.push_back(value.asString());
        } else if (value.isInteger() || value.isDouble()) {
            tokens.push_back(std::to_string(value.isInteger() ? value.asInteger() : static_cast<int64_t>(value.asDouble())));
        } else {
            tokens.push_back("0");
        }
    }
    return tokens;
}

bool loadGameFromSourceText(const std::string& source_text, ps_game** out_game) {
    ps_compile_result* result = nullptr;
    if (!ps_compile_source(source_text.data(), source_text.size(), &result) || result == nullptr) {
        if (result != nullptr) {
            ps_free_compile_result(result);
        }
        return false;
    }
    const ps_game* game = ps_compile_result_game(result);
    if (game == nullptr) {
        ps_free_compile_result(result);
        return false;
    }
    *out_game = const_cast<ps_game*>(game);
    ps_free_compile_result(result);
    return true;
}

struct GameDeleter {
    void operator()(ps_game* game) const {
        ps_free_game(game);
    }
};

using GamePtr = std::unique_ptr<ps_game, GameDeleter>;

struct FullStateDeleter {
    void operator()(ps_full_state* state) const {
        ps_full_state_destroy(state);
    }
};

using FullStatePtr = std::unique_ptr<ps_full_state, FullStateDeleter>;

bool runSingleCase(const CorpusCase& test_case, ps_game* game, CaseTiming& timing, std::string& error) {
    if (game == nullptr) {
        error = test_case.name + ": failed to compile source";
        return false;
    }

    ps_full_state* raw_session = nullptr;
    ps_error* ps_error_ptr = nullptr;
    auto phase_start = std::chrono::steady_clock::now();
    if (!sessionCreateForGame(game, test_case.seed, &raw_session, &ps_error_ptr)) {
        timing.session_create_us = elapsedMicrosSince(phase_start);
        error = test_case.name + ": " + (ps_error_ptr != nullptr ? ps_error_message(ps_error_ptr) : "session create failed");
        ps_free_error(ps_error_ptr);
        return false;
    }
    timing.session_create_us = elapsedMicrosSince(phase_start);
    FullStatePtr session(raw_session);
    ps_full_state_set_unit_testing(session.get(), true);

    phase_start = std::chrono::steady_clock::now();
    if (!ps_full_state_load_level(session.get(), test_case.target_level, &ps_error_ptr)) {
        timing.level_load_us = elapsedMicrosSince(phase_start);
        error = test_case.name + ": " + (ps_error_ptr != nullptr ? ps_error_message(ps_error_ptr) : "level load failed");
        ps_free_error(ps_error_ptr);
        return false;
    }
    timing.level_load_us = elapsedMicrosSince(phase_start);

    phase_start = std::chrono::steady_clock::now();
    if (!replayInputTokens(session.get(), test_case.inputs)) {
        timing.replay_us = elapsedMicrosSince(phase_start);
        error = test_case.name + ": replay failed";
        return false;
    }
    timing.replay_us = elapsedMicrosSince(phase_start);
    return true;
}

} // namespace

bool parseCorpusCaseLine(const std::string& line, CorpusCase& out_case, std::string& error) {
    try {
        const auto root = puzzlescript::json::parse(line);
        const auto* index_value = root.find("index");
        const auto* name_value = root.find("name");
        const auto* source_value = root.find("source");
        const auto* inputs_value = root.find("inputs");
        const auto* target_level_value = root.find("target_level");
        const auto* seed_value = root.find("seed");
        if (name_value == nullptr || source_value == nullptr || !name_value->isString() || !source_value->isString()) {
            throw std::runtime_error("missing name/source");
        }
        out_case.index = index_value != nullptr
            ? static_cast<size_t>(jsonToInt64(*index_value))
            : 0;
        out_case.name = name_value->asString();
        out_case.source = source_value->asString();
        if (out_case.source.empty() || out_case.source.back() != '\n') {
            out_case.source.push_back('\n');
        }
        out_case.inputs = inputs_value != nullptr ? inputTokensFromJsonArray(*inputs_value) : std::vector<std::string>{};
        out_case.target_level = target_level_value != nullptr && !target_level_value->isNull()
            ? static_cast<int32_t>(jsonToInt64(*target_level_value))
            : 0;
        out_case.seed.reset();
        if (seed_value != nullptr && !seed_value->isNull()) {
            if (seed_value->isString()) {
                out_case.seed = seed_value->asString();
            } else if (seed_value->isInteger() || seed_value->isDouble()) {
                out_case.seed = std::to_string(jsonToInt64(*seed_value));
            }
        }
        return true;
    } catch (const std::exception& ex) {
        error = ex.what();
        return false;
    }
}

CorpusSummary runCorpusCases(const std::vector<CorpusCase>& cases) {
    CorpusSummary summary;
    summary.cases = cases.size();
    const auto wall_start = std::chrono::steady_clock::now();

    std::unordered_map<std::string, size_t> source_to_unique;
    std::vector<std::string> unique_sources;
    std::vector<GamePtr> unique_games;
    std::vector<int64_t> unique_compile_us;
    std::vector<size_t> case_to_unique(cases.size(), 0);

    for (size_t case_index = 0; case_index < cases.size(); ++case_index) {
        const auto [iterator, inserted] = source_to_unique.emplace(cases[case_index].source, unique_sources.size());
        case_to_unique[case_index] = iterator->second;
        if (inserted) {
            unique_sources.push_back(cases[case_index].source);
            unique_games.emplace_back(nullptr);
            unique_compile_us.push_back(0);
        }
    }

    for (size_t unique_index = 0; unique_index < unique_sources.size(); ++unique_index) {
        const auto compile_start = std::chrono::steady_clock::now();
        ps_game* raw_game = nullptr;
        if (!loadGameFromSourceText(unique_sources[unique_index], &raw_game)) {
            unique_compile_us[unique_index] = elapsedMicrosSince(compile_start);
            unique_games[unique_index].reset(nullptr);
            continue;
        }
        unique_compile_us[unique_index] = elapsedMicrosSince(compile_start);
        unique_games[unique_index].reset(raw_game);
        ++summary.games_loaded;
        summary.source_compile_us += unique_compile_us[unique_index];
    }
    summary.games_reused = cases.size() - unique_sources.size();

    for (size_t case_index = 0; case_index < cases.size(); ++case_index) {
        const CorpusCase& test_case = cases[case_index];
        const size_t unique_index = case_to_unique[case_index];
        CaseTiming timing;
        timing.source_compile_us = unique_compile_us[unique_index];
        std::string error;
        const bool ok = runSingleCase(test_case, unique_games[unique_index].get(), timing, error);
        summary.session_create_us += timing.session_create_us;
        summary.level_load_us += timing.level_load_us;
        summary.replay_us += timing.replay_us;
        if (ok) {
            ++summary.passed;
        } else {
            ++summary.failed;
            if (summary.first_error.empty()) {
                summary.first_error = error;
            }
        }
    }

    summary.wall_us = elapsedMicrosSince(wall_start);
    return summary;
}

CorpusSummary runCorpusNdjsonFile(const char* path) {
    CorpusSummary summary;
    const auto wall_start = std::chrono::steady_clock::now();
    int64_t parse_us_total = 0;

    std::ifstream stream(path, std::ios::binary);
    if (!stream) {
        summary.first_error = std::string("failed to open corpus: ") + path;
        summary.failed = 1;
        return summary;
    }

#if defined(ESP_PLATFORM)
    std::string line;
    size_t line_number = 0;
    while (std::getline(stream, line)) {
        ++line_number;
        if (line.empty()) {
            continue;
        }
        if (line.back() == '\r') {
            line.pop_back();
        }

        const auto parse_start = std::chrono::steady_clock::now();
        CorpusCase test_case;
        std::string error;
        if (!parseCorpusCaseLine(line, test_case, error)) {
            summary.first_error = "line " + std::to_string(line_number) + ": " + error;
            summary.failed = 1;
            summary.wall_us = elapsedMicrosSince(wall_start);
            summary.testdata_parse_us = parse_us_total;
            return summary;
        }
        parse_us_total += elapsedMicrosSince(parse_start);
        line.clear();
        line.shrink_to_fit();

        ++summary.cases;

        const auto compile_start = std::chrono::steady_clock::now();
        ps_game* raw_game = nullptr;
        if (!loadGameFromSourceText(test_case.source, &raw_game)) {
            ++summary.failed;
            if (summary.first_error.empty()) {
                summary.first_error = test_case.name + ": failed to compile source";
            }
            test_case.source.clear();
            test_case.source.shrink_to_fit();
            continue;
        }
        const int64_t compile_us = elapsedMicrosSince(compile_start);
        GamePtr game(raw_game);
        ++summary.games_loaded;
        summary.source_compile_us += compile_us;

        CaseTiming timing;
        timing.source_compile_us = compile_us;
        const bool ok = runSingleCase(test_case, game.get(), timing, error);
        summary.session_create_us += timing.session_create_us;
        summary.level_load_us += timing.level_load_us;
        summary.replay_us += timing.replay_us;
        if (ok) {
            ++summary.passed;
        } else {
            ++summary.failed;
            if (summary.first_error.empty()) {
                summary.first_error = error;
            }
        }

        test_case.source.clear();
        test_case.source.shrink_to_fit();
    }
#else
    constexpr size_t kMaxCachedGames = static_cast<size_t>(-1);

    struct CachedGame {
        GamePtr game;
        int64_t compile_us = 0;
    };
    std::unordered_map<std::string, CachedGame> game_cache;

    std::string line;
    size_t line_number = 0;
    while (std::getline(stream, line)) {
        ++line_number;
        if (line.empty()) {
            continue;
        }
        if (line.back() == '\r') {
            line.pop_back();
        }

        const auto parse_start = std::chrono::steady_clock::now();
        CorpusCase test_case;
        std::string error;
        if (!parseCorpusCaseLine(line, test_case, error)) {
            summary.first_error = "line " + std::to_string(line_number) + ": " + error;
            summary.failed = 1;
            summary.wall_us = elapsedMicrosSince(wall_start);
            summary.testdata_parse_us = parse_us_total;
            return summary;
        }
        parse_us_total += elapsedMicrosSince(parse_start);
        line.clear();

        ++summary.cases;

        CachedGame* cached = nullptr;
        const auto cache_it = game_cache.find(test_case.source);
        if (cache_it != game_cache.end()) {
            cached = &cache_it->second;
            ++summary.games_reused;
        } else {
            const auto compile_start = std::chrono::steady_clock::now();
            ps_game* raw_game = nullptr;
            if (!loadGameFromSourceText(test_case.source, &raw_game)) {
                ++summary.failed;
                if (summary.first_error.empty()) {
                    summary.first_error = test_case.name + ": failed to compile source";
                }
                continue;
            }
            const int64_t compile_us = elapsedMicrosSince(compile_start);
            const auto [inserted_it, inserted] = game_cache.emplace(
                test_case.source,
                CachedGame{GamePtr(raw_game), compile_us});
            cached = &inserted_it->second;
            if (inserted) {
                ++summary.games_loaded;
                summary.source_compile_us += compile_us;
            }

            while (game_cache.size() > kMaxCachedGames) {
                game_cache.erase(game_cache.begin());
            }
        }

        CaseTiming timing;
        timing.source_compile_us = cached != nullptr ? cached->compile_us : 0;
        const bool ok = runSingleCase(
            test_case,
            cached != nullptr ? cached->game.get() : nullptr,
            timing,
            error);
        summary.session_create_us += timing.session_create_us;
        summary.level_load_us += timing.level_load_us;
        summary.replay_us += timing.replay_us;
        if (ok) {
            ++summary.passed;
        } else {
            ++summary.failed;
            if (summary.first_error.empty()) {
                summary.first_error = error;
            }
        }
    }
#endif

    summary.wall_us = elapsedMicrosSince(wall_start);
    summary.testdata_parse_us = parse_us_total;
    return summary;
}

std::string corpusSummaryToJson(const CorpusSummary& summary) {
    const std::string first_error =
        summary.first_error.empty() ? "" : summary.first_error.substr(0, 200);
    char buffer[1024];
    std::snprintf(
        buffer,
        sizeof(buffer),
        "{\"event\":\"simulation_corpus_summary\",\"schema_version\":1,\"kind\":\"simulation_corpus_summary\","
        "\"status_summary\":{\"passed\":%zu,\"failed\":%zu,\"total\":%zu,\"cases\":%zu,\"repeats\":1,\"jobs\":1,"
        "\"elapsed_ms\":%lld,\"turn_executor\":\"interpreter\"},"
        "\"profile\":{\"wall_ms\":%lld,\"games_loaded\":%zu,\"games_reused\":%zu,\"testdata_parse_ms\":%lld,"
        "\"source_compile_ms\":%lld,\"session_create_ms\":%lld,\"level_load_ms\":%lld,\"replay_ms\":%lld,"
        "\"replay_avg_ms\":%lld,\"replay_median_ms\":%lld,\"serialize_ms\":0},"
        "\"first_error\":\"%s\"}",
        summary.passed,
        summary.failed,
        summary.passed + summary.failed,
        summary.cases,
        static_cast<long long>(usToMs(summary.wall_us)),
        static_cast<long long>(usToMs(summary.wall_us)),
        summary.games_loaded,
        summary.games_reused,
        static_cast<long long>(usToMs(summary.testdata_parse_us)),
        static_cast<long long>(usToMs(summary.source_compile_us)),
        static_cast<long long>(usToMs(summary.session_create_us)),
        static_cast<long long>(usToMs(summary.level_load_us)),
        static_cast<long long>(usToMs(summary.replay_us)),
        summary.cases > 0 ? static_cast<long long>(usToMs(summary.replay_us)) : 0LL,
        summary.cases > 0 ? static_cast<long long>(usToMs(summary.replay_us)) : 0LL,
        first_error.c_str());
    return std::string(buffer);
}

} // namespace puzzlescript::simulation
