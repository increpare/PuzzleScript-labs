#include "handheld/report.hpp"

#include "puzzlescript/compiler.h"
#include "puzzlescript/puzzlescript.h"
#include "runtime/json.hpp"

#include <cctype>
#include <fstream>
#include <memory>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace puzzlescript::handheld {
namespace {

using CompileResultPtr = std::unique_ptr<ps_compile_result, decltype(&ps_free_compile_result)>;
using CompilerResultPtr = std::unique_ptr<ps_compiler_result, decltype(&ps_compiler_result_free)>;
using ErrorPtr = std::unique_ptr<ps_error, decltype(&ps_free_error)>;
using FullStatePtr = std::unique_ptr<ps_full_state, decltype(&ps_full_state_destroy)>;
using GamePtr = std::unique_ptr<ps_game, decltype(&ps_free_game)>;

struct GameReport {
    std::string json;
    bool passing = false;
    bool compileOk = false;
    size_t boardLevels = 0;
    size_t textLevels = 0;
    size_t degradedLevels = 0;
};

const char* severityName(ps_diagnostic_severity severity) {
    switch (severity) {
        case PS_DIAG_ERROR: return "error";
        case PS_DIAG_WARNING: return "warning";
        case PS_DIAG_INFO: return "info";
        case PS_DIAG_LOG: return "log";
    }
    return "info";
}

std::string errorMessage(ps_error* error, std::string_view fallback) {
    ErrorPtr holder(error, ps_free_error);
    if (holder) {
        const char* message = ps_error_message(holder.get());
        if (message != nullptr && message[0] != '\0') {
            return message;
        }
    }
    return std::string(fallback);
}

std::string compileErrorMessage(const ps_compile_result* result) {
    if (result == nullptr) {
        return "compile did not return a result";
    }
    const ps_error* error = ps_compile_result_error(result);
    ErrorPtr holder(const_cast<ps_error*>(error), ps_free_error);
    if (holder) {
        const char* message = ps_error_message(holder.get());
        if (message != nullptr && message[0] != '\0') {
            return message;
        }
    }
    return "source did not compile";
}

std::string linePrefix(const std::string& label, size_t lineNumber) {
    return label + ":" + std::to_string(lineNumber) + ": ";
}

bool isWhitespaceOnly(std::string_view text) {
    for (const unsigned char ch : text) {
        if (!std::isspace(ch)) {
            return false;
        }
    }
    return true;
}

std::string requiredStringField(
    const puzzlescript::json::Value::Object& object,
    const std::string& key,
    const std::string& context) {
    const auto it = object.find(key);
    if (it == object.end()) {
        throw std::runtime_error(context + "missing required string field '" + key + "'");
    }
    const puzzlescript::json::Value& value = it->second;
    if (!value.isString()) {
        throw std::runtime_error(context + "field '" + key + "' must be a string");
    }
    return value.asString();
}

void appendDiagnostics(std::ostringstream& out, const std::string& sourceText) {
    CompilerResultPtr diagnostics(
        ps_compiler_compile_source_diagnostics(sourceText.data(), sourceText.size()),
        ps_compiler_result_free);

    out << "\"diagnostics\":[";
    bool first = true;
    if (diagnostics) {
        const size_t count = ps_compiler_result_diagnostic_count(diagnostics.get());
        for (size_t index = 0; index < count; ++index) {
            const ps_diagnostic* diagnostic = ps_compiler_result_diagnostic(diagnostics.get(), index);
            if (diagnostic == nullptr) {
                continue;
            }
            if (!first) {
                out << ',';
            }
            first = false;
            out << '{'
                << "\"severity\":" << jsonEscape(severityName(diagnostic->severity)) << ','
                << "\"code\":" << diagnostic->code << ','
                << "\"line\":" << diagnostic->line << ','
                << "\"message\":" << jsonEscape(diagnostic->message == nullptr ? "" : diagnostic->message)
                << '}';
        }
    }
    out << ']';
}

void appendSelectedMetadata(std::ostringstream& out, const ps_game* game) {
    static constexpr const char* keys[] = {
        "flickscreen",
        "zoomscreen",
        "realtime_interval",
        "noaction",
        "norestart",
        "noundo",
    };

    out << "\"metadata\":{";
    bool first = true;
    for (const char* key : keys) {
        if (!ps_game_has_metadata(game, key)) {
            continue;
        }
        if (!first) {
            out << ',';
        }
        first = false;
        out << jsonEscape(key) << ':'
            << jsonEscape(ps_game_metadata_value(game, key));
    }
    out << '}';
}

std::optional<PlayerPosition> firstPlayerPosition(const ps_full_state* session) {
    int32_t playerX = 0;
    int32_t playerY = 0;
    if (!ps_full_state_first_player_position(session, &playerX, &playerY)) {
        return std::nullopt;
    }
    return PlayerPosition{playerX, playerY};
}

const char* stateModeName(ps_full_state_mode mode) {
    switch (mode) {
        case PS_FULL_STATE_MODE_LEVEL: return "level";
        case PS_FULL_STATE_MODE_TITLE: return "title";
        case PS_FULL_STATE_MODE_MESSAGE: return "message";
    }
    return "unknown";
}

void appendLevelReport(
    std::ostringstream& out,
    const ps_game* game,
    ps_full_state* session,
    int32_t levelIndex,
    const ReportOptions& options,
    std::optional<Viewport>& previousViewport,
    GameReport& report) {
    ps_error* rawError = nullptr;
    if (!ps_full_state_load_level(session, levelIndex, &rawError)) {
        report.passing = false;
        out << '{'
            << "\"index\":" << levelIndex << ','
            << "\"load_ok\":false,"
            << "\"error\":" << jsonEscape(errorMessage(rawError, "level load failed"))
            << '}';
        return;
    }

    ps_full_state_status_info status{};
    ps_full_state_status(session, &status);
    if (status.text_mode || status.mode == PS_FULL_STATE_MODE_MESSAGE || status.mode == PS_FULL_STATE_MODE_TITLE) {
        ++report.textLevels;
        out << '{'
            << "\"index\":" << levelIndex << ','
            << "\"load_ok\":true,"
            << "\"kind\":\"text\","
            << "\"mode\":" << jsonEscape(stateModeName(status.mode)) << ','
            << "\"text_mode\":" << (status.text_mode ? "true" : "false") << ','
            << "\"terminal_width\":34,"
            << "\"terminal_height\":13,"
            << "\"message\":" << jsonEscape(ps_full_state_message_text(session))
            << '}';
        return;
    }

    ++report.boardLevels;
    const auto flickscreen = parseScreenSize(ps_game_metadata_value(game, "flickscreen"));
    const auto zoomscreen = parseScreenSize(ps_game_metadata_value(game, "zoomscreen"));
    const LevelView level{status.width, status.height, flickscreen, zoomscreen};
    const Viewport viewport = computeViewport(level, firstPlayerPosition(session), previousViewport);
    previousViewport = viewport;
    const FitResult fit = computeFit(options.display, viewport);

    if (fit.degraded) {
        report.passing = false;
        ++report.degradedLevels;
    }
    if (!fit.fits) {
        report.passing = false;
    }

    out << '{'
        << "\"index\":" << levelIndex << ','
        << "\"load_ok\":true,"
        << "\"kind\":\"board\","
        << "\"mode\":" << jsonEscape(viewport.mode) << ','
        << "\"board_width\":" << status.width << ','
        << "\"board_height\":" << status.height << ','
        << "\"viewport_x\":" << viewport.minX << ','
        << "\"viewport_y\":" << viewport.minY << ','
        << "\"viewport_width\":" << viewport.width << ','
        << "\"viewport_height\":" << viewport.height << ','
        << "\"viewport_max_x\":" << viewport.maxX << ','
        << "\"viewport_max_y\":" << viewport.maxY << ','
        << "\"tile_pixels\":" << fit.tilePixels << ','
        << "\"sprite_scale\":" << fit.spriteScale << ','
        << "\"pixel_width\":" << fit.pixelWidth << ','
        << "\"pixel_height\":" << fit.pixelHeight << ','
        << "\"offset_x\":" << fit.offsetX << ','
        << "\"offset_y\":" << fit.offsetY << ','
        << "\"degraded\":" << (fit.degraded ? "true" : "false") << ','
        << "\"fits\":" << (fit.fits ? "true" : "false")
        << '}';
}

GameReport buildGameReport(
    const std::string& sourceName,
    const std::string& sourceText,
    const ReportOptions& options) {
    std::ostringstream out;
    GameReport report;
    out << '{'
        << "\"source\":" << jsonEscape(sourceName) << ',';

    ps_compile_result* rawResult = nullptr;
    const bool compiled = ps_compile_source(sourceText.data(), sourceText.size(), &rawResult);
    CompileResultPtr result(rawResult, ps_free_compile_result);
    if (!compiled || !result) {
        out << "\"compile_ok\":false,"
            << "\"compile_error\":" << jsonEscape(compileErrorMessage(result.get())) << ',';
        appendDiagnostics(out, sourceText);
        out << '}';
        report.json = out.str();
        return report;
    }

    const ps_game* rawGame = ps_compile_result_game(result.get());
    GamePtr game(const_cast<ps_game*>(rawGame), ps_free_game);
    if (!game) {
        out << "\"compile_ok\":false,"
            << "\"compile_error\":" << jsonEscape(compileErrorMessage(result.get())) << ',';
        appendDiagnostics(out, sourceText);
        out << '}';
        report.json = out.str();
        return report;
    }

    report.compileOk = true;
    out << "\"compile_ok\":true,"
        << "\"background_color\":" << jsonEscape(ps_game_background_color(game.get())) << ',';
    appendSelectedMetadata(out, game.get());
    out << ',';

    ps_error* rawError = nullptr;
    ps_full_state* rawSession = nullptr;
    if (!ps_full_state_create(game.get(), &rawSession, &rawError)) {
        out << "\"session_ok\":false,"
            << "\"session_error\":" << jsonEscape(errorMessage(rawError, "session creation failed")) << ','
            << "\"levels\":[]"
            << '}';
        report.json = out.str();
        return report;
    }
    FullStatePtr session(rawSession, ps_full_state_destroy);

    report.passing = true;
    out << "\"session_ok\":true,"
        << "\"levels\":[";
    bool firstLevel = true;
    std::optional<Viewport> previousViewport;
    const int32_t levelCount = ps_game_level_count(game.get());
    for (int32_t levelIndex = 0; levelIndex < levelCount; ++levelIndex) {
        if (!firstLevel) {
            out << ',';
        }
        firstLevel = false;
        appendLevelReport(out, game.get(), session.get(), levelIndex, options, previousViewport, report);
    }
    out << "]}";
    report.json = out.str();
    return report;
}

} // namespace

