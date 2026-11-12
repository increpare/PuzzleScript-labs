#include "runtime/core.hpp"
#include <cstdlib>
#include <iostream>
#include <utility>

void require(bool condition, const char* message) {
    if (!condition) { std::cerr << message << '\n'; std::exit(1); }
}

int main() {
    puzzlescript::LinePreconditionCache cache;
    const auto first = cache.begin(2);
    require(first != 0 && (first & 1) == 0, "generation must leave the result bit free");
    cache.tags[0] = first | 1;
    cache.tags[1] = first;
    require((cache.tags[0] & ~uint32_t{1}) == first && (cache.tags[0] & 1), "cached acceptance lost");
    require((cache.tags[1] & ~uint32_t{1}) == first && !(cache.tags[1] & 1), "cached rejection lost");
    const auto second = cache.begin(20);
    require(second != first, "another rule/collection reused the generation");
    require((cache.tags[0] & ~uint32_t{1}) != second, "old row result remained valid");
    require(cache.tags[19] == 0, "newly allocated lines must start invalid");

    // A very long solver run must not resurrect a stale result at wraparound.
    cache.generation = UINT32_MAX - 1;
    cache.tags[0] = 3;
    require(cache.begin(1) == 2, "wrapped generation must restart above the invalid marker");
    require(cache.tags[0] == 0 && cache.tags[1] == 0, "wraparound did not invalidate every line");

    auto copy = cache;
    require(copy.tags.empty() && copy.generation == 0, "solver copies must drop ephemeral cache storage");
    copy = cache;
    require(copy.tags.empty() && copy.generation == 0, "copy assignment retained cached results");
    cache.tags[0] = cache.generation | 1;
    auto moved = std::move(cache);
    require(moved.tags[0] == (moved.generation | 1), "moving lost reusable cache storage");
    std::cout << "Line precondition cache: invalidation, growth, wraparound and copies passed\n";
}
