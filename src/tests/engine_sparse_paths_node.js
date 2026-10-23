#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {compileGameFile} = require('./run_solver_tests_js');
compileGameFile(path.join(__dirname,'solver_smoke_tests/one_move.txt'),{quiet:true});
lazyFunctionGeneration = false;
STRIDE_OBJ = STRIDE_MOV = 2;
_o2_5 = new BitVec(2);
sfxCreateMask = new BitVec(2);sfxDestroyMask = new BitVec(2);
const bv = words => new BitVec(words);
const empty = () => bv([0,0]);
const replacement = (clear,set,moveClear=[0,0],moveSet=[0,0]) => new CellReplacement([
    bv(clear),bv(set),bv(moveClear),bv(moveSet),empty(),empty(),empty(),[]
]);
const board = () => ({height:1,objects:new Int32Array([1,8]),movements:new Int32Array([0,2]),
    rowCellContents:[empty()],colCellContents:[empty()],mapCellContents:empty(),
    rowCellContents_Movements:[empty()],colCellContents_Movements:[empty()],mapCellContents_Movements:empty()});
const rule = {rigid:false};
const cell = {replacement:replacement([1,0],[2,0])};
const replace = CellPattern.prototype.generateReplaceFunction.call(cell,2,2,rule);
const testBoard=board();let hashCalls=0;
testBoard.solverZobristUpdateCell=(index,next)=>{
    hashCalls++;assert.equal(index,0);assert.deepEqual([...testBoard.objects],[1,8]);
    assert.deepEqual([...next.data],[2,8]);
};
turnObjectsModified=false;
assert(replace.call(cell,testBoard,rule,0));
assert.equal(hashCalls,1);assert(turnObjectsModified);assert.deepEqual([...testBoard.objects],[2,8]);
turnObjectsModified=false;
assert.equal(replace.call(cell,testBoard,rule,0),false);assert.equal(hashCalls,1);assert.equal(turnObjectsModified,false);
const moveCell={replacement:replacement([0,0],[0,0],[0,2],[0,4])};
assert(CellPattern.prototype.generateReplaceFunction.call(moveCell,2,2,rule).call(moveCell,testBoard,rule,0));
assert.equal(turnObjectsModified,false);assert.equal(hashCalls,1);assert.deepEqual([...testBoard.movements],[0,4]);
const otherCell={replacement:replacement([0,8],[0,16])};
assert.notEqual(CellPattern.prototype.generateReplaceFunction.call(otherCell,2,2,rule),replace,'cache must distinguish word positions');
// An advanced predicate needs words absent from the ordinary present/missing masks.
const pattern=new CellPattern([bv([1,0]),empty(),[],empty(),empty(),null,[{layers:[{
    objectMask:bv([0,2]),movementsAny:bv([0,1]),movementsPresent:empty(),movementsMissing:empty()
}]}],[]]);
assert(pattern.matches.call(pattern,0,new Int32Array([1,2]),new Int32Array([0,1])));
assert.equal(Boolean(pattern.matches.call(pattern,0,new Int32Array([1,2]),new Int32Array([0,0]))),false);
// A final generator may append work or throw; no consumed entries may remain live.
let generated=0;
const work=()=>Object.assign(Object.create(CellPattern.prototype),{generateMatchFunction(){generated++;return ()=>true}});
const first=work();first.generateMatchFunction=function(){generated++;WORKLIST_OBJECTS_TO_GENERATE_FUNCTIONS_FOR.push(work());return ()=>true};
lazy_function_generation_clear_backlog();WORKLIST_OBJECTS_TO_GENERATE_FUNCTIONS_FOR.push(first);
tick_lazy_function_generation();assert.equal(generated,2);assert.equal(WORKLIST_GENERATION_INDEX,0);assert.equal(WORKLIST_OBJECTS_TO_GENERATE_FUNCTIONS_FOR.length,0);
const failing=work();failing.generateMatchFunction=()=>{throw Error('test generation failure')};
WORKLIST_OBJECTS_TO_GENERATE_FUNCTIONS_FOR.push(failing);
assert.throws(()=>tick_lazy_function_generation(),/test generation failure/);
assert.equal(WORKLIST_OBJECTS_TO_GENERATE_FUNCTIONS_FOR.length,0);
WORKLIST_OBJECTS_TO_GENERATE_FUNCTIONS_FOR.push(failing,work());
assert.throws(()=>tick_lazy_function_generation(),/test generation failure/);
tick_lazy_function_generation();assert.equal(generated,3);
assert.equal(WORKLIST_OBJECTS_TO_GENERATE_FUNCTIONS_FOR.length,0);
// Direct application must retain command queuing and fall back for capture bindings/debugging.
let direct=0,fallback=0,commands=0;
const fake={direction:8,hasReplacements:true,patterns:[[{replace(){direct++;return true}}]],ellipsisCount:[0],
    propertyBindingsArr:null,aggregateBindingsArr:null,rulePlanMetadata:{row_count:1},
    findMatches:()=>[[0,1]],applyAt(){fallback++;return true},queueCommands(){commands++}};
verbose_logging=false;assert(Rule.prototype.tryApply.call(fake,{height:1}));assert.equal(direct,2);assert.equal(commands,1);
for(const binding of ['propertyBindingsArr','aggregateBindingsArr']){
    fake[binding]=[];Rule.prototype.tryApply.call(fake,{height:1});fake[binding]=null;
}
verbose_logging=true;Rule.prototype.tryApply.call(fake,{height:1});verbose_logging=false;
assert.equal(direct,2);assert.equal(fallback,6);assert.equal(commands,4);
console.log('engine_sparse_paths_node passed');
