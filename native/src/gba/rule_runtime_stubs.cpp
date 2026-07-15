#include "gba/perf_telemetry.hpp"
#include "runtime/core.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstdlib>

#ifndef PS_GBA_PERF_TELEMETRY
#define PS_GBA_PERF_TELEMETRY 0
#endif

#if PS_GBA_PERF_TELEMETRY
#include <sys/unistd.h>
#endif

namespace {

#if PS_GBA_PERF_TELEMETRY
constexpr uintptr_t kTimer2Data = 0x04000108;
constexpr uintptr_t kTimer3Data = 0x0400010c;
constexpr uintptr_t kMgbaDebugBuffer = 0x04fff600;
constexpr uintptr_t kMgbaDebugFlags = 0x04fff700;
constexpr uintptr_t kMgbaDebugEnable = 0x04fff780;
constexpr uintptr_t kSramProgress = 0x0e000080;
constexpr uint32_t kProgressMagic = 0x47505350U; // "PSPG"
constexpr size_t kRuntimeCounterCount =
    static_cast<size_t>(puzzlescript::RuntimeCounterId::MovementAnchorRuntimeMaskBuilds) + 1U;

uint64_t gRuntimeCounters[kRuntimeCounterCount]{};
bool gTelemetryEnabled = false;
uint32_t gAllocationCalls = 0;
uint32_t gAllocationBytes = 0;
uint32_t gDeallocationCalls = 0;
uintptr_t gHeapBaseline = 0;
uintptr_t gHeapHighWater = 0;
uint32_t gProgressStage = 0;
uint32_t gProgressDetail = 0;
uint32_t gProgressHeartbeatFrames = 0;
constexpr size_t kPerfGroupSlots = 32;
struct PerfGroupStat {
    uint64_t cycles = 0;
    uint32_t calls = 0;
    uint32_t sourceLine = 0;
    uint16_t group = 0;
    uint8_t phase = 0;
    uint8_t probe = 0;
};
#if defined(__GNUC__) && defined(__arm__)
PerfGroupStat gPerfGroups[kPerfGroupSlots] __attribute__((section(".ewram"))) {};
#else
PerfGroupStat gPerfGroups[kPerfGroupSlots]{};
#endif
bool gPerfProbe = false;
uint64_t gPerfRebuildCycles = 0;
uint32_t gPerfRebuildCalls = 0;

uint32_t timerCycles() {
    uint32_t highBefore = *reinterpret_cast<volatile uint16_t*>(kTimer3Data);
    uint32_t low = *reinterpret_cast<volatile uint16_t*>(kTimer2Data);
    const uint32_t highAfter = *reinterpret_cast<volatile uint16_t*>(kTimer3Data);
    if (highBefore != highAfter) {
        highBefore = highAfter;
        low = *reinterpret_cast<volatile uint16_t*>(kTimer2Data);
    }
    return (highBefore << 16U) | low;
}

void appendHex(char*& destination, uint32_t value) {
    static constexpr char kHex[] = "0123456789abcdef";
    for (unsigned digit = 8; digit > 0; --digit) {
        *destination++ = kHex[(value >> ((digit - 1U) * 4U)) & 0x0fU];
    }
}

void logProgress(uint32_t stage, uint32_t detail) {
    auto& debugEnable = *reinterpret_cast<volatile uint16_t*>(kMgbaDebugEnable);
    debugEnable = 0xc0de;
    if (debugEnable != 0x1dea) return;
    char* cursor = reinterpret_cast<char*>(kMgbaDebugBuffer);
    const char prefix[] = "PS_GBA_PROGRESS,";
    for (char ch : prefix) if (ch != '\0') *cursor++ = ch;
    appendHex(cursor, stage);
    *cursor++ = ',';
    appendHex(cursor, detail);
    *cursor = '\0';
    *reinterpret_cast<volatile uint16_t*>(kMgbaDebugFlags) = 0x102;
}

void logGroup(uint32_t probe, uint32_t phase, uint32_t group, const PerfGroupStat& stat) {
    auto& debugEnable = *reinterpret_cast<volatile uint16_t*>(kMgbaDebugEnable);
    debugEnable = 0xc0de;
    if (debugEnable != 0x1dea) return;
    char* cursor = reinterpret_cast<char*>(kMgbaDebugBuffer);
    const char prefix[] = "PS_GBA_GROUP,";
    for (char ch : prefix) if (ch != '\0') *cursor++ = ch;
    appendHex(cursor, 1); *cursor++ = ',';
    appendHex(cursor, probe); *cursor++ = ',';
    appendHex(cursor, phase); *cursor++ = ',';
    appendHex(cursor, group); *cursor++ = ',';
    appendHex(cursor, stat.sourceLine); *cursor++ = ',';
    appendHex(cursor, stat.calls); *cursor++ = ',';
    appendHex(cursor, static_cast<uint32_t>(stat.cycles >> 32U));
    appendHex(cursor, static_cast<uint32_t>(stat.cycles));
    *cursor = '\0';
    *reinterpret_cast<volatile uint16_t*>(kMgbaDebugFlags) = 0x102;
}

void writeProgressSram(uint32_t stage, uint32_t detail) {
    auto* sram = reinterpret_cast<volatile uint8_t*>(kSramProgress);
    for (size_t byte = 0; byte < 4; ++byte) sram[4 + byte] = static_cast<uint8_t>(stage >> (byte * 8U));
    for (size_t byte = 0; byte < 4; ++byte) sram[8 + byte] = static_cast<uint8_t>(detail >> (byte * 8U));
    for (size_t byte = 0; byte < 4; ++byte) sram[byte] = static_cast<uint8_t>(kProgressMagic >> (byte * 8U));
}

uint32_t counter32(puzzlescript::RuntimeCounterId id) {
    return static_cast<uint32_t>(gRuntimeCounters[static_cast<size_t>(id)]);
}

void noteHeapHighWater() {
    const uintptr_t current = reinterpret_cast<uintptr_t>(sbrk(0));
    if (current > gHeapHighWater) gHeapHighWater = current;
}

void noteAllocation(size_t size) {
    if (!gTelemetryEnabled) return;
    ++gAllocationCalls;
    const uint64_t total = static_cast<uint64_t>(gAllocationBytes) + size;
    gAllocationBytes = static_cast<uint32_t>(std::min<uint64_t>(total, 0xffffffffULL));
    noteHeapHighWater();
}

#endif

} // namespace

