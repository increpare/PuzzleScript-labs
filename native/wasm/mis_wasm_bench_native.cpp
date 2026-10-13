// Native (x86/arm) build of the MIS wasm entry points, to measure what the
// WebAssembly build costs relative to the same code compiled natively.
//
//   node src/tests/mis_backend_bench_node.js --dump-grids /tmp/grids.txt
//   native/wasm/build_mis_bench_native.sh && build/mis-bench-native/mis_wasm_bench_native /tmp/grids.txt
//
// Input: "GAME <path>" lines followed by "LEVEL <name> <w> <h> <count> <ids...>".
// Output: one line per level/strategy with status, states expanded and ms.
//
// Replay mode, for engine work: a corpus of "ASSESS <name> <w> <h> <count>
// <ids...>" lines (node src/tests/mis_generator_bench_node.js corpus) runs every
// board through misw_assess as the generator does - deterministic, primary
// capped at --cap states (30k), refinement lanes always - for PASSES passes:
//
//   mis_wasm_bench_native corpus.txt --passes 3 [--list] [--cap 30000]
//
// It prints the time of the assessments only and a checksum of every result
// (status, states, lanes, difficulty), which must not change across an
// optimization.

#include <chrono>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

extern "C" {
int misw_compile(const char* source, int length);
const char* misw_error();
int32_t* misw_grid_buffer(int count);
int misw_solve(int width, int height, int count, int strategy, double timeoutMs, double maxExpanded, int deterministic);
int misw_assess(int width, int height, int count, double primaryTimeoutMs, int runSupplemental, double supplementalTimeoutMs,
    double gateMinExpanded, double primaryMaxExpanded, int deterministic);
double misw_result_greedy();
double misw_result_weighted_astar();
double misw_result_bfs();
double misw_result_difficulty();
double misw_result_expanded();
double misw_result_elapsed_ms();
int misw_result_solution_length();
}

static int replay(const char* file, int passes, bool list, double cap) {
    struct Board { size_t game; std::string name; int w, h; std::vector<int32_t> ids; };
    std::vector<std::string> games;
    std::vector<Board> boards;
    std::ifstream in(file);
    std::string line;
    while (std::getline(in, line)) {
        std::istringstream ss(line);
        std::string kind;
        ss >> kind;
        if (kind == "GAME") {
            std::string path;
            std::getline(ss >> std::ws, path);
            std::ifstream f(path);
            std::stringstream buf;
            buf << f.rdbuf();
            games.push_back(buf.str());
        } else if (kind == "ASSESS" && !games.empty()) {
            Board b{games.size() - 1, "", 0, 0, {}};
            int count;
            ss >> b.name >> b.w >> b.h >> count;
            b.ids.resize(count);
            for (int i = 0; i < count; i++) ss >> b.ids[i];
            boards.push_back(std::move(b));
        }
    }
    const char* statuses[] = {"solved", "unsolvable", "timeout", "error"};
    for (int pass = 0; pass < passes; pass++) {
        uint64_t checksum = 1469598103934665603ull;
        auto mix = [&](double v) { checksum = (checksum ^ static_cast<uint64_t>(static_cast<int64_t>(v))) * 1099511628211ull; };
        double totalMs = 0, states = 0;
        size_t current = static_cast<size_t>(-1);
        for (const Board& b : boards) {
            if (b.game != current) {
                current = b.game;
                if (!misw_compile(games[current].c_str(), static_cast<int>(games[current].size()))) std::cerr << "compile failed: " << misw_error() << "\n";
            }
            int32_t* grid = misw_grid_buffer(static_cast<int>(b.ids.size()));
            for (size_t i = 0; i < b.ids.size(); i++) grid[i] = b.ids[i];
            const auto t0 = std::chrono::steady_clock::now();
            const int st = misw_assess(b.w, b.h, static_cast<int>(b.ids.size()), 600000, 1, 600000, 0, cap, 1);
            const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
            totalMs += ms;
            const double values[] = {static_cast<double>(st), misw_result_expanded(), misw_result_greedy(), misw_result_weighted_astar(), misw_result_bfs(), misw_result_difficulty()};
            for (double v : values) mix(v);
            states += misw_result_expanded();
            if (list && pass == 0) std::printf("%s %s %.0f %.0f %.2f\n", b.name.c_str(), statuses[st < 0 || st > 3 ? 3 : st], misw_result_expanded(), misw_result_difficulty(), ms);
        }
        std::printf("pass %d: %zu boards, %.0f primary states, %.1f ms, checksum %016llx\n", pass + 1, boards.size(), states, totalMs,
            static_cast<unsigned long long>(checksum));
    }
    return 0;
}

int main(int argc, char** argv) {
    if (argc >= 3 && std::string(argv[2]) == "--passes") {
        bool list = false;
        double cap = 30000;
        for (int i = 4; i < argc; i++) {
            if (std::string(argv[i]) == "--list") list = true;
            else if (std::string(argv[i]) == "--cap" && i + 1 < argc) cap = std::stod(argv[++i]);
        }
        return replay(argv[1], std::stoi(argv[3]), list, cap);
    }
    if (argc < 2) { std::cerr << "usage: mis_wasm_bench_native GRIDS [timeout_ms] [max_expanded]\n"; return 2; }
    const double timeoutMs = argc > 2 ? std::stod(argv[2]) : 8000;
    const double cap = argc > 3 ? std::stod(argv[3]) : 300000;
    std::ifstream in(argv[1]);
    std::string line;
    const char* names[] = {"portfolio", "bfs", "astar", "astar-deep", "greedy"};
    const char* statuses[] = {"solved", "unsolvable", "timeout", "error"};
    while (std::getline(in, line)) {
        std::istringstream ss(line);
        std::string kind;
        ss >> kind;
        if (kind == "GAME") {
            std::string path;
            std::getline(ss >> std::ws, path);
            std::ifstream f(path);
            std::stringstream buf;
            buf << f.rdbuf();
            const std::string src = buf.str();
            if (!misw_compile(src.c_str(), static_cast<int>(src.size()))) std::cerr << "compile failed: " << misw_error() << "\n";
        } else if (kind == "LEVEL") {
            std::string name;
            int w, h, count;
            ss >> name >> w >> h >> count;
            std::vector<int32_t> ids(count);
            for (int i = 0; i < count; i++) ss >> ids[i];
            for (int strategy : {1, 2, 4, 0}) {
                int32_t* grid = misw_grid_buffer(count);
                for (int i = 0; i < count; i++) grid[i] = ids[i];
                const int st = misw_solve(w, h, count, strategy, timeoutMs, strategy == 0 ? 0 : cap, 0);
                std::printf("%s %s %s %.0f %.0f %d\n", name.c_str(), names[strategy], statuses[st < 0 || st > 3 ? 3 : st],
                    misw_result_expanded(), misw_result_elapsed_ms(), misw_result_solution_length());
            }
        }
    }
    return 0;
}
