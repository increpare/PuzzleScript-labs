'use strict';

function Level(lineNumber, width, height, layerCount, objects) {
	this.lineNumber = lineNumber;
	this.width = width;
	this.height = height;
	this.n_tiles = width * height;
	this.objects = objects;
	this.layerCount = layerCount;
	this.commandQueue = [];
	this.commandQueueSourceRules = [];
}

Level.prototype.clone = function () {
	let clone = new Level(this.lineNumber, this.width, this.height, this.layerCount, null);
	clone.objects = new Int32Array(this.objects);
	return clone;
}

Level.prototype.getCell = function (index) {
	return new BitVec(this.objects.subarray(index * STRIDE_OBJ, index * STRIDE_OBJ + STRIDE_OBJ));
}

Level.prototype.getCellInto = function (index, targetarray) {
	for (let i = 0; i < STRIDE_OBJ; i++) {
		targetarray.data[i] = this.objects[index * STRIDE_OBJ + i];
	}
	return targetarray;
}

Level.prototype.setCell = function (index, vec) {
	if (this.solverZobristUpdateCell) {
		this.solverZobristUpdateCell(index, vec);
	}
	for (let i = 0; i < vec.data.length; ++i) {
		if (this.objects[index * STRIDE_OBJ + i] !== vec.data[i]) {
			turnObjectsModified = true;
		}
		this.objects[index * STRIDE_OBJ + i] = vec.data[i];
	}
}

let _movementVecs;
let _movementVecIndex = 0;
Level.prototype.getMovements = function (index) {
	let _movementsVec = _movementVecs[_movementVecIndex];
	_movementVecIndex = (_movementVecIndex + 1) % _movementVecs.length;

	for (let i = 0; i < STRIDE_MOV; i++) {
		_movementsVec.data[i] = this.movements[index * STRIDE_MOV + i];
	}
	return _movementsVec;
}

Level.prototype.getRigids = function (index) {
	return this.rigidMovementAppliedMask[index].clone();
}

Level.prototype.getMovementsInto = function (index, targetarray) {
	let _movementsVec = targetarray;

	for (let i = 0; i < STRIDE_MOV; i++) {
		_movementsVec.data[i] = this.movements[index * STRIDE_MOV + i];
	}
	return _movementsVec;
}

Level.prototype.setMovements = function (index, vec) {
	for (let i = 0; i < vec.data.length; ++i) {
		this.movements[index * STRIDE_MOV + i] = vec.data[i];
	}

	//corresponding object stuff in repositionEntitiesOnLayer
	let colIndex = (index / this.height) | 0;
	let rowIndex = (index % this.height);
	this.colCellContents_Movements[colIndex].ior(vec);
	this.rowCellContents_Movements[rowIndex].ior(vec);
	this.mapCellContents_Movements.ior(vec);
}


function LEVEL_SET_MOVEMENTS(index, vec, array_size) {
	var result = "{";
	for (let i = 0; i < array_size; i++) {
		result += `\tlevel.movements[${index}*${array_size}+${i}]=${vec}.data[${i}];\n`;
	}
	result += `
	const colIndex=(${index}/level.height)|0;
	const rowIndex=(${index}%level.height);

	${UNROLL(`level.colCellContents_Movements[colIndex] |= ${vec}`, array_size)}
	${UNROLL(`level.rowCellContents_Movements[rowIndex] |= ${vec}`, array_size)}
	${UNROLL(`level.mapCellContents_Movements |= ${vec}`, array_size)}
}`

	return result;
}

//same as LEVEL_SET_MOVEMENTS, but expects colIndex/rowIndex to already be in scope
//(so callers that also update the object masks don't compute the div/mod twice)
function LEVEL_SET_MOVEMENTS_REUSE_INDICES(index, vec, array_size) {
	var result = "";
	for (let i = 0; i < array_size; i++) {
		result += `\tlevel.movements[${index}*${array_size}+${i}]=${vec}.data[${i}];\n`;
	}
	result += `
	${UNROLL(`level.colCellContents_Movements[colIndex] |= ${vec}`, array_size)}
	${UNROLL(`level.rowCellContents_Movements[rowIndex] |= ${vec}`, array_size)}
	${UNROLL(`level.mapCellContents_Movements |= ${vec}`, array_size)}
`

	return result;
}

Level.prototype.calcBackgroundMask = function (state) {
	if (state.backgroundlayer === undefined) {
		logError("you have to have a background layer");
		return new BitVec(STRIDE_OBJ);
	}

	let backgroundMask = state.layerMasks[state.backgroundlayer];
	if (backgroundMask === undefined) {
		logError("the background layer is invalid");
		return new BitVec(STRIDE_OBJ);
	}
	for (let i = 0; i < this.n_tiles; i++) {
		let cell = this.getCell(i);
		cell.iand(backgroundMask);
		if (!cell.iszero()) {
			return cell;
		}
	}
	const cell = new BitVec(STRIDE_OBJ);
	if (state.backgroundid !== undefined) {
		cell.ibitset(state.backgroundid);
	}
	return cell;
}
