#include "generation.h"

//#include "ofxMSAmcts.h"

#include "engine.h"
#include "game.h"
#include "global.h"
#include "native_bridge/NativeGameFacade.h"
#include "visualsandide.h"

namespace generator {
    recursive_mutex generatorMutex;
    vector<set<pair<float,vvvs> > > generatorNeighborhood;
    int counter = 0, solvedCounter = 0, unsolvableCounter = 0, timedoutCounter = 0, maxSolveTime = 0;
}

/*
using namespace msa::mcts;
namespace generator {
    
    recursive_mutex generatorMutex;
    vector<set<pair<float,vvvs> > > generatorNeighborhood;

    struct Action {
        Action() {}
        Action(const vvvs & _newState) : newState(_newState) {}
        vvvs newState;
    };
    
    class State {
    public:
        
        //--------------------------------------------------------------
        // MUST HAVE METHODS (INTERFACE)
        
        int maxStates = 10;
        
        
        State() {
            //generator::generatorNeighborhood[gbl::currentGame.currentLevelIndex].clear();
        }
        
        // default constructors will do
        // copy and assignment operators should perform a DEEP clone of the given state
        //    State(const State& other);
        //    State& operator = (const State& other);
        
        
        // whether or not this state is terminal (reached end)
        bool is_terminal() const  {
            return false; //there is no such thing as the perfect level (at least not obviously)
        }
        
        //  agent id (zero-based) for agent who is about to make a decision
        int agent_id() const {
            return 0;
        }
        
        // apply action to state
        void apply_action(const Action& action)  {
            data.state = action.newState;
        }
        
        
        // return possible actions from this state
        void get_actions(std::vector<Action>& actions) const {
 
            //vector<vvvs> newStates = generateStep(data.state, maxStates, gbl::currentGame) ;
            ////TODO: make sure none of them previously explored.
            //for(int i=0;i<newStates.size();++i) {
            //    actions.emplace_back(newStates[i]);
            //}
        }
        
        
        // get a random action, return false if no actions found
        bool get_random_action(Action& action) const {
 
            //vector<vvvs> randomState = generateStep(data.state, 1, gbl::currentGame);
            //action.newState = randomState[0];
 
        }
        
        
        // evaluate this state and return a vector of rewards (for each agent)
        // make sure to have an evaluate DP
        const vector<float> evaluate() const  {
            vector<float> rewards(1,0);
            atomic_bool keepSolving(true);
            deque<short> emptyMoves = {};
            SolveInformation info = astarSolver(data.state, gbl::currentGame, 10000, 5000, emptyMoves, keepSolving);
            //TODO: Penalty according to time.
            if(info.success == 1) {
                rewards[0] = info.statesExploredAStar;
                //gbl::currentGame.generatorNeighborhood.insert( make_pair(rewards[0], data.state) );
            }
            return rewards;
        }
        
        
        // return state as string (for debug purposes)
        std::string to_string() const  {
            stringstream str;
            str << data.state.size() << endl;
            return str.str();
        }
        
        
        //--------------------------------------------------------------
        // IMPLEMENTATION SPECIFIC
        
        struct {
            vvvc state;
            //maybe add solve information from other solves to this.
        } data;
        
        void reset() {
            
        }
    };
}*/



static volatile std::atomic_bool requestGenerating(false);
static Game cgame;
static vector<vector<bool> > cmodifyTable;

struct QueuedTimeout {
    vvvs state;
    long long lastBudgetMs;
};

static const size_t kMaxUnknownStack = 64;
static const long long kMaxSolveTimeMs = 60000; //ceiling so a bad throughput estimate can't run away

static void publishMaxSolveTime(long long threadBudgetMs) {
    const int budgetMs = static_cast<int>(MIN(threadBudgetMs, static_cast<long long>(INT_MAX)));
    synchronized(generator::generatorMutex) {
        if(generator::maxSolveTime < budgetMs) {
            generator::maxSolveTime = budgetMs;
        }
    }
}

