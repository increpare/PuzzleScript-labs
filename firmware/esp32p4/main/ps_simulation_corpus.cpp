#include "ps_simulation_corpus.hpp"

#include "probe_config.hpp"
#include "ps_instrumentation.hpp"
#include "ps_storage.hpp"
#include "simulation/corpus_runner.hpp"

#include <sys/stat.h>

namespace ps_probe {
namespace {

bool bundle_exists(const char* path) {
    struct stat bundle_stat {};
    return stat(path, &bundle_stat) == 0 && S_ISREG(bundle_stat.st_mode);
}

const char* resolve_corpus_bundle_path() {
    if (bundle_exists(kSdSimulationCorpusBundle)) {
        return kSdSimulationCorpusBundle;
    }
    if (mount_flash_storage() == ESP_OK && bundle_exists(kFlashSimulationCorpusBundle)) {
        return kFlashSimulationCorpusBundle;
    }
    return nullptr;
}

} // namespace

bool simulation_corpus_bundle_available() {
    return resolve_corpus_bundle_path() != nullptr;
}

void run_simulation_corpus_if_available() {
    const char* bundle_path = resolve_corpus_bundle_path();
    if (bundle_path == nullptr) {
        emit_phase_result(
            Phase::SimulationCorpus,
            "pass",
            "bundle_missing",
            0);
        return;
    }

    PhaseTimer timer(Phase::SimulationCorpus);
    const puzzlescript::simulation::CorpusSummary summary =
        puzzlescript::simulation::runCorpusNdjsonFile(bundle_path);
    const std::string json = puzzlescript::simulation::corpusSummaryToJson(summary);
    emit_json_event(json.c_str());

    if (summary.failed > 0 || summary.cases == 0) {
        emit_phase_result(
            Phase::SimulationCorpus,
            "fail",
            summary.first_error.empty() ? "corpus_failed" : summary.first_error.c_str(),
            timer.elapsed_ms());
        return;
    }

    emit_phase_result(
        Phase::SimulationCorpus,
        "pass",
        bundle_path,
        timer.elapsed_ms());
}

} // namespace ps_probe
