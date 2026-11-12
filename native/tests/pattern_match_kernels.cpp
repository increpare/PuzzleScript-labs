// Differential and page-boundary tests for handwritten mask operations.
#include "runtime/pattern_match_kernels.hpp"
#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <iostream>
#include <random>
#include <string>
#include <vector>
#if defined(__unix__) || defined(__APPLE__)
#include <sys/mman.h>
#include <unistd.h>
#endif

using namespace puzzlescript::mask_experiment;

void require(bool ok, const char* message) {
    if (!ok) { std::cerr << message << '\n'; std::exit(1); }
}

template <typename Word>
void compare(const Word* actual, const Word* required, const Word* forbidden, size_t count) {
    bool expected = true;
    // Independent reference: no fused accumulation or fixed-width dispatch.
    for (size_t i = 0; i < count; ++i) {
        if (required && (actual[i] & required[i]) != required[i]) expected = false;
        if (forbidden && (actual[i] & forbidden[i]) != 0) expected = false;
    }
    require(matches<Kernel::Original>(actual, required, forbidden, count) == expected, "original mismatch");
    require(matches<Kernel::Cpp>(actual, required, forbidden, count) == expected, "C++ mismatch");
    require(matches<Kernel::Neon>(actual, required, forbidden, count) == expected, "NEON mismatch");
    require(matches<Kernel::Assembly>(actual, required, forbidden, count) == expected, "assembly mismatch");
    require(matches<Kernel::EarlyAssembly>(actual, required, forbidden, count) == expected, "early assembly mismatch");
    require(matches<Kernel::CompilerCopy>(actual, required, forbidden, count) == expected, "compiler copy mismatch");
    require(matches<Kernel::AssemblyLoop>(actual, required, forbidden, count) == expected, "assembly loop mismatch");
    require(matches<Kernel::ReadOnlyLoop>(actual, required, forbidden, count) == expected, "readonly assembly loop mismatch");
}

template <typename Word>
void differential() {
    std::mt19937_64 random(0x6d61736b);
    for (size_t count = 0; count <= 33; ++count) {
        // One-word offsets also exercise 128-bit-unaligned loads.
        std::vector<Word> a(count + 1), r(count + 1), f(count + 1);
        for (int trial = 0; trial < 2500; ++trial) {
            for (size_t i = 0; i <= count; ++i) {
                a[i] = static_cast<Word>(random());
                r[i] = static_cast<Word>(random()) & a[i];
                f[i] = static_cast<Word>(random()) & ~a[i];
            }
            const size_t shift = trial % 2;
            auto* actual = a.data() + shift;
            auto* required = r.data() + shift;
            auto* forbidden = f.data() + shift;
            if (trial % 100 == 0) {
                compare(actual, actual, static_cast<Word*>(nullptr), count);
                compare(actual, static_cast<Word*>(nullptr), actual, count);
                compare(actual, actual, actual, count);
            }
            for (unsigned flags = 0; flags < 4; ++flags) {
                const auto* present = flags & 1 ? required : nullptr;
                const auto* missing = flags & 2 ? forbidden : nullptr;
                compare(actual, present, missing, count); // Successful match.
                if (count) {
                    const size_t word = static_cast<size_t>(trial) % count;
                    const Word saved = actual[word];
                    // Check every bit, including sign bits, over the trials.
                    using U = std::make_unsigned_t<Word>;
                    actual[word] ^= static_cast<Word>(U{1} << (trial % (8 * sizeof(Word))));
                    compare(actual, present, missing, count);
                    actual[word] = saved;
                }
            }
        }
    }
    // No masks must not dereference even a null cell pointer.
    compare<Word>(nullptr, nullptr, nullptr, 0);
}

