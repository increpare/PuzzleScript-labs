#undef NDEBUG
#include <algorithm>
#include <cassert>
#include <iostream>
#include <string>
#include <vector>

#include "compiler/compile_diagnostics.hpp"
#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"

namespace {
const std::string kObjects = R"(OBJECTS

Background .
green

Player P
white

Marker M
red

LEGEND
SOUNDS
COLLISIONLAYERS
Background
Player
Marker
RULES
)";
const std::string kEnding = "WINCONDITIONS\nLEVELS\nP\n";

std::vector<puzzlescript::compiler::Diagnostic> diagnosticsFor(const std::string& source) {
    puzzlescript::compiler::DiagnosticSink parsed, full;
    const auto state = puzzlescript::compiler::parseSource(source, parsed);
    puzzlescript::compiler::runCompileDiagnostics(state, source, parsed.diagnostics(), full);
    return full.diagnostics();
}

puzzlescript::LoadedGame lower(const std::string& source) {
    puzzlescript::compiler::DiagnosticSink diagnostics;
    const auto state = puzzlescript::compiler::parseSource(source, diagnostics);
    puzzlescript::LoadedGame loaded;
    const auto error = puzzlescript::compiler::lowerToRuntimeGame(state, loaded);
    assert(error == nullptr);
    assert(loaded.information != nullptr);
    return loaded;
}

bool hasMessage(const std::vector<puzzlescript::compiler::Diagnostic>& diagnostics, const std::string& text) {
    return std::any_of(diagnostics.begin(), diagnostics.end(), [&](const auto& diagnostic) {
        return diagnostic.message == text;
    });
}
}

int main() {
    // Invalid metadata must disappear before any player/exporter interprets it.
    for (const auto* key : {"flickscreen", "zoomscreen"}) {
        for (const auto* dimensions : {"0x5", "5x0", "-2x5", "5x-2", "5", "2.5x5"}) {
            const auto loaded = lower(std::string(key) + " " + dimensions + "\n" + kObjects + kEnding);
            assert(!loaded.information->metadata.values.contains(key));
        }
        const auto loaded = lower(std::string(key) + " 5x3\n" + kObjects + kEnding);
        assert(loaded.information->metadata.values.at(key) == "5x3");
        for (const auto* dimensions : {"1.0x3", "1e1x3", "5\u00a0x3", "5x\u20033"}) {
            const auto integral = lower(std::string(key) + " " + dimensions + "\n" + kObjects + kEnding);
            assert(integral.information->metadata.values.contains(key));
            assert(integral.information->metadata.values.at(key) == dimensions);
        }
        const auto overridden = lower(std::string(key) + " 5x3\n" + key + " 0x5\n" + kObjects + kEnding);
        assert(!overridden.information->metadata.values.contains(key));
    }
    assert(diagnosticsFor("nohack\n" + kObjects + kEnding).empty());

    // A comment between an object's declaration and colors does not finish it.
    auto multicolor = kObjects;
    multicolor.replace(multicolor.find("green\n"), 6, "(colors follow)\nlightgreen green\n");
    const auto spriteDiagnostics = diagnosticsFor(multicolor + kEnding);
    assert(spriteDiagnostics.size() == 1);
    assert(hasMessage(spriteDiagnostics, "Object \"BACKGROUND\" lists several colours but doesn't have a sprite matrix; it will just be a solid square of the first colour."));

    // Reject the whole invalid rule, retaining the immediately following one.
    for (const auto* modifier : {"random", "randomdir"}) {
        const auto source = kObjects + "[ " + modifier + " Player ] -> [ Marker ]\n[ Player ] -> [ Player Marker ]\n" + kEnding;
        const auto messages = diagnosticsFor(source);
        const auto expected = std::string(modifier == std::string("random") ? "RANDOM" : "RANDOMDIR")
            + " cannot be matched on the left-hand side; it can only appear on the right";
        assert(hasMessage(messages, expected));
        const auto loaded = lower(source);
        size_t rules = 0;
        for (const auto& group : loaded.information->rules) for (const auto& rule : group) {
            ++rules;
            assert(rule.lineNumber == std::count(kObjects.begin(), kObjects.end(), '\n') + 2);
        }
        assert(rules == 1);
    }
    for (const auto* rule : {"late [ randomdir Player ] -> [ Player ]\n", "late [ Player ] -> [ randomdir Player ]\n"}) {
        assert(hasMessage(diagnosticsFor(kObjects + rule + kEnding), "Movements cannot appear in late rules."));
    }
    for (const auto* rule : {"late [ randomdir Player ] -> [ Player Marker ]\n", "late [ Player ] -> [ randomdir Player Marker ]\n"}) {
        const auto recovered = lower(kObjects + rule + kEnding);
        size_t ruleCount = 0;
        for (const auto& group : recovered.information->lateRules) for (const auto& rule : group) {
            ++ruleCount;
            for (const auto& row : rule.patterns) for (const auto& pattern : row) {
                if (pattern.replacement) assert(!pattern.replacement->hasRandomDirMask);
            }
        }
        assert(ruleCount == 1);
    }
    const auto grouped = lower(kObjects + "[ Player ] -> [ Player ] sfx0\n"
        "[ random Player ] -> [ Marker ]\n+ [ Player ] -> [ Player Marker ]\n" + kEnding);
    assert(grouped.information->rules.size() == 2);
    {
        auto source = kObjects;
        source.replace(source.find("Player P"), 8, "Player HeroAlias");
        source.replace(source.find("LEGEND\n"), 7, "LEGEND\nMixedLegend = Player\n");
        puzzlescript::compiler::DiagnosticSink diagnostics;
        const auto state = puzzlescript::compiler::parseSource(source + kEnding, diagnostics);
        assert(state.originalCaseNames.at("heroalias") == "HeroAlias");
        assert(state.originalCaseNames.at("mixedlegend") == "MixedLegend");
    }
    // Keep primary-name and multi-character alias warnings, including v.
    for (const auto* declaration : {"v", "Other up"}) {
        auto names = kObjects;
        names.replace(names.find("Marker M"), 8, declaration);
        const auto messages = diagnosticsFor(names + kEnding);
        const auto name = declaration == std::string("v") ? "V" : "UP";
        assert(hasMessage(messages, std::string("You named an object \"") + name + "\", but this is a keyword. Don't do that!"));
    }
    std::cout << "compiler_upstream_regressions: ok\n";
}
