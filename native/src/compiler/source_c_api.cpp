// Source-to-runtime-game compile C API.
//
// This lives in the COMPILER library (not the runtime library) so the runtime
// library puzzlescript_native stays standalone: a consumer that only loads and
// steps runtime state must not pull in parser/compiler symbols. The guard is
// native/tests/runtime_standalone_link.cpp.

#include "runtime/core.hpp"
#include "runtime/compiled_rules.hpp"
#include "runtime/c_api_internal.hpp"

#include "compiler/lower_to_runtime.hpp"
#include "compiler/parser.hpp"

#include "puzzlescript/compiler.h"
#include "puzzlescript/puzzlescript.h"

#include <exception>
#include <memory>
#include <string>
#include <string_view>

using puzzlescript::CompileResult;
using puzzlescript::Error;
using puzzlescript::Game;
using puzzlescript::LoadedGame;

bool ps_compile_source(const char* source_utf8, size_t source_size, ps_compile_result** out_result) {
    if (!out_result) {
        return false;
    }
    auto* wrapper = new ps_compile_result();
    wrapper->impl = std::make_unique<CompileResult>();
    try {
        puzzlescript::compiler::DiagnosticSink diagnostics;
        const auto state = puzzlescript::compiler::parseSource(
            source_utf8 == nullptr ? std::string_view{} : std::string_view(source_utf8, source_size),
            diagnostics
        );
        // For now, treat any lowering failure as a compile error. (Once lowering
        // is implemented, we can choose to gate on diagnostic severity.)
        LoadedGame loadedGame;
        if (auto error = puzzlescript::compiler::lowerToRuntimeGame(state, loadedGame)) {
            wrapper->impl->error = std::move(error);
            *out_result = wrapper;
            return false;
        }
        if (loadedGame.information) {
            puzzlescript::attachLinkedCompiledRules(
                *std::const_pointer_cast<Game>(loadedGame.information),
                source_utf8 == nullptr ? std::string_view{} : std::string_view(source_utf8, source_size)
            );
        }
        wrapper->impl->loadedGame = std::move(loadedGame);
        *out_result = wrapper;
        return true;
    } catch (const std::exception& e) {
        wrapper->impl->error = std::make_unique<Error>(e.what());
        *out_result = wrapper;
        return false;
    }
}

const ps_game* ps_compile_result_game(ps_compile_result* result) {
    if (!result || !result->impl || !result->impl->loadedGame.information) {
        return nullptr;
    }
    auto* wrapper = new ps_game();
    wrapper->impl = std::move(result->impl->loadedGame);
    return wrapper;
}

const ps_error* ps_compile_result_error(const ps_compile_result* result) {
    if (!result || !result->impl || !result->impl->error) {
        return nullptr;
    }
    auto* wrapper = new ps_error();
    wrapper->impl = std::make_unique<Error>(result->impl->error->message);
    return wrapper;
}

void ps_free_compile_result(ps_compile_result* result) {
    delete result;
}
