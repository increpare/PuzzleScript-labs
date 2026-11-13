'use strict';
// Translate the already-validated pure matching/bounded leader helpers. CUDA's
// warp entry point is explicit in cooperative.cuh; commits remain leader-only.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../src/runtime_cooperative.wgsl'),'utf8');
let s=source.slice(0,source.indexOf('@compute')).replace(/\/\/[^\n]*/g,'');
const core=fs.readFileSync(path.join(__dirname,'../src/runtime_v2.wgsl'),'utf8');
const header=core.slice(core.indexOf('const EPOCH:'),core.indexOf('const MATCH_COUNTS:'));
for(const m of header.matchAll(/const (\w+):u32=(\d+)u;/g)){if(+m[2]>=80||['CAN_COUNT','CANT_COUNT'].includes(m[1]))continue;const name=m[1];s=s.replaceAll(`rd(${name})`,`cursor_${name}`).replaceAll(`put(${name},`,`cursor_put_${name}(`);}
const shared=[...s.matchAll(/var<workgroup> (\w+):[^;]+;/g)].map(m=>m[1]);
s=s.replace(/var<workgroup>[^;]+;/g,'').replace('const COOPERATIVE_CROSS_LINES:bool=false;','const COOPERATIVE_CROSS_LINES:bool=true;');
s=s.replace(/const\s+(\w+)\s*:\s*(u32|bool)\s*=/g,'static constexpr $2 $1=');
s=s.replace(/vec([24])<(u32|i32)>/g,'Vec$1<$2>').replace(/\bvec2\(/g,'v2(').replace(/\bvec4\(/g,'v4(').replace(/\.yz\b/g,'.yz()');
s=s.replace(/fn\s+(\w+)\(([^)]*)\)(?:->([^\{]+))?\{/g,(_,name,args,ret)=>`PS_HD ${ret?.trim()||'void'} ${name}(${args.trim()?args.split(',').map(p=>{const m=p.trim().match(/^(\w+):(.+)$/);if(!m)throw Error(p);return m[2]+' '+m[1];}).join(','):''}){`);
s=s.replace(/var\s+(\w+)\s*=/g,'auto $1=').replace(/let\s+(\w+)\s*=/g,'const auto $1=').replace(/\b(\d+)i\b/g,'$1').replace(/switch\s+([^\{]+)\{/g,'switch($1){');
const stack=[],insert=[];for(const t of s.matchAll(/case\s+[^:]+:\s*\{|default\s*:\s*\{|[{}]/g)){if(t[0].endsWith('{'))stack.push(t[0]!=='{');else if(stack.pop())insert.push(t.index+1);}for(const i of insert.reverse())s=s.slice(0,i)+'break;'+s.slice(i);
for(const name of [...shared,'eligible_rule_start','eligible_rule_bits','eligible_rule_valid','eligible_line_valid','eligible_line_row','eligible_line_bits'])s=s.replace(new RegExp('\\b'+name+'\\b','g'),'shared->'+name);
s=s.replace(/\bOBJ_WORDS\b/g,'object_words()').replace(/\bMOV_WORDS\b/g,'movement_words()');
// CUDA-only experiment: consume the same line-pruning certificate through a
// rank interval. Matching/writes and WGSL/reference sources remain unchanged.
const compactAnchor='if(COOPERATIVE_CROSS_LINES && game[rp+2u]==0u){';
if(!s.includes(compactAnchor))throw Error('Cooperative compact-line insertion point changed');
s=s.replace(compactAnchor,'if(compact_lines && cached_lines && game[rp+2u]==0u){prepare_compact_lines(span);return;}\n  '+compactAnchor);
s=s.replace(compactAnchor,'if(parallel_ellipses && game[rp+2u]!=0u){prepare_parallel_ellipses(span,cached_lines);return;}\n  '+compactAnchor);
if(/\bfn\b|\bvar\b|\blet\b|@|array<|vec[234]<|\w\s*:\s*(?:u32|i32)/.test(s))throw Error('Untranslated cooperative WGSL');
const output='// Generated cooperative helpers. WGSL SHA-256 '+crypto.createHash('sha256').update(source).digest('hex')+'\n'+s,file=path.join(__dirname,'generated-cooperative.inc');
if(process.argv.includes('--check')){if(fs.readFileSync(file,'utf8')!==output)throw Error('Cooperative helpers stale');}else fs.writeFileSync(file,output);
