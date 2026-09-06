#pragma once

#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <list>
#include <mutex>
#include <unordered_map>

namespace puzzlescript::search {

// Exact equality resolves hash collisions. Pending entries coalesce identical
// searches, but cancellation belongs to each caller: a stopped owner releases
// the slot and a live waiter retries with its own budget. Solver work and user
// callbacks always run outside the cache lock.
template<class Key, class Value, class Hash>
class EvaluationCache {
    struct Entry {
        std::condition_variable changed;
        bool pending = true;
        std::shared_ptr<const Value> value;
        size_t bytes = 0;
        typename std::list<const Key*>::iterator position;
    };
    std::mutex mutex_;
    std::unordered_map<Key, std::shared_ptr<Entry>, Hash> entries_;
    std::list<const Key*> recent_;
    size_t maxEntries_, maxBytes_, bytes_ = 0;
    uint64_t hits_ = 0, searches_ = 0, waits_ = 0;

    bool evictOne() {
        // Keep an explicit LRU list so steady-state insertion does not scan
        // thousands of retained boards each time the bounded cache fills.
        if (recent_.empty()) return false;
        auto oldest = entries_.find(*recent_.front());
        recent_.pop_front();
        bytes_ -= oldest->second->bytes;
        entries_.erase(oldest);
        return true;
    }
public:
    EvaluationCache(size_t maxEntries, size_t maxBytes)
        : maxEntries_(maxEntries), maxBytes_(maxBytes) {}

    template<class Compute, class Stop, class Retain, class Size>
    Value get(const Key& key, Compute compute, Stop stopped, Retain retain, Size size) {
        std::shared_ptr<Entry> entry;
        {
            std::unique_lock<std::mutex> lock(mutex_);
            for (;;) {
                lock.unlock();
                const bool stop = stopped();
                lock.lock();
                if (stop) { lock.unlock(); return compute(); }
                auto found = entries_.find(key);
                if (found == entries_.end()) break;
                entry = found->second;
                if (!entry->pending && entry->value) {
                    ++hits_;
                    recent_.splice(recent_.end(), recent_, entry->position);
                    auto value = entry->value;
                    lock.unlock();
                    return *value;
                }
                ++waits_;
                // Short waits let a cancelled UI request leave independently
                // while another request continues to own the actual search.
                entry->changed.wait_for(lock, std::chrono::milliseconds(5),
                                        [&] { return !entry->pending; });
            }
            ++searches_;
            while (maxEntries_ && entries_.size() >= maxEntries_ && evictOne()) {}
            if (!maxEntries_ || !maxBytes_ || entries_.size() >= maxEntries_) {
                lock.unlock();
                return compute(); // Capacity occupied by live work: no unbounded queue.
            }
            entry = std::make_shared<Entry>();
            entries_.emplace(key, entry);
        }
        auto release = [&] {
            std::lock_guard<std::mutex> lock(mutex_);
            if (entry->value) {
                recent_.erase(entry->position);
                bytes_ -= entry->bytes;
            }
            entries_.erase(key);
            entry->pending = false;
            entry->changed.notify_all();
        };
        try {
            Value result = compute();
            const bool keep = !stopped() && retain(result);
            const size_t cost = size(key, result);
            auto stored = keep && cost <= maxBytes_ ? std::make_shared<Value>(result) : nullptr;
            std::lock_guard<std::mutex> lock(mutex_);
            if (stored) {
                while (bytes_ > maxBytes_ - cost && evictOne()) {}
                recent_.push_back(&entries_.find(key)->first);
                entry->position = std::prev(recent_.end());
                entry->value = std::move(stored);
                entry->bytes = cost;
                bytes_ += cost;
            } else {
                entries_.erase(key);
            }
            entry->pending = false;
            entry->changed.notify_all();
            return result;
        } catch (...) {
            release();
            throw;
        }
    }

    template<class Stats> Stats stats() {
        std::lock_guard<std::mutex> lock(mutex_);
        return Stats{hits_, searches_, waits_, entries_.size(), bytes_};
    }
};
} // namespace puzzlescript::search
