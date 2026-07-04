#undef NDEBUG
#include <cassert>
#include <cstdint>
#include <exception>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

#include "handheld/report.hpp"
#include "runtime/json.hpp"

using puzzlescript::handheld::DisplaySpec;
using puzzlescript::handheld::ReportOptions;
using puzzlescript::handheld::SourceInput;
using puzzlescript::handheld::buildReportForSources;
using puzzlescript::handheld::loadSourcesFromNdjsonText;
using puzzlescript::json::Value;

namespace {

void require(bool condition, const char* message) {
    if (!condition) {
        assert(false && message);
    }
}

const Value& requireField(const Value::Object& object, const char* key) {
    const auto it = object.find(key);
    require(it != object.end(), "missing JSON field");
    return it->second;
}

void requireMissingField(const Value::Object& object, const char* key) {
    require(object.find(key) == object.end(), "JSON field should be absent");
}

const Value::Object& requireObject(const Value& value, const char* message) {
    require(value.isObject(), message);
    return value.asObject();
}

const Value::Array& requireArray(const Value& value, const char* message) {
    require(value.isArray(), message);
    return value.asArray();
}

std::string requireString(const Value::Object& object, const char* key) {
    const Value& value = requireField(object, key);
    require(value.isString(), "JSON field should be a string");
    return value.asString();
}

int64_t requireInteger(const Value::Object& object, const char* key) {
    const Value& value = requireField(object, key);
    require(value.isInteger(), "JSON field should be an integer");
    return value.asInteger();
}

bool requireBool(const Value::Object& object, const char* key) {
    const Value& value = requireField(object, key);
    require(value.isBool(), "JSON field should be a boolean");
    return value.asBool();
}

void requireContains(const std::string& haystack, std::string_view needle, const char* message) {
    require(haystack.find(std::string(needle)) != std::string::npos, message);
}

void requireNdjsonErrorContains(
    const std::string& ndjsonText,
    std::string_view label,
    std::string_view line,
    std::string_view expected) {
    try {
        (void)loadSourcesFromNdjsonText(std::string(label), ndjsonText);
    } catch (const std::exception& e) {
        const std::string message = e.what();
        requireContains(message, label, "NDJSON error should include label");
        requireContains(message, line, "NDJSON error should include line number");
        requireContains(message, expected, "NDJSON error should include expected detail");
        return;
    }
    require(false, "NDJSON input should throw");
}

std::string jsonString(const std::string& value) {
    std::ostringstream out;
    out << '"';
    for (const unsigned char ch : value) {
        switch (ch) {
            case '"': out << "\\\""; break;
            case '\\': out << "\\\\"; break;
            case '\b': out << "\\b"; break;
            case '\f': out << "\\f"; break;
            case '\n': out << "\\n"; break;
            case '\r': out << "\\r"; break;
            case '\t': out << "\\t"; break;
            default:
                if (ch < 0x20) {
                    static constexpr char digits[] = "0123456789abcdef";
                    out << "\\u00" << digits[ch >> 4] << digits[ch & 0x0f];
                } else {
                    out << static_cast<char>(ch);
                }
                break;
        }
    }
    out << '"';
    return out.str();
}

const Value::Object& firstGameObject(const Value& root) {
    const Value::Object& rootObject = requireObject(root, "report root should be an object");
    const Value::Array& games = requireArray(requireField(rootObject, "games"), "games should be an array");
    require(games.size() == 1, "smoke report should contain one game");
    return requireObject(games[0], "game should be an object");
}

const Value::Object& firstLevelObject(const Value::Object& game) {
    const Value::Array& levels = requireArray(requireField(game, "levels"), "levels should be an array");
    require(!levels.empty(), "compiled game should report at least one level");
    return requireObject(levels[0], "level should be an object");
}

std::string simpleSource() {
    return R"PS(
title simple
background_color #123456

OBJECTS

Background
black

Player
white

LEGEND

. = Background
P = Player

COLLISIONLAYERS

Background
Player

LEVELS

P..
...
)PS";
}

std::string flickscreenSource() {
    return R"PS(
title flick
flickscreen 2x2

OBJECTS

Background
black

Player
white

LEGEND

. = Background
P = Player

COLLISIONLAYERS

Background
Player

LEVELS

....
....
..P.
....
)PS";
}

