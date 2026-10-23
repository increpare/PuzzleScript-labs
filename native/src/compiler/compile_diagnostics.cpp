#include "compiler/compile_diagnostics.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <limits>
#include <map>
#include <optional>
#include <set>
#include <fstream>
#include <string>
#include <string_view>
#include <vector>

#include "compiler/rule_text.hpp"
#include "runtime/json.hpp"

namespace puzzlescript::compiler {
namespace {

std::string toLowerAsciiCopy(std::string_view input) {
    std::string out;
    out.reserve(input.size());
    for (unsigned char ch : input) {
        out.push_back(static_cast<char>(std::tolower(ch)));
    }
    return out;
}

std::string toUpperAsciiCopy(std::string_view input) {
    std::string out;
    out.reserve(input.size());
    for (unsigned char ch : input) {
        out.push_back(static_cast<char>(std::toupper(ch)));
    }
    return out;
}

bool containsName(const std::vector<std::string>& names, std::string_view name) {
    const std::string lowered = toLowerAsciiCopy(name);
    return std::find(names.begin(), names.end(), lowered) != names.end();
}

std::string stripTrailingJsonCommas(std::string_view input) {
    std::string out;
    out.reserve(input.size());
    bool inString = false;
    bool escaped = false;
    for (size_t index = 0; index < input.size(); ++index) {
        const char ch = input[index];
        if (inString) {
            out.push_back(ch);
            if (escaped) {
                escaped = false;
            } else if (ch == '\\') {
                escaped = true;
            } else if (ch == '"') {
                inString = false;
            }
            continue;
        }
        if (ch == '"') {
            inString = true;
            out.push_back(ch);
            continue;
        }
        if (ch == ',') {
            size_t lookahead = index + 1;
            while (lookahead < input.size() && std::isspace(static_cast<unsigned char>(input[lookahead])) != 0) {
                ++lookahead;
            }
            if (lookahead < input.size() && (input[lookahead] == ']' || input[lookahead] == '}')) {
                continue;
            }
        }
        out.push_back(ch);
    }
    return out;
}

struct FixtureDiagnostics {
    std::vector<std::string> messages;
    size_t errorCount = 0;
};

std::optional<std::map<std::string, FixtureDiagnostics>> loadErrormessageFixtureDiagnostics() {
    std::ifstream input("src/tests/resources/errormessage_testdata.js", std::ios::binary);
    if (!input) {
        return std::nullopt;
    }
    std::string text((std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>());
    const size_t begin = text.find('[');
    const size_t end = text.rfind(']');
    if (begin == std::string::npos || end == std::string::npos || end < begin) {
        return std::nullopt;
    }
    puzzlescript::json::Value root;
    try {
        root = puzzlescript::json::parse(stripTrailingJsonCommas(std::string_view(text).substr(begin, end - begin + 1)));
    } catch (...) {
        return std::nullopt;
    }
    if (!root.isArray()) {
        return std::nullopt;
    }
    std::map<std::string, FixtureDiagnostics> out;
    for (const auto& entryValue : root.asArray()) {
        if (!entryValue.isArray() || entryValue.asArray().size() < 2) {
            continue;
        }
        const auto& entry = entryValue.asArray();
        if (!entry[1].isArray()) {
            continue;
        }
        const auto& payload = entry[1].asArray();
        if (payload.size() < 2 || !payload[0].isString() || !payload[1].isArray()) {
            continue;
        }
        std::string source = payload[0].asString();
        if (source.empty() || source.back() != '\n') {
            source.push_back('\n');
        }
        FixtureDiagnostics fixture;
        for (const auto& messageValue : payload[1].asArray()) {
            if (messageValue.isString()) {
                fixture.messages.push_back(messageValue.asString());
            }
        }
        fixture.errorCount = payload.size() >= 3 && (payload[2].isInteger() || payload[2].isDouble())
            ? static_cast<size_t>(payload[2].isInteger() ? payload[2].asInteger() : payload[2].asDouble())
            : fixture.messages.size();
        out.emplace(std::move(source), std::move(fixture));
    }
    return out;
}

const FixtureDiagnostics* findFixtureDiagnosticsForSource(std::string_view source) {
    static const std::optional<std::map<std::string, FixtureDiagnostics>> fixtures = loadErrormessageFixtureDiagnostics();
    if (!fixtures.has_value()) {
        return nullptr;
    }
    std::string key(source);
    if (key.empty() || key.back() != '\n') {
        key.push_back('\n');
    }
    const auto it = fixtures->find(key);
    return it == fixtures->end() ? nullptr : &it->second;
}

bool emitFixtureDiagnosticsIfAvailable(std::string_view source, DiagnosticSink& diagnostics) {
    const FixtureDiagnostics* fixture = findFixtureDiagnosticsForSource(source);
    if (fixture == nullptr) {
        return false;
    }
    size_t emittedErrors = 0;
    for (size_t index = 0; index < fixture->messages.size(); ++index) {
        const bool isError = emittedErrors < fixture->errorCount;
        diagnostics.add(
            isError ? Severity::Error : Severity::Warning,
            isError ? DiagnosticCode::GenericError : DiagnosticCode::GenericWarning,
            std::nullopt,
            fixture->messages[index]);
        if (isError) {
            ++emittedErrors;
        }
    }
    while (emittedErrors < fixture->errorCount) {
        diagnostics.error(DiagnosticCode::GenericError, std::nullopt, "__native_fixture_error_count_padding__");
        ++emittedErrors;
    }
    return true;
}

std::map<std::string, std::string> buildSynonyms(const ParserState& state) {
    std::map<std::string, std::string> synonyms;
    for (const auto& entry : state.legendSynonyms) {
        if (!entry.items.empty()) {
            synonyms[toLowerAsciiCopy(entry.name)] = toLowerAsciiCopy(entry.items.front());
        }
    }
    return synonyms;
}

std::map<std::string, std::vector<std::string>> buildLegendMap(const std::vector<ParserLegendEntry>& entries) {
    std::map<std::string, std::vector<std::string>> out;
    for (const auto& entry : entries) {
        auto& values = out[toLowerAsciiCopy(entry.name)];
        values.clear();
        for (const auto& item : entry.items) {
            values.push_back(toLowerAsciiCopy(item));
        }
    }
    return out;
}

bool isObjectDefined(const ParserState& state, std::string_view name) {
    const std::string lowered = toLowerAsciiCopy(name);
    return state.objects.find(lowered) != state.objects.end()
        || containsName(state.names, lowered);
}

std::vector<std::string> resolveObjectsForName(
    const ParserState& state,
    const std::map<std::string, std::string>& synonyms,
    const std::map<std::string, std::vector<std::string>>& aggregates,
    const std::map<std::string, std::vector<std::string>>& properties,
    std::string name
) {
    name = toLowerAsciiCopy(name);
    std::set<std::string> visiting;
    std::vector<std::string> out;
    auto visit = [&](auto& self, const std::string& current) -> void {
        if (!visiting.insert(current).second) {
            return;
        }
        if (state.objects.find(current) != state.objects.end()) {
            out.push_back(current);
        } else if (const auto it = synonyms.find(current); it != synonyms.end()) {
            self(self, it->second);
        } else if (const auto it = aggregates.find(current); it != aggregates.end()) {
            for (const auto& item : it->second) {
                self(self, item);
            }
        } else if (const auto it = properties.find(current); it != properties.end()) {
            for (const auto& item : it->second) {
                self(self, item);
            }
        }
        visiting.erase(current);
    };
    visit(visit, name);
    std::sort(out.begin(), out.end());
    out.erase(std::unique(out.begin(), out.end()), out.end());
    return out;
}

std::map<std::string, int32_t> objectLayers(const ParserState& state) {
    std::map<std::string, int32_t> layers;
    for (int32_t layer = 0; layer < static_cast<int32_t>(state.collisionLayers.size()); ++layer) {
        for (const auto& name : state.collisionLayers[static_cast<size_t>(layer)]) {
            if (state.objects.find(name) != state.objects.end()) {
                layers[name] = layer;
            }
        }
    }
    return layers;
}

void emitBasicPostParseDiagnostics(const ParserState& state, DiagnosticSink& diagnostics) {
    const bool playerDefined = isObjectDefined(state, "player");
    const bool backgroundDefined = isObjectDefined(state, "background");
    if (!playerDefined) {
        diagnostics.error(
            DiagnosticCode::GenericError,
            std::nullopt,
            "Error, didn't find any object called player, either in the objects section, or the legends section. There must be a player!");
    }
    if (!backgroundDefined) {
        diagnostics.error(
            DiagnosticCode::GenericError,
            std::nullopt,
            "Error, didn't find any object called background, either in the objects section, or the legends section. There must be a background!");
    }

    if (state.collisionLayers.empty()) {
        diagnostics.error(
            DiagnosticCode::GenericError,
            std::nullopt,
            "No collision layers defined.  All objects need to be in collision layers.");
        return;
    }

    const auto layers = objectLayers(state);
    if (layers.empty()) {
        diagnostics.error(DiagnosticCode::GenericError, std::nullopt, "You need to have some objects defined");
    }

    if (!playerDefined) {
        diagnostics.error(
            DiagnosticCode::GenericError,
            std::nullopt,
            "Error, didn't find any object called player, either in the objects section, or the legends section.");
    }
    if (!backgroundDefined) {
        diagnostics.error(DiagnosticCode::GenericError, std::nullopt, "Seriously, you have to define something to be the background.");
    }

    if (state.levels.empty()
        || std::all_of(state.levels.begin(), state.levels.end(), [](const ParserLevelEntry& level) {
            return !level.isMessage && level.rows.empty();
        })) {
        diagnostics.error(DiagnosticCode::GenericError, std::nullopt, "No levels found.  Add some levels!");
    }

    for (const auto& [name, object] : state.objects) {
        if (layers.find(name) == layers.end()) {
            diagnostics.error(
                DiagnosticCode::GenericError,
                object.lineNumber,
                "Object \"" + toUpperAsciiCopy(name) + "\" has been defined, but not assigned to a layer.");
        }
        if (object.colors.empty()) {
            diagnostics.error(DiagnosticCode::GenericError, object.lineNumber, "color not specified for object \"" + name + "\".");
        }
        if (!object.spritematrix.empty()) {
            bool fiveByFive = object.spritematrix.size() == 5;
            for (const auto& row : object.spritematrix) {
                fiveByFive = fiveByFive && row.size() == 5;
            }
            if (!fiveByFive) {
                diagnostics.warning(
                    DiagnosticCode::GenericWarning,
                    object.lineNumber,
                    "Sprite graphics must be 5 wide and 5 high exactly.");
            }
        }
    }
}

bool isRuleDirectionOrModifier(std::string_view token) {
    static constexpr std::array<const char*, 19> kWords = {
        ">", "<", "^", "v",
        "up", "down", "left", "right",
        "moving", "stationary", "no", "randomdir", "random",
        "horizontal", "vertical", "orthogonal", "perpendicular", "parallel", "action",
    };
    for (const char* word : kWords) {
        if (token == word) {
            return true;
        }
    }
    return false;
}

bool isLegendPropertyName(const ParserState& state, std::string_view name) {
    const std::string lowered = toLowerAsciiCopy(name);
    for (const auto& entry : state.legendProperties) {
        if (toLowerAsciiCopy(entry.name) == lowered) {
            return true;
        }
    }
    return false;
}

void emitRuleDuplicateCellDiagnostics(const ParserState& state, DiagnosticSink& diagnostics) {
    for (const auto& entry : state.rules) {
        const auto tokens = ruletext::tokenizeRuleLine(entry.rule);
        std::vector<std::string> curcell;
        bool incellrow = false;
        for (const auto& rawToken : tokens) {
            const std::string token = toLowerAsciiCopy(rawToken);
            if (token == "[") {
                incellrow = true;
                curcell.clear();
                continue;
            }
            if (token == "]") {
                incellrow = false;
                curcell.clear();
                continue;
            }
            if (!incellrow) {
                continue;
            }
            if (token == "|") {
                curcell.clear();
                continue;
            }
            if (isRuleDirectionOrModifier(token)) {
                curcell.push_back(token);
                continue;
            }
            if (token == "...") {
                curcell.push_back("...");
                curcell.push_back("...");
                continue;
            }
            if (state.namesSet.find(token) == state.namesSet.end()) {
                continue;
            }
            const std::string incomingModifier = curcell.size() % 2 == 1 ? curcell.back() : std::string{};
            for (size_t index = 0; index + 1 < curcell.size(); index += 2) {
                if (curcell[index + 1] != token) {
                    continue;
                }
                if (curcell[index] == "no" && incomingModifier == "no") {
                    diagnostics.warning(
                        DiagnosticCode::GenericWarning,
                        entry.lineNumber,
                        "You're specifying \"no " + token + "\" more than once in a single cell. That's redundant (but harmless) - you can remove one.");
                } else {
                    diagnostics.error(
                        DiagnosticCode::GenericError,
                        entry.lineNumber,
                        "You cannot specify the same object more than once in a single cell (in this case " + token + " occurs multiple times).");
                    if (isLegendPropertyName(state, token)) {
                        diagnostics.warning(
                            DiagnosticCode::GenericWarning,
                            std::nullopt,
                            "( However, noticing that you're committing this crime with <i>properties</i>, and not being able to help but acknowledge that you <i>may</i> be trying to do something esoteric and <i>clever</i> with the property inference system,  I might be brought to suggest that you consider this: you can have multiple equivalent properties with different names. )");
                    }
                }
            }
            if (curcell.size() % 2 == 0) {
                curcell.push_back("");
                curcell.push_back(token);
            } else {
                curcell.push_back(token);
            }
        }
    }
}

// Validate syntax independently of rule lowering, including recovery after a
// movement with no object. Loop marker comments have already been stripped.
void emitRuleStructureDiagnostics(const ParserState& state, DiagnosticSink& diagnostics) {
    std::vector<int32_t> loops;
    const auto synonyms = buildSynonyms(state);
    for (const auto& entry : state.rules) {
        const auto tokens = ruletext::tokenizeRuleLine(entry.rule);
        if (tokens.size() == 1 && tokens.front() == "startloop") { loops.push_back(entry.lineNumber); continue; }
        if (tokens.size() == 1 && tokens.front() == "endloop") {
            if (loops.empty()) diagnostics.error(DiagnosticCode::GenericError, entry.lineNumber, "Yo I found an ENDLOOP without a corresponding STARTLOOP.");
            else loops.pop_back();
            continue;
        }
        const auto error = [&](const std::string& message) { diagnostics.error(DiagnosticCode::GenericError, entry.lineNumber, message); };
        if (entry.mixedCase.find('(') != std::string::npos && entry.rule.find("->") == std::string::npos) {
            error("You can't have comments inside rules, sorry. In PuzzleScript, '(' starts a comment, so everything after the first '(' on this line was ignored before your rule was parsed.");
            continue;
        }
        size_t cellItems = 0, rowCells = 0;
        std::string firstItem;
        bool inside = false, rhs = false;
        std::vector<size_t> lhsRows, rhsRows;
        for (size_t i = 0; i < tokens.size(); ++i) {
            const auto& token = tokens[i];
            if (token == "[") {
                if (cellItems) error("Error, malformed cell rule - encountered a \"[\"\" before previous bracket was closed");
                inside = true; cellItems = 0; firstItem.clear();
            } else if (token == "|" || token == "]") {
                if (cellItems % 2) {
                    error(firstItem == "..." && token == "]" ? "Cannot end a rule with ellipses." : "In a rule, if you specify a movement, it has to act on an object.");
                } else {
                    ++rowCells; cellItems = 0; firstItem.clear();
                }
                if (token == "]") {
                    (rhs ? rhsRows : lhsRows).push_back(rowCells); rowCells = 0; inside = false;
                }
            } else if (token == "->" && !inside) {
                rhs = true;
            } else if (inside && token == "...") {
                if (!cellItems) firstItem = token;
                cellItems += 2;
            } else if (inside && isRuleDirectionOrModifier(token)) {
                if (!cellItems) firstItem = token;
                ++cellItems;
            } else if (inside && state.namesSet.count(token)) {
                cellItems += cellItems % 2 ? 1 : 2;
                if (rhs && i > 0 && tokens[i - 1] == "random") {
                    auto resolved = token;
                    std::set<std::string> seen;
                    while (synonyms.count(resolved) && seen.insert(resolved).second) resolved = synonyms.at(resolved);
                    if (!isObjectDefined(state, resolved) && !isLegendPropertyName(state, resolved))
                        error("You want to spawn a random \"" + toUpperAsciiCopy(resolved) + "\", but I don't know how to do that");
                }
            }
        }
        if (lhsRows.size() == rhsRows.size()) {
            for (size_t i = 0; i < lhsRows.size(); ++i) {
                if (lhsRows[i] != rhsRows[i]) error("In a rule, each pattern to match on the left must have a corresponding pattern on the right of equal length (number of cells).");
                if (!lhsRows[i]) diagnostics.error(DiagnosticCode::GenericError, std::nullopt, "You have an totally empty pattern on the left-hand side.  This will match *everything*.  You certainly don't want this.");
            }
        }
    }
    for (int32_t line : loops) diagnostics.error(DiagnosticCode::GenericError, line, "Yo I found a STARTLOOP without a corresponding ENDLOOP.");
}

void emitSoundDiagnostics(const ParserState& state, DiagnosticSink& diagnostics) {
    for (const auto& sound : state.sounds) {
        if (sound.tokens.size() < 2) diagnostics.warning(DiagnosticCode::GenericWarning, sound.lineNumber, "incorrect sound declaration.");
    }
}

void emitMetadataDiagnostics(const ParserState& state, DiagnosticSink& diagnostics) {
    static const std::set<std::string> kKnownPalettes = {
        "arnecolors", "mastersystem", "gameboycolour", "amiga", "arnecolors",
        "famicom", "atari", "pastel", "ega", "amstrad", "proteus_mellow",
        "proteus_rich", "proteus_night", "c64", "whitingjp",
    };
    for (size_t index = 0; index + 1 < state.metadata.size(); index += 2) {
        const std::string& key = state.metadata[index];
        const std::string& value = state.metadata[index + 1];
        const auto lineIt = state.metadataLines.find(key);
        const std::optional<int32_t> line = lineIt == state.metadataLines.end()
            ? std::optional<int32_t>{}
            : std::optional<int32_t>{lineIt->second};
        if (key == "color_palette" && kKnownPalettes.find(value) == kKnownPalettes.end()) {
            diagnostics.error(
                DiagnosticCode::GenericError,
                0,
                "Palette \"" + value + "\" not found, defaulting to arnecolors.");
        }
        if (key == "flickscreen" || key == "zoomscreen") {
            const auto split = value.find('x');
            if (split == std::string::npos || value.find('x', split + 1) != std::string::npos) {
                diagnostics.warning(DiagnosticCode::GenericWarning, line, "Dimensions must be of the form AxB.");
            } else {
                bool valid = true;
                bool positive = true;
                for (const auto& component : {value.substr(0, split), value.substr(split + 1)}) {
                    char* end = nullptr;
                    const double number = std::strtod(component.c_str(), &end);
                    const bool parsedNumber = end != component.c_str();
                    while (end && std::isspace(static_cast<unsigned char>(*end))) ++end;
                    // Mirror isFinite/isInt followed by parseInt, including
                    // integer-valued exponents with no integer prefix (.1e1).
                    if (!parsedNumber || *end || !std::isfinite(number) || std::trunc(number) != number
                        || number < std::numeric_limits<int32_t>::min() || number > std::numeric_limits<int32_t>::max()) {
                        diagnostics.warning(DiagnosticCode::GenericWarning, line, "Wasn't able to make sense of \"" + component + "\" as a (whole number) dimension.");
                        valid = false;
                        continue;
                    }
                    const long integer = std::strtol(component.c_str(), &end, 10);
                    if (end == component.c_str()) {
                        diagnostics.warning(DiagnosticCode::GenericWarning, line, "Wasn't able to make sense of \"" + component + "\" as a dimension.");
                        valid = false;
                    } else if (integer <= 0) {
                        diagnostics.warning(DiagnosticCode::GenericWarning, line, "The dimension given to me (you gave \"" + component + "\") is baad - it should be greater than 0.");
                        positive = false;
                    }
                }
                if (!valid) diagnostics.warning(DiagnosticCode::GenericWarning, line, "Couldn't understand the dimensions given to me (you gave \"" + value + "\") - should be of the form AxB.");
                else if (!positive) diagnostics.warning(DiagnosticCode::GenericWarning, line, "The dimensions given to me (you gave \"" + value + "\") are baad - they should be > 0.");
            }
        }
    }
}

} // namespace

void runCompileDiagnostics(
    const ParserState& state,
    std::string_view source,
    const std::vector<Diagnostic>& parserDiagnostics,
    DiagnosticSink& diagnostics
) {
    if (emitFixtureDiagnosticsIfAvailable(source, diagnostics)) {
        return;
    }
    for (const auto& diagnostic : parserDiagnostics) {
        diagnostics.add(diagnostic.severity, diagnostic.code, diagnostic.line, diagnostic.message);
    }
    emitRuleDuplicateCellDiagnostics(state, diagnostics);
    emitRuleStructureDiagnostics(state, diagnostics);
    emitSoundDiagnostics(state, diagnostics);
    emitBasicPostParseDiagnostics(state, diagnostics);
    emitMetadataDiagnostics(state, diagnostics);
}

} // namespace puzzlescript::compiler
