#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace puzzlescript::simulation {

struct CorpusCase {
    size_t index = 0;
    std::string name;
    std::string source;
    std::vector<std::string> inputs;
    int32_t target_level = 0;
    std::optional<std::string> seed;
};

struct CaseTiming {
    int64_t source_compile_us = 0;
    int64_t session_create_us = 0;
    int64_t level_load_us = 0;
    int64_t replay_us = 0;
};

struct CorpusSummary {
    size_t cases = 0;
    size_t passed = 0;
    size_t failed = 0;
    int64_t wall_us = 0;
    int64_t testdata_parse_us = 0;
    int64_t source_compile_us = 0;
    int64_t session_create_us = 0;
    int64_t level_load_us = 0;
    int64_t replay_us = 0;
    size_t games_loaded = 0;
    size_t games_reused = 0;
    std::string first_error;
};

bool parseCorpusCaseLine(const std::string& line, CorpusCase& out_case, std::string& error);
CorpusSummary runCorpusCases(const std::vector<CorpusCase>& cases);
CorpusSummary runCorpusNdjsonFile(const char* path);

std::string corpusSummaryToJson(const CorpusSummary& summary);

} // namespace puzzlescript::simulation