#if PS_GBA_PERF_TELEMETRY
void* operator new(std::size_t size) {
    void* result = std::malloc(size == 0 ? 1 : size);
    if (result == nullptr) std::abort();
    noteAllocation(size);
    return result;
}

void* operator new[](std::size_t size) {
    return ::operator new(size);
}

void operator delete(void* memory) noexcept {
    if (gTelemetryEnabled && memory != nullptr) ++gDeallocationCalls;
    std::free(memory);
}

void operator delete[](void* memory) noexcept {
    ::operator delete(memory);
}

void operator delete(void* memory, std::size_t) noexcept {
    ::operator delete(memory);
}

void operator delete[](void* memory, std::size_t) noexcept {
    ::operator delete(memory);
}
#endif

namespace puzzlescript {

bool runtimeCountersEnabled() {
#if PS_GBA_PERF_TELEMETRY
    return gTelemetryEnabled;
#else
    return false;
#endif
}

uint64_t runtimeCounterNowNs() {
#if PS_GBA_PERF_TELEMETRY
    return timerCycles();
#else
    return 0;
#endif
}

void addRuntimeCounter(RuntimeCounterId id, uint64_t amount) {
#if PS_GBA_PERF_TELEMETRY
    if (!gTelemetryEnabled) return;
    const size_t index = static_cast<size_t>(id);
    if (index < kRuntimeCounterCount) gRuntimeCounters[index] += amount;
#else
    (void)id;
    (void)amount;
#endif
}

bool inputSpecializationEnabled() {
    return true;
}

uint8_t inputSpecializationMaskForDirectionMask(int32_t directionMask) {
    switch (directionMask) {
        case 1: return 1U << 0;
        case 4: return 1U << 1;
        case 2: return 1U << 2;
        case 8: return 1U << 3;
        case 16: return 1U << 4;
        default: return 1U << 5;
    }
}

} // namespace puzzlescript

