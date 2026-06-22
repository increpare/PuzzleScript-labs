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

#include <algorithm>
#include <exception>
#include <memory>
#include <set>
#include <string>
#include <string_view>
#include <vector>

using puzzlescript::CompileResult;
using puzzlescript::Error;
using puzzlescript::Game;
using puzzlescript::LoadedGame;

namespace {

bool maskHasAnyBit(const std::vector<puzzlescript::MaskWord>& mask) {
    return std::any_of(mask.begin(), mask.end(), [](puzzlescript::MaskWord word) {
        return word != 0;
    });
}

void setMaskBit(std::vector<puzzlescript::MaskWord>& mask, int32_t objectId) {
    if (objectId < 0) {
        return;
    }
    const uint32_t word = puzzlescript::maskWordIndex(static_cast<uint32_t>(objectId));
    if (word >= mask.size()) {
        return;
    }
    mask[static_cast<size_t>(word)] |= puzzlescript::maskBit(static_cast<uint32_t>(objectId));
}

void orMaskInto(std::vector<puzzlescript::MaskWord>& target, const std::vector<puzzlescript::MaskWord>& source) {
    const size_t count = std::min(target.size(), source.size());
    for (size_t index = 0; index < count; ++index) {
        target[index] |= source[index];
    }
}

puzzlescript::MaskOffset storeMaskWords(Game& game, const std::vector<puzzlescript::MaskWord>& words) {
    const auto offset = static_cast<puzzlescript::MaskOffset>(game.maskArena.size());
    game.maskArena.insert(game.maskArena.end(), words.begin(), words.end());
    return offset;
}

std::vector<puzzlescript::MaskWord> resolveParserGlyphMask(
    const Game& game,
    const puzzlescript::compiler::ParserState& parserState,
    const std::string& name,
    std::set<std::string>& visiting
) {
    std::vector<puzzlescript::MaskWord> mask(static_cast<size_t>(game.wordCount), 0);
    if (!visiting.insert(name).second) {
        return mask;
    }

    if (parserState.objects.find(name) != parserState.objects.end()) {
        for (const auto& object : game.objectsById) {
            if (object.name == name) {
                setMaskBit(mask, object.id);
                break;
            }
        }
        visiting.erase(name);
        return mask;
    }

    for (const auto& entry : parserState.legendSynonyms) {
        if (entry.name == name && !entry.items.empty()) {
            mask = resolveParserGlyphMask(game, parserState, entry.items.front(), visiting);
            visiting.erase(name);
            return mask;
        }
    }

    for (const auto& entry : parserState.legendAggregates) {
        if (entry.name != name) {
            continue;
        }
        for (const auto& item : entry.items) {
            orMaskInto(mask, resolveParserGlyphMask(game, parserState, item, visiting));
        }
        visiting.erase(name);
        return mask;
    }

    visiting.erase(name);
    return mask;
}

void publishParserGlyphs(Game& game, const puzzlescript::compiler::ParserState& parserState) {
    game.glyphOrder.clear();
    game.glyphMaskTable.clear();
    game.glyphOrder.reserve(parserState.abbrevNames.size());
    game.glyphMaskTable.reserve(parserState.abbrevNames.size());

    for (const std::string& name : parserState.abbrevNames) {
        std::set<std::string> visiting;
        std::vector<puzzlescript::MaskWord> mask = resolveParserGlyphMask(game, parserState, name, visiting);
        if (!maskHasAnyBit(mask)) {
            continue;
        }
        game.glyphOrder.push_back(name);
        game.glyphMaskTable.push_back({name, storeMaskWords(game, mask)});
    }
}

} // namespace

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
            publishParserGlyphs(*std::const_pointer_cast<Game>(loadedGame.information), state);
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

const ps_game* ps_compile_result_game(const ps_compile_result* result) {
    if (!result || !result->impl || !result->impl->loadedGame.information) {
        return nullptr;
    }
    auto* wrapper = new ps_game();
    wrapper->impl = result->impl->loadedGame;
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
