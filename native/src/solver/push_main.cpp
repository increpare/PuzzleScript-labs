#include "search/push_prototype.hpp"
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>

int main(int argc, char** argv) {
    if (argc < 2 || argc > 4) {
        std::cerr << "usage: puzzlescript_push_solver GAME [LEVEL_INDEX [TIMEOUT_MS]]\n";
        return 1;
    }
    try {
        std::ifstream file(argv[1]);
        if (!file) throw std::runtime_error("cannot open source");
        std::stringstream source; source << file.rdbuf();
        const auto result = puzzlescript::search::solvePushPrototype(source.str(),
            argc >= 3 ? std::stoull(argv[2]) : 0, argc >= 4 ? std::stoll(argv[3]) : 5000);
        const char* status = result.status == PS_SOLVE_STATUS_SOLVED ? "solved"
            : result.status == PS_SOLVE_STATUS_EXHAUSTED ? "exhausted"
            : result.status == PS_SOLVE_STATUS_TIMEOUT ? "timeout" : "error";
        // Reasons can include compiler diagnostics; quote all JSON control bytes.
        std::string reason;
        for (unsigned char c : result.reason) {
            if (c < 32) { const char* hex = "0123456789abcdef"; reason += "\\u00"; reason += hex[c >> 4]; reason += hex[c & 15]; }
            else { if (c == '"' || c == '\\') reason += '\\'; reason += c; }
        }
        std::cout << "{\"status\":\"" << status << "\",\"supported\":" << (result.supported ? "true" : "false")
            << ",\"reason\":\"" << reason << "\",\"expanded\":" << result.expanded
            << ",\"pushes\":" << result.pushes << ",\"solution\":[";
        for (size_t i = 0; i < result.solution.size(); ++i) {
            if (i) std::cout << ',';
            std::cout << static_cast<int>(result.solution[i]);
        }
        std::cout << "]}\n";
        return result.status == PS_SOLVE_STATUS_ERROR ? 1 : 0;
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
