#undef NDEBUG  // keep assert() live under the Release -DNDEBUG build

#include <cassert>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "puzzlescript/compiler.h"
#include "puzzlescript/puzzlescript.h"
#include "runtime/c_api_internal.hpp"
#include "runtime/core.hpp"

namespace {

constexpr const char* kSource =
    "title Mask Interning Test\n"
    "\n"
    "========\n"
    "OBJECTS\n"
    "========\n"
    "\n"
    "Background\n"
    "black\n"
    "\n"
    "Wall\n"
    "gray\n"
    "\n"
    "=======\n"
    "LEGEND\n"
    "=======\n"
    "\n"
    ". = Background\n"
    "# = Wall\n"
    "\n"
    "================\n"
    "COLLISIONLAYERS\n"
    "================\n"
    "\n"
    "Background\n"
    "Wall\n"
    "\n"
    "=======\n"
    "LEVELS\n"
    "=======\n"
    "\n"
    ".#\n";

puzzlescript::MaskOffset namedOffset(
    const std::vector<puzzlescript::Game::NamedMaskEntry>& table,
    const std::string& name
) {
    for (const auto& entry : table) {
        if (entry.name == name) {
            return entry.offset;
        }
    }
    return puzzlescript::kNullMaskOffset;
}

} // namespace

int main() {
    puzzlescript::Game emptyGame;
    const puzzlescript::MaskVector empty;
    const puzzlescript::MaskOffset emptyOffset = puzzlescript::storeMaskWords(emptyGame, empty);

    ps_compile_result* result = nullptr;
    const bool ok = ps_compile_source(kSource, std::strlen(kSource), &result);
    assert(ok);
    assert(result != nullptr);
    std::unique_ptr<ps_compile_result, decltype(&ps_free_compile_result)> resultGuard(
        result,
        ps_free_compile_result
    );

    const ps_game* rawGame = ps_compile_result_game(resultGuard.get());
    assert(rawGame != nullptr);
    std::unique_ptr<ps_game, decltype(&ps_free_game)> gameGuard(
        const_cast<ps_game*>(rawGame),
        ps_free_game
    );
    assert(gameGuard->impl.information != nullptr);
    const puzzlescript::Game& game = *gameGuard->impl.information;

    assert(namedOffset(game.glyphMaskTable, ".") == namedOffset(game.objectMaskTable, "background"));
    assert(namedOffset(game.glyphMaskTable, "#") == namedOffset(game.objectMaskTable, "wall"));
    assert(emptyOffset != puzzlescript::kNullMaskOffset);

    return 0;
}
