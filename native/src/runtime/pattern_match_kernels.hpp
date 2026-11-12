#pragma once

// Opt-in profiling experiment. Keep the ordinary interpreter independent of
// these kernels unless PS_PATTERN_MATCH_KERNEL is explicitly selected.
#include <cstddef>
#include <cstdint>
#include <type_traits>

#if defined(__aarch64__) && (defined(__clang__) || defined(__GNUC__))
#include <arm_neon.h>
#define PS_PATTERN_MATCH_ARM64 1
#else
#define PS_PATTERN_MATCH_ARM64 0
#endif

#if defined(_MSC_VER)
#define PS_MASK_INLINE __forceinline
#else
#define PS_MASK_INLINE inline __attribute__((always_inline))
#endif

namespace puzzlescript::mask_experiment {

enum class Kernel { Original, Cpp, Neon, Assembly, EarlyAssembly, CompilerCopy, AssemblyLoop, ReadOnlyLoop = 9 };
inline constexpr bool hasArm64 = PS_PATTERN_MATCH_ARM64;

// This is the scalar predicate emitted by Clang -O3 for the existing loop:
// BICS/TST followed by a conditional branch. Flag outputs are a comparison
// point; Clang may still materialize the flags when integrating this inline.
template <bool Required, typename Word>
PS_MASK_INLINE bool earlyWord(Word actual, Word mask) {
#if PS_PATTERN_MATCH_ARM64
    bool ok;
    if constexpr (sizeof(Word) == 8) {
        if constexpr (Required)
            asm("bics xzr, %1, %2" : "=@cceq" (ok) : "r" (mask), "r" (actual));
        else
            asm("tst %1, %2" : "=@cceq" (ok) : "r" (mask), "r" (actual));
    } else {
        if constexpr (Required)
            asm("bics wzr, %w1, %w2" : "=@cceq" (ok) : "r" (mask), "r" (actual));
        else
            asm("tst %w1, %w2" : "=@cceq" (ok) : "r" (mask), "r" (actual));
    }
    return ok;
#else
    if constexpr (Required) return (actual & mask) == mask;
    return (actual & mask) == 0;
#endif
}

#if defined(__clang__)
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wvla-extension"
#endif
// The bounded GNU array operand describes exactly the bytes read by ASM.
// It is a type only: it allocates no variable-length array. This avoids a
// global memory clobber, which otherwise invalidates unrelated cached loads.
template <bool Required, bool ReadOnly = false, typename Word>
PS_MASK_INLINE bool earlyLoop(const Word* actual, const Word* mask, size_t count) {
#if PS_PATTERN_MATCH_ARM64
    if constexpr (sizeof(Word) == 8) {
        uint64_t value, bits;
        uint32_t ok;
#define PS_MASK_LOOP_TEXT(TEST, GUARD) \
            "mov %w[ok], #1\n\t" GUARD \
            "1:\n\tldr %[value], [%[actual]], #8\n\tldr %[bits], [%[mask]], #8\n\t" \
            TEST "\n\tb.ne 3f\n\tsubs %[count], %[count], #1\n\tb.ne 1b\n\tb 2f\n" \
            "3:\n\tmov %w[ok], #0\n2:"
#define PS_MASK_LOOP_OUTPUTS \
            [ok] "=&r" (ok), [value] "=&r" (value), [bits] "=&r" (bits), \
            [actual] "+&r" (actual), [mask] "+&r" (mask), [count] "+&r" (count)
#define PS_MASK_LOOP(TEST) \
        if constexpr (ReadOnly) { \
            if (count == 0) return true; \
            __extension__ typedef const Word ReadMemory[count]; \
            asm(PS_MASK_LOOP_TEXT(TEST, "") : PS_MASK_LOOP_OUTPUTS \
                : "m" (*reinterpret_cast<const ReadMemory*>(actual)), \
                  "m" (*reinterpret_cast<const ReadMemory*>(mask)) : "cc"); \
        } else { \
            asm(PS_MASK_LOOP_TEXT(TEST, "cbz %[count], 2f\n") : PS_MASK_LOOP_OUTPUTS : : "cc", "memory"); \
        }
        if constexpr (Required) { PS_MASK_LOOP("bics xzr, %[bits], %[value]"); }
        else { PS_MASK_LOOP("tst %[bits], %[value]"); }
#undef PS_MASK_LOOP
#undef PS_MASK_LOOP_OUTPUTS
#undef PS_MASK_LOOP_TEXT
        return ok != 0;
    }
#endif
    for (size_t w = 0; w < count; ++w) {
        if constexpr (Required) { if ((actual[w] & mask[w]) != mask[w]) return false; }
        else { if ((actual[w] & mask[w]) != 0) return false; }
    }
    return true;
}
#if defined(__clang__)
#pragma clang diagnostic pop
#endif

template <bool Required, bool Forbidden, typename Word>
PS_MASK_INLINE bool original(const Word* actual, const Word* required,
                            const Word* forbidden, size_t count) {
    if constexpr (Required) {
        for (size_t w = 0; w < count; ++w)
            if ((actual[w] & required[w]) != required[w]) return false;
    }
    if constexpr (Forbidden) {
        for (size_t w = 0; w < count; ++w)
            if ((actual[w] & forbidden[w]) != 0) return false;
    }
    return true;
}

template <bool Required, bool Forbidden, typename Word>
PS_MASK_INLINE bool fusedCpp(const Word* actual, const Word* required,
                            const Word* forbidden, size_t count) {
    using Unsigned = std::make_unsigned_t<Word>;
    Unsigned bad = 0;
    for (size_t w = 0; w < count; ++w) {
        const Unsigned value = static_cast<Unsigned>(actual[w]);
        if constexpr (Required) bad |= static_cast<Unsigned>(required[w]) & ~value;
        if constexpr (Forbidden) bad |= static_cast<Unsigned>(forbidden[w]) & value;
    }
    return bad == 0;
}

#if PS_PATTERN_MATCH_ARM64
// All input loads are expressed in C++ so their exact bounds and memory
// dependencies remain visible to the optimizer and AddressSanitizer. Only the
// bit operations/reduction are handwritten; no hardcoded struct offsets/ABI.
template <bool Required, bool Forbidden, typename Word>
PS_MASK_INLINE bool scalarAssembly(const Word* actual, const Word* required,
                                  const Word* forbidden) {
    uint64_t value = static_cast<uint64_t>(*actual), bad;
    if constexpr (Required && Forbidden) {
        asm("bic %[bad], %[required], %[value]\n\t"
            "and %[value], %[value], %[forbidden]\n\t"
            "orr %[bad], %[bad], %[value]"
            : [bad] "=&r" (bad), [value] "+r" (value)
            : [required] "r" (static_cast<uint64_t>(*required)),
              [forbidden] "r" (static_cast<uint64_t>(*forbidden)));
    } else if constexpr (Required) {
        asm("bic %0, %1, %2" : "=r" (bad)
            : "r" (static_cast<uint64_t>(*required)), "r" (value));
    } else if constexpr (Forbidden) {
        asm("and %0, %1, %2" : "=r" (bad)
            : "r" (static_cast<uint64_t>(*forbidden)), "r" (value));
    } else {
        return true;
    }
    return bad == 0;
}

template <Kernel Backend, bool Required, bool Forbidden, typename Word>
PS_MASK_INLINE bool vectorMask(const Word* actual, const Word* required,
                              const Word* forbidden, size_t count) {
    if (count == 1) {
        if constexpr (Backend == Kernel::Assembly)
            return scalarAssembly<Required, Forbidden>(actual, required, forbidden);
        return fusedCpp<Required, Forbidden>(actual, required, forbidden, 1);
    }
    uint64x2_t bad = vdupq_n_u64(0);
    size_t w = 0;
    for (; w + 2 <= count; w += 2) {
        const auto value = vld1q_u64(reinterpret_cast<const uint64_t*>(actual + w));
        uint64x2_t missing = vdupq_n_u64(0), excluded = vdupq_n_u64(0);
        if constexpr (Required)
            missing = vld1q_u64(reinterpret_cast<const uint64_t*>(required + w));
        if constexpr (Forbidden)
            excluded = vld1q_u64(reinterpret_cast<const uint64_t*>(forbidden + w));
        if constexpr (Backend == Kernel::Assembly) {
            uint64x2_t temp;
            if constexpr (Required && Forbidden) {
                // BSL chooses forbidden bits where actual=1, required bits
                // where actual=0: exactly (required & ~actual) | (forbidden & actual).
                temp = value;
                asm("bsl %0.16b, %1.16b, %2.16b"
                    : "+w" (temp) : "w" (excluded), "w" (missing));
            } else if constexpr (Required) {
                asm("bic %0.16b, %1.16b, %2.16b"
                    : "=w" (temp) : "w" (missing), "w" (value));
            } else if constexpr (Forbidden) {
                asm("and %0.16b, %1.16b, %2.16b"
                    : "=w" (temp) : "w" (excluded), "w" (value));
            }
            // Keep accumulation visible so Clang can fold the initial OR
            // with zero and schedule independent vector loads itself.
            bad = vorrq_u64(bad, temp);
        } else {
            if constexpr (Required) bad = vorrq_u64(bad, vbicq_u64(missing, value));
            if constexpr (Forbidden) bad = vorrq_u64(bad, vandq_u64(excluded, value));
        }
    }
    uint32_t reduced;
    if constexpr (Backend == Kernel::Assembly) {
        asm("umaxv b31, %1.16b\n\tumov %w0, v31.b[0]"
            : "=r" (reduced) : "w" (bad) : "v31");
    } else {
        reduced = vmaxvq_u8(vreinterpretq_u8_u64(bad));
    }
    // Odd widths never read the following word, including at a page boundary.
    return reduced == 0 && fusedCpp<Required, Forbidden>(
        actual + w, Required ? required + w : nullptr,
        Forbidden ? forbidden + w : nullptr, count - w);
}
#endif

template <Kernel Backend, bool Required, bool Forbidden, typename Word>
PS_MASK_INLINE bool fixedMask(const Word* actual, const Word* required,
                             const Word* forbidden, size_t count) {
    if constexpr (!Required && !Forbidden) return true;
    if constexpr (Backend == Kernel::Original || Backend == Kernel::CompilerCopy)
        return original<Required, Forbidden>(actual, required, forbidden, count);
    if constexpr (Backend == Kernel::EarlyAssembly) {
        if constexpr (Required)
            for (size_t w = 0; w < count; ++w)
                if (!earlyWord<true>(actual[w], required[w])) return false;
        if constexpr (Forbidden)
            for (size_t w = 0; w < count; ++w)
                if (!earlyWord<false>(actual[w], forbidden[w])) return false;
        return true;
    }
    if constexpr (Backend == Kernel::AssemblyLoop || Backend == Kernel::ReadOnlyLoop) {
        if constexpr (Required) if (!earlyLoop<true, Backend == Kernel::ReadOnlyLoop>(actual, required, count)) return false;
        if constexpr (Forbidden) if (!earlyLoop<false, Backend == Kernel::ReadOnlyLoop>(actual, forbidden, count)) return false;
        return true;
    }
#if PS_PATTERN_MATCH_ARM64
    if constexpr (sizeof(Word) == 8 && (Backend == Kernel::Neon || Backend == Kernel::Assembly))
        return vectorMask<Backend, Required, Forbidden>(actual, required, forbidden, count);
#endif
    return fusedCpp<Required, Forbidden>(actual, required, forbidden, count);
}

template <Kernel Backend, bool Required, bool Forbidden, typename Word>
PS_MASK_INLINE bool sizedMask(const Word* actual, const Word* required,
                             const Word* forbidden, size_t count) {
    if constexpr (Backend == Kernel::Original || Backend == Kernel::CompilerCopy)
        return original<Required, Forbidden>(actual, required, forbidden, count);
    if constexpr (Backend == Kernel::EarlyAssembly || Backend == Kernel::AssemblyLoop || Backend == Kernel::ReadOnlyLoop)
        return fixedMask<Backend, Required, Forbidden>(actual, required, forbidden, count);
    // The same dispatch is used for all fused backends. Keep the compiler's
    // fixed-width unrolling in the comparison, rather than handicapping C++.
    switch (count) {
        case 1: return fixedMask<Backend, Required, Forbidden>(actual, required, forbidden, 1);
        case 2: return fixedMask<Backend, Required, Forbidden>(actual, required, forbidden, 2);
        case 4: return fixedMask<Backend, Required, Forbidden>(actual, required, forbidden, 4);
        default: return fixedMask<Backend, Required, Forbidden>(actual, required, forbidden, count);
    }
}

template <Kernel Backend, typename Word>
PS_MASK_INLINE bool matches(const Word* actual, const Word* required,
                           const Word* forbidden, size_t count) {
    if (required) {
        if (forbidden) return sizedMask<Backend, true, true>(actual, required, forbidden, count);
        return sizedMask<Backend, true, false>(actual, required, forbidden, count);
    }
    if (forbidden) return sizedMask<Backend, false, true>(actual, required, forbidden, count);
    return true;
}

} // namespace puzzlescript::mask_experiment

#undef PS_MASK_INLINE
