#include "compiler/compile_diagnostics.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <limits>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <vector>
#include <utf8proc.h>

#include "compiler/rule_text.hpp"
#include "compiler/diagnostic_rules.hpp"

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

std::map<std::string, std::string> buildSynonyms(const ParserState& state) {
    std::map<std::string, std::string> synonyms;
    for (const auto& entry : state.legendSynonyms) {
        if (!entry.items.empty()) {
            synonyms.emplace(toLowerAsciiCopy(entry.name), toLowerAsciiCopy(entry.items.front()));
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
        || containsName(state.names, lowered)
        || std::any_of(state.legendSynonyms.begin(), state.legendSynonyms.end(), [&](const auto& entry) { return entry.name == lowered; })
        || std::any_of(state.legendProperties.begin(), state.legendProperties.end(), [&](const auto& entry) { return entry.name == lowered; })
        || std::any_of(state.legendAggregates.begin(), state.legendAggregates.end(), [&](const auto& entry) { return entry.name == lowered; });
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

bool emitRequiredDefinitions(const ParserState& state, DiagnosticSink& diagnostics) {
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
        return false;
    }
    return true;
}

void emitExtraMemberDiagnostics(const ParserState& state, DiagnosticSink& diagnostics) {
    const auto layers = objectLayers(state);
    for (const auto& name : state.objectDefinitionOrder) {
        const auto& object = state.objects.at(name);
        if (object.colors.size() > 10) diagnostics.error(DiagnosticCode::GenericError, object.lineNumber + 1,
            "a sprite cannot have more than 10 colors. Why you would want more than 10 is beyond me.");
        if (object.colors.empty()) diagnostics.error(DiagnosticCode::GenericError, object.lineNumber, "color not specified for object \"" + name + "\".");
        if (!object.spritematrix.empty()) {
            const bool valid = object.spritematrix.size() == 5 && std::all_of(object.spritematrix.begin(), object.spritematrix.end(), [](const auto& row) { return row.size() == 5; });
            if (!valid) diagnostics.warning(DiagnosticCode::GenericWarning, object.lineNumber, "Sprite graphics must be 5 wide and 5 high exactly.");
        }
    }
    const auto synonyms = buildSynonyms(state);
    const auto aggregates = buildLegendMap(state.legendAggregates);
    const auto properties = buildLegendMap(state.legendProperties);
    for (const auto& entry : state.legendAggregates) {
        std::map<int32_t, std::string> occupied;
        for (const auto& item : entry.items) for (const auto& name : resolveObjectsForName(state, synonyms, aggregates, properties, item)) {
            if (!layers.contains(name)) continue;
            const auto layer = layers.at(name);
            if (occupied.contains(layer)) diagnostics.error(DiagnosticCode::GenericError, entry.lineNumber,
                "Trying to create an aggregate object (something defined in the LEGEND section using AND) with both \"" + toUpperAsciiCopy(name) + "\" and \"" + toUpperAsciiCopy(occupied.at(layer)) + "\", which are on the same layer and therefore can't coexist.");
            else occupied[layer] = name;
        }
    }
    auto aggregateEntries = state.legendAggregates, propertyEntries = state.legendProperties;
    for (const auto& alias : state.legendSynonyms) {
        if (alias.items.empty()) continue;
        auto target = alias.items.front();
        std::set<std::string> seen;
        while (synonyms.contains(target) && seen.insert(target).second) target = synonyms.at(target);
        if (properties.contains(target)) propertyEntries.push_back({alias.name, properties.at(target), alias.lineNumber});
        if (aggregates.contains(target)) aggregateEntries.push_back({alias.name, aggregates.at(target), alias.lineNumber});
    }
    for (const auto& [kind, entries] : std::vector<std::pair<std::string, const std::vector<ParserLegendEntry>*>>{{"aggregate", &aggregateEntries}, {"property", &propertyEntries}}) {
        const auto& opposite = kind == "aggregate" ? properties : aggregates;
        for (const auto& entry : *entries) for (auto name : entry.items) {
            std::set<std::string> seen;
            while (synonyms.contains(name) && seen.insert(name).second) name = synonyms.at(name);
            if (opposite.contains(name)) diagnostics.error(DiagnosticCode::GenericError, std::nullopt,
                "Trying to define " + kind + " \"" + toUpperAsciiCopy(entry.name) + "\" in terms of " + (kind == "aggregate" ? "property" : "aggregate") + " \"" + toUpperAsciiCopy(name) + "\".");
        }
    }
    if (layers.empty()) {
        diagnostics.error(DiagnosticCode::GenericError, std::nullopt, "You need to have some objects defined");
    }
    if (!state.objects.contains("background")) {
        auto background = std::string("background");
        std::set<std::string> seen;
        while (synonyms.contains(background) && seen.insert(background).second) background = synonyms.at(background);
        const auto line = state.originalLineNumbers.contains("background") ? state.originalLineNumbers.at("background") : 0;
        if (aggregates.contains(background)) diagnostics.error(DiagnosticCode::GenericError, line,
            "background cannot be an aggregate (declared with 'and'), it has to be a simple type, or property (declared in terms of others using 'or').");
        else if (properties.contains(background)) {
            const auto members = resolveObjectsForName(state, synonyms, aggregates, properties, background);
            std::set<int32_t> memberLayers;
            for (const auto& member : members) if (layers.contains(member)) memberLayers.insert(layers.at(member));
            if (memberLayers.size() > 1) diagnostics.error(DiagnosticCode::GenericError, line, "Background objects must be on the same layer");
        } else if (!isObjectDefined(state, "background")) {
        diagnostics.error(DiagnosticCode::GenericError, std::nullopt, "Seriously, you have to define something to be the background.");
        }
    }
    if (!isObjectDefined(state, "player")) diagnostics.error(DiagnosticCode::GenericError, std::nullopt,
        "Error, didn't find any object called player, either in the objects section, or the legends section.");
}

void emitLayerDiagnostics(const ParserState& state, DiagnosticSink& diagnostics) {
    const auto layers = objectLayers(state);
    for (const auto& name : state.objectDefinitionOrder) {
        const auto& object = state.objects.at(name);
        if (layers.find(name) == layers.end()) {
            diagnostics.error(
                DiagnosticCode::GenericError,
                object.lineNumber,
                "Object \"" + toUpperAsciiCopy(name) + "\" has been defined, but not assigned to a layer.");
        }
    }
}

size_t wrappedRows(const std::string& text, size_t width = 34) {
    size_t rows = 0, start = 0;
    while (start < text.size()) {
        ++rows;
        size_t end = std::min(start + width, text.size());
        if (end == text.size()) break;
        size_t split = end;
        while (split > start && !std::isspace(static_cast<unsigned char>(text[split]))) --split;
        start = split > start ? split + 1 : end;
    }
    return rows;
}

void emitLevelDiagnostics(const ParserState& state, DiagnosticSink& diagnostics) {
    const auto synonyms = buildSynonyms(state);
    const auto aggregates = buildLegendMap(state.legendAggregates), properties = buildLegendMap(state.legendProperties);
    const auto layers = objectLayers(state);
    for (const auto& level : state.levels) {
        if (level.isMessage) {
            if (wrappedRows(level.message) > 12) diagnostics.warning(DiagnosticCode::GenericWarning, level.lineNumber, "Message too long to fit on screen.");
            continue;
        }
        bool stopped = false;
        std::vector<std::vector<std::string>> rows;
        for (const auto& row : level.rows) {
            rows.emplace_back();
            for (size_t offset = 0; offset < row.size();) {
                utf8proc_int32_t codepoint = 0;
                const auto width = utf8proc_iterate(reinterpret_cast<const utf8proc_uint8_t*>(row.data()+offset), static_cast<utf8proc_ssize_t>(row.size()-offset), &codepoint);
                const size_t bytes = width > 0 ? static_cast<size_t>(width) : 1;
                rows.back().push_back(row.substr(offset, bytes)); offset += bytes;
            }
        }
        const size_t width = rows.empty() ? 0 : rows.front().size();
        for (size_t x = 0; x < width && !stopped; ++x) for (size_t y = 0; y < level.rows.size() && !stopped; ++y) {
            if (rows[y].empty()) continue;
            const auto& glyph = rows[y][std::min(x, rows[y].size()-1)];
            auto name = glyph;
            std::set<std::string> seen;
            while (synonyms.contains(name) && seen.insert(name).second) name = synonyms.at(name);
            const auto members = resolveObjectsForName(state, synonyms, aggregates, properties, name);
            const bool isProperty = !state.objects.contains(name) && properties.contains(name);
            if (!isProperty && !members.empty() && std::all_of(members.begin(), members.end(), [&](const auto& member) { return layers.contains(member); })) continue;
            diagnostics.error(DiagnosticCode::GenericError, level.lineNumber.value_or(0) + static_cast<int32_t>(y), isProperty
                ? "Error, symbol \"" + glyph + "\" is defined using OR, and therefore ambiguous - it cannot be used in a map. Did you mean to define it in terms of AND?"
                : "Error, symbol \"" + glyph + "\", used in map, not found.");
            stopped = true;
        }
    }
}

void emitWinDiagnostics(const ParserState& state, DiagnosticSink& diagnostics) {
    const auto synonyms = buildSynonyms(state);
    const auto aggregates = buildLegendMap(state.legendAggregates), properties = buildLegendMap(state.legendProperties);
    const auto layers = objectLayers(state);
    for (const auto& condition : state.winconditions) {
        if (condition.tokens.empty()) break;
        if (condition.tokens.size() < 2) {
            diagnostics.error(DiagnosticCode::GenericError, condition.lineNumber, "Win conditions is badly formatted - needs to look something like \"No Fruit\", \"All Target On Crate\", \"Some Fruit\", \"Some Gold on Chest\", \"No Gold on Chest\", or the like."); continue;
        }
        for (size_t index : {size_t{1}, size_t{3}}) {
            if (index >= condition.tokens.size()) continue;
            const auto& name = condition.tokens[index];
            auto resolved = name;
            std::set<std::string> seen;
            while (synonyms.contains(resolved) && seen.insert(resolved).second) resolved = synonyms.at(resolved);
            if (!layers.contains(resolved) && !properties.contains(resolved) && !aggregates.contains(resolved))
                diagnostics.error(DiagnosticCode::GenericError, condition.lineNumber, "Unwelcome term \"" + name + "\" found in win condition. I don't know what I'm supposed to do with this.");
        }
    }
}

void emitTitleDiagnostic(const ParserState& state, DiagnosticSink& diagnostics) {
    if (state.levels.empty()) return;
    std::map<std::string, std::string> metadata;
    for (size_t i = 0; i + 1 < state.metadata.size(); i += 2) metadata[state.metadata[i]] = state.metadata[i + 1];
    const auto title = metadata.count("title") ? metadata.at("title") : std::string("Puzzle Script Game");
    // The native diagnostic has no renderer font table. ASCII titles use the
    // same 34-column pixel-font wrapping as the JS title screen.
    if (std::any_of(title.begin(), title.end(), [](unsigned char ch) { return ch >= 128; })) return;
    size_t rows = 0, start = 0;
    while (start < title.size()) {
        ++rows;
        size_t end = std::min(start + 34, title.size());
        if (end == title.size()) break;
        size_t split = end;
        while (split > start && !std::isspace(static_cast<unsigned char>(title[split]))) --split;
        start = split > start ? split + 1 : end;
    }
    const bool extraRow = metadata.count("noaction") || (metadata.count("noundo") && metadata.count("norestart"));
    const size_t capacity = 5 + (extraRow ? 1 : 0) - (metadata.count("author") ? 1 : 0);
    if (rows > capacity && metadata.count("title")) diagnostics.warning(DiagnosticCode::GenericWarning, state.metadataLines.at("title"), "Game title is too long to fit on screen; truncating to fit.");
    if (metadata.count("author") && wrappedRows("by " + metadata.at("author")) > 1
        && rows + wrappedRows("by " + metadata.at("author")) > 5 + (extraRow ? 1 : 0))
        diagnostics.warning(DiagnosticCode::GenericWarning, state.metadataLines.at("author"), "Author name is too long to fit on screen; truncating to fit.");
}

void emitSoundDiagnostics(const ParserState& state, DiagnosticSink& diagnostics) {
    std::set<std::string> declared;
    const auto aggregates = buildLegendMap(state.legendAggregates);
    const auto properties = buildLegendMap(state.legendProperties);
    const auto synonyms = buildSynonyms(state);
    const auto layers = objectLayers(state);
    for (const auto& sound : state.sounds) {
        if (sound.tokens.size() < 2) {
            diagnostics.warning(DiagnosticCode::GenericWarning, sound.lineNumber, "incorrect sound declaration.");
            continue;
        }
        if (sound.tokens.back().kind != "SOUND") diagnostics.error(DiagnosticCode::GenericError, sound.lineNumber,
            "Expecting sfx data, instead found \"" + sound.tokens.back().text + "\".");
        const auto& name = sound.tokens.front().text;
        if (sound.tokens.front().kind == "SOUNDEVENT") {
            if (!declared.insert(name).second) diagnostics.warning(DiagnosticCode::GenericWarning, sound.lineNumber, toUpperAsciiCopy(name) + " already declared.");
        } else {
            auto target = name;
            std::set<std::string> seen;
            while (synonyms.contains(target) && seen.insert(target).second) target = synonyms.at(target);
            if (aggregates.contains(target)) diagnostics.error(DiagnosticCode::GenericError, sound.lineNumber,
                "cannot assign sound events to aggregate objects (declared with \"and\"), only to regular objects, or properties, things defined in terms of \"or\" (\"" + name + "\").");
            else if (!properties.contains(target) && !layers.contains(target)) diagnostics.error(DiagnosticCode::GenericError, sound.lineNumber, "Object \"" + name + "\" not found.");
        }
    }
}

void emitMetadataDiagnostics(const ParserState& state, DiagnosticSink& diagnostics) {
    static const std::set<std::string> kKnownPalettes = {
        "arnecolors", "mastersystem", "gameboycolour", "amiga", "arnecolors",
        "famicom", "atari", "pastel", "ega", "amstrad", "proteus_mellow",
        "proteus_rich", "proteus_night", "c64", "whitingjp",
        "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14",
    };
    std::vector<size_t> indices;
    // twiddleMetaData processes flickscreen before zoomscreen regardless of
    // their order in the source preamble.
    for (const auto& pass : {std::string("flickscreen"), std::string("zoomscreen"), std::string{}})
        for (size_t i = 0; i + 1 < state.metadata.size(); i += 2)
            if (pass.empty() ? (state.metadata[i] != "flickscreen" && state.metadata[i] != "zoomscreen") : state.metadata[i] == pass) indices.push_back(i);
    for (size_t index : indices) {
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
        if (key == "text_color" || key == "background_color") {
            static const std::set<std::string> colors = {"black", "white", "gray", "grey", "darkgray", "darkgrey", "lightgray", "lightgrey", "red", "darkred", "lightred", "brown", "darkbrown", "lightbrown", "orange", "yellow", "green", "darkgreen", "lightgreen", "blue", "darkblue", "lightblue", "purple", "pink", "transparent"};
            const bool hex = (value.size() == 4 || value.size() == 7) && value.front() == '#'
                && std::all_of(value.begin()+1, value.end(), [](unsigned char c) { return std::isxdigit(c); });
            if (!colors.contains(value) && !hex) diagnostics.error(DiagnosticCode::GenericError, line,
                key + " in incorrect format - found " + value + ", but I expect a color name (like 'pink') or hex-formatted color (like '#1412FA'). Defaulting to " + (key == "text_color" ? "white." : "black."));
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
    std::string_view /*source*/,
    const std::vector<Diagnostic>& parserDiagnostics,
    DiagnosticSink& diagnostics
) {
    for (const auto& diagnostic : parserDiagnostics) {
        diagnostics.add(diagnostic.severity, diagnostic.code, diagnostic.line, diagnostic.message);
        // loadFile stops tokenization immediately after the sixth parser error.
        if (std::count_if(diagnostics.diagnostics().begin(), diagnostics.diagnostics().end(),
            [](const auto& item) { return item.severity == Severity::Error; }) > 5) return;
    }
    if (!emitRequiredDefinitions(state, diagnostics)) return;
    emitExtraMemberDiagnostics(state, diagnostics);
    emitLevelDiagnostics(state, diagnostics);
    if (!runRuleDiagnostics(state, diagnostics)) return;
    emitWinDiagnostics(state, diagnostics);
    emitLayerDiagnostics(state, diagnostics);
    emitMetadataDiagnostics(state, diagnostics);
    emitSoundDiagnostics(state, diagnostics);
    if (state.levels.empty() || std::all_of(state.levels.begin(), state.levels.end(), [](const auto& level) { return !level.isMessage && level.rows.empty(); }))
        diagnostics.error(DiagnosticCode::GenericError, std::nullopt, "No levels found. Add some levels!");
    emitTitleDiagnostic(state, diagnostics);
}

} // namespace puzzlescript::compiler
