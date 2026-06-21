#undef NDEBUG  // keep assert() live under the Release -DNDEBUG build
#include <cassert>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

#include "compiler/compact_turn_codegen.hpp"
#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"
#include "runtime/core.hpp"

namespace {

std::string loadSourceFile(const std::string& path) {
    std::ifstream input(path);
    if (!input) {
        throw std::runtime_error("failed to open source: " + path);
    }
    std::ostringstream buffer;
    buffer << input.rdbuf();
    const std::string source = buffer.str();
    if (source.empty()) {
        throw std::runtime_error("empty source: " + path);
    }
    return source;
}

puzzlescript::Game compileGameFromSource(const std::string& source) {
    puzzlescript::compiler::DiagnosticSink diagnostics;
    const auto state = puzzlescript::compiler::parseSource(source, diagnostics);
    puzzlescript::LoadedGame loaded;
    const auto error = puzzlescript::compiler::lowerToRuntimeGame(state, loaded);
    if (error != nullptr) {
        throw std::runtime_error(error->message);
    }
    if (loaded.information == nullptr) {
        throw std::runtime_error("missing compiled game");
    }
    return *loaded.information;
}

puzzlescript::Game compileGameFromPath(const std::string& path) {
    return compileGameFromSource(loadSourceFile(path));
}

void expectNativeKernel(
    const puzzlescript::compiler::CompactTurnSupport& support,
    const char* label
) {
    assert(support.nativeKernel() && "expected native kernel");
    assert(!support.usesInterpreterBridge() && "expected no interpreter bridge");
    assert(support.statusReason == "native_kernel" && label);
    (void)label;
}

void expectInterpreterBridge(
    const puzzlescript::compiler::CompactTurnSupport& support,
    const char* label
) {
    assert(support.usesInterpreterBridge() && label);
    assert(support.statusReason == "interpreter_bridge" && label);
    (void)label;
}

} // namespace

int main() {
    using puzzlescript::compiler::CompactCodegenOptions;
    using puzzlescript::compiler::compactNativeTurnSupportForGame;
    using puzzlescript::compiler::compactTurnSupportForGame;

    const CompactCodegenOptions compilerMode{};
    CompactCodegenOptions interpreterMode{};
    interpreterMode.interpreterMode = true;

    const puzzlescript::Game cakemonsters =
        compileGameFromPath("src/tests/solver_tests/cakemonsters.txt");
    expectNativeKernel(compactNativeTurnSupportForGame(cakemonsters), "cakemonsters native");
    expectNativeKernel(compactTurnSupportForGame(cakemonsters, compilerMode), "cakemonsters compiler");
    expectInterpreterBridge(compactTurnSupportForGame(cakemonsters, interpreterMode), "cakemonsters interpreter");

    const puzzlescript::Game pushPull =
        compileGameFromPath("src/tests/solver_smoke_tests/push_pull.txt");
    expectNativeKernel(compactTurnSupportForGame(pushPull, compilerMode), "push_pull compiler");

    const puzzlescript::Game witchLifter =
        compileGameFromPath("src/tests/solver_tests/witch lifter.txt");
    // Was a compiler bridge (aggregate_bindings); the compact-turn mini-VM
    // (codegen-pass2) now emits a native kernel for it.
    expectNativeKernel(compactNativeTurnSupportForGame(witchLifter), "witch lifter native");
    expectNativeKernel(compactTurnSupportForGame(witchLifter, compilerMode), "witch lifter compiler");

    const puzzlescript::Game gemSoketeer =
        compileGameFromPath("src/tests/solver_tests/gem soketeer.txt");
    // Was a compiler bridge (rule_loops); now a native kernel (codegen-pass2).
    expectNativeKernel(compactNativeTurnSupportForGame(gemSoketeer), "gem soketeer native");
    expectNativeKernel(compactTurnSupportForGame(gemSoketeer, compilerMode), "gem soketeer compiler");

    const puzzlescript::Game alternatey =
        compileGameFromPath("src/tests/solver_tests/alternatey.txt");
    // Was a compiler bridge (transparent_object_compact_unsupported); now native (codegen-pass2).
    expectNativeKernel(compactNativeTurnSupportForGame(alternatey), "alternatey native");
    expectNativeKernel(compactTurnSupportForGame(alternatey, compilerMode), "alternatey compiler");

    const puzzlescript::Game heroes =
        compileGameFromPath("src/tests/solver_tests/heroes_of_sokoban_3.txt");
    expectNativeKernel(compactNativeTurnSupportForGame(heroes), "heroes native");

    const puzzlescript::Game redRing =
        compileGameFromPath("src/tests/solver_tests/the red ring of immortality.txt");
    // Was a compiler bridge (cancel_command); now a native kernel (codegen-pass2).
    expectNativeKernel(compactNativeTurnSupportForGame(redRing), "red ring native");
    expectNativeKernel(compactTurnSupportForGame(redRing, compilerMode), "red ring compiler");

    const puzzlescript::Game hairtug =
        compileGameFromPath("src/tests/solver_tests/hairtug.txt");
    // Was a compiler bridge (cancel_command); now a native kernel (codegen-pass2).
    expectNativeKernel(compactNativeTurnSupportForGame(hairtug), "hairtug native");
    expectNativeKernel(compactTurnSupportForGame(hairtug, compilerMode), "hairtug compiler");

    std::cout << "compiler_compact_turn_support: ok\n";
    return 0;
}
