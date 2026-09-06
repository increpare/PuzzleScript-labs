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
    puzzlescript::generator::BlockState block;
    block.spec.header.take = 1;

    puzzlescript::generator::LevelSetOptions options;
    options.exhaustPasses = 2;

    const auto before = puzzlescript::generator::snapshotBlockBest(block);
    assert(before.keeperCount == 0);
    assert(!puzzlescript::generator::blockImprovedSinceSnapshot(block, before));

    assert(puzzlescript::generator::tryInsertKeeper(block, makeKeeper(1, 100, 50)));
    assert(puzzlescript::generator::blockImprovedSinceSnapshot(block, before));

    const auto afterFirst = puzzlescript::generator::snapshotBlockBest(block);
    puzzlescript::generator::notePassOutcome(block, afterFirst, options);
    assert(!block.permanentlyExhausted);
    assert(block.passesWithoutImprovement == 1);

    puzzlescript::generator::notePassOutcome(block, afterFirst, options);
    assert(block.permanentlyExhausted);
    assert(block.passesWithoutImprovement == 2);
    assert(block.passPhase == puzzlescript::generator::BlockState::PassPhase::Exhausted);

    puzzlescript::generator::BlockState improvingBlock;
    improvingBlock.spec.header.take = 1;
    const auto improvingStart = puzzlescript::generator::snapshotBlockBest(improvingBlock);
    assert(puzzlescript::generator::tryInsertKeeper(improvingBlock, makeKeeper(2, 100, 50)));
    puzzlescript::generator::notePassOutcome(improvingBlock, improvingStart, options);
    assert(!improvingBlock.permanentlyExhausted);
    assert(improvingBlock.passesWithoutImprovement == 0);

    const auto passTwoStart = puzzlescript::generator::snapshotBlockBest(improvingBlock);
    assert(puzzlescript::generator::tryInsertKeeper(improvingBlock, makeKeeper(3, 200, 60)));
    puzzlescript::generator::notePassOutcome(improvingBlock, passTwoStart, options);
    assert(!improvingBlock.permanentlyExhausted);
    assert(improvingBlock.passesWithoutImprovement == 0);

    options.exhaustPasses = 0;
    block.permanentlyExhausted = false;
    block.passesWithoutImprovement = 0;
    const auto disabledStart = puzzlescript::generator::snapshotBlockBest(block);
    puzzlescript::generator::notePassOutcome(block, disabledStart, options);
    assert(!block.permanentlyExhausted);
    assert(block.passesWithoutImprovement == 0);

    return 0;
}
