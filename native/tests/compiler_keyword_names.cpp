#undef NDEBUG  // keep assert() live under the Release -DNDEBUG build
#include <cassert>
#include <fstream>
#include <sstream>
#include <string>

#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"

namespace {

std::string readFixture(const char* relPath) {
    std::ifstream in(relPath);
    std::stringstream buffer;
    buffer << in.rdbuf();
    return buffer.str();
}

} // namespace

int main() {
    const std::string source = readFixture("src/tests/solver_tests/a distant sunset.txt");
    assert(!source.empty());
    assert(source.find("sprt_1_1 ^") != std::string::npos);

    puzzlescript::compiler::DiagnosticSink diagnostics;
    const auto state = puzzlescript::compiler::parseSource(source, diagnostics);

    bool warnedAboutGlyph = false;
    for (const auto& diagnostic : diagnostics.diagnostics()) {
        assert(diagnostic.severity != puzzlescript::compiler::Severity::Error);
        if (diagnostic.message == "You named an object \"^\", but this is a keyword. Don't do that!") {
            assert(diagnostic.severity == puzzlescript::compiler::Severity::Warning);
            warnedAboutGlyph = true;
        }
    }
    // JS warns about keyword aliases too; the glyph remains usable.
    assert(warnedAboutGlyph);

    puzzlescript::LoadedGame game;
    const auto error = puzzlescript::compiler::lowerToRuntimeGame(state, game);
    assert(error == nullptr);
    assert(game.information != nullptr);
    assert(!game.information->rules.empty());

    return 0;
}