std::string readTextFile(const std::filesystem::path& path) {
    std::ifstream file(path, std::ios::binary);
    if (!file) {
        throw std::runtime_error("failed to open source file: " + path.string());
    }
    std::ostringstream buffer;
    buffer << file.rdbuf();
    if (!file.good() && !file.eof()) {
        throw std::runtime_error("failed to read source file: " + path.string());
    }
    return buffer.str();
}

std::string buildReportForSourceText(
    const std::string& sourceName,
    const std::string& sourceText,
    const ReportOptions& options) {
    return buildGameReport(sourceName, sourceText, options).json;
}

std::string buildReportForSources(
    const std::vector<SourceInput>& sources,
    const ReportOptions& options) {
    std::ostringstream out;
    std::vector<GameReport> reports;
    reports.reserve(sources.size());
    size_t compiledGames = 0;
    size_t boardLevels = 0;
    size_t textLevels = 0;
    size_t degradedLevels = 0;
    for (const SourceInput& source : sources) {
        GameReport report = buildGameReport(source.name, source.source, options);
        if (report.compileOk) {
            ++compiledGames;
        }
        boardLevels += report.boardLevels;
        textLevels += report.textLevels;
        degradedLevels += report.degradedLevels;
        reports.push_back(std::move(report));
    }

    out << "{\"summary\":{"
        << "\"game_count\":" << sources.size() << ','
        << "\"compiled_games\":" << compiledGames << ','
        << "\"compile_failures\":" << (sources.size() - compiledGames) << ','
        << "\"board_levels\":" << boardLevels << ','
        << "\"text_levels\":" << textLevels << ','
        << "\"degraded_levels\":" << degradedLevels
        << "},\"games\":[";
    bool first = true;
    for (const GameReport& report : reports) {
        if (!options.includePassingGames && report.passing) {
            continue;
        }
        if (!first) {
            out << ',';
        }
        first = false;
        out << report.json;
    }
    out << "]}";
    return out.str();
}

std::vector<SourceInput> loadSourcesFromNdjsonText(
    const std::string& label,
    const std::string& ndjsonText) {
    std::vector<SourceInput> sources;
    std::istringstream input(ndjsonText);
    std::string line;
    size_t lineNumber = 0;
    while (std::getline(input, line)) {
        ++lineNumber;
        if (isWhitespaceOnly(line)) {
            continue;
        }
        const std::string context = linePrefix(label, lineNumber);
        puzzlescript::json::Value value;
        try {
            value = puzzlescript::json::parse(line);
        } catch (const std::exception& e) {
            throw std::runtime_error(context + "invalid JSON: " + e.what());
        }
        if (!value.isObject()) {
            throw std::runtime_error(context + "record must be a JSON object");
        }
        const puzzlescript::json::Value::Object& object = value.asObject();
        sources.push_back(SourceInput{
            requiredStringField(object, "name", context),
            requiredStringField(object, "source", context),
        });
    }
    return sources;
}

std::vector<SourceInput> loadSourcesFromNdjsonFile(const std::filesystem::path& path) {
    return loadSourcesFromNdjsonText(path.string(), readTextFile(path));
}

} // namespace puzzlescript::handheld
