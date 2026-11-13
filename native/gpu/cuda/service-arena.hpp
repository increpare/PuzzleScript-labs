#pragma once
#include <map>

// Host bookkeeping only. During a search, releasing a buffer coalesces offsets;
// it never calls cudaFree/cudaFreeHost and therefore cannot synchronize streams.
struct ByteArena {
    enum Kind {Borrowed,Device,Pinned};
    unsigned char* data=nullptr;size_t capacity=0,used=0,peak=0;Kind kind=Borrowed;
    std::map<size_t,size_t> free;
    ByteArena(size_t bytes,Kind kind):capacity(bytes),kind(kind){
        if(kind==Device)ck(cudaMalloc(reinterpret_cast<void**>(&data),bytes));
        else if(kind==Pinned)ck(cudaHostAlloc(reinterpret_cast<void**>(&data),bytes,cudaHostAllocDefault));
        else throw std::runtime_error("Owned arena kind required");
        free.emplace(0,bytes);
    }
    ByteArena(unsigned char* data,size_t bytes):data(data),capacity(bytes){free.emplace(0,bytes);}
    ~ByteArena(){if(kind==Device)cudaFree(data);else if(kind==Pinned)cudaFreeHost(data);}
    static size_t aligned(size_t bytes){require(bytes&&bytes<=SIZE_MAX-255,"Arena size overflow");return (bytes+255)&~size_t(255);}
    // Preflight the exact allocation order without changing any live leases.
    // Total free bytes alone do not establish that fragmented storage fits.
    bool fits(const std::vector<size_t>& sizes)const{
        auto available=free;
        for(auto bytes:sizes){bytes=aligned(bytes);auto chosen=available.end();for(auto i=available.begin();i!=available.end();++i)if(i->second>=bytes&&(chosen==available.end()||i->second<chosen->second))chosen=i;
            if(chosen==available.end())return false;size_t offset=chosen->first,left=chosen->second-bytes;available.erase(chosen);if(left)available.emplace(offset+bytes,left);
        }return true;
    }
    size_t largest_free()const{size_t result=0;for(const auto& span:free)result=std::max(result,span.second);return result;}
    void* allocate(size_t bytes){bytes=aligned(bytes);auto chosen=free.end();for(auto i=free.begin();i!=free.end();++i)if(i->second>=bytes&&(chosen==free.end()||i->second<chosen->second))chosen=i;
        require(chosen!=free.end(),"Arena slice capacity exceeded");size_t offset=chosen->first,left=chosen->second-bytes;free.erase(chosen);if(left)free.emplace(offset+bytes,left);used+=bytes;peak=std::max(peak,used);return data+offset;
    }
    void release(void* pointer,size_t bytes){bytes=aligned(bytes);auto* p=static_cast<unsigned char*>(pointer);require(p>=data&&size_t(p-data)<=capacity&&bytes<=capacity-size_t(p-data),"Arena pointer outside slice");size_t offset=size_t(p-data);auto next=free.lower_bound(offset);auto prev=next==free.begin()?free.end():std::prev(next);
        require((next==free.end()||offset+bytes<=next->first)&&(prev==free.end()||prev->first+prev->second<=offset)&&used>=bytes,"Arena overlapping/double release");used-=bytes;
        if(prev!=free.end()&&prev->first+prev->second==offset){offset=prev->first;bytes+=prev->second;free.erase(prev);}if(next!=free.end()&&offset+bytes==next->first){bytes+=next->second;free.erase(next);}free.emplace(offset,bytes);
    }
    ByteArena(const ByteArena&)=delete;
};
struct ArenaLease;
struct ServiceArenas {
    ByteArena workspace,frontier,pinned;u32 count;std::vector<bool> busy;
    explicit ServiceArenas(u32 n):workspace(6ull*1024*1024*1024,ByteArena::Device),frontier(2ull*1024*1024*1024,ByteArena::Device),pinned(512ull*1024*1024,ByteArena::Pinned),count(n),busy(n,false){}
    size_t slice(const ByteArena& a)const{return (a.capacity/count)&~size_t(255);}
    std::unique_ptr<ArenaLease> acquire();
};
struct ArenaLease {
    ServiceArenas& owner;u32 index;ByteArena workspace,frontier,pinned;
    ArenaLease(ServiceArenas& a,u32 i):owner(a),index(i),workspace(a.workspace.data+i*a.slice(a.workspace),a.slice(a.workspace)),frontier(a.frontier.data+i*a.slice(a.frontier),a.slice(a.frontier)),pinned(a.pinned.data+i*a.slice(a.pinned),a.slice(a.pinned)){}
    ~ArenaLease(){require(!workspace.used&&!frontier.used&&!pinned.used,"Live buffers remain in returned arena slice");owner.busy[index]=false;}
};
inline std::unique_ptr<ArenaLease> ServiceArenas::acquire(){for(u32 i=0;i<count;i++)if(!busy[i]){auto lease=std::make_unique<ArenaLease>(*this,i);busy[i]=true;return lease;}throw std::runtime_error("No free GPU arena context slice");}
