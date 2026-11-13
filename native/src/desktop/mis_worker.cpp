// Process-isolated desktop transport for the SAME MIS C API used by wasm.
// Search/scoring bodies are unchanged. Cancellation terminates this disposable
// worker; no partially completed score is exported or treated as a proof.
#include "mis_wasm.cpp"
#include "runtime/json.hpp"
#include <iomanip>
#include <iostream>
#include <sstream>
#include <cmath>
#include <chrono>
using J=puzzlescript::json::Value;
static void require(bool b,const char* message){if(!b)throw std::runtime_error(message);}
static const J& field(const J& r,const char* name){auto p=r.find(name);require(p,"Missing MIS field");return *p;}
static int64_t number(const J& r,const char* name,int64_t fallback,int64_t lo,int64_t hi){auto p=r.find(name);auto v=p?p->asInteger():fallback;require(v>=lo&&v<=hi,"MIS numeric capacity");return v;}
static bool flag(const J& r,const char* name,bool fallback){auto p=r.find(name);return p?p->asBool():fallback;}
static J ji(int64_t v){return J(v);}
static J js(const char* v){return J(std::string(v));}
static void json(std::ostream& o,const J& v){
 switch(v.kind()){
 case J::Kind::Null:o<<"null";break;case J::Kind::Bool:o<<(v.asBool()?"true":"false");break;
 case J::Kind::Integer:o<<v.asInteger();break;case J::Kind::Double:require(std::isfinite(v.asDouble()),"Nonfinite MIS result");o<<v.asDouble();break;
 case J::Kind::String:{o<<'"';for(unsigned char c:v.asString()){if(c=='"'||c=='\\')o<<'\\'<<c;else if(c<32){const char* h="0123456789abcdef";o<<"\\u00"<<h[c>>4]<<h[c&15];}else o<<c;}o<<'"';break;}
 case J::Kind::Array:{o<<'[';bool comma=false;for(auto& x:v.asArray()){if(comma)o<<',';comma=true;json(o,x);}o<<']';break;}
 case J::Kind::Object:{o<<'{';bool comma=false;for(auto& [k,x]:v.asObject()){if(comma)o<<',';comma=true;json(o,J(k));o<<':';json(o,x);}o<<'}';break;}
 }
}
static J solution(){J::Array a;for(int i=0;i<misw_result_solution_length();i++)a.push_back(ji(misw_result_solution()[i]));return J(std::move(a));}
static J::Object result(int status){require(status>=0&&status<4,"Invalid MIS result status");const char* names[]={"solved","unsolvable","timeout","error"};J::Object r{{"status",js(names[status])},{"expanded",J(misw_result_expanded())},{"ms",J(misw_result_elapsed_ms())}};if(status==0)r["solution"]=solution();if(status==3)r["error"]=js(misw_error());return r;}
int main(){std::cout<<std::setprecision(15);for(;;){std::string line,id;bool overflow=false;char c;while(std::cin.get(c)&&c!='\n'){if(line.size()<1024*1024)line.push_back(c);else overflow=true;}if(line.empty()&&!std::cin)return 0;
 bool quit=false;J::Object response;
 try{require(!overflow,"MIS request exceeds1MiB");const auto r=puzzlescript::json::parse(line);id=field(r,"id").asString();require(id.size()<=128,"MIS identity capacity");const auto op=field(r,"op").asString();J report;
  if(op=="shutdown")quit=true;
  else if(op=="compile"||op=="compile_original"){
   const bool original=op=="compile_original";const auto& source=field(r,"source").asString();require(!source.empty()&&source.size()<=768*1024,"MIS source capacity768KiB");require(original?misw_compile_original(source.data(),int(source.size())):misw_compile(source.data(),int(source.size())),misw_error());
   const int count=original?misw_original_object_count():misw_object_count();J::Array objects;for(int i=0;i<count;i++)objects.emplace_back(J::Object{{"id",ji(i)},{"name",js(original?misw_original_object_name(i):misw_object_name(i))},{"layer",ji(original?misw_original_object_layer(i):misw_object_layer(i))}});
   report=J(J::Object{{"objects",J(std::move(objects))},{"objectCount",ji(count)},{"layerCount",ji(original?misw_original_layer_count():misw_layer_count())},{"actionUnnecessary",J(bool(misw_action_unnecessary()))},{"backend",js("native-mis-c-api")}});
  }else if(op=="validate_original"){
   const auto start=std::chrono::steady_clock::now();const int w=int(number(r,"width",0,1,512)),h=int(number(r,"height",0,1,512));require(uint64_t(w)*h<=65536,"MIS board capacity65536 cells");const auto& grid=field(r,"grid").asArray();require(grid.size()==size_t(w)*h*misw_original_layer_count()&&grid.size()<=131072,"MIS original grid capacity");
   std::vector<int32_t> checked;for(size_t i=0;i<grid.size();i++){const auto n=grid[i].asInteger();require(n>=-1&&n<misw_original_object_count(),"MIS original identity");require(n<0||misw_original_object_layer(int(n))==int(i/(size_t(w)*h)),"MIS original collision layer");checked.push_back(int32_t(n));}
   const auto& inputs=field(r,"solution").asArray();require(!inputs.empty()&&inputs.size()<=100000,"Native replay supports1..100000 moves; use JS for empty/long paths");std::vector<int32_t> moves;for(const auto& v:inputs){const auto n=v.asInteger();require(n>=0&&n<=4,"MIS original move");moves.push_back(int32_t(n));}
   std::copy(checked.begin(),checked.end(),misw_grid_buffer(int(checked.size())));const bool valid=misw_validate_original(w,h,int(checked.size()),moves.data(),int(moves.size()));
   const double ms=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-start).count();report=J(J::Object{{"valid",J(valid)},{"ms",J(ms)},{"engine",js("native-original-ordinary-runtime")}});
  }else{
   require(op=="solve"||op=="assess","Unsupported MIS operation");require(misw_object_count()>0,"Compile MIS game first");
   const int w=int(number(r,"width",0,1,512)),h=int(number(r,"height",0,1,512));require(uint64_t(w)*h<=65536,"MIS board capacity65536 cells");const auto& grid=field(r,"grid").asArray();require(grid.size()==size_t(w)*h*misw_layer_count()&&grid.size()<=131072,"MIS grid capacity");
   std::vector<int32_t> checked;checked.reserve(grid.size());for(size_t i=0;i<grid.size();i++){auto n=grid[i].asInteger();require(n>=-1&&n<misw_object_count(),"MIS object identity");require(n<0||misw_object_layer(int(n))==int(i/(size_t(w)*h)),"MIS grid collision layer");checked.push_back(int32_t(n));}
   std::copy(checked.begin(),checked.end(),misw_grid_buffer(int(grid.size())));
   const auto* opts=r.find("options");const J empty(J::Object{});const auto& o=opts?*opts:empty;const int64_t time=number(o,"timeMs",1500,-1,120000),cap=number(o,op=="solve"?"maxExpanded":"primaryMaxExpanded",0,0,1000000);const int det=flag(o,"deterministic",false);
   if(op=="solve"){const int strategy=int(number(o,"strategy",0,0,4));report=J(result(misw_solve(w,h,int(grid.size()),strategy,double(time),double(cap),det)));}
   else{
    const int64_t refineTime=number(o,"refineTimeMs",time>0?time:1500,1,120000),gate=number(o,"refineGate",-1,-1,1000000000);const int st=misw_assess_impl(w,h,int(grid.size()),double(time),flag(o,"refine",true),double(refineTime),double(gate),double(cap),det,flag(o,"skipBfs",false));auto row=result(st);row["bfsDeferred"]=J(gLast.bfsDeferred);
    row["primaryMs"]=J(misw_result_primary_elapsed_ms());row["optimal"]=J(false);J::Object lanes;
    if(st==0){for(auto [key,value]:std::initializer_list<std::pair<const char*,double>>{{"portfolio",misw_result_portfolio()},{"greedy",misw_result_greedy()},{"astar",misw_result_weighted_astar()},{"bfs",misw_result_bfs()}})if(value>=0)lanes[key]=J(value);
     row["length"]=ji(misw_result_solution_length());row["effort"]=J(std::max(1.0,misw_result_difficulty()>=0?misw_result_difficulty():misw_result_expanded()));row["refined"]=J(bool(misw_result_supplemental_ran()));
     const int64_t floor=number(o,"bfsFloor",0,0,1000000);if(floor){const auto timeout=number(o,"bfsTimeMs",time>0?time:1500,1,60000);const int bfs=misw_solve(w,h,int(grid.size()),1,double(timeout),double(floor),det);if(bfs==0){row["solution"]=solution();row["length"]=ji(misw_result_solution_length());row["optimal"]=J(true);}}
    }
    row["lanes"]=J(std::move(lanes));report=J(std::move(row));
   }
  }
  response={{"id",J(id)},{"ok",J(true)},{"report",std::move(report)}};
 }catch(const std::exception& e){response={{"id",J(id)},{"ok",J(false)},{"error",js(e.what())}};}
 std::ostringstream out;out<<std::setprecision(15);json(out,J(std::move(response)));require(out.str().size()<=16*1024*1024,"MIS response exceeds16MiB");std::cout<<out.str()<<'\n'<<std::flush;if(quit)return 0;
 }}
