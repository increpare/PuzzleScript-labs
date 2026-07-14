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
    writeProgressSram(stage, detail);
#else
    (void)stage;
    (void)detail;
#endif
}

extern "C" void ps_gba_perf_vblank() {
#if PS_GBA_PERF_TELEMETRY
    if (gTelemetryEnabled && gProgressStage != 0) logProgress(gProgressStage, gProgressDetail);
#endif
}