std::string edgeFlickscreenSource() {
    return R"PS(
title flick edge
flickscreen 3x3

OBJECTS

Background
black

Player
white

LEGEND

. = Background
P = Player

COLLISIONLAYERS

Background
Player

LEVELS

.....
.....
.....
.....
....P
    )PS";
}

std::string messageLevelSource() {
    return R"PS(
title message level

OBJECTS

Background
black

Player
white

LEGEND

. = Background
P = Player

COLLISIONLAYERS

Background
Player

LEVELS

message hello handheld

P
)PS";
}

std::string brokenSource() {
    return R"PS(
title broken

OBJECTS

Background
black

Player
white

LEGEND

. = Background
P = Player
B = Background and Player

COLLISIONLAYERS

Background
Player

RULES

[ no B ] -> [ ]

LEVELS

P
)PS";
}

void reportsSimpleFullLevel() {
    const std::string report = buildReportForSources(
        {SourceInput{"simple.txt", simpleSource()}},
        ReportOptions{DisplaySpec{800, 480, 5}, true});
    const Value root = puzzlescript::json::parse(report);
    const Value::Object& game = firstGameObject(root);
    const Value::Object& level = firstLevelObject(game);

    require(requireString(game, "source") == "simple.txt", "simple source name");
    require(requireBool(game, "compile_ok"), "simple source should compile");
    require(requireString(game, "background_color") == "#123456", "simple background color");
    requireObject(requireField(game, "metadata"), "metadata should be an object");
    require(requireString(level, "mode") == "full", "simple viewport mode");
    require(requireInteger(level, "board_width") == 3, "simple board width");
    require(requireInteger(level, "board_height") == 2, "simple board height");
    require(requireInteger(level, "viewport_x") == 0, "simple viewport x");
    require(requireInteger(level, "viewport_y") == 0, "simple viewport y");
    require(requireInteger(level, "viewport_width") == 3, "simple viewport width");
    require(requireInteger(level, "viewport_height") == 2, "simple viewport height");
    require(requireInteger(level, "viewport_max_x") == 3, "simple viewport max x");
    require(requireInteger(level, "viewport_max_y") == 2, "simple viewport max y");
    require(requireInteger(level, "tile_pixels") == 240, "simple tile pixels");
    require(!requireBool(level, "degraded"), "simple fit should not be degraded");
    require(requireBool(level, "fits"), "simple fit should fit");
}

void reportsFlickscreenMetadataAndViewport() {
    const std::string report = buildReportForSources(
        {SourceInput{"flick.txt", flickscreenSource()}},
        ReportOptions{DisplaySpec{800, 480, 5}, true});
    const Value root = puzzlescript::json::parse(report);
    const Value::Object& game = firstGameObject(root);
    const Value::Object& metadata = requireObject(requireField(game, "metadata"), "metadata should be an object");
    const Value::Object& level = firstLevelObject(game);

    require(requireString(game, "source") == "flick.txt", "flick source name");
    require(requireBool(game, "compile_ok"), "flick source should compile");
    require(requireString(metadata, "flickscreen") == "2x2", "flickscreen metadata");
    require(requireString(level, "mode") == "flickscreen", "flick viewport mode");
    require(requireInteger(level, "board_width") == 4, "flick board width");
    require(requireInteger(level, "board_height") == 4, "flick board height");
    require(requireInteger(level, "viewport_x") == 2, "flick viewport x");
    require(requireInteger(level, "viewport_y") == 2, "flick viewport y");
    require(requireInteger(level, "viewport_width") == 2, "flick viewport width");
    require(requireInteger(level, "viewport_height") == 2, "flick viewport height");
    require(requireInteger(level, "viewport_max_x") == 4, "flick viewport max x");
    require(requireInteger(level, "viewport_max_y") == 4, "flick viewport max y");
    require(requireInteger(level, "tile_pixels") == 240, "flick tile pixels");
    require(!requireBool(level, "degraded"), "flick fit should not be degraded");
    require(requireBool(level, "fits"), "flick fit should fit");
}

