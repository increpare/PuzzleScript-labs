'use strict';
// The only CPU interpreter in this component is the TEST oracle. The runner never
// links this module and upload() never calls processInput or precomputes a turn.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const REVISION = '5a94bde1a5127a3a45306ea28598eba2874d446d';
const DEFAULT_REFERENCE = path.join(__dirname, '../engine/typescript');
let root, effects = 0, diagnostics = 0, outputEvents = [];
function initialize(reference = process.env.PUZZLESCRIPT_TS_REFERENCE || DEFAULT_REFERENCE) {
  root = path.resolve(reference);
  const { loadPuzzleScript, ORACLE_SOURCE } = require(path.join(root, 'test/native-host.cjs'));
  if (ORACLE_SOURCE.revision !== REVISION || ORACLE_SOURCE.implementation !== 'vanilla') throw Error('Incorrect vanilla authority');
  loadPuzzleScript({ includeTests: true, debugTimelineSink: () => {
    // Vanilla's verbose level-start path reads the current timeline's length.
    // Keep that logging-only container even though this headless host renders no
    // debugger and retains no board snapshots. Do not change compiled metadata.
    if (!debug_visualisation_array[debugger_turnIndex]) debug_visualisation_array[debugger_turnIndex] = [];
    return '';
  } }); // validates ALL 22 pinned hashes before evaluation
  const originalSet = localStorage.setItem;
  localStorage.setItem = function(key, value) {
    if (key === document.URL + '_checkpoint') effects += 1;
    return originalSet.call(this, key, value);
  };
  const originalWin = DoWin;
  DoWin = function() { if (!winning) effects += 65536; return originalWin(); };
  const originalSound = playSound;
  playSound = function(seed, ...args) {
    outputEvents.push({ kind: 'sound', seed: String(seed) });
    return originalSound(seed, ...args);
  };
  const originalMessage = showTempMessage;
  showTempMessage = function(...args) {
    outputEvents.push({ kind: 'message', text: messagetext });
    return originalMessage(...args);
  };
  const originalError=logErrorCacheable;
  logErrorCacheable=function(message,...args){
    if(message.includes('looping lots'))diagnostics|=1;
    if(message.includes('vortex'))diagnostics|=2;
    return originalError(message,...args);
  };
  return root;
}
const word = v => (v?.data?.[0] || 0) >>> 0;
const words = v => Array.from(v, x => x >>> 0);
function prepare(source, seed, command) {
  level = new Level(0, 0, 0, 0, new Int32Array(0));
  backups = []; restartTarget = undefined; oldflickscreendat = [];
  messagetext = ''; seedsToPlay_CanMove = []; seedsToPlay_CantMove = [];
  hasUsedCheckpoint = false; restarting = false; runrulesonlevelstart_phase = false;
  curlevelTarget = null; winning = false; againing = false;
  localStorage.removeItem(document.URL); localStorage.removeItem(document.URL + '_checkpoint');
  unitTesting = false; lazyFunctionGeneration = false;
  compile(command, source + '\n', seed);
  // Headless host has no IDE timeline; this changes logging, not gameplay.
  verbose_logging = false;
  if (errorCount) throw Error(`Unsupported source: ${errorCount} compiler errors: ${errorStrings.join('; ')}`);
  effects = 0; outputEvents = [];
  return state;
}
function compileGame(source, seed = 'gpu', levelIndex = 0) {
  return prepare(source, seed, ['loadLevel', levelIndex]);
}
function compileProgram(source, seed = 'gpu') {
  // Install compiled definitions without loading any playable level. In
  // particular, this must not execute CPU level-start rules for GPU uploads.
  return prepare(source, seed, ['restart']);
}
function loadProgramLevel(index, seed = 'gpu') {
  if (!state.levels[index] || state.levels[index].message !== undefined) throw Error('Selected level is not playable');
  effects = 0; diagnostics = 0; outputEvents = []; backups = [];
  hasUsedCheckpoint = false; winning = false; againing = false;
  loadLevelFromState(state, index, seed);
  return snapshot(false);
}
function upload(source, operations, { seed = 'gpu', name = 'source', level: levelIndex = 0 } = {}) {
  // Reject level-start execution BEFORE compiler installation, which would run it.
  if (/^\s*run_rules_on_level_start\b/im.test(source)) throw Error('Unsupported: run_rules_on_level_start');
  compileGame(source, seed, levelIndex);
  const reject = reason => { throw Error('Unsupported: ' + reason); };
  if (STRIDE_OBJ !== 1 || state.objectCount > 32) reject('more than 32 object identities');
  if (STRIDE_MOV !== 1 || state.collisionLayers.length > 6) reject('more than 6 collision layers');
  if (level.width * level.height > 256 || !level.width || !level.height) reject('board capacity (1..256 cells)');
  if (state.levels.some(l => l.message !== undefined)) reject('message levels');
  if (state.levels.length !== 1 || levelIndex !== 0) reject('multi-level transitions (single board session only)');
  const metadata = new Set(['title','author','homepage','youtube','background_color','text_color','color_palette','sprite_size','key_repeat_interval','again_interval','realtime_interval','noundo','norestart','noaction','require_player_movement','verbose_logging','debug']);
  for (const key of Object.keys(state.metadata)) if (!metadata.has(key)) reject('metadata ' + key);
  if (Object.keys(state.sfx_Events).length || state.sfx_CreationMasks.length || state.sfx_DestructionMasks.length || state.sfx_MovementFailureMasks.length || state.sfx_MovementMasks.some(a => a.length)) reject('sound declarations');
  if (Object.values(state.objects).some(o => o.id < 0 || o.layer < 0)) reject('unlayered/orphan objects');
  if (state.winconditions.length>16) reject('more than 16 win conditions');
  const allGroups = [...state.rules, ...state.lateRules];
  if (allGroups.length > 31) reject('more than 31 rule groups');
  const groups = [], rules = [], rows = [], cells = [];
  const commands = ['cancel','restart','win','checkpoint','again'];
  for (let gi=0;gi<allGroups.length;gi++) {
    const group=allGroups[gi];
    const late=gi>=state.rules.length;
    const loops=late ? state.lateLoopPoint : state.loopPoint;
    const local=late ? gi-state.rules.length : gi;
    groups.push([rules.length, group.length, Number(group[0].isRandom), loops[local] === undefined ? 0xffffffff : loops[local]+(late?state.rules.length:0)]);
    for (const rule of group) {
      if (rule.patterns.length > 4) reject('more than 4 bracket rows');
      let cmd=0;
      for (const c of rule.commands) {const bit=commands.indexOf(c[0]);if(bit<0)reject('command '+c[0]);cmd|=1<<bit;}
      const ordinal=rule.rigid ? state.groupNumber_to_RigidGroupIndex[rule.groupNumber]+1 : 0;
      if (ordinal>31) reject('rigid ordinal capacity');
      rules.push([rule.direction, rows.length, rule.patterns.length, cmd, ordinal, Number(rule.hasReplacements), rule.lineNumber,0]);
      for (const row of rule.patterns) {
        const ellipses=row.filter(p=>Array.isArray(p)).length;
        if (ellipses>1) reject('more than one ellipsis per row');
        if (row.length>16) reject('more than 16 pattern cells per row');
        rows.push([cells.length,row.length,ellipses,0]);
        for (const p of row) {
          if(Array.isArray(p)){cells.push([...Array(17).fill(0),1]);continue;}
          if(p.anyObjectsPresent.length>4)reject('more than 4 property predicates per cell');
          const any=p.anyObjectsPresent.map(word);while(any.length<4)any.push(0);
          const r=p.replacement;
          cells.push([word(p.objectsPresent),word(p.objectsMissing),word(p.movementsPresent),word(p.movementsMissing),p.anyObjectsPresent.length,...any,
            Number(r!==null),word(r?.objectsClear),word(r?.objectsSet),word(r?.movementsClear),word(r?.movementsSet),word(r?.movementsLayerMask),word(r?.randomEntityMask),word(r?.randomDirMask),0]);
        }
      }
    }
  }
  if(rules.length>4096 || cells.length>65536)reject('compiled rule capacity');
  const g=Array(32).fill(0);
  const section=(slot,data)=>{g[slot]=g.length;g.push(...data.flat());};
  Object.assign(g,{0:1,1:level.width,2:level.height,3:state.collisionLayers.length,4:state.objectCount,5:word(state.playerMask[1]),6:Number(state.playerMask[0]),
    7:groups.length,8:state.rules.length,9:rules.length,10:cells.length,
    11:('noundo' in state.metadata?1:0)|('norestart' in state.metadata?2:0)|('require_player_movement' in state.metadata?4:0),
    18:state.loopPoint[state.rules.length]??0xffffffff,
    19:state.lateLoopPoint[state.lateRules.length]===undefined?0xffffffff:state.lateLoopPoint[state.lateRules.length]+state.rules.length,
    20:rows.length,22:state.winconditions.length});
  section(12,state.layerMasks.map(word));section(13,groups);section(14,rules);section(15,rows);section(16,cells);
  section(17,Array.from({length:32},(_,ordinal)=>state.rigidGroupIndex_to_GroupIndex[ordinal-1]??31));
  section(21,state.winconditions.map(w=>[w[0]+1,word(w[1]),word(w[2]),Number(w[4]),Number(w[5])]));
  const initial=Array(13120).fill(0);
  for(let i=0;i<256;i++) initial[64+i]=RandomGen._state.s[i];
  for(let i=0;i<level.n_tiles;i++){initial[320+i]=level.objects[i]>>>0;initial[1344+i]=level.objects[i]>>>0;}
  const op=o=> typeof o==='number'?o:({up:0,left:1,down:2,right:3,action:4,tick:5,undo:6,restart:7})[o];
  const ops=operations.map(op);if(ops.some(o=>!Number.isInteger(o)||o<0||o>7))reject('unknown operation');
  return {format:'puzzlescript-gpu-v1',authority:REVISION,name,game:g,initial,operations:ops};
}
function snapshot(modified=false) {
  let after={dat:[...level.objects],width:level.width,height:level.height,oldflickscreendat:[...oldflickscreendat]};
  const history=Array(backups.length);
  for(let i=backups.length-1;i>=0;i--){after=unconsolidateDiff(backups[i],after);history[i]=words(after.dat);}
  return {board:words(level.objects),movements:words(level.movements),rng:{i:RandomGen._state.i,j:RandomGen._state.j,s:[...RandomGen._state.s]},
    history,restart:words(restartTarget.dat),againing,winning,checkpoint:hasUsedCheckpoint,effects,modified:Boolean(modified),commands:0,
    created:word(sfxCreateMask),destroyed:word(sfxDestroyMask),diagnostics};
}
function operate(op) {
  effects=0;diagnostics=0;outputEvents=[];let modified=false;
  if(op===6){const n=backups.length;DoUndo(false,false);modified=backups.length!==n;}
  else if(op===7){modified=!('norestart' in state.metadata);DoRestart(false);}
  else modified=processInput(op===5?-1:op);
  return snapshot(modified);
}
function wideSnapshot(base = snapshot(false)) {
  return { ...base, created: words(sfxCreateMask.data), destroyed: words(sfxDestroyMask.data),
    events: outputEvents.map(event => ({ ...event })), message: messagetext, textMode };
}
function identity(){return {revision:REVISION,manifestSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'oracle-source.json'))).digest('hex'),root};}
module.exports={initialize,upload,compileGame,compileProgram,loadProgramLevel,operate,snapshot,wideSnapshot,identity,REVISION,boardWire:()=>convertLevelToString()};
