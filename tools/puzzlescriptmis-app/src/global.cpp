#include "global.h"

#include "game.h"
#include "levelSolve.h"
#include "logError.h"
#include "native_bridge/NativeGameFacade.h"
#include "recordandundo.h"
#include "visualsandide.h"

namespace gbl {
    MODE_TYPE mode = MODE_LEVEL_EDITOR;
    Game currentGame;
    Record record;
    int version = 100000;
    
    const string locationOfResources = "data/";
    bool isMousePressed = false, isMouseReleased = false, isFirstMousePressed = false;
    
    const deque<short> emptyMoves = {};
}

// This is the main controller. All logic of non-local state changes happen in this file.

void switchToLevel(int level, Game & game) {
    cout << "SWITCHING TO LEVEL " << level << endl;
    if(!nativebridge::loadLevel(level, game, logger::levelEdit)) {
        return;
    }

    game.currentMessageIndex = 0;

    levelSolve::requestSolve(game, game.beginStateAfterStationaryMove);
    
    /* TODO:
     if(game.currentMessageIndex < game.messages[level].size()) {
     //switch into message mode
     mode = MODE_MESSAGE;
     } else {*/
    
    //mode = MODE_LEVEL_EDITOR;
}
