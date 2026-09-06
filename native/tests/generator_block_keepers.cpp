#undef NDEBUG

#include "generator/block_scheduler.hpp"

#include <cassert>
#include <cstdint>

namespace {

puzzlescript::generator::Keeper makeKeeper(uint64_t hash, int64_t difficulty, int64_t expandedPortfolio) {
    puzzlescript::generator::Keeper keeper;
    keeper.levelHash = hash;
    keeper.level.width = keeper.level.height = 1;
    keeper.level.objects = {static_cast<puzzlescript::MaskWord>(hash)};
    keeper.difficulty = difficulty;
    keeper.expandedPortfolio = expandedPortfolio;
    return keeper;
}

} // namespace

int main() {
    puzzlescript::generator::BlockState collisions;
    collisions.spec.header.take = 2;
    auto colliding = makeKeeper(7, 100, 50);
    assert(puzzlescript::generator::tryInsertKeeper(collisions, colliding));
    colliding.level.objects = {99};
    assert(puzzlescript::generator::tryInsertKeeper(collisions, colliding));
    assert(collisions.keepers.size() == 2); // Same hash, different exact boards.
    puzzlescript::generator::BlockState block;
    block.spec.header.take = 2;
    assert(puzzlescript::generator::tryInsertKeeper(block, makeKeeper(10, 100, 50)));
    assert(block.keepers.size() == 1);
    assert(!puzzlescript::generator::tryInsertKeeper(block, makeKeeper(10, 100, 50)));
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

    puzzlescript::generator::BlockState gate;
    gate.spec.header.take = 1;
    assert(puzzlescript::generator::canImproveKeeper(gate, 0));
    assert(puzzlescript::generator::tryInsertKeeper(gate, makeKeeper(20, 10, 1000)));
    assert(puzzlescript::generator::canImproveKeeper(gate, 500));
    assert(!puzzlescript::generator::canImproveKeeper(gate, 10));
    assert(puzzlescript::generator::tryInsertKeeper(gate, makeKeeper(21, 100, 500)));
    assert(!puzzlescript::generator::canImproveKeeper(gate, 99));
    return 0;
}
