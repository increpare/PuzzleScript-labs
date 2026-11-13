'use strict';
// Frozen generated boards, never selected by their benchmark outcomes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const wide=require('../tools/export-v2.cjs');
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function prepare(input=path.join(__dirname,'../out/generated-large-20261107/manifest.json')){
 input=path.resolve(input);const manifest=JSON.parse(fs.readFileSync(input)),out=path.join(__dirname,'out/games');fs.mkdirSync(out,{recursive:true});const records=[];
 for(const record of manifest.records){const r={...record};for(const key of ['source','boards_file','template','ir'])r[key]=path.resolve(path.dirname(input),r[key]);assert.equal(hash(r.source),r.source_sha256);assert.equal(hash(r.boards_file),r.boards_sha256);let u=JSON.parse(fs.readFileSync(r.template));const l=wide.layout(u.game,u.symbols.length),b=fs.readFileSync(r.boards_file),stride=256+l.cells*l.objectWords;assert.equal(b.length,24+r.jobs.length*stride*4);
  const roots=r.jobs.map((_,i)=>{const s=u.initial.slice();for(let k=0;k<256;k++)s[128+k]=b.readUInt32LE(24+(i*stride+k)*4);for(let k=0;k<l.cells*l.objectWords;k++)s[l.board+k]=s[l.restart+k]=b.readUInt32LE(24+(i*stride+256+k)*4);return s;});u.initial=roots[0];u.initial_boards=roots;const file=path.join(out,'f'+r.family+'.json');fs.writeFileSync(file,JSON.stringify(u));records.push({...r,upload:file,upload_sha256:hash(file)});
 }
 const result={authority:manifest.authority,canonical_corpus_sha256:manifest.canonical_corpus_sha256,input_manifest:input,input_manifest_sha256:hash(input),records};fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(result,null,2));return result;
}
if(require.main===module)console.log(JSON.stringify({families:prepare(process.argv[2]).records.length}));
module.exports={prepare,hash};
