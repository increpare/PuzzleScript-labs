// Native (x86/arm) build of the MIS wasm entry points, to measure what the
// WebAssembly build costs relative to the same code compiled natively.
//
//   node src/tests/mis_backend_bench_node.js --dump-grids /tmp/grids.txt
//   native/wasm/build_mis_bench_native.sh && build/mis-bench-native/mis_wasm_bench_native /tmp/grids.txt
//
// Input: "GAME <path>" lines followed by "LEVEL <name> <w> <h> <count> <ids...>".
// Output: one line per level/strategy with status, states expanded and ms.

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
double misw_result_expanded();
double misw_result_elapsed_ms();
int misw_result_solution_length();
}

int main(int argc, char** argv) {
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
