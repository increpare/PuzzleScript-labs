// Bounded experiment driver: production solveLevel includes independent replay.
#define main unused_solver_cli_main
#include "../src/solver/main.cpp"
#undef main

int main(int argc, char** argv) {
    try {
        if (argc < 3 || argc > 4) throw std::runtime_error("Usage: rule_goal_bench CORPUS survey|auto|rule-goals|auto-wa2|rule-goals-wa2 [TIMEOUT_MS]");
        const std::string mode = argv[2];
        const bool weighted = mode == "auto-wa2" || mode == "rule-goals-wa2";
        const auto kind = puzzlescript::solver::parseHeuristicName(weighted ? mode.substr(0, mode.size() - 4) : mode);
        if (mode != "survey" && (!kind || argc != 4)) throw std::runtime_error("Invalid mode/budget");
        for (const auto& path : discoverGames(argv[1])) {
            const auto name = relativeGameName(argv[1], path);
            auto source = readFile(path);
            if (source.empty() || source.back() != '\n') source.push_back('\n');
            std::string error;
            const auto loaded = compileGame(source, error);
            if (!loaded.information) throw std::runtime_error(name + ": " + error);
            const auto start = Clock::now();
            const auto plan = puzzlescript::solver::ruleGoalPlanFor(loaded.information);
            const double setup = std::chrono::duration<double, std::milli>(Clock::now() - start).count();
            if (mode == "survey") {
                int playable = 0;
                for (const auto& level : loaded.information->levels) if (!level.isMessage) ++playable;
                auto raw = std::make_shared<puzzlescript::solver::RuleGoalPlan>(*loaded.information, false);
                int checked = 0;
                if (plan->supported) for (const auto& level : loaded.information->levels) {
                    if (level.isMessage) continue;
                    puzzlescript::solver::RuleGoalContext optimized(plan, level.width, level.height, loaded.information->wordCount);
                    puzzlescript::solver::RuleGoalContext reference(raw, level.width, level.height, loaded.information->wordCount);
                    auto board = level.objects;
                    uint32_t seed = 12345;
                    for (int sample = 0; sample < 16; ++sample) {
                        if (optimized.score(board.data()) != reference.score(board.data()))
                            throw std::runtime_error(name + ": compacted heuristic score changed");
                        ++checked;
                        // Arbitrary boards stress OR/AND, duplicates and absent
                        // cyclic producers; no claim these are reachable states.
                        for (size_t cell = 0; cell < board.size(); ++cell) {
                            seed = seed * 1664525u + 1013904223u;
                            if ((seed & 7u) == 0) board[cell] ^= puzzlescript::maskBit((seed >> 8) % PS_MASK_WORD_BITS);
                        }
                    }
                }
                std::cout << "{\"game\":" << jsonString(name) << ",\"supported\":" << (plan->supported ? "true" : "false")
                    << ",\"portfolio_active\":" << (plan->supported && portfolioHeuristic(choosePortfolioProfile(analyzePortfolioFeatures(*loaded.information)), puzzlescript::solver::HeuristicKind::RuleGoals) == puzzlescript::solver::HeuristicKind::RuleGoals ? "true" : "false")
                    << ",\"levels\":" << playable << ",\"nodes\":" << plan->nodes.size()
                    << ",\"raw_nodes\":" << raw->nodes.size() << ",\"score_checks\":" << checked
                    << ",\"win_rules\":" << plan->victories.size() << ",\"some_objects\":" << plan->someObjects.size()
                    << ",\"skipped_rules\":" << plan->skippedRules << ",\"setup_ms\":" << setup << "}\n";
                continue;
            }
            if (!plan->supported) continue;
            // Both arms warm the immutable ruleset plan before level deadlines.
            // Survey reports setup separately; this measures repeated-level use.
            for (size_t level = 0; level < loaded.information->levels.size(); ++level) {
                if (loaded.information->levels[level].isMessage) continue;
                const auto result = solveLevel(loaded, name, static_cast<int32_t>(level), std::stoll(argv[3]), 0,
                    weighted ? Strategy::WeightedAStar : Strategy::Portfolio, 0, true, true, false, false, true, 2, *kind, nullptr, false, 1, 1);
                printJsonResult(result, std::cout); std::cout << '\n';
                if (result.status == "level_error") throw std::runtime_error(result.error);
            }
        }
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