void pageBoundaries() {
#if defined(__unix__) || defined(__APPLE__)
    const size_t page = static_cast<size_t>(sysconf(_SC_PAGESIZE));
    std::vector<void*> allocations;
    for (int i = 0; i < 3; ++i) {
        void* ptr = mmap(nullptr, page * 2, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0);
        require(ptr != MAP_FAILED, "mmap failed");
        require(mprotect(static_cast<char*>(ptr) + page, page, PROT_NONE) == 0, "mprotect failed");
        allocations.push_back(ptr);
    }
    for (size_t count = 0; count <= 33; ++count) {
        auto* a = reinterpret_cast<uint64_t*>(static_cast<char*>(allocations[0]) + page) - count;
        auto* r = reinterpret_cast<uint64_t*>(static_cast<char*>(allocations[1]) + page) - count;
        auto* f = reinterpret_cast<uint64_t*>(static_cast<char*>(allocations[2]) + page) - count;
        for (size_t w = 0; w < count; ++w) { a[w] = 0xabcdef1234567890; r[w] = a[w]; f[w] = ~a[w]; }
        for (unsigned flags = 0; flags < 4; ++flags) {
            compare(a, flags & 1 ? r : nullptr, flags & 2 ? f : nullptr, count);
            for (size_t w = 0; w < count; ++w) {
                a[w] ^= 1;
                compare(a, flags & 1 ? r : nullptr, flags & 2 ? f : nullptr, count);
                a[w] ^= 1;
            }
        }
    }
    for (void* ptr : allocations) require(munmap(ptr, page * 2) == 0, "munmap failed");
#endif
}

template <Kernel Backend>
uint64_t batch(const std::vector<uint64_t>& cells, const uint64_t* required,
               const uint64_t* forbidden, size_t words) {
    uint64_t sum = 0;
    for (size_t i = 0; i < cells.size(); i += words)
        sum += matches<Backend>(cells.data() + i, required, forbidden, words);
    return sum;
}

template <Kernel Backend>
void measure(const char* name, const std::vector<uint64_t>& cells,
             const uint64_t* required, const uint64_t* forbidden,
             size_t words, const char* scenario, unsigned flags) {
    std::vector<double> samples;
    uint64_t checksum = 0;
    constexpr size_t repeats = 200;
    for (int trial = 0; trial < 5; ++trial) {
        const auto start = std::chrono::steady_clock::now();
        for (size_t r = 0; r < repeats; ++r) {
#if defined(__clang__) || defined(__GNUC__)
            asm volatile("" : : "r" (cells.data()) : "memory");
#endif
            checksum += batch<Backend>(cells, required, forbidden, words);
        }
        const double ns = std::chrono::duration<double, std::nano>(std::chrono::steady_clock::now() - start).count();
        samples.push_back(ns / (repeats * cells.size() / words));
    }
    const uint64_t expected = batch<Kernel::Original>(cells, required, forbidden, words) * repeats * 5;
    require(checksum == expected, "benchmark checksum mismatch");
    std::sort(samples.begin(), samples.end());
    std::cout << "{\"kernel\":\"" << name << "\",\"words\":" << words
              << ",\"scenario\":\"" << scenario << "\",\"flags\":" << flags
              << ",\"ns_per_cell\":" << samples[2] << ",\"checksum\":" << checksum << "}\n";
}

void benchmark() {
    for (size_t words : {1, 2, 4, 5, 8, 9, 16}) {
        for (const std::string scenario : {"match", "reject-first", "reject-last", "mixed"}) {
            std::vector<uint64_t> cells(2048 * words, 0), required(words, 0), forbidden(words, 0);
            const size_t testedWord = scenario == "reject-first" ? 0 : words - 1;
            required[testedWord] = 1;
            forbidden[testedWord] = 2;
            for (size_t i = 0; i < 2048; ++i) {
                const bool rejected = scenario == "reject-first" || scenario == "reject-last"
                    || (scenario == "mixed" && (i * 0x9e3779b9u % 11 < 5));
                cells[i * words + testedWord] = rejected ? 2 : 1;
            }
            for (unsigned flags = 1; flags < 4; ++flags) {
                const auto* r = flags & 1 ? required.data() : nullptr;
                const auto* f = flags & 2 ? forbidden.data() : nullptr;
                measure<Kernel::Original>("original", cells, r, f, words, scenario.c_str(), flags);
                measure<Kernel::Cpp>("cpp", cells, r, f, words, scenario.c_str(), flags);
                if constexpr (hasArm64) {
                    measure<Kernel::Neon>("neon", cells, r, f, words, scenario.c_str(), flags);
                    measure<Kernel::Assembly>("asm", cells, r, f, words, scenario.c_str(), flags);
                }
            }
        }
    }
}

int main(int argc, char** argv) {
    differential<int32_t>();
    differential<int64_t>();
    pageBoundaries();
    if (argc == 2 && std::string(argv[1]) == "--bench") benchmark();
    else std::cout << "Mask differential and guard-page checks passed; ARM64=" << hasArm64 << '\n';
}