void reportsFlickscreenEdgePageBounds() {
    const std::string report = buildReportForSources(
        {SourceInput{"edge.txt", edgeFlickscreenSource()}},
        ReportOptions{DisplaySpec{800, 480, 5}, true});
    const Value root = puzzlescript::json::parse(report);
    const Value::Object& game = firstGameObject(root);
    const Value::Object& level = firstLevelObject(game);

    require(requireString(game, "source") == "edge.txt", "edge source name");
    require(requireBool(game, "compile_ok"), "edge source should compile");
    require(requireString(level, "mode") == "flickscreen", "edge viewport mode");
    require(requireInteger(level, "board_width") == 5, "edge board width");
    require(requireInteger(level, "board_height") == 5, "edge board height");
    require(requireInteger(level, "viewport_x") == 3, "edge viewport x");
    require(requireInteger(level, "viewport_y") == 3, "edge viewport y");
    require(requireInteger(level, "viewport_width") == 3, "edge viewport width");
    require(requireInteger(level, "viewport_height") == 3, "edge viewport height");
    require(requireInteger(level, "viewport_max_x") == 5, "edge viewport max x");
    require(requireInteger(level, "viewport_max_y") == 5, "edge viewport max y");
    require(requireBool(level, "fits"), "edge fit should fit");
}

void reportsMessageLevelsSeparatelyFromBoardFits() {
    const std::string report = buildReportForSources(
        {SourceInput{"message.txt", messageLevelSource()}},
        ReportOptions{DisplaySpec{800, 480, 5}, true});
    const Value root = puzzlescript::json::parse(report);
    const Value::Object& rootObject = requireObject(root, "report root should be an object");
    const Value::Object& summary = requireObject(requireField(rootObject, "summary"), "summary should be an object");
    const Value::Object& game = firstGameObject(root);
    const Value::Array& levels = requireArray(requireField(game, "levels"), "levels should be an array");
    require(levels.size() == 2, "message source should report message and board levels");

    require(requireInteger(summary, "board_levels") == 1, "message summary board levels");
    require(requireInteger(summary, "text_levels") == 1, "message summary text levels");
    require(requireInteger(summary, "degraded_levels") == 0, "message source should not degrade board fits");

    const Value::Object& messageLevel = requireObject(levels[0], "message level should be an object");
    require(requireString(messageLevel, "kind") == "message", "message level kind");
    require(requireString(messageLevel, "mode") == "message", "message level mode");
    require(requireBool(messageLevel, "text_mode"), "message level should be text mode");
    require(requireString(messageLevel, "message") == "hello handheld", "message text");
    require(requireInteger(messageLevel, "terminal_width") == 34, "message terminal width");
    require(requireInteger(messageLevel, "terminal_height") == 13, "message terminal height");
    requireMissingField(messageLevel, "board_width");
    requireMissingField(messageLevel, "tile_pixels");

    const Value::Object& boardLevel = requireObject(levels[1], "board level should be an object");
    require(requireString(boardLevel, "kind") == "board", "board level kind");
    require(requireInteger(boardLevel, "board_width") > 0, "board level width should be positive");
    require(requireInteger(boardLevel, "board_height") > 0, "board level height should be positive");
    require(requireBool(boardLevel, "fits"), "board level should fit");
}

void reportsBrokenSourceDiagnostics() {
    const std::string report = buildReportForSources(
        {SourceInput{"broken.txt", brokenSource()}},
        ReportOptions{DisplaySpec{800, 480, 5}, true});
    const Value root = puzzlescript::json::parse(report);
    const Value::Object& game = firstGameObject(root);
    const Value::Array& diagnostics = requireArray(requireField(game, "diagnostics"), "diagnostics should be an array");

    require(requireString(game, "source") == "broken.txt", "broken source name");
    require(!requireBool(game, "compile_ok"), "broken source should not compile");
    require(!diagnostics.empty(), "broken source should report diagnostics");

    bool foundErrorDiagnostic = false;
    for (const Value& diagnosticValue : diagnostics) {
        const Value::Object& diagnostic = requireObject(diagnosticValue, "diagnostic should be an object");
        if (requireString(diagnostic, "severity") == "error" && !requireString(diagnostic, "message").empty()) {
            foundErrorDiagnostic = true;
        }
    }
    require(foundErrorDiagnostic, "broken source should include an error diagnostic with a message");
}