static void generating() {
    
    
    cerr << "START GENERATING THREAD" << endl;
    std::shared_ptr<nativebridge::CandidateSolverContext> solverContext = nativebridge::createCandidateSolverContext();
    if(!solverContext) {
        cerr << "STOP GENERATING THREAD: failed to create native solver context" << endl;
        return;
    }

    //default time
    long long timeToSolve = 100; //start with a tenth of a second
    bool hasFoundAnyTransform = false;
    // Difficulty is measured in states expanded (machine-independent), but the
    // native solver only enforces a wall-clock budget. Keep a smoothed estimate
    // of solver throughput (states expanded per ms) so an expanded-count target
    // can be translated back into a time budget that doesn't drift with CPU load.
    double expandedPerMs = 0.0;
    generator::counter = 0; generator::solvedCounter = 0, generator::unsolvableCounter = 0, generator::timedoutCounter = 0;
    publishMaxSolveTime(timeToSolve);
    vector<QueuedTimeout> unknownStack;
    while(requestGenerating) {
        //if(counter % 10 == 0) cerr << "generated " << counter << " levels." << endl;

        vvvs candidateState;
        bool haveCandidate = false;
        // Only re-drill queued time-outs once we have a transform and a real
        // difficulty budget; before that, favour breadth (find any transform).
        for(size_t retryIndex = 0; hasFoundAnyTransform && retryIndex < unknownStack.size(); ++retryIndex) {
            if(unknownStack[retryIndex].lastBudgetMs < timeToSolve) {
                candidateState = unknownStack[retryIndex].state;
                unknownStack.erase(unknownStack.begin() + static_cast<long>(retryIndex));
                haveCandidate = true;
                break;
            }
        }
        
        if(!haveCandidate) {
            /* maybe remove possibility of double match (think about this some more...) */
            vector<vvvs> newStates = generateStep(cgame.currentState, 1, cgame, cmodifyTable);
            if(newStates.empty()) {
                continue;
            }
            //Do the obligatory stationary move
            moveAndChangeField(STATIONARY_MOVE, newStates[0], cgame);
            candidateState = newStates[0];
            generator::counter++; //count distinct generated candidates, not retries
        }

        //TODO: only matched part
        //TODO: make sure newStates doesn't appear in current state
        
        {
            const long long budgetMs = timeToSolve;
            nativebridge::CandidateSolveResult info = nativebridge::solveGeneratedState(*solverContext, candidateState, timeToSolve);

            // Update the throughput estimate from any run that actually searched
            // (solved or timed-out both report states expanded over elapsed time).
            if(info.expanded > 0 && info.elapsedMs > 0) {
                const double sampleRate = static_cast<double>(info.expanded) / static_cast<double>(info.elapsedMs);
                expandedPerMs = (expandedPerMs <= 0.0) ? sampleRate : (0.8 * expandedPerMs + 0.2 * sampleRate);
            }

            if(info.status == nativebridge::CandidateSolveStatus::Solved) {
                long long timeItTook = MAX(1, info.elapsedMs);
                long long statesExplored = MAX(1, info.expanded);
                auto p = make_pair(-statesExplored, candidateState );
                bool addTime = false;
                synchronized(generator::generatorMutex) {
                    std::atomic_thread_fence(std::memory_order_seq_cst);
                    if(generator::generatorNeighborhood[cgame.currentLevelIndex].empty() || -statesExplored < generator::generatorNeighborhood[cgame.currentLevelIndex].rbegin()->first)
                        addTime = true;
                    generator::solvedCounter++;
                    //a re-drilled candidate was already tallied as timed-out: move it across
                    if(haveCandidate && generator::timedoutCounter > 0) generator::timedoutCounter--;
                    generator::generatorNeighborhood[cgame.currentLevelIndex].insert( p );
                    if(generator::generatorNeighborhood[cgame.currentLevelIndex].size() > 4) {
                        generator::generatorNeighborhood[cgame.currentLevelIndex].erase(    prev(generator::generatorNeighborhood[cgame.currentLevelIndex].end()) );
                    }
                }
                if(addTime) {
                    //cout << "alrighty " << timeToSolve << " " << timeItTook << endl;
                    // Grow the budget toward the difficulty frontier measured in
                    // states expanded (×7 headroom), translated to a time budget
                    // via the smoothed throughput. Fall back to the old elapsed
                    // estimate until we have a throughput sample.
                    long long budgetFromStates = timeItTook*7;
                    if(expandedPerMs > 0.0) {
                        const double targetMs = (statesExplored * 7.0) / expandedPerMs;
                        budgetFromStates = static_cast<long long>(MIN(targetMs, static_cast<double>(kMaxSolveTimeMs)));
                    }
                    budgetFromStates = MAX(1LL, budgetFromStates);
                    if(!hasFoundAnyTransform)
                        timeToSolve = MAX(1000LL, budgetFromStates);
                    else
                        timeToSolve = MAX(timeToSolve, budgetFromStates);

                    publishMaxSolveTime(timeToSolve);
                    hasFoundAnyTransform = true;
                }
            } else if(info.status == nativebridge::CandidateSolveStatus::Unsolvable) {
                generator::unsolvableCounter++;
                //a re-drilled candidate was already tallied as timed-out: move it across
                if(haveCandidate && generator::timedoutCounter > 0) generator::timedoutCounter--;
            } else if(info.status == nativebridge::CandidateSolveStatus::Timeout) {
                if(!haveCandidate) generator::timedoutCounter++; //count each distinct candidate's timeout once
                if(unknownStack.size() >= kMaxUnknownStack) {
                    unknownStack.erase(unknownStack.begin());
                }
                unknownStack.push_back({candidateState, budgetMs});
                // Before the first transform there is no difficulty signal yet, so
                // ramp the budget geometrically on time-outs (machine-independent,
                // unlike the old wall-clock ramp) until something solves. We do not
                // re-drill here, so generation keeps exploring new candidates.
                if(!hasFoundAnyTransform) {
                    timeToSolve = MIN(kMaxSolveTimeMs, timeToSolve*2);
                    publishMaxSolveTime(timeToSolve);
                }
            } else {
                if(!haveCandidate) generator::timedoutCounter++; //treat solver errors like time-outs, once per candidate
                if(!info.error.empty()) {
                    cerr << "native generator solve error: " << info.error << endl;
                }
            }
        }
        
        //cout << "try generating next" << endl;
    }
    cerr << "STOP GENERATING THREAD" << endl;
}

