#undef NDEBUG  // keep assert() live under the Release -DNDEBUG build
#include <cassert>
#include <cstring>

#include "puzzlescript/puzzlescript.h"

// This executable links ONLY puzzlescript_native (no puzzlescript_compiler). It
// exists to guarantee a consumer can load/step runtime state (precompiled IR or
// a snapshot) without parser/compiler symbols. The matching CTest also audits
// the runtime archive with nm, because LTO can otherwise discard unused leaked
// compiler-coupled functions before link-time undefined symbols are reported.
int main() {
    ps_game* game = nullptr;
    ps_error* error = nullptr;
    const char* notJson = "{ this is not valid IR json";
    const bool loaded = ps_load_ir_json(notJson, std::strlen(notJson), &game, &error);
    assert(!loaded);          // invalid IR must fail to load
    assert(game == nullptr);  // no game produced on failure
    if (error != nullptr) {
        ps_free_error(error);
    }
    return 0;
}
