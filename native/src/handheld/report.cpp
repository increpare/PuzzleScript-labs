#include "handheld/report.hpp"

#include "puzzlescript/compiler.h"
#include "puzzlescript/puzzlescript.h"

#include <fstream>
#include <memory>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
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

void appendLevelReport(
    std::ostringstream& out,
    const ps_game* game,
    ps_full_state* session,
    int32_t levelIndex,
    const ReportOptions& options,
    std::optional<Viewport>& previousViewport,
    bool& passing) {
    ps_error* rawError = nullptr;
    if (!ps_full_state_load_level(session, levelIndex, &rawError)) {
        passing = false;
        out << '{'
            << "\"index\":" << levelIndex << ','
            << "\"load_ok\":false,"
            << "\"error\":" << jsonEscape(errorMessage(rawError, "level load failed"))
            << '}';
        return;
    }

    ps_full_state_status_info status{};
    ps_full_state_status(session, &status);
    const auto flickscreen = parseScreenSize(ps_game_metadata_value(game, "flickscreen"));
    const auto zoomscreen = parseScreenSize(ps_game_metadata_value(game, "zoomscreen"));
    const LevelView level{status.width, status.height, flickscreen, zoomscreen};
    const Viewport viewport = computeViewport(level, firstPlayerPosition(session), previousViewport);
    previousViewport = viewport;
    const FitResult fit = computeFit(options.display, viewport);

    if (fit.degraded || !fit.fits) {
        passing = false;
    }

    out << '{'
        << "\"index\":" << levelIndex << ','
        << "\"load_ok\":true,"
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
        return GameReport{out.str(), false};
    }

    const ps_game* rawGame = ps_compile_result_game(result.get());
    GamePtr game(const_cast<ps_game*>(rawGame), ps_free_game);
    if (!game) {
        out << "\"compile_ok\":false,"
            << "\"compile_error\":" << jsonEscape(compileErrorMessage(result.get())) << ',';
        appendDiagnostics(out, sourceText);
        out << '}';
        return GameReport{out.str(), false};
    }

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
        return GameReport{out.str(), false};
    }
    FullStatePtr session(rawSession, ps_full_state_destroy);

    out << "\"session_ok\":true,"
        << "\"levels\":[";
    bool firstLevel = true;
    bool passing = true;
    std::optional<Viewport> previousViewport;
    const int32_t levelCount = ps_game_level_count(game.get());
    for (int32_t levelIndex = 0; levelIndex < levelCount; ++levelIndex) {
        if (!firstLevel) {
            out << ',';
        }
        firstLevel = false;
        appendLevelReport(out, game.get(), session.get(), levelIndex, options, previousViewport, passing);
    }
    out << "]}";
    return GameReport{out.str(), passing};
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
    out << "{\"games\":[";
    bool first = true;
    for (const SourceInput& source : sources) {
        const GameReport report = buildGameReport(source.name, source.source, options);
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

} // namespace puzzlescript::handheld
