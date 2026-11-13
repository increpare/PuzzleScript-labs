'use strict';
// Pure transport conversion using the compiler's immutable object provenance.
// It performs no gameplay, so it need not wait behind JS replay requests.
const assert=require('node:assert/strict');
function boardGrid(prepared,board,original=false){
 const a=prepared.original,b=original?a:prepared.solver,w=board?.w,h=board?.h;
 assert(Number.isInteger(w)&&w>0&&w<=512&&Number.isInteger(h)&&h>0&&h<=512&&w*h<=65536,'MIS CPU board capacity65536 cells');
 assert(board.cells&&(Array.isArray(board.cells)||ArrayBuffer.isView(board.cells))&&board.cells.length===w*h*a.stride,'MIS board stride');
 assert(w*h*b.layerCount<=131072,'MIS grid capacity131072');
 const grid=new Int32Array(w*h*b.layerCount).fill(-1);
 for(let tile=0;tile<w*h;tile++){const seen=new Set(),x=Math.floor(tile/h),y=tile%h;for(let word=0;word<a.stride;word++){
  const value=board.cells[tile*a.stride+word];assert(Number.isInteger(value)&&value>=-2147483648&&value<=0xffffffff,'MIS object word');let bits=value>>>0;
  while(bits){const id=word*32+31-Math.clz32(bits&-bits),object=a.objects[id];assert(object&&object.layer>=0,'MIS unknown object bit');assert(!seen.has(object.layer),'MIS multiple objects in one collision layer');seen.add(object.layer);
   const mapped=original?id:prepared.idMap[id];assert(Number.isInteger(mapped),'MIS object provenance');if(mapped>=0){const target=b.objects[mapped];assert(target&&target.layer>=0,'MIS projected object identity');const index=target.layer*w*h+y*w+x;assert(grid[index]===-1||grid[index]===mapped,'MIS projected collision');grid[index]=mapped;}
   bits=(bits&(bits-1))>>>0;
  }
 }}
 return {width:w,height:h,grid:Array.from(grid)};
}
module.exports={boardGrid};
