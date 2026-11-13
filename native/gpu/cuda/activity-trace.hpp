// Optional diagnostic build only. CUPTI activity timestamps, not hardware counters.
// No interpreter/search behavior is changed. All records are written after service
// shutdown. The trace explicitly fails if records or buffers are lost.
#pragma once
#include <cupti.h>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <unordered_map>
#include <cstdlib>
#include <array>
#include <atomic>
#include <vector>
#include <chrono>
#include <thread>
namespace ps_activity {
struct Event {
 uint64_t start=0,end=0,bytes=0,queued=0,submitted=0;
 uint32_t kind=0,device=0,context=0,stream=0,correlation=0,name=0;
 uint32_t gx=0,gy=0,gz=0,bx=0,by=0,bz=0,registers=0,shared=0,thread=0,cbid=0,result=0;
};
class Recorder {
 static constexpr size_t record_capacity=4000000,buffer_size=1u<<20,buffer_capacity=512;
 static constexpr uint32_t flush_period_ms=50;
 inline static std::atomic<Recorder*> instance{nullptr};
 std::mutex mutex;std::vector<Event> events;std::vector<std::string> names;
 std::unordered_map<std::string,uint32_t> name_ids;std::string filename,error;
 std::atomic<size_t> buffers{0},peak_buffers{0};std::atomic<uint64_t> allocation_failures{0};
 std::atomic<bool> stop_flush{false};std::thread flusher;
 uint64_t base=0,begin_utc_before=0,begin_utc_after=0,dropped=0,overflow=0,invalid=0;
 uint32_t version=0;bool finished=false,latency=false;
 const std::array<CUpti_ActivityKind,5> kinds{CUPTI_ACTIVITY_KIND_CONCURRENT_KERNEL,CUPTI_ACTIVITY_KIND_MEMCPY,CUPTI_ACTIVITY_KIND_MEMSET,CUPTI_ACTIVITY_KIND_RUNTIME,CUPTI_ACTIVITY_KIND_DRIVER};
 static uint64_t utc(){return std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::system_clock::now().time_since_epoch()).count();}
 static void check(CUptiResult r){if(r!=CUPTI_SUCCESS){const char* s=nullptr;cuptiGetResultString(r,&s);throw std::runtime_error(std::string("CUPTI: ")+(s?s:"unknown error"));}}
 uint32_t intern(const char* s){const std::string name=s?s:"<unnamed>";auto found=name_ids.find(name);if(found!=name_ids.end())return found->second;require(names.size()<65536,"Activity name capacity");const auto id=uint32_t(names.size());names.push_back(name);name_ids.emplace(name,id);return id;}
 void accept(CUpti_Activity* raw){
  if(events.size()>=record_capacity){overflow++;return;}Event e{};e.kind=raw->kind;
  if(raw->kind==CUPTI_ACTIVITY_KIND_CONCURRENT_KERNEL||raw->kind==CUPTI_ACTIVITY_KIND_KERNEL){
   const auto& k=*reinterpret_cast<const CUpti_ActivityKernel12*>(raw);
   e.start=k.start;e.end=k.end;e.device=k.deviceId;e.context=k.contextId;e.stream=k.streamId;e.correlation=k.correlationId;e.name=intern(k.name);
   e.gx=k.gridX;e.gy=k.gridY;e.gz=k.gridZ;e.bx=k.blockX;e.by=k.blockY;e.bz=k.blockZ;e.registers=k.registersPerThread;e.shared=k.staticSharedMemory+k.dynamicSharedMemory;e.queued=k.queued;e.submitted=k.submitted;
  }else if(raw->kind==CUPTI_ACTIVITY_KIND_MEMCPY){
   const auto& k=*reinterpret_cast<const CUpti_ActivityMemcpy6*>(raw);e.start=k.start;e.end=k.end;e.device=k.deviceId;e.context=k.contextId;e.stream=k.streamId;e.correlation=k.correlationId;e.bytes=k.bytes;e.name=intern("memcpy");e.result=k.copyKind;
  }else if(raw->kind==CUPTI_ACTIVITY_KIND_MEMSET){
   const auto& k=*reinterpret_cast<const CUpti_ActivityMemset4*>(raw);e.start=k.start;e.end=k.end;e.device=k.deviceId;e.context=k.contextId;e.stream=k.streamId;e.correlation=k.correlationId;e.bytes=k.bytes;e.name=intern("memset");
  }else if(raw->kind==CUPTI_ACTIVITY_KIND_RUNTIME||raw->kind==CUPTI_ACTIVITY_KIND_DRIVER){
   const auto& k=*reinterpret_cast<const CUpti_ActivityAPI*>(raw);e.start=k.start;e.end=k.end;e.correlation=k.correlationId;e.thread=k.threadId;e.cbid=k.cbid;e.result=k.returnValue;
   const char* name=nullptr;cuptiGetCallbackName(raw->kind==CUPTI_ACTIVITY_KIND_RUNTIME?CUPTI_CB_DOMAIN_RUNTIME_API:CUPTI_CB_DOMAIN_DRIVER_API,k.cbid,&name);e.name=intern(name);
  }else return;
  if(!e.start||!e.end||e.end<e.start||e.start<base){invalid++;return;}events.push_back(e);
 }
 static void CUPTIAPI requested(uint8_t** buffer,size_t* size,size_t* max_records){
  auto* s=instance.load();*buffer=nullptr;*size=0;*max_records=0;if(!s)return;
  const size_t count=s->buffers.fetch_add(1)+1;size_t peak=s->peak_buffers.load();while(count>peak&&!s->peak_buffers.compare_exchange_weak(peak,count)){}
  if(count<=buffer_capacity)*buffer=static_cast<uint8_t*>(std::malloc(buffer_size));
  if(!*buffer){s->allocation_failures++;s->buffers--;return;}*size=buffer_size;
 }
 static void CUPTIAPI completed(CUcontext context,uint32_t stream,uint8_t* buffer,size_t,size_t valid){
  auto* s=instance.load();if(s)try{
   std::lock_guard lock(s->mutex);CUpti_Activity* record=nullptr;
   if(valid)for(;;){const auto result=cuptiActivityGetNextRecord(buffer,valid,&record);if(result==CUPTI_ERROR_MAX_LIMIT_REACHED)break;check(result);s->accept(record);}
   size_t lost=0;check(cuptiActivityGetNumDroppedRecords(context,stream,&lost));s->dropped+=lost;
  }catch(const std::exception& e){std::lock_guard lock(s->mutex);s->error=e.what();}catch(...){std::lock_guard lock(s->mutex);s->error="Unknown activity callback error";}
  std::free(buffer);if(s)s->buffers--;
 }
public:
 Recorder(){
  const char* folder=std::getenv("PS_CUDA_ACTIVITY_DIR");require(folder&&*folder,"Activity build requires PS_CUDA_ACTIVITY_DIR");require(std::filesystem::is_directory(folder),"Activity output directory must exist");require(!instance.load(),"Only one activity recorder is supported");
  check(cuptiGetVersion(&version));begin_utc_before=utc();check(cuptiGetTimestamp(&base));begin_utc_after=utc();
  filename=(std::filesystem::path(folder)/("guided-"+std::to_string(GetCurrentProcessId())+"-"+std::to_string(base)+".jsonl")).string();require(!std::filesystem::exists(filename),"Fresh activity output required");
  events.reserve(record_capacity);instance.store(this);
  try{check(cuptiActivityRegisterCallbacks(requested,completed));check(cuptiActivityFlushPeriod(0));latency=cuptiActivityEnableLatencyTimestamps(1)==CUPTI_SUCCESS;for(auto kind:kinds)check(cuptiActivityEnable(kind));
   // FlushPeriod only delivers already-full, completed host buffers. Explicit
   // non-forced flushes also drain pending device records during stream churn.
   flusher=std::thread([this]{while(!stop_flush.load()){
    std::this_thread::sleep_for(std::chrono::milliseconds(flush_period_ms));if(stop_flush.load())break;
    try{check(cuptiActivityFlushAll(0));}catch(const std::exception& e){std::lock_guard lock(mutex);error=e.what();break;}
   }});
  }
  catch(...){cuptiActivityFlushAll(CUPTI_ACTIVITY_FLAG_FLUSH_FORCED);cuptiFinalize();instance.store(nullptr);throw;}
 }
 Recorder(const Recorder&)=delete;
 ~Recorder(){if(!finished)try{finish();}catch(const std::exception& e){std::cerr<<"Activity finalization: "<<e.what()<<'\n';}if(instance.load()==this){cuptiFinalize();instance.store(nullptr);}}
 void finish(){
  if(finished)return;stop_flush.store(true);if(flusher.joinable())flusher.join();check(cuptiActivityFlushPeriod(0));check(cuptiActivityFlushAll(0));for(auto kind:kinds)check(cuptiActivityDisable(kind));check(cuptiActivityFlushAll(CUPTI_ACTIVITY_FLAG_FLUSH_FORCED));
  uint64_t end=0;const auto utc_before=utc();check(cuptiGetTimestamp(&end));const auto utc_after=utc();check(cuptiFinalize());instance.store(nullptr);
  std::lock_guard lock(mutex);finished=true;const bool complete=!dropped&&!overflow&&!invalid&&!allocation_failures.load()&&error.empty();
  std::ofstream out(filename,std::ios::binary);require(bool(out),"Cannot open activity output");J::Array ns;for(const auto& name:names)ns.emplace_back(name);
  J header(J::Object{{"format",J(std::string("puzzlescript-cupti-activity-v1"))},{"complete",J(complete)},{"pid",ji(GetCurrentProcessId())},{"cupti_version",ji(version)},
   {"base_ns",J(std::to_string(base))},{"start_utc_before_ns",J(std::to_string(begin_utc_before))},{"start_utc_after_ns",J(std::to_string(begin_utc_after))},
   {"end_ns",ji(end-base)},{"end_utc_before_ns",J(std::to_string(utc_before))},{"end_utc_after_ns",J(std::to_string(utc_after))},
   {"latency_timestamps",J(latency)},{"record_capacity",ji(record_capacity)},{"records",ji(events.size())},{"dropped",ji(dropped)},{"overflow",ji(overflow)},{"invalid_timestamps",ji(invalid)},
   {"buffer_allocation_failures",ji(allocation_failures.load())},{"peak_buffers",ji(peak_buffers.load())},{"buffer_bytes",ji(buffer_size)},{"buffer_capacity",ji(buffer_capacity)},{"event_bytes",ji(sizeof(Event))},{"flush_period_ms",ji(flush_period_ms)},{"explicit_periodic_flush",J(true)},{"callback_error",J(error)},{"names",J(std::move(ns))},
   {"columns",J(std::string("kind,start_ns,end_ns,device,context,stream,correlation,name,bytes,grid_x,grid_y,grid_z,block_x,block_y,block_z,registers,shared_bytes,queued_ns,submitted_ns,thread,cbid,result"))}});
  json(out,header);out<<'\n';const auto relative=[&](uint64_t x){return x>=base?x-base:0;};
  for(const auto& e:events)out<<'['<<e.kind<<','<<e.start-base<<','<<e.end-base<<','<<e.device<<','<<e.context<<','<<e.stream<<','<<e.correlation<<','<<e.name<<','<<e.bytes<<','<<e.gx<<','<<e.gy<<','<<e.gz<<','<<e.bx<<','<<e.by<<','<<e.bz<<','<<e.registers<<','<<e.shared<<','<<relative(e.queued)<<','<<relative(e.submitted)<<','<<e.thread<<','<<e.cbid<<','<<e.result<<"]\n";
  out.close();require(bool(out),"Activity output failed");require(complete,"Activity trace incomplete; inspect dropped/overflow/error counters");
 }
};
}