void reportsCorpusSummary() {
    const std::string ndjson =
        "{ \"index\":0, \"name\":\"simple\", \"source\":" + jsonString(simpleSource()) + " }\n"
        "{ \"index\":1, \"name\":\"broken\", \"source\":" + jsonString(brokenSource()) + " }\n";
    const std::vector<SourceInput> sources = loadSourcesFromNdjsonText("inline.ndjson", ndjson);

    require(sources.size() == 2, "corpus should load two sources");
    require(sources[0].name == "simple", "first corpus source name");
    require(sources[0].source == simpleSource(), "first corpus source text");
    require(sources[1].name == "broken", "second corpus source name");
    require(sources[1].source == brokenSource(), "second corpus source text");

    const std::string report = buildReportForSources(
        sources,
        ReportOptions{DisplaySpec{800, 480, 5}, true});
    const Value root = puzzlescript::json::parse(report);
    const Value::Object& rootObject = requireObject(root, "report root should be an object");
    const Value::Object& summary = requireObject(requireField(rootObject, "summary"), "summary should be an object");
    const Value::Array& games = requireArray(requireField(rootObject, "games"), "games should be an array");

    require(requireInteger(summary, "game_count") == 2, "corpus summary game count");
    require(requireInteger(summary, "compiled_games") == 1, "corpus summary compiled games");
    require(requireInteger(summary, "compile_failures") == 1, "corpus summary compile failures");
    require(requireInteger(summary, "board_levels") == 1, "corpus summary board levels");
    require(requireInteger(summary, "text_levels") == 0, "corpus summary text levels");
    require(requireInteger(summary, "degraded_levels") == 0, "corpus summary degraded levels");
    require(games.size() == 2, "corpus report should include both games by default");
}

void rejectsMalformedCorpusRecords() {
    requireNdjsonErrorContains(
        "{ \"name\":\"simple\", \"source\":\"x\" }\n{",
        "bad.ndjson",
        ":2:",
        "invalid JSON");
    requireNdjsonErrorContains(
        "[]\n",
        "bad.ndjson",
        ":1:",
        "record must be a JSON object");
    requireNdjsonErrorContains(
        "{ \"source\":\"x\" }\n",
        "bad.ndjson",
        ":1:",
        "name");
    requireNdjsonErrorContains(
        "{ \"name\":\"simple\" }\n",
        "bad.ndjson",
        ":1:",
        "source");
    requireNdjsonErrorContains(
        "{ \"name\":7, \"source\":\"x\" }\n",
        "bad.ndjson",
        ":1:",
        "name");
    requireNdjsonErrorContains(
        "{ \"name\":\"simple\", \"source\":false }\n",
        "bad.ndjson",
        ":1:",
        "source");
}

void summaryCountsAllSourcesWhenPassingGamesAreFiltered() {
    const std::string report = buildReportForSources(
        {
            SourceInput{"simple.txt", simpleSource()},
            SourceInput{"broken.txt", brokenSource()},
        },
        ReportOptions{DisplaySpec{800, 480, 5}, false});
    const Value root = puzzlescript::json::parse(report);
    const Value::Object& rootObject = requireObject(root, "report root should be an object");
    const Value::Object& summary = requireObject(requireField(rootObject, "summary"), "summary should be an object");
    const Value::Array& games = requireArray(requireField(rootObject, "games"), "games should be an array");

    require(requireInteger(summary, "game_count") == 2, "filtered summary game count");
    require(requireInteger(summary, "compiled_games") == 1, "filtered summary compiled games");
    require(requireInteger(summary, "compile_failures") == 1, "filtered summary compile failures");
    require(requireInteger(summary, "board_levels") == 1, "filtered summary board levels");
    require(requireInteger(summary, "text_levels") == 0, "filtered summary text levels");
    require(requireInteger(summary, "degraded_levels") == 0, "filtered summary degraded levels");
    require(games.size() == 1, "filtered report should include only failing games");
    const Value::Object& game = requireObject(games[0], "filtered game should be an object");
    require(requireString(game, "source") == "broken.txt", "filtered game source");
    require(!requireBool(game, "compile_ok"), "filtered game should be the compile failure");
}

} // namespace

int main() {
    reportsSimpleFullLevel();
    reportsFlickscreenMetadataAndViewport();
    reportsFlickscreenEdgePageBounds();
    reportsMessageLevelsSeparatelyFromBoardFits();
    reportsBrokenSourceDiagnostics();
    reportsCorpusSummary();
    rejectsMalformedCorpusRecords();
    summaryCountsAllSourcesWhenPassingGamesAreFiltered();
    return 0;
}
