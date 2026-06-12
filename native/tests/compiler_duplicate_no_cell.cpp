#include <cassert>
#include <string>

#include "compiler/compile_diagnostics.hpp"
#include "compiler/diagnostic.hpp"
#include "compiler/parser.hpp"

namespace {

std::string gameWithRule(const std::string& ruleLine) {
    return "title test\nauthor test\n\n========\nOBJECTS\n========\n\nBackground\nblack\n\nPlayer\ngreen\n\nWall\nbrown\n\nStrap\norange\n\n=======\nLEGEND\n=======\n\n. = Background\nP = Player\n# = Wall\nS = Strap\n\n=======\nSOUNDS\n=======\n\n================\nCOLLISIONLAYERS\n================\n\nBackground\nPlayer, Wall, Strap\n\n======\nRULES\n======\n\n"
        + ruleLine + "\n\n==============\nWINCONDITIONS\n==============\n\n=======\nLEVELS\n=======\n\n.\n";
}

size_t countSeverity(const puzzlescript::compiler::DiagnosticSink& sink, puzzlescript::compiler::Severity severity) {
    size_t count = 0;
    for (const auto& diagnostic : sink.diagnostics()) {
        if (diagnostic.severity == severity) {
            ++count;
        }
    }
    return count;
}

bool hasMessageContaining(const puzzlescript::compiler::DiagnosticSink& sink, const std::string& needle) {
    for (const auto& diagnostic : sink.diagnostics()) {
        if (diagnostic.message.find(needle) != std::string::npos) {
            return true;
        }
    }
    return false;
}

void runDiagnosticsForRule(const std::string& ruleLine, puzzlescript::compiler::DiagnosticSink& out) {
    const std::string source = gameWithRule(ruleLine);
    puzzlescript::compiler::DiagnosticSink parserSink;
    const auto state = puzzlescript::compiler::parseSource(source, parserSink);
    puzzlescript::compiler::runCompileDiagnostics(state, source, parserSink.diagnostics(), out);
}

} // namespace

int main() {
    {
        puzzlescript::compiler::DiagnosticSink diagnostics;
        runDiagnosticsForRule("[ no strap no strap ] -> [ ]", diagnostics);
        assert(countSeverity(diagnostics, puzzlescript::compiler::Severity::Error) == 0);
        assert(hasMessageContaining(
            diagnostics,
            "You're specifying \"no strap\" more than once in a single cell. That's redundant (but harmless) - you can remove one."));
    }
    {
        puzzlescript::compiler::DiagnosticSink diagnostics;
        runDiagnosticsForRule("[ strap strap ] -> [ ]", diagnostics);
        assert(countSeverity(diagnostics, puzzlescript::compiler::Severity::Error) >= 1);
        assert(hasMessageContaining(
            diagnostics,
            "You cannot specify the same object more than once in a single cell (in this case strap occurs multiple times)."));
    }
    {
        puzzlescript::compiler::DiagnosticSink diagnostics;
        runDiagnosticsForRule("[ player no player | ] -> [ | ]", diagnostics);
        assert(countSeverity(diagnostics, puzzlescript::compiler::Severity::Error) >= 1);
        assert(hasMessageContaining(
            diagnostics,
            "You cannot specify the same object more than once in a single cell (in this case player occurs multiple times)."));
    }
    return 0;
}
