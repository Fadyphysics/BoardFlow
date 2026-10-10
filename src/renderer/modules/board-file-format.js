const MAX_BOARD_FILE_BYTES = 25 * 1024 * 1024;
const MAX_BOARD_OBJECTS = 5000;
const MAX_BOARD_NESTING = 20;
const MAX_BOARD_COORDINATE = 1000000;

function isPlainRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isSafeFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_BOARD_COORDINATE;
}

function validateSerializedObject(object, depth, counter, layerIds) {
    if (!isPlainRecord(object) || typeof object.type !== 'string' || !object.type || object.type.length > 64) return false;
    if (depth > MAX_BOARD_NESTING || ++counter.count > MAX_BOARD_OBJECTS) return false;
    for (const key of ['left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle', 'skewX', 'skewY']) {
        if (key in object && !isSafeFiniteNumber(object[key])) return false;
    }
    if (('width' in object && object.width < 0) || ('height' in object && object.height < 0)) return false;
    if ('boardflowLayer' in object && !layerIds.includes(object.boardflowLayer)) return false;
    return !object.objects || (
        Array.isArray(object.objects)
        && object.objects.every(child => validateSerializedObject(child, depth + 1, counter, layerIds))
    );
}

function validateBoardLessonData(data, byteLength, themes, layerIds) {
    if (!isPlainRecord(data)
        || (data.app !== 'BoardFlow' && data.app !== 'BoardView')
        || byteLength > MAX_BOARD_FILE_BYTES) return false;

    const canvasState = Array.isArray(data.objects) ? { objects: data.objects } : data.objects;
    if (!isPlainRecord(canvasState) || !Array.isArray(canvasState.objects)) return false;
    const counter = { count: 0 };
    if (!canvasState.objects.every(object => validateSerializedObject(object, 0, counter, layerIds))) return false;
    if (data.theme !== undefined && !Object.hasOwn(themes, data.theme)) return false;
    if (data.grid !== undefined && typeof data.grid !== 'boolean') return false;
    if (data.viewport !== undefined) {
        if (!Array.isArray(data.viewport) || data.viewport.length !== 6 || !data.viewport.every(isSafeFiniteNumber)) return false;
        if (Math.abs(data.viewport[0] * data.viewport[3] - data.viewport[1] * data.viewport[2]) < 0.000001) return false;
    }
    for (const key of ['pageNum', 'boardPage', 'boardPages']) {
        if (data[key] !== undefined && (!Number.isInteger(data[key]) || data[key] < 0 || data[key] > MAX_BOARD_OBJECTS)) return false;
    }
    if (data.layers !== undefined && !isPlainRecord(data.layers)) return false;
    return canvasState;
}

export { validateBoardLessonData };
