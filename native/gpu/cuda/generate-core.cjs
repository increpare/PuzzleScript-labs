'use strict';
// Deliberately small, fail-closed transliteration of the scalar interpreter.
// The WGSL source is never changed by this experimental backend. Both CPU and
// CUDA compile the resulting allocation-free C++ core; JS/WGSL remain oracles.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../src/runtime_v2.wgsl'), 'utf8');
let s = source.replace(/\/\/[^\n]*/g, '').replace(/@group[^\n]*\n/g, '');
// Batch independent scans inside one cursor unit, as the WGSL host also does.
s = s.replace('const MATCH_CHUNK:u32=1u;', 'const MATCH_CHUNK:u32=32u;');
s = s.replace('const FAST_SINGLE_WORD_MATCHING:bool=false;', 'const FAST_SINGLE_WORD_MATCHING:bool=true;');
s = s.replace('const FLAT_ROW_MATCHING:bool=false;', 'const FLAT_ROW_MATCHING:bool=true;');
s = s.replace('const COOPERATIVE_MODE:bool=false;', 'const COOPERATIVE_MODE:bool=Cooperative;');
// Same named-cursor lowering as src/registers.rs. Dynamic match/audio counters
// stay in storage; other cursors load once per bounded launch and save at exit.
const header=source.slice(source.indexOf('const EPOCH:'),source.indexOf('const MATCH_COUNTS:'));
const names=[...header.matchAll(/const (\w+):u32=(\d+)u;/g)].filter(m=>+m[2]<80&&!['CAN_COUNT','CANT_COUNT'].includes(m[1])).map(m=>m[1]);
let declarations='',load='fn load_execution_registers(){',save='fn save_execution_registers(){';
for(const name of names){
 s=s.replaceAll(`rd(${name})`,`cursor_${name}`).replaceAll(`put(${name},`,`cursor_put_${name}(`);
 declarations+=`var<private> cursor_${name}:u32;\nfn cursor_put_${name}(v:u32){cursor_${name}=v;}\n`;
 load+=`cursor_${name}=states[base+${name}];`;save+=`states[base+${name}]=cursor_${name};`;
}
s=declarations+s.replace('fn load_execution_registers(){}',load+'}').replace('fn save_execution_registers(){}',save+'}');
const sharedNames=[...s.matchAll(/var<workgroup> (\w+):[^;]+;/g)].map(m=>m[1]);
s=s.replace(/var<workgroup>[^;]+;/g,'');
s = s.replace(/var<private>\s+(\w+)\s*:\s*u32\s*;/g, 'u32 $1=0;');
s = s.replace(/const\s+(\w+)\s*:\s*(u32|bool)\s*=/g, 'static constexpr $2 $1=');
// Optional WGSL sparse/cooperative metadata is disabled in this first port.
s = s.replace(/fn report_completion\(board:u32\)\{[\s\S]*?\n\}/, '');
s = s.replace(/@compute @workgroup_size\(32u\)\s*fn main\(@builtin\(global_invocation_id\) id:vec3<u32>\)\{[\s\S]*?if\(cursor_EPOCH!=params.y\)/,
  'fn run(op:u32,epoch:u32,fuel_limit:u32){\nbase=0u;line_base=0u;opcode=op;params=Params{0u,epoch,1u,fuel_limit};load_execution_registers();\nif(cursor_EPOCH!=params.y)');
s = s.replace(/\s*report_completion\(id.x\);/g, '');
s = s.replace(/vec2<(u32|i32)>/g, 'Vec2<$1>').replace(/\bvec2\(/g, 'v2(');
s = s.replace(/array<([^,>]+(?:<[^>]+>)?),\s*(\w+)>/g, (_, t, n) => `Array<${t},${({OBJ_WORDS:'(FixedOW?FixedOW:32)',MOV_WORDS:'(FixedMW?FixedMW:64)',ROW_CAP:'16'})[n] || n}>`);
s = s.replace(/struct Limbs\s*\{\s*v:\s*([^,]+(?:,[^>]+>)?),\s*\}/, 'struct Limbs { $1 v; };');
s = s.replace(/fn\s+(\w+)\(([^)]*)\)(?:->([^\{]+))?\{/g, (_,name,args,ret) => {
  const a = args.trim() ? args.split(',').map(p => { const m=p.trim().match(/^(\w+)\s*:\s*(.+)$/); if(!m)throw Error('argument '+p); return m[2]+' '+m[1]; }).join(',') : '';
  return `PS_HD ${ret?.trim() || 'void'} ${name}(${a}){`;
});
s = s.replace(/var\s+(\w+)\s*:\s*([^;=]+);/g, '$2 $1{};');
s = s.replace(/var\s+(\w+)\s*=/g, 'auto $1=').replace(/let\s+(\w+)\s*=/g, 'const auto $1=');
s = s.replace(/\b(\d+)i\b/g, '$1').replace(/\bloop\s*\{/g, 'while(true){');
s = s.replace(/switch\s+([^\{]+)\{/g, 'switch($1){');
// WGSL case bodies do not fall through. Insert breaks at their matching brace.
const tokens = [...s.matchAll(/case\s+[^:]+:\s*\{|default\s*:\s*\{|[{}]/g)];
const stack=[], insert=[];
for(const t of tokens){if(t[0].endsWith('{'))stack.push(t[0] !== '{');else if(stack.pop())insert.push(t.index+1);}
for(const i of insert.reverse())s=s.slice(0,i)+'break;'+s.slice(i);
if(/\bfn\b|\bvar\b|\blet\b|@|array<|vec[234]<|\w\s*:\s*(?:u32|i32)/.test(s))throw Error('Untranslated WGSL construct');
const hash=crypto.createHash('sha256').update(source).digest('hex');
s=s.replace(/\bOBJ_WORDS\b/g,'object_words()').replace(/\bMOV_WORDS\b/g,'movement_words()');
for(const name of sharedNames)s=s.replace(new RegExp('\\b'+name+'\\b','g'),'shared->'+name);
s=s.replaceAll('shared->eligible_rule_valid=0u;shared->eligible_line_valid=0u;','shared->eligible_rule_valid=0u;shared->eligible_line_valid=0u;shared->prefix_valid=0u;');
// Prefix membership is exact, unlike conservative monotone object caches.
// Repeating this same rule after writes must recompute its prefix witnesses.
if(!s.includes('PS_HD void begin_rule(){'))throw Error('Prefix invalidation insertion point changed');
s=s.replace('PS_HD void begin_rule(){','PS_HD void begin_rule(){if(COOPERATIVE_MODE){shared->prefix_valid=0u;}');
// A warp may evaluate the pure win scan immediately before finish_result. This
// value never survives that call and is never used by an AGAIN probe or restart.
if(!s.includes('PS_HD bool has_won(){'))throw Error('Win scan insertion point changed');
s=s.replace('PS_HD bool has_won(){','PS_HD bool has_won(){if(COOPERATIVE_MODE&&finish_win_valid)return finish_win_value;');
// Optional experiment: remove tuple-local arrays, preserving all rechecks before writes.
// A changed generated authority function requires a fresh semantic audit.
{
 const begin=s.indexOf('PS_HD void apply_tick(){'),end=s.indexOf('PS_HD void finish_movement_scan(',begin);
 if(begin<0||end<=begin)throw Error('Tuple application insertion point changed');
 const original=s.slice(begin,end);
 if(crypto.createHash('sha256').update(original).digest('hex')!=="6c4dcc34cf97c6173c2251b757bd82d78c189f9f857d56e8b33afcbc41fbd0bb")throw Error('Tuple application authority changed');
 const streamed="PS_HD void apply_tick(){\n  auto tuple=cursor_TUPLE;\n  auto valid=true;\n  // Every live row recheck precedes every replacement, including overlaps.\n  for(auto r=0u;r<game[rule_ptr()+2u];r++){\n    const auto count=rd(MATCH_COUNTS+r);\n    const auto at=MATCHES+(r*MATCH_CAP+tuple%count)*3u;\n    tuple/=count;\n    const auto start=rd(at);\n    const auto gaps=v2(rd(at+1u),rd(at+2u));\n    valid=valid && matches(r,start,gaps);\n  }\n  if(valid && game[rule_ptr()+5u]!=0u){\n    auto changed=false;\n    // Replacement changes board/movement/RNG/rigid state, never the collected\n    // match records or counts. Decode the same tuple again in original order.\n    tuple=cursor_TUPLE;\n    for(auto r=0u;r<game[rule_ptr()+2u];r++){\n      const auto count=rd(MATCH_COUNTS+r);\n      const auto at=MATCHES+(r*MATCH_CAP+tuple%count)*3u;\n      tuple/=count;\n      const auto start=rd(at);\n      const auto gaps=v2(rd(at+1u),rd(at+2u));\n      changed=replace(r,start,gaps)||changed;\n    }\n    if(changed){cursor_put_PASS_CHANGED(1u);cursor_put_LOOP_CHANGED(1u);}\n  }\n  if(game[group_ptr()+2u]!=0u){\n    queue_commands();\n    cursor_put_PHASE(4u);\n    return;\n  }\n  cursor_put_TUPLE(cursor_TUPLE+1u);\n  if(cursor_TUPLE>=cursor_TUPLE_COUNT){\n    queue_commands();\n    next_rule();\n  }\n}\n";
 s=s.slice(0,begin)+'#if defined(PS_CUDA_STREAM_TUPLES) && PS_CUDA_STREAM_TUPLES\n'+streamed+'#else\n'+original+'#endif\n'+s.slice(end);
}
const result=`// Generated by generate-core.cjs. WGSL SHA-256 ${hash}\n${s}`;
const out=path.join(__dirname,'generated-core.inc');
if(process.argv.includes('--check')) { if(fs.readFileSync(out,'utf8')!==result)throw Error('Generated core is stale'); }
else fs.writeFileSync(out,result);
console.log(JSON.stringify({source_sha256:hash,output:out}));
