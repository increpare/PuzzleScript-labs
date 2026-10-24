// Sparse cell writes must preserve the same indices, sound masks and dirty
// caches as a full-width write. Untouched inputs are deliberately poisoned.
#undef NDEBUG
#include <cassert>
#include <iostream>
#include <limits>
#include "compiler/parser.hpp"
#include "compiler/lower_to_runtime.hpp"
#include "runtime/compiled_rules.hpp"

int main() {
    std::string source = "objects\n\nBackground .\nblack\n\nPlayer P\nwhite\n\n";
    for (int i = 0; i < 200; ++i) source += "Object" + std::to_string(i) + "\nred\n\n";
    source += "legend\nsounds\ncollisionlayers\nBackground\nPlayer\n";
    for (int i = 0; i < 200; ++i) source += "Object" + std::to_string(i) + "\n";
    source += "rules\nwinconditions\nlevels\n\nPP\n";
    puzzlescript::compiler::DiagnosticSink diagnostics;
    auto parsed = puzzlescript::compiler::parseSource(source, diagnostics);
    puzzlescript::LoadedGame loaded;
    assert(!puzzlescript::compiler::lowerToRuntimeGame(parsed, loaded));
    auto dense = puzzlescript::createFullState(loaded), sparse = puzzlescript::createFullState(loaded);
    assert(!puzzlescript::loadLevel(*dense,0));assert(!puzzlescript::loadLevel(*sparse,0));
    const auto ow=loaded.information->wordCount, mw=loaded.information->movementWordCount;
    assert(ow>=4 && mw>=4);
    puzzlescript::MaskVector values(ow), created(ow), destroyed(ow);
    const auto* old=puzzlescript::compiledRuleCellObjects(*dense,0);
    for(uint32_t i=0;i<ow;++i)values[i]=old[i];
    values[0] &= ~puzzlescript::maskBit(1);values[ow-1] |= 1;
    for(uint32_t i=0;i<ow;++i){created[i]=values[i]&~old[i];destroyed[i]=old[i]&~values[i];}
    dense->scratch.pendingCreateMask.assign(ow,0);dense->scratch.pendingDestroyMask.assign(ow,0);
    sparse->scratch.pendingCreateMask.assign(ow,0);sparse->scratch.pendingDestroyMask.assign(ow,0);
    puzzlescript::compiledRuleSetCellObjectsFromWords(*dense,0,values.data(),created.data(),destroyed.data());
    const uint32_t objectWords[]={0,ow-1};
    for(uint32_t i=1;i+1<ow;++i)values[i]=created[i]=destroyed[i]=std::numeric_limits<puzzlescript::MaskWord>::max();
    puzzlescript::compiledRuleSetCellObjectsSparseFromWords(*sparse,0,values.data(),created.data(),destroyed.data(),objectWords,2);
    assert(dense->levelState.board.objects==sparse->levelState.board.objects);
    assert(dense->scratch.objectCellBits==sparse->scratch.objectCellBits);
    assert(dense->scratch.objectCellCounts==sparse->scratch.objectCellCounts);
    assert(dense->scratch.rowMasks==sparse->scratch.rowMasks);
    assert(dense->scratch.columnMasks==sparse->scratch.columnMasks);
    assert(dense->scratch.boardMask==sparse->scratch.boardMask);
    assert(dense->scratch.dirtyObjectRows==sparse->scratch.dirtyObjectRows);
    assert(dense->scratch.dirtyObjectColumns==sparse->scratch.dirtyObjectColumns);
    assert(dense->scratch.pendingCreateMask==sparse->scratch.pendingCreateMask);
    assert(dense->scratch.pendingDestroyMask==sparse->scratch.pendingDestroyMask);
    puzzlescript::MaskVector movements(mw,0);movements[0]=2;movements[mw-1]=1;
    puzzlescript::compiledRuleSetCellMovementsFromWords(*dense,0,movements.data());
    const uint32_t movementWords[]={0,mw-1};
    for(uint32_t i=1;i+1<mw;++i)movements[i]=std::numeric_limits<puzzlescript::MaskWord>::max();
    puzzlescript::compiledRuleSetCellMovementsSparseFromWords(*sparse,0,movements.data(),movementWords,2);
    assert(dense->scratch.liveMovements==sparse->scratch.liveMovements);
    assert(dense->scratch.movementCellBits==sparse->scratch.movementCellBits);
    assert(dense->scratch.rowMovementMasks==sparse->scratch.rowMovementMasks);
    assert(dense->scratch.columnMovementMasks==sparse->scratch.columnMovementMasks);
    assert(dense->scratch.boardMovementMask==sparse->scratch.boardMovementMask);
    assert(dense->scratch.dirtyMovementRows==sparse->scratch.dirtyMovementRows);
    assert(dense->scratch.dirtyMovementColumns==sparse->scratch.dirtyMovementColumns);
    std::cout<<"Sparse replacements: indices, sound masks and dirty caches passed\n";
}