static volatile bool stillGenerating = false;
static int generatorCount = 1;
static vector<thread> generatorThread;

static void resetGeneratorState() {
    synchronized(generator::generatorMutex) {
        std::atomic_thread_fence(std::memory_order_seq_cst);
        const int levelIndex = gbl::currentGame.currentLevelIndex;
        generator::counter = 0;
        generator::solvedCounter = 0;
        generator::unsolvableCounter = 0;
        generator::timedoutCounter = 0;
        generator::maxSolveTime = 0;
        if(levelIndex >= 0 && static_cast<size_t>(levelIndex) < generator::generatorNeighborhood.size()) {
            generator::generatorNeighborhood[levelIndex].clear();
        }
        std::atomic_thread_fence(std::memory_order_seq_cst);
    }
}

void startGenerating() {
    cout << "start generating" << endl;

    const int levelIndex = gbl::currentGame.currentLevelIndex;
    if(levelIndex < 0
       || static_cast<size_t>(levelIndex) >= editor::modifyTable.size()
       || static_cast<size_t>(levelIndex) >= generator::generatorNeighborhood.size()) {
        resetGeneratorState();
        return;
    }

    if(stillGenerating
       && cgame.getHash() == gbl::currentGame.getHash()
       && cmodifyTable == editor::modifyTable[levelIndex]
       && cgame.currentState == gbl::currentGame.currentState) {
        return;
    }

    if(stillGenerating) {
        stopGenerating();
    }

    resetGeneratorState();
    stillGenerating = true;
    requestGenerating = true;
    cgame = gbl::currentGame;
    cmodifyTable = editor::modifyTable[levelIndex];
    generatorCount = MAX(1,(int)thread::hardware_concurrency() - 1);
    generatorThread.clear();
    generatorThread.resize(generatorCount);
    for(size_t i=0; i<generatorThread.size(); ++i) {
        generatorThread[i] = thread(generating);
    }
}

void stopGenerating() {
    cout << "stop generating" << endl;
    requestGenerating = false;
    std::atomic_thread_fence(std::memory_order_seq_cst);

    if(stillGenerating) {
        for(size_t i=0;i<generatorThread.size();++i) {
            if(generatorThread[i].joinable()) {
                generatorThread[i].join();
            }
        }
    }

    generatorThread.clear();
    stillGenerating = false;
    resetGeneratorState();
}

bool stillTransforming() {
    return stillGenerating;
}
