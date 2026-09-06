#undef NDEBUG
#include "search/evaluation_cache.hpp"
#include "search/difficulty.hpp"
#include <atomic>
#include <cassert>
#include <future>
#include <stdexcept>
#include <thread>

// Deliberately collide every key: correctness must come from exact equality.
struct CollisionHash { size_t operator()(int) const { return 0; } };
using Cache = puzzlescript::search::EvaluationCache<int, int, CollisionHash>;
using Stats = puzzlescript::search::DifficultyCacheStats;
auto live = [] { return false; };
auto retain = [](int value) { return value >= 0; };
auto bytes = [](int, int) -> size_t { return 16; };

int main() {
    Cache cache(2, 32);
    int calls = 0;
    auto get = [&](int key) { return cache.get(key, [&] { ++calls; return key; }, live, retain, bytes); };
    assert(get(1) == 1 && get(2) == 2 && get(1) == 1 && calls == 2);
    assert(get(3) == 3 && get(1) == 1 && calls == 3); // LRU evicts 2.
    assert(get(2) == 2 && calls == 4);
    assert(cache.stats<Stats>().entries == 2 && cache.stats<Stats>().retainedBytes == 32);
    for (int i = 0; i < 2; ++i)
        assert(cache.get(8, [&] { ++calls; return -1; }, live, retain, bytes) == -1);
    assert(calls == 6); // Unknown results stay retryable even at the same budget.
    Cache tiny(10, 15);
    tiny.get(1, [] { return 1; }, live, retain, bytes);
    assert(tiny.stats<Stats>().entries == 0 && tiny.stats<Stats>().retainedBytes == 0);

    Cache concurrent(8, 128);
    std::promise<void> entered, release;
    auto released = release.get_future().share();
    std::atomic<int> searches{0};
    auto compute = [&] { if (++searches == 1) entered.set_value(); released.wait(); return 42; };
    auto owner = std::async(std::launch::async, [&] { return concurrent.get(1, compute, live, retain, bytes); });
    entered.get_future().wait();
    std::vector<std::future<int>> followers;
    for (int i = 0; i < 7; ++i)
        followers.push_back(std::async(std::launch::async, [&] { return concurrent.get(1, compute, live, retain, bytes); }));
    while (concurrent.stats<Stats>().waits == 0) std::this_thread::yield();
    release.set_value();
    assert(owner.get() == 42);
    for (auto& follower : followers) assert(follower.get() == 42);
    assert(searches == 1 && concurrent.stats<Stats>().hits == 7);

    // An independently cancelled waiter returns without cancelling the owner.
    Cache cancellation(4, 64);
    std::promise<void> started, finish;
    auto finished = finish.get_future().share();
    std::atomic<bool> cancelWaiter{false}, cancelOwner{false};
    auto pending = std::async(std::launch::async, [&] {
        return cancellation.get(1, [&] { started.set_value(); finished.wait(); return 9; },
                                [&] { return cancelOwner.load(); }, retain, bytes);
    });
    started.get_future().wait();
    auto waiter = std::async(std::launch::async, [&] {
        return cancellation.get(1, [] { return -1; }, [&] { return cancelWaiter.load(); }, retain, bytes);
    });
    while (cancellation.stats<Stats>().waits == 0) std::this_thread::yield();
    cancelWaiter = true;
    assert(waiter.wait_for(std::chrono::seconds(1)) == std::future_status::ready && waiter.get() == -1);
    auto retry = std::async(std::launch::async, [&] {
        return cancellation.get(1, [] { return 17; }, live, retain, bytes);
    });
    cancelOwner = true;
    finish.set_value();
    assert(pending.get() == 9 && retry.get() == 17);
    assert(cancellation.get(1, [] { return 0; }, live, retain, bytes) == 17);

    // Exceptions release pending slots; future callers can retry normally.
    try {
        cancellation.get(2, []() -> int { throw std::runtime_error("failure"); }, live, retain, bytes);
        assert(false);
    } catch (const std::runtime_error&) {}
    assert(cancellation.get(2, [] { return 2; }, live, retain, bytes) == 2);
}
