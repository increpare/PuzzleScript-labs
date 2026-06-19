#include "keyHandling.h"

#include "game.h"
#include "generation.h"
#include "global.h"
#include "logError.h"
#include "native_bridge/NativeGameFacade.h"
#include "recordandundo.h"
#include "visualsandide.h"

namespace keyHandling {
    queue<pair<KEY_TYPE,long long> > keyQueue; //which key should be pressed and how long the keyboard input should be paused after this.

    static map<int, KEY_TYPE> keyMapper;
    static chrono::steady_clock::time_point lastPressedTime = chrono::steady_clock::now();
}
using namespace keyHandling;


//map<KEY_TYPE, pair<long long,bool> > keyPressedDown;
//map<KEY_TYPE, bool> timeWaitForRepress;

//bool setRemapKey = false;
//keyType remapKey = UNKNOWNKEYT;

/*
 Key Codes:
 ----------
 */

void initDefaultKeyMapping() {
    keyMapper.insert({87, KEY_UP});
    keyMapper.insert({119, KEY_UP});
    keyMapper.insert({357, KEY_UP});
    keyMapper.insert({57357,KEY_UP});
    
    keyMapper.insert({65, KEY_LEFT});
    keyMapper.insert({97, KEY_LEFT});
    keyMapper.insert({356, KEY_LEFT});
    keyMapper.insert({57356, KEY_LEFT});
    
    keyMapper.insert({83, KEY_DOWN});
    keyMapper.insert({115, KEY_DOWN});
    keyMapper.insert({359, KEY_DOWN});
    keyMapper.insert({57359, KEY_DOWN });
    
    keyMapper.insert({68, KEY_RIGHT});
    keyMapper.insert({100, KEY_RIGHT});
    keyMapper.insert({358, KEY_RIGHT});
    keyMapper.insert({57358, KEY_RIGHT});
    
    keyMapper.insert({13, KEY_ACTION});
    keyMapper.insert({32, KEY_ACTION});
    
    keyMapper.insert({88, KEY_ACTION});
    keyMapper.insert({120, KEY_ACTION});
    
    keyMapper.insert({85, KEY_UNDO});
    keyMapper.insert({117, KEY_UNDO});
    
    keyMapper.insert({90, KEY_UNDO});
    keyMapper.insert({122, KEY_UNDO});
    
    keyMapper.insert({82, KEY_RESTART});
    keyMapper.insert({114, KEY_RESTART});
    
    keyMapper.insert({76, KEY_SOLVE}); //button l
    keyMapper.insert({108, KEY_SOLVE});
    
    keyMapper.insert({80, KEY_PRINT});
    keyMapper.insert({112, KEY_PRINT});
    
    keyMapper.insert({73, KEY_IMPORT});
    keyMapper.insert({105, KEY_IMPORT});
    
    keyMapper.insert({71, KEY_GENERATE});
    keyMapper.insert({103, KEY_GENERATE});
    
    keyMapper.insert({84, KEY_GENERATE});
    keyMapper.insert({116, KEY_GENERATE});
    /*
     keyMapper.insert({57, CHANGE_TO_SUPERAIR});
     
     keyMapper.insert({67, CLEAR});
     keyMapper.insert({99, CLEAR});
     
     keyMapper.insert({76, SOLVE});
     keyMapper.insert({108, SOLVE});
     
     keyMapper.insert({27, TOGGLE_TOOLBAR});
     
     keyMapper.insert({105, IMPROVE});
     */
}


void keyHandle(int key) {
    if(keyMapper.count(key) == 0) {
        if(gbl::mode == MODE_LEVEL_EDITOR && !editor::activeIDE && key >= '0' && key <= '9') {
            int selectkey = key == '0' ? 9 : (key-'1');
            if(selectkey < gbl::currentGame.synsWithSingleCharName.size()) {
                editor::selectedBlockStr = gbl::currentGame.synsWithSingleCharName[selectkey].first;
                editor::selectedBlock = gbl::currentGame.synsWithSingleCharName[selectkey].second;
            } else if(selectkey < gbl::currentGame.synsWithSingleCharName.size() + gbl::currentGame.aggsWithSingleCharName.size()) {
                editor::selectedBlockStr = gbl::currentGame.aggsWithSingleCharName[selectkey - gbl::currentGame.synsWithSingleCharName.size()].first;
                editor::selectedBlock = selectkey - gbl::currentGame.synsWithSingleCharName.size() + gbl::currentGame.objLayer.size();
            }
        }
        if(gbl::mode == MODE_EXPLOITATION && !editor::activeIDE && key >= '0' && key <= '9') {
            int selectkey = key == '0' ? 9 : (key-'1');
            if(selectkey < 2) {
                editor::selectedExploitationTool = selectkey;
            }
        }
        DEB("pressed key " + to_string(key));
    } //unknown key
    else {
        keyQueue.push({keyMapper[key],0});
    }
}



