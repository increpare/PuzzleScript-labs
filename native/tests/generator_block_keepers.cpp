#undef NDEBUG

#include "generator/block_scheduler.hpp"

#include <cassert>
#include <cstdint>

namespace {

puzzlescript::generator::Keeper makeKeeper(uint64_t hash, int64_t difficulty, int64_t expandedPortfolio) {
    puzzlescript::generator::Keeper keeper;
    keeper.levelHash = hash;
    keeper.difficulty = difficulty;
    keeper.expandedPortfolio = expandedPortfolio;
    return keeper;
}

} // namespace

int main() {
    puzzlescript::generator::GlobalDedupe dedupe;
    const size_t dedupeMax = 128;
    uint64_t firstInserted = 0;
    for (uint64_t hash = 1; hash <= static_cast<uint64_t>(dedupeMax + 32); ++hash) {
        if (puzzlescript::generator::insertGlobalDedupe(dedupe, hash, dedupeMax)) {
            if (firstInserted == 0) {
                firstInserted = hash;
            }
        }
    }
    assert(firstInserted != 0);
    assert(puzzlescript::generator::insertGlobalDedupe(dedupe, firstInserted, dedupeMax));
    assert(puzzlescript::generator::insertGlobalDedupe(dedupe, dedupeMax + 100, dedupeMax));

    puzzlescript::generator::BlockState block;
    block.spec.header.take = 2;
    assert(puzzlescript::generator::tryInsertKeeper(block, makeKeeper(10, 100, 50)));
    assert(block.keepers.size() == 1);
    assert(puzzlescript::generator::tryInsertKeeper(block, makeKeeper(11, 200, 60)));
    assert(block.keepers.size() == 2);
    assert(puzzlescript::generator::tryInsertKeeper(block, makeKeeper(12, 150, 70)));
    assert(block.keepers.size() == 2);
    assert(block.keepers.front().difficulty == 150);
    assert(block.keepers.back().difficulty == 200);
    assert(!puzzlescript::generator::tryInsertKeeper(block, makeKeeper(14, 120, 70)));
    assert(puzzlescript::generator::tryInsertKeeper(block, makeKeeper(13, 250, 80)));
    assert(block.keepers.size() == 2);
    assert(block.keepers.front().difficulty == 200);
    assert(block.keepers.back().difficulty == 250);
    return 0;
}