extern "C" void ps_gba_perf_begin() {
#if PS_GBA_PERF_TELEMETRY
    std::fill(gRuntimeCounters, gRuntimeCounters + kRuntimeCounterCount, uint64_t{0});
    gAllocationCalls = 0;
    gAllocationBytes = 0;
    gDeallocationCalls = 0;
    gHeapBaseline = reinterpret_cast<uintptr_t>(sbrk(0));
    gHeapHighWater = gHeapBaseline;
    gProgressStage = 0;
    gProgressDetail = 0;
    gProgressHeartbeatFrames = 0;
    for (auto& group : gPerfGroups) group = PerfGroupStat{};
    gPerfProbe = false;
    gPerfRebuildCycles = 0;
    gPerfRebuildCalls = 0;
    gTelemetryEnabled = true;
    writeProgressSram(0, 0);
#endif
}

extern "C" void ps_gba_perf_end(ps_gba_perf_snapshot* snapshot) {
#if PS_GBA_PERF_TELEMETRY
    if (snapshot == nullptr) return;
    noteHeapHighWater();
    gTelemetryEnabled = false;
    snapshot->setup_cycles = gRuntimeCounters[static_cast<size_t>(puzzlescript::RuntimeCounterId::CompactTurnSetupNs)];
    snapshot->early_rules_cycles = gRuntimeCounters[static_cast<size_t>(puzzlescript::RuntimeCounterId::CompactTurnEarlyRulesNs)];
    snapshot->movement_cycles = gRuntimeCounters[static_cast<size_t>(puzzlescript::RuntimeCounterId::CompactTurnMovementNs)];
    snapshot->late_rules_cycles = gRuntimeCounters[static_cast<size_t>(puzzlescript::RuntimeCounterId::CompactTurnLateRulesNs)];
    snapshot->win_cycles = gRuntimeCounters[static_cast<size_t>(puzzlescript::RuntimeCounterId::CompactTurnWinNs)];
    snapshot->canonicalize_cycles = gRuntimeCounters[static_cast<size_t>(puzzlescript::RuntimeCounterId::CompactTurnCanonicalizeNs)];
    snapshot->again_probe_cycles = gRuntimeCounters[static_cast<size_t>(puzzlescript::RuntimeCounterId::CompactTurnAgainProbeNs)];
    snapshot->again_probe_calls = counter32(puzzlescript::RuntimeCounterId::CompactTurnAgainProbeCalls);
    snapshot->rebuild_cycles = gPerfRebuildCycles;
    snapshot->rebuild_calls = gPerfRebuildCalls;
    snapshot->allocation_calls = gAllocationCalls;
    snapshot->allocation_bytes = gAllocationBytes;
    snapshot->deallocation_calls = gDeallocationCalls;
    snapshot->heap_growth_bytes = gHeapHighWater > gHeapBaseline
        ? static_cast<uint32_t>(std::min<uintptr_t>(gHeapHighWater - gHeapBaseline, 0xffffffffU))
        : 0;
    snapshot->rules_visited = counter32(puzzlescript::RuntimeCounterId::RulesVisited);
    snapshot->candidate_cells_tested = counter32(puzzlescript::RuntimeCounterId::CandidateCellsTested);
    snapshot->replacements_attempted = counter32(puzzlescript::RuntimeCounterId::ReplacementsAttempted);
    snapshot->replacements_applied = counter32(puzzlescript::RuntimeCounterId::ReplacementsApplied);
    snapshot->row_scans = counter32(puzzlescript::RuntimeCounterId::RowScans);
    snapshot->ellipsis_scans = counter32(puzzlescript::RuntimeCounterId::EllipsisScans);
    snapshot->progress_stage = gProgressStage;
    snapshot->progress_detail = gProgressDetail;
#else
    (void)snapshot;
#endif
}