void executeKeys() {
    if(keyQueue.size()==0) return;
    
    chrono::steady_clock::time_point ctime = chrono::steady_clock::now();
    auto dur = chrono::duration_cast<std::chrono::milliseconds>(ctime - lastPressedTime).count();
    
    if(dur > keyQueue.front().second)  {
        KEY_TYPE key = keyQueue.front().first;
        keyQueue.pop();
        lastPressedTime = ctime;

        switch(key) {
            case KEY_LEFT:
            case KEY_RIGHT:
                if(gbl::mode == MODE_EXPLOITATION || gbl::mode == MODE_LEVEL_EDITOR || gbl::mode == MODE_INSPIRATION) {
                    if(key==KEY_LEFT && gbl::currentGame.currentLevelIndex > 0) gbl::currentGame.currentLevelIndex--;
                    else if(key==KEY_RIGHT && gbl::currentGame.currentLevelIndex+1<gbl::currentGame.levels.size()) gbl::currentGame.currentLevelIndex++;
                    switchToLeftEditor(gbl::mode,"switching_level_to_"+to_string(gbl::currentGame.currentLevelIndex));
                    break;
                }
            case KEY_UP:
            case KEY_DOWN:
            case KEY_ACTION:
                if(gbl::mode == MODE_PLAYING) {
                    short dir = key == KEY_UP ? UP_MOVE : key == KEY_DOWN ? DOWN_MOVE : key == KEY_LEFT ? LEFT_MOVE : key == KEY_RIGHT ? RIGHT_MOVE : ACTION_MOVE;
                    bool winning = false;
                    nativebridge::step(dir, gbl::currentGame, winning, logger::levelEdit);
                    if(winning) {
                        keyQueue.push({KEY_WIN,300});
                    }
                }
                
                break;
            case KEY_WIN:
                if(gbl::mode == MODE_PLAYING) {
                    //gbl::mode = MODE_PLAYING
                    //switchToLevel(gbl::currentGame.currentLevelIndex+1, gbl::currentGame);
                    switchToLevel(gbl::currentGame.currentLevelIndex, gbl::currentGame);
                    switchToLeftEditor(editor::previousMenuMode,"won_level");
                }
            break;
            case KEY_UNDO:
                if(gbl::mode == MODE_PLAYING)
                    nativebridge::undo(gbl::currentGame);
                else if(gbl::mode == MODE_LEVEL_EDITOR || gbl::mode == MODE_EXPLOITATION) {
                    undoEditorState(gbl::record);
                }
                break;
            case KEY_RESTART:
                if(gbl::mode == MODE_PLAYING) {
                    if(nativebridge::isAtRestartState(gbl::currentGame)) {
                        switchToLevel(gbl::currentGame.currentLevelIndex, gbl::currentGame);
                        switchToLeftEditor(editor::previousMenuMode,"switch_from_play_to_menu_wo_win");
                    } else {
                        nativebridge::restart(gbl::currentGame);
                    }
                }
                else if(gbl::mode == MODE_LEVEL_EDITOR || gbl::mode == MODE_EXPLOITATION) {
                    switchToLevel(gbl::currentGame.currentLevelIndex, gbl::currentGame);
                    gbl::mode = MODE_PLAYING;
                }
            
                break;
            case KEY_SOLVE:
                if(gbl::mode == MODE_PLAYING) {
                    // Native solve playback is not wired yet.
                }
                break;
            case KEY_PRINT:
                cout << "===================" << endl;
                cout << "Printing IDE String" << endl;
                cout << "===================" << endl;
                for(int i=0; i<editor::ideString.size();++i) {
                    cout << editor::ideString[i] << endl;
                }
                
                cout << "===============================" << endl;
                cout << "Printing IDE String (formatted)" << endl;
                cout << "===============================" << endl;
                cout << "{";
                for(int i=0; i<editor::ideString.size();++i) {
                    cout << "\"" << editor::ideString[i] << (i+1 != editor::ideString.size() ? "\"," : "\"") << endl;
                }
                cout << "}";
                cout << "EXPORT !!! " << endl;
                exportRecordToFile(gbl::record, "storerecord");
                break;
                
            case KEY_IMPORT:
                cout << "IMPORT !!! " << endl;
                //DISABLED FOR USERS
                importRecordFromFile(gbl::record, "storerecord");
                break;
            
            case KEY_GENERATE:
                if(gbl::mode == MODE_LEVEL_EDITOR || gbl::mode == MODE_EXPLOITATION || gbl::mode == MODE_INSPIRATION) {
                    editor::showGenerate = 1;
                    stopGenerating();
                    if(editor::successes.first && editor::successes.second) startGenerating();
                }

            default:;DEB("Unhandled key " + to_string(key));
        }
    }
    //std::cout << "Time difference = " << std::chrono::duration_cast<std::chrono::microseconds>(end - begin).count() <<std::endl;
}
