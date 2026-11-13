// Stage the checked native/CUDA distribution into the normal desktop package.
// Browser builds never run this step and retain their existing Workers/WASM.
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function buildBackend(){
 const base=path.join(root,'desktop/mis/backend'),platform=process.platform+'-'+process.arch;
 const manifest=JSON.parse(await readFile(path.join(base,'prebuilt/manifest.json'),'utf8'));
 const selected=manifest.platforms[platform],bin=path.join(base,'bin',platform),engine=path.join(base,'engine');
 // These are fixed generated directories, never user-selected deletion targets.
 await rm(path.join(base,'bin'),{recursive:true,force:true});
 await rm(engine,{recursive:true,force:true});
 await mkdir(bin,{recursive:true});await mkdir(path.join(engine,'src'),{recursive:true});
 if(selected){
  for(const [file,expected] of Object.entries({...manifest.native_sources,...manifest.gpu_sources})){
   if(sha(await readFile(path.join(root,file)))!==expected)throw Error('Native helper source changed: '+file+'. Rebuild and validate the native helper before updating its distribution manifest.');
  }
  for(const [file,expected] of Object.entries(selected.files)){
   const input=path.join(base,'prebuilt',platform,file);
   if(sha(await readFile(input))!==expected)throw Error('Native distribution hash mismatch: '+file);
   await cp(input,path.join(bin,file));
  }
 }
 await cp(path.join(root,'src/js'),path.join(engine,'src/js'),{recursive:true});
 const reference=path.join(base,'authority'),authority=JSON.parse(await readFile(path.join(reference,'oracle-source.json'),'utf8'));
 if(authority.implementation!=='vanilla'||authority.revision!==manifest.authority.revision)throw Error('Incorrect GPU compiler authority');
 for(const file of ['oracle-source.json','test/native-host.cjs']){const dest=path.join(engine,'typescript',file);await mkdir(path.dirname(dest),{recursive:true});await cp(path.join(reference,file),dest);}
 for(const [file,expected] of Object.entries(authority.sourceSha256)){
  const input=path.join(reference,'test/vanilla',file),dest=path.join(engine,'typescript/test/vanilla',file);
  if(sha(await readFile(input))!==expected)throw Error('Pinned vanilla source changed: '+file);
  await mkdir(path.dirname(dest),{recursive:true});await cp(input,dest);
 }
 await cp(path.join(root,'LICENSE'),path.join(engine,'LICENSE'));
 const files={};async function inventory(dir){for(const e of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('Linked backend asset');if(e.isDirectory())await inventory(file);else files[path.relative(base,file).replaceAll('\\','/')]=sha(await readFile(file));}}
 await inventory(engine);await inventory(bin);
 const report={format:'mis-desktop-assets-v1',platform,native:!!selected,cuda:!!selected?.cuda,authority:manifest.authority,files};
 await writeFile(path.join(base,'assets-manifest.json'),JSON.stringify(report,null,2));
 console.log('MIS95 backend:',platform,selected?'native C++ + optional CUDA':'WASM fallback (no validated native distribution for this platform)');
 return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await buildBackend();