extern "C" void ps_gba_perf_progress(uint32_t stage, uint32_t detail) {
#if PS_GBA_PERF_TELEMETRY
    if (!gTelemetryEnabled) return;
    gProgressStage = stage;
    gProgressDetail = detail;
    gProgressHeartbeatFrames = 0;
    writeProgressSram(stage, detail);
#else
    (void)stage;
    (void)detail;
#endif
}

extern "C" void ps_gba_perf_vblank() {
#if PS_GBA_PERF_TELEMETRY
    if (gTelemetryEnabled && gProgressStage != 0 && ++gProgressHeartbeatFrames >= 60) {
        gProgressHeartbeatFrames = 0;
        logProgress(gProgressStage, gProgressDetail);
    }
#endif
}

extern "C" void ps_gba_perf_set_probe(bool probe) {
#if PS_GBA_PERF_TELEMETRY
    gPerfProbe = probe;
#else
    (void)probe;
#endif
}

extern "C" uint32_t ps_gba_perf_group_begin() {
#if PS_GBA_PERF_TELEMETRY
    return gTelemetryEnabled ? timerCycles() : 0;
#else
    return 0;
#endif
}

extern "C" uint32_t ps_gba_perf_rebuild_begin() {
#if PS_GBA_PERF_TELEMETRY
    return gTelemetryEnabled ? timerCycles() : 0;
#else
    return 0;
#endif
}

extern "C" void ps_gba_perf_rebuild_end(uint32_t startCycles) {
#if PS_GBA_PERF_TELEMETRY
    if (!gTelemetryEnabled || startCycles == 0) return;
    gPerfRebuildCycles += static_cast<uint32_t>(timerCycles() - startCycles);
    ++gPerfRebuildCalls;
#else
    (void)startCycles;
#endif
}

extern "C" void ps_gba_perf_group_end(
    uint32_t phase, uint32_t group, uint32_t sourceLine, uint32_t startCycles) {
#if PS_GBA_PERF_TELEMETRY
    if (!gTelemetryEnabled || startCycles == 0 || group > 0xffffU) return;
    const uint32_t elapsed = static_cast<uint32_t>(timerCycles() - startCycles);
    const uint8_t probe = gPerfProbe ? 1U : 0U;
    PerfGroupStat* stat = nullptr;
    PerfGroupStat* smallest = &gPerfGroups[0];
    for (auto& candidate : gPerfGroups) {
        if (candidate.calls != 0 && candidate.probe == probe
            && candidate.phase == phase && candidate.group == group) {
            stat = &candidate;
            break;
        }
        if (candidate.calls == 0) {
            stat = &candidate;
            break;
        }
        if (candidate.cycles < smallest->cycles) smallest = &candidate;
    }
    if (stat == nullptr) {
        if (elapsed <= smallest->cycles) return;
        stat = smallest;
        *stat = PerfGroupStat{};
    }
    stat->cycles += elapsed;
    ++stat->calls;
    stat->sourceLine = sourceLine;
    stat->group = static_cast<uint16_t>(group);
    stat->phase = static_cast<uint8_t>(phase);
    stat->probe = probe;
#else
    (void)phase; (void)group; (void)sourceLine; (void)startCycles;
#endif
}

extern "C" void ps_gba_perf_write_group_log() {
#if PS_GBA_PERF_TELEMETRY
    for (const PerfGroupStat& stat : gPerfGroups) {
        if (stat.calls != 0) logGroup(stat.probe, stat.phase, stat.group, stat);
    }
#endif
}
