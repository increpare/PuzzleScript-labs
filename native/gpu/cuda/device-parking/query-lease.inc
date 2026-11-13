// Query members. A pool owns only a weak reference; a released continuation
// cannot be kept alive by a parked physical slot. Only the GPU owner mutates
// reservation contents. Other threads read immutable accounting and identity.
struct ParkedCheckpoint {
    const uint64_t pool, reserved_bytes;
    const u32 slot, generation, count;
    std::unique_ptr<resident::Checkpoint> reservation;
    std::atomic<bool> device_owned{true};
    std::atomic<double> materialize_ms{0};
    std::string digest;
    ParkedCheckpoint(uint64_t p,u32 s,u32 g,std::unique_ptr<resident::Checkpoint> cp):
      pool(p),reserved_bytes(cp->bytes()),slot(s),generation(g),count(cp->q.count),reservation(std::move(cp)){
        require(!reservation->owned&&reservation->compact_ready,"Invalid parked reservation");
    }
};
std::shared_ptr<ParkedCheckpoint> parked_search;
