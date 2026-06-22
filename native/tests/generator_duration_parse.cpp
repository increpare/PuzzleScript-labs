#undef NDEBUG

#include "generator/duration_parse.hpp"

#include <cassert>
#include <stdexcept>

int main() {
    using puzzlescript::generator::parseDurationMs;
    assert(parseDurationMs("30s") == 30000);
    assert(parseDurationMs("1m") == 60000);
    assert(parseDurationMs("1h30m") == 90LL * 60 * 1000);
    assert(parseDurationMs("500ms") == 500);
    bool threw = false;
    try {
        parseDurationMs("");
        threw = true;
    } catch (const std::runtime_error&) {
    }
    assert(!threw);
    return 0;
}
