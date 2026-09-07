// Invoke the actual native solver and replay path. Diagnostic hooks are compiled
// only for this target; a second target builds the same driver without probes.
#define main unused_solver_cli_main
#include "../src/solver/main.cpp"
#undef main
#include "solver/portfolio_diagnostics.hpp"

int main(int argc, char** argv) {
    try {
        if (argc < 5 || argc > 7) throw std::runtime_error(
            "Usage: solver_portfolio_diagnosis CORPUS CASES_TSV MODE TIMEOUT_MS [MAX_EXPANDED=0] [trace|quiet]");
        const std::string mode = argv[3];
        const int64_t budget = std::stoll(argv[4]);
        const uint64_t cap = argc > 5 ? std::stoull(argv[5]) : 0;
        const bool trace = argc < 7 || std::string(argv[6]) == "trace";
        if (argc == 7 && std::string(argv[6]) != "trace" && std::string(argv[6]) != "quiet") throw std::runtime_error("Invalid trace mode");
        if (budget <= 0) throw std::runtime_error("Budget must be positive");
        Strategy strategy = Strategy::Portfolio;
        int32_t weight = 2;
        if (mode == "bfs") strategy = Strategy::Bfs;
        else if (mode == "wa2" || mode == "wa8") { strategy = Strategy::WeightedAStar; weight = mode == "wa8" ? 8 : 2; }
        else if (mode == "greedy") strategy = Strategy::Greedy;
        else if (mode != "auto" && mode != "no-lock") throw std::runtime_error("Unknown mode");
        if (cap && strategy != Strategy::Portfolio) throw std::runtime_error("Expansion cap is for diagnostic portfolio only");
#ifndef PS_PORTFOLIO_DIAGNOSTICS
        if (mode == "no-lock" || cap) throw std::runtime_error("Controls require the diagnostic target");
#endif
        std::ifstream cases(argv[2]);
        if (!cases) throw std::runtime_error("Cannot read cases");
        std::string line;
        size_t count = 0;
        while (std::getline(cases, line)) {
            if (!line.empty() && line.back() == '\r') line.pop_back();
            if (line.empty()) continue;
            const size_t tab = line.find('\t');
            if (tab == std::string::npos) throw std::runtime_error("Expected game TAB source-level-index");
            const std::string name = line.substr(0, tab);
            if (std::filesystem::path(name).has_parent_path()) throw std::runtime_error("Expected corpus filename");
            const int32_t level = std::stoi(line.substr(tab + 1));
            auto source = readFile(std::filesystem::path(argv[1]) / name);
            if (source.empty() || source.back() != '\n') source.push_back('\n');
            std::string error;
            auto game = compileGame(source, error);
            if (!game.information) throw std::runtime_error(name + ": " + error);
            puzzlescript::solver::PortfolioDiagnosis diagnosis;
            diagnosis.disableLock = mode == "no-lock";
            diagnosis.collect = trace;
            diagnosis.maxExpanded = cap;
            diagnosis.start = Clock::now();
            puzzlescript::solver::activePortfolioDiagnosis = &diagnosis;
            // Same compact state representation and heuristic for every mode;
            // source compilation is outside the per-level deadline, as in CLI.
            auto result = solveLevel(game, name, level, budget, 0, strategy, 0,
                true, true, false, false, true, weight,
                puzzlescript::solver::HeuristicKind::Auto, nullptr, false, 1, 1);
            puzzlescript::solver::activePortfolioDiagnosis = nullptr;
            if (result.status == "level_error" || result.status == "skipped_message") throw std::runtime_error(name + ": " + result.error + " " + result.status);
            if (trace && strategy == Strategy::Portfolio && !diagnosis.lanes.empty()) {
                uint64_t expanded = 0, generated = 0;
                for (const auto& lane : diagnosis.lanes) { expanded += lane.expanded; generated += lane.generated; }
#ifdef PS_PORTFOLIO_DIAGNOSTICS
                if (expanded != result.expanded || generated != result.generated) throw std::runtime_error("Diagnostic totals disagree");
#endif
            }
            std::cout << "{\"mode\":" << jsonString(mode) << ",\"result\":";
            printJsonResult(result, std::cout);
            std::cout << ",\"diagnosis\":{\"lock_expanded\":" << diagnosis.lockExpanded
                << ",\"initial_h\":" << diagnosis.initialHeuristic << ",\"best_h\":" << diagnosis.bestHeuristic
                << ",\"last_improvement_expanded\":" << diagnosis.lastImprovementExpanded
                << ",\"expansion_digest\":" << jsonString(std::to_string(diagnosis.expansionDigest))
                << ",\"dropped_events\":" << diagnosis.droppedEvents << ",\"lanes\":[";
            for (size_t i = 0; i < diagnosis.lanes.size(); ++i) {
                if (i) std::cout << ',';
                const auto& l = diagnosis.lanes[i];
                std::cout << "{\"name\":" << jsonString(l.name) << ",\"expanded\":" << l.expanded
                    << ",\"generated\":" << l.generated << ",\"unique\":" << l.unique << ",\"noops\":" << l.noops
                    << ",\"duplicates\":" << l.duplicates << ",\"lower\":" << l.lower << ",\"equal\":" << l.equal
                    << ",\"higher\":" << l.higher << ",\"improvements\":" << l.improvements << ",\"step_ms\":" << ms(l.stepNs) << '}';
            }
            std::cout << "],\"events\":[";
            for (size_t i = 0; i < diagnosis.events.size(); ++i) {
                if (i) std::cout << ',';
                const auto& e = diagnosis.events[i];
                std::cout << "{\"reason\":" << jsonString(e.reason) << ",\"from\":" << e.from << ",\"to\":" << e.to
                    << ",\"expanded\":" << e.expanded << ",\"generated\":" << e.generated << ",\"elapsed_ms\":" << e.elapsedMs
                    << ",\"step_us_per_generated\":" << e.stepUsPerGenerated << ",\"best_h\":" << e.bestHeuristic << '}';
            }
            std::cout << "]}}\n";
            ++count;
        }
        if (!count) throw std::runtime_error("Empty case list");
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
