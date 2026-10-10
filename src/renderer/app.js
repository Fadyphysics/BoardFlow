import './bf-globals.js';
import * as fabric from 'fabric';
if (typeof window !== 'undefined' && !window.fabric) {
    window.fabric = fabric;
}
import { updateDateLabel } from './date.js';
import { byId } from './dom.js';
import { createMathIntelligence } from './math-intelligence.js';
let smartGraphs = null;
const smartGraphsReady = import('./smart-graph.js').then(module => { smartGraphs = module; }).catch(() => {});
import { createClassroomSuite } from './classroom-suite.js';
import { isScratchOut, denseScratchPoints, scratchPasses } from './scribble-gesture.js';
import { isElectron, isCapacitor, isWeb } from './utils/host.js';
if (isWeb() && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
        .catch(error => console.error('Unable to register offline app support', error));
}
import { normalizeInkStroke, groupStrokesByTime, normalizePointsToOrigin, calculateAdvancedMetrics } from './ink-pipeline.js';
import { classifyNormalizedStroke, convertShapeToFabric } from './ink-shape-recognition.js';
import { analyzeSelectedObjects, analyzeAllObjects, createMeasurementOverlays, removeMeasurementOverlays } from './geometry-engine.js';
import { recognizeHandwritingFromStrokes } from './handwriting-recognition.js';
import { recognizeTable } from './table-recognition.js';

import { sampleInkPath, canAutoConvert, recognizedTextLines } from './recognition-input.js';
import { loadPdfDocument } from './pdf-service.js';
import { hashDeletePin } from './security.js';
import {
    ACTIVE_SUBJECT_STORE,
    getAppFolder,
    getCheckpoint,
    getSubjectFolder,
    loadPreference,
    putAppFolder,
    putCheckpoint,
    putSubjectFolder,
    readSubjects,
    savePreference,
    writeSubjects
} from './persistence.js';
import { canvas, wrap, updateViewChip, updateGridBackground } from './modules/canvas-core.js';
import { validateBoardLessonData } from './modules/board-file-format.js';
import { createHistoryManager } from './modules/history-manager.js';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const CUSTOM_OBJECT_PROPERTIES = ['isFile', 'isSketch', 'isShape', 'isTriangle', 'isArrow', 'angleShow', 'boardflowEraseSpots', 'boardflowErasePaths', 'boardflowId', 'boardflowKind', 'boardflowPayload', 'boardflowLayer', 'boardflowArrowStart', 'boardflowArrowEnd', 'boardflowArrowThickness'];
const loadPref = loadPreference;
const savePref = savePreference;
let resolveStartupReady;
const startupReady = new Promise(resolve => { resolveStartupReady = resolve; });

document.addEventListener('pointerdown', event => {
    if (event.target.closest('#geometryToolRail, #geometryInsight')) return;
    if (selectedNatHit && !event.target.closest('canvas')) closeGeometryTools();
});

const LAYER_IDS = ['lesson', 'teacher', 'student', 'answers'];
let appMode = loadPref('bv-app-mode') || 'teacher';
let activeLayer = loadPref('bv-active-layer') || (appMode === 'student' ? 'student' : 'teacher');
let presentationMode = false;
let classroomSuite = null;
let layerState;
try {
    layerState = JSON.parse(loadPref('bv-layer-state') || 'null');
} catch {
    layerState = null;
}
layerState = Object.fromEntries(LAYER_IDS.map(id => [id, {
    visible: layerState?.[id]?.visible !== false,
    locked: !!layerState?.[id]?.locked
}]));
layerState.answers.visible = layerState?.answers?.visible === true;
function objectLayer(object) { return object.boardflowLayer || (object.isFile ? 'lesson' : 'teacher'); }
function layerLocked(layer) {
    return presentationMode || layerState[layer]?.locked || (appMode === 'student' && layer !== 'student');
}
function layerCanEdit(object) {
    if (object?.type === 'activeSelection' && object.getObjects) return object.getObjects().every(layerCanEdit);
    const layer = objectLayer(object);
    return layerState[layer]?.visible !== false && !layerLocked(layer);
}
function persistLayerState() {
    savePref('bv-app-mode', appMode);
    savePref('bv-active-layer', activeLayer);
    savePref('bv-layer-state', JSON.stringify(layerState));
}
const canvasPoint = event => canvas.getScenePoint(event);
const objectLocalPoint = (object, point) => fabric.util.transformPoint(
    new fabric.Point(point.x, point.y),
    fabric.util.invertTransform(object.calcTransformMatrix())
);

let checkpointTimer = null;
let lastUploadedFile = null;
function cancelInkRecognition() {
    recognitionGeneration++;
    clearTimeout(inkAssistTimer);
    recentInkStrokes = [];
}
const historyManager = createHistoryManager({
    canvas,
    fabric,
    customObjectProperties: CUSTOM_OBJECT_PROPERTIES,
    currentFileVisualState,
    restoreCurrentFileVisualState,
    layerCanEdit,
    scheduleCheckpoint,
    attachApexControl,
    attachArrowControls,
    rebuildEraseMask,
    applyInteractivity,
    applyFileErasability,
    cancelInkRecognition,
    byId
});
const {
    annotationsJSON,
    pushSnapshotNow,
    queueSnapshot,
    clearPendingSnapshot,
    resetHistory,
    undo,
    redo,
    clearEditableAnnotations,
    historyTrigger,
    applyAnnotationStateAsync,
    isSuppressed: isHistorySuppressed,
    isApplying: isHistoryApplying,
    setSuppressed: setHistorySuppressed
} = historyManager;

// Store normalized ink for debugging/testing purposes
window.__normalizedInk = [];
window.__lastShapeResult = null;
window.__lastHandwritingResult = null;
window.__lastEquationResult = null;
window.__lastSmartMathResult = null;
window.__lastTableResult = null;

// Function to handle table recognition
function handleTableRecognition(originalPath, normalizedStroke) {
    // For table recognition, we need multiple strokes to form a grid
    // So we'll need to collect recent strokes and check for grid patterns
    const recognitionMode = inkAssistMode;
    
    if (recognitionMode === 'tables' || recognitionMode === 'data') { // We'll use 'tables' mode for table recognition
        // For now, we'll just use the single stroke, but in a full implementation
        // we would collect multiple strokes to form a grid
        const strokes = [normalizedStroke];
        
        try {
            const tableResult = recognizeTable(strokes);
            
            if (tableResult && tableResult.tableObject && tableResult.confidence >= 0.7) {
                // Remove the original path and add the recognized table object
                canvas.remove(originalPath);
                canvas.add(tableResult.tableObject);
                canvas.setActiveObject(tableResult.tableObject);
                canvas.requestRenderAll();
                
                // Store the result for diagnostic purposes
                window.__lastTableResult = tableResult;
                
                return true;
            }
        } catch (error) {
            console.warn('Table recognition error:', error);
        }
    }
    
    return false;
}

// Function to capture and normalize ink strokes
function captureNormalizedInk(event) {
    const object = event.target;
    
    // Only process path/pencil objects that are not files
    if (object && object.type === 'path' && !object.isFile && layerCanEdit(object)) {
        // Normalize the ink stroke without interfering with the original drawing
        const normalizedStroke = normalizeInkStroke(object, sketchWorldPolyline(object));
        
        if (normalizedStroke) {
            // Store for debugging purposes
            window.__normalizedInk.push(normalizedStroke);
            
            // Keep only the last 100 strokes to prevent memory issues
            if (window.__normalizedInk.length > 100) {
                window.__normalizedInk = window.__normalizedInk.slice(-100);
            }
            
            // Perform recognition based on the current mode
            const recognitionMode = inkAssistMode;
            
            if (recognitionMode === 'shapes') {
                // Perform shape recognition on the normalized stroke
                try {
                    const shapeResult = classifyNormalizedStroke(normalizedStroke);
                    
                    // Store the last shape result for diagnostic purposes
                    window.__lastShapeResult = shapeResult;
                    
                    // Attempt to convert the shape if confidence is high enough
                    if (shapeResult && shapeResult.confidence >= 0.75 && shapeResult.shapeType !== 'none') {
                        // Only convert shapes, not handwriting
                        if (recognitionMode === 'shapes') {
                            convertRecognizedShape(object, shapeResult);
                        }
                    }
                } catch (error) {
                    console.warn('Error in shape recognition:', error);
                }
            } else if (recognitionMode === 'tables' || recognitionMode === 'data') {
                // Handle table recognition
                handleTableRecognition(object, normalizedStroke);
            }
            
            // Log for debugging (only in development)
            if (typeof window !== 'undefined' && window.location && window.location.hostname === 'localhost') {
                console.log(`Recognition mode: ${recognitionMode}`, normalizedStroke);
            }
        }
    }
}

// Diagnostic function for testing
window.__getLastShapeResult = function() {
    return window.__lastShapeResult;
};

// Diagnostic function for handwriting recognition
window.__getLastHandwritingResult = function() {
    return window.__lastHandwritingResult;
};

// Diagnostic function for equation recognition
window.__getLastEquationResult = function() {
    return window.__lastEquationResult;
};

// Diagnostic function for table recognition
window.__getLastTableResult = function() {
    return window.__lastTableResult;
};

// Diagnostic function for workspace state
window.__getWorkspaceState = function() {
    if (window.classroomSuite) {
        return {
            boards: window.classroomSuite.getBoards(),
            activeBoardId: window.classroomSuite.getActiveBoardId(),
            canvasState: canvas.toJSON()
        };
    }
    return null;
};

// Diagnostic function for smart math results
window.__getLastSmartMathResult = function() {
    return window.__lastSmartMathResult;
};

// Function to convert recognized shapes to fabric objects
function convertRecognizedShape(originalPath, shapeResult) {
    if (!canvas.getObjects().includes(originalPath) || !shapeResult || shapeResult.confidence < 0.75 || shapeResult.shapeType === 'none') {
        return false; // Don't convert if confidence is too low or shape is 'none'
    }
    
    // Convert the recognized shape to a fabric object
    const convertedObject = convertShapeToFabric(shapeResult, originalPath);
    
    if (convertedObject) {
        convertedObject.isSketch = true;
        convertedObject.isShape = true;
        convertedObject.boardflowKind = `recognized-${shapeResult.shapeType}`;
        convertedObject.boardflowLayer = originalPath.boardflowLayer;
        if (shapeResult.shapeType === 'triangle') {
            convertedObject.isTriangle = true;
            attachApexControl(convertedObject);
        }
        // Replace the original path with the converted object
        canvas.remove(originalPath);
        canvas.add(convertedObject);
        canvas.setActiveObject(convertedObject);
        canvas.requestRenderAll();
        return true;
    }
    
    return false;
}

canvas.on('object:added', historyTrigger);
canvas.on('object:added', event => {
    const object = event.target;
    if (object && !object.boardflowLayer) object.boardflowLayer = object.isFile ? 'lesson' : activeLayer;
    if (object?.stroke && !object.isSketch) object.set('strokeUniform', true);
    applyInteractivity();
    
    // Capture normalized ink data for future recognition processing
    captureNormalizedInk(event);
});
canvas.on('object:removed', historyTrigger);
canvas.on('object:modified', historyTrigger);
canvas.on('object:modified', e => {
    const o = e.target;
    if (o && o.type === 'textbox' && (o.scaleX !== 1 || o.scaleY !== 1)) {
        o.set({ width: o.width * o.scaleX, fontSize: o.fontSize * o.scaleY, scaleX: 1, scaleY: 1 });
    }
});
function scheduleCheckpoint() {
    clearTimeout(checkpointTimer);
    setSaveStatus('Saving recovery copy…');
    checkpointTimer = setTimeout(() => saveCheckpoint().catch(error => {
        console.error('Unable to auto-save checkpoint', error);
        setSaveStatus('Autosave failed. Export a copy.', true);
        setStatus('Autosave failed. Keep BoardFlow open and export a copy.', true);
    }), 500);
}
byId('btnUndo').onclick = undo;
byId('btnUndoQuick').onclick = undo;
byId('btnClearQuick').onclick = clearEditableAnnotations;
byId('btnRedo').onclick = redo;

const pageMemory = new Map(); // "boardPage:pdfPage" -> annotations JSON
let boardPage = 0, boardPages = 1;
canvas.on('path:created', opt => {
    console.log('🔥 PATH CREATED! Current tool:', tool);
    console.log('Path object:', opt.path);
    const p = opt.path;
    const trivial = (p.path && p.path.length <= 1) || (p.width < 2 && p.height < 2);
    if (trivial) { canvas.remove(p); canvas.requestRenderAll(); return; }
    p.isSketch = true;
    p.boardflowLayer = activeLayer;
    p.set({ strokeLineCap: 'round', strokeLineJoin: 'round', objectCaching: false });
    if (tryScratchOut(p)) return;
    if (penPressureSamples.length) {
        const pressure = penPressureSamples.reduce((sum, value) => sum + value, 0) / penPressureSamples.length;
        p.set('strokeWidth', penWidth * clamp(0.55 + pressure, 0.65, 1.5));
    }
    
    if (!canvas.getObjects().includes(p)) return;
    
    // MyScript Interactive Ink owns recognition and edit gestures. BoardFlow
    // keeps ordinary erasers, but does not run its former scratch classifier.
    if (!isHistorySuppressed()) queueInkAssist(p);

});
function groupRecognitionInk(objects) {
    const groups = [];
    const closeToGroup = (bounds, groupBounds) => {
        const horizontalGap = Math.max(
            0,
            bounds.left - (groupBounds.left + groupBounds.width),
            groupBounds.left - (bounds.left + bounds.width)
        );
        const verticalGap = Math.max(
            0,
            bounds.top - (groupBounds.top + groupBounds.height),
            groupBounds.top - (bounds.top + bounds.height)
        );
        const height = Math.max(bounds.height, groupBounds.height, 1);
        return horizontalGap <= height * 0.7 && verticalGap <= height * 0.45;
    };

    objects.forEach(object => {
        if (!object?.isSketch || !canvas.getObjects().includes(object)) return;
        const bounds = object.getBoundingRect();
        const matchingGroups = groups.filter(group => closeToGroup(bounds, group.bounds));
        if (!matchingGroups.length) {
            groups.push({ objects: [object], bounds: { ...bounds }, firstIndex: objects.indexOf(object) });
            return;
        }
        const primary = matchingGroups[0];
        primary.objects.push(object);
        const left = Math.min(primary.bounds.left, bounds.left);
        const top = Math.min(primary.bounds.top, bounds.top);
        const right = Math.max(primary.bounds.left + primary.bounds.width, bounds.left + bounds.width);
        const bottom = Math.max(primary.bounds.top + primary.bounds.height, bounds.top + bounds.height);
        primary.bounds = { left, top, width: right - left, height: bottom - top };
        matchingGroups.slice(1).forEach(merged => {
            primary.objects.push(...merged.objects);
            const mergedRight = merged.bounds.left + merged.bounds.width;
            const mergedBottom = merged.bounds.top + merged.bounds.height;
            primary.bounds.left = Math.min(primary.bounds.left, merged.bounds.left);
            primary.bounds.top = Math.min(primary.bounds.top, merged.bounds.top);
            const rightEdge = Math.max(primary.bounds.left + primary.bounds.width, mergedRight);
            const bottomEdge = Math.max(primary.bounds.top + primary.bounds.height, mergedBottom);
            primary.bounds.width = rightEdge - primary.bounds.left;
            primary.bounds.height = bottomEdge - primary.bounds.top;
            primary.firstIndex = Math.min(primary.firstIndex, merged.firstIndex);
            groups.splice(groups.indexOf(merged), 1);
        });
    });

    return groups.sort((a, b) => a.firstIndex - b.firstIndex).map(group => group.objects.slice(0, 200));
}


function tryScratchOut(gesture) {
    if (isHistoryApplying() || isHistorySuppressed() || !layerCanEdit(gesture)) return false;
    const points = sketchWorldPolyline(gesture);
    if (!isScratchOut(points, canvas.getZoom())) return false;
    const samples = denseScratchPoints(points, 2 / canvas.getZoom());
    const edits = [];
    for (const object of canvas.getObjects()) {
        if (object === gesture || object.isFile || object.boardflowTransient || !object.visible || !layerCanEdit(object)) continue;
        const local = samples.map(p => objectLocalPoint(object, p));
        const hitWidth = Math.max(object.width, 8 / canvas.getZoom()), hitHeight = Math.max(object.height, 8 / canvas.getZoom());
        const box = { left: -hitWidth / 2, top: -hitHeight / 2, width: hitWidth, height: hitHeight };
        if (!local.some(p => p.x >= box.left && p.x <= box.left + box.width && p.y >= box.top && p.y <= box.top + box.height)) continue;
        if (object.removeChars && !object.path && object.direction !== 'rtl') {
            const indices = [];
            let top = object._getTopOffset(), index = 0;
            object._textLines.forEach((line, row) => {
                object.measureLine(row); // Bounds may be empty before first render.
                const height = object.getHeightOfLine(row);
                const left = object._getLeftOffset() + object._getLineLeftOffset(row);
                line.forEach((char, col) => {
                    const cell = object.__charBounds[row]?.[col];
                    // The middle of the letter must be crossed, not just an
                    // overhanging edge of a scratch on its neighbour.
                    if (cell && scratchPasses(local, { left: left + cell.left + cell.width * .3, top, width: cell.width * .4, height: height / object.lineHeight }) >= 3) indices.push(index + col);
                });
                index += line.length + object.missingNewlineOffset(row);
                top += height;
            });
            if (indices.length) edits.push(() => {
                indices.reverse().forEach(i => object.removeChars(i, i + 1));
                if (!object.text.trim()) canvas.remove(object);
            });
        } else {
            if (scratchPasses(local, box) >= 3) edits.push(() => {
                canvas.remove(object);
                if (object.boardflowKind === 'equation') canvas.getObjects().filter(o => o.boardflowKind === 'linked-graph' && o.boardflowPayload?.equationId === object.boardflowId && layerCanEdit(o)).forEach(o => canvas.remove(o));
            });
        }
    }
    if (!edits.length) return false;
    clearPendingSnapshot();
    cancelInkRecognition();
    setHistorySuppressed(true);
    try {
        canvas.remove(gesture); // Undo restores the content, never this gesture.
        pushSnapshotNow();
        canvas.discardActiveObject();
        edits.forEach(edit => edit());
    } finally { setHistorySuppressed(false); }
    pushSnapshotNow();
    canvas.requestRenderAll();
    scheduleCheckpoint();
    return true;
}
function hasInk() { return canvas.getObjects().some(o => !o.isFile); }
function removeAnnotationsSilent() {
    canvas.getObjects().filter(o => !o.isFile).forEach(o => canvas.remove(o));
    canvas.discardActiveObject();
    canvas.requestRenderAll();
}

// ================= Theme + Grid =================
const THEMES = {
    light: { bg: '#ffffff', grid: 'rgba(49,94,232,.20)' },
    dark: { bg: '#202327', grid: 'rgba(148,163,184,.18)' }
};
const storedTheme = loadPref('bv-theme');
const storedGrid = loadPref('bv-grid');
const themeDefaultsMigrated = loadPref('bv-theme-grid-default-v1') === '1';
const migrateOldDefaults = !themeDefaultsMigrated && storedTheme === 'light' && storedGrid === '0';
let theme = migrateOldDefaults ? 'dark' : storedTheme || 'dark';
let showGrid = migrateOldDefaults || storedGrid === null ? true : storedGrid === '1';
if (!themeDefaultsMigrated) savePref('bv-theme-grid-default-v1', '1');
const btnTheme = byId('btnTheme');
const btnGrid = byId('btnGrid');
function applyTheme() {
    canvas.backgroundColor = THEMES[theme].bg;
    canvas.requestRenderAll();
    updateGridBackground(theme, showGrid, THEMES);
    btnTheme.classList.toggle('active', theme === 'dark');
    btnGrid.classList.toggle('active', showGrid);
    savePref('bv-theme', theme); savePref('bv-grid', showGrid ? '1' : '0');
}
btnTheme.onclick = () => { theme = theme === 'light' ? 'dark' : 'light'; applyTheme(); };
btnGrid.onclick = () => { showGrid = !showGrid; applyTheme(); };
// ================= Brushes =================
const pen = new fabric.PencilBrush(canvas);
pen.color = loadPref('bv-pen-color') || '#ff3333';
pen.width = +(loadPref('bv-pen-width') || 2);
pen.decimate = 0.2;
pen.strokeLineCap = 'round';
pen.strokeLineJoin = 'round';
let penWidth = pen.width, eraseWidth = +(loadPref('bv-eraser-width') || 24);
let palmRejection = loadPref('bv-palm-rejection') !== '0';
let beautifyInk = loadPref('bv-beautify-ink') !== '0';
pen.decimate = beautifyInk ? 0.3 : 0.05;
let inkAssistMode = 'off';
window.currentRecognitionMode = inkAssistMode;
let recognitionGeneration = 0;
let recognitionPointerDown = false;
let inkAssistTimer = null;
let recentInkStrokes = [];
let lastPenPointerAt = 0;
let penPressureSamples = [];
wrap.addEventListener('pointerdown', event => {
    if (event.pointerType === 'pen') {
        lastPenPointerAt = Date.now();
        penPressureSamples = event.pressure > 0 ? [event.pressure] : [];
        return;
    }
    if (event.pointerType === 'touch' && palmRejection && Date.now() - lastPenPointerAt < 900) {
        event.preventDefault();
        event.stopImmediatePropagation();
    }
}, { capture: true, passive: false });
wrap.addEventListener('pointermove', event => {
    if (event.pointerType !== 'pen') return;
    lastPenPointerAt = Date.now();
    if (event.pressure > 0 && penPressureSamples.length < 240) penPressureSamples.push(event.pressure);
}, { capture: true, passive: true });
wrap.addEventListener('pointerup', event => {
    if (event.pointerType === 'pen') lastPenPointerAt = Date.now();
}, { capture: true, passive: true });

// ================= Tools =================
let tool = 'pen';
let activeFileForControls = null;
let hlColor = '#FFE600';
const btnSelect = byId('btnSelect');
const btnPen = byId('btnPen');
const btnArrow = byId('btnArrow');
const btnText = byId('btnText');
const btnEraserInk = byId('btnEraserInk');
const btnEraserAll = byId('btnEraserAll');
const swatches = [byId('hlYellow'), byId('hlPink'), byId('hlPist')];
const toolButtons = { select: btnSelect, pen: btnPen, arrow: btnArrow, text: btnText, eraserInk: btnEraserInk, eraserAll: btnEraserAll };
function applyFileErasability() {
    canvas.forEachObject(o => {
        o.erasable = layerCanEdit(o) && (tool === 'eraserAll' || (!o.isFile && tool !== 'eraserInk'));
    });
}
function applyInteractivity() {
    canvas.forEachObject(o => {
        const layer = objectLayer(o);
        o.visible = layerState[layer]?.visible !== false;
        const textish = (o.type === 'i-text' || o.type === 'textbox');
        const on = !o.isArrow && layerCanEdit(o) &&
            (o.isFile ? tool === 'select' && o === activeFileForControls : tool === 'select' || (tool === 'text' && textish));
        o.selectable = on; o.evented = on;
    });
    const active = canvas.getActiveObject();
    if (active && (!layerCanEdit(active) || active.selectable === false)) canvas.discardActiveObject();
    canvas.requestRenderAll();
}
function setTool(t) {
    tool = t;
    if (t !== 'select') activeFileForControls = null;
    Object.entries(toolButtons).forEach(([k, b]) => b.classList.toggle('active', k === t));
    swatches.forEach(b => b.classList.toggle('active', t === 'highlight' && b.dataset.c === hlColor));
    updateQuickPen();
    if (t === 'select') { canvas.isDrawingMode = false; canvas.selection = true; canvas.defaultCursor = 'default'; }
    else if (t === 'text') { canvas.isDrawingMode = false; canvas.selection = false; canvas.defaultCursor = 'text'; }
    else if (t === 'arrow' || t === 'highlight' || t === 'eraserInk' || t === 'eraserAll') { canvas.isDrawingMode = false; canvas.selection = false; canvas.defaultCursor = 'crosshair'; canvas.discardActiveObject(); }
    else { canvas.isDrawingMode = true; canvas.selection = false; canvas.freeDrawingCursor = 'crosshair'; canvas.freeDrawingBrush = pen; }
    applyInteractivity();
    applyFileErasability();
    const isEraserTool = (t === 'eraserInk' || t === 'eraserAll');
    byId('inkSize').value = isEraserTool ? eraseWidth : penWidth;
    byId('sizeLabel').textContent = isEraserTool ? 'Eraser size' : 'Pen size';
    updateQuickPen();
}
function setAppMode(mode) {
    appMode = mode === 'student' ? 'student' : 'teacher';
    if (appMode === 'student') activeLayer = 'student';
    else if (activeLayer === 'student') activeLayer = 'teacher';
    document.body.classList.toggle('student-mode', appMode === 'student');
    persistLayerState();
    applyInteractivity();
    applyFileErasability();
    classroomSuite?.renderLayers();
}
function setActiveLayer(layer) {
    if (!LAYER_IDS.includes(layer)) return;
    if (appMode === 'student' && layer !== 'student') return;
    activeLayer = layer;
    persistLayerState();
    classroomSuite?.renderLayers();
}
function setLayerVisible(layer, visible) {
    if (!layerState[layer]) return;
    layerState[layer].visible = !!visible;
    persistLayerState();
    applyInteractivity();
}
function setLayerLocked(layer, locked) {
    if (!layerState[layer] || (appMode === 'student' && layer !== 'student')) return;
    layerState[layer].locked = !!locked;
    persistLayerState();
    applyInteractivity();
    applyFileErasability();
}
function setPresentationMode(enabled) {
    presentationMode = !!enabled;
    document.body.classList.toggle('presentation-safe', presentationMode);
    applyInteractivity();
    if (presentationMode) {
        hideMenuNow();
        byId('classroomPanel').classList.add('hidden');
        byId('mathPanel').classList.add('hidden');
        setTool('select');
        setStatus('Presentation-safe mode is on. Press Esc or the menu button to exit.');
    } else {
        showMenu();
        setStatus('Presentation-safe mode is off.');
    }
}
function classroomLayerState() {
    return { mode: appMode, active: activeLayer, presentation: presentationMode, layers: layerState };
}
btnSelect.onclick = () => setTool('select');
btnPen.onclick = () => setTool('pen');
btnArrow.onclick = () => setTool('arrow');
btnText.onclick = () => setTool('text');
btnEraserInk.onclick = () => setTool('eraserInk');
btnEraserAll.onclick = () => setTool('eraserAll');
swatches.forEach(b => b.onclick = () => { hlColor = b.dataset.c; setTool('highlight'); });
byId('inkColor').value = pen.color;
byId('inkColor').oninput = e => {
    pen.color = e.target.value;
    savePref('bv-pen-color', pen.color);
};
byId('inkSize').oninput = e => {
    const s = +e.target.value;
    if (tool === 'eraserInk' || tool === 'eraserAll') {
        eraseWidth = s;
        savePref('bv-eraser-width', eraseWidth);
    } else {
        penWidth = s;
        savePref('bv-pen-width', penWidth);
    }
    pen.width = penWidth;
};
byId('btnClear').onclick = clearEditableAnnotations;
byId('btnSaveBoard').onclick = exportPNG;

// ================= SAFE ink eraser =================
let inkErasing = false;
let allErasing = false;
let activeEraseGesture = null;
let pendingErasePoint = null;
let eraseAnimationFrame = null;
function pointTouchesObject(object, point, radius) {
    const bounds = object.getBoundingRect();
    return point.x >= bounds.left - radius
        && point.x <= bounds.left + bounds.width + radius
        && point.y >= bounds.top - radius
        && point.y <= bounds.top + bounds.height + radius;
}
function maskFromErasePath(pathData) {
    const points = pathData.points || [];
    if (!points.length) return null;
    const radius = pathData.width / 2;
    const control = radius * 0.5522847498;
    const path = points.map(({ x, y }) =>
        `M ${x + radius} ${y} C ${x + radius} ${y + control} ${x + control} ${y + radius} ${x} ${y + radius}` +
        ` C ${x - control} ${y + radius} ${x - radius} ${y + control} ${x - radius} ${y}` +
        ` C ${x - radius} ${y - control} ${x - control} ${y - radius} ${x} ${y - radius}` +
        ` C ${x + control} ${y - radius} ${x + radius} ${y - control} ${x + radius} ${y} Z`
    ).join(' ');
    return new fabric.Path(path, { fill: '#000000', strokeWidth: 0, objectCaching: false });
}
function rebuildEraseMask(object) {
    const scaleX = Math.max(0.001, Math.abs(object.scaleX || 1));
    const scaleY = Math.max(0.001, Math.abs(object.scaleY || 1));
    const masks = (object.boardflowEraseSpots || []).map(spot => {
        const local = objectLocalPoint(object, spot);
        const radiusX = spot.r / scaleX;
        const radiusY = spot.r / scaleY;
        return new fabric.Ellipse({
            left: local.x,
            top: local.y,
            originX: 'center',
            originY: 'center',
            rx: radiusX,
            ry: radiusY,
            fill: '#000000',
            strokeWidth: 0
        });
    });
    (object.boardflowErasePaths || []).forEach(pathData => {
        const mask = maskFromErasePath(pathData);
        if (mask) masks.push(mask);
    });
    if (!masks.length) {
        object.clipPath = null;
        object.dirty = true;
        return;
    }
    let mask = masks[0];
    if (masks.length > 1) {
        mask = new fabric.Group(masks);
        const center = mask.getCenterPoint();
        mask.set({ originX: 'center', originY: 'center', left: center.x, top: center.y });
    }
    mask.set({ inverted: true });
    object.set({ clipPath: mask, objectCaching: true });
    object.dirty = true;
}
function erasableObjectsAt(point, eraseAll, radius) {
    return canvas.getObjects().filter(object => {
        const inkOrShape = object.isSketch || object.isShape || object.isArrow;
        return layerCanEdit(object) && (eraseAll || inkOrShape) && pointTouchesObject(object, point, radius);
    });
}
function discoverEraseTargets(from, to) {
    if (!activeEraseGesture) return;
    const radius = activeEraseGesture.width / 2;
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const count = Math.max(1, Math.ceil(distance / clamp(activeEraseGesture.width * 0.4, 1, 8)));
    for (let index = 0; index <= count; index += 1) {
        const point = { x: from.x + (to.x - from.x) * index / count, y: from.y + (to.y - from.y) * index / count };
        erasableObjectsAt(point, activeEraseGesture.eraseAll, radius).forEach(object => {
            if (activeEraseGesture.paths.has(object)) return;
            const scale = Math.max(0.001, Math.sqrt(Math.abs((object.scaleX || 1) * (object.scaleY || 1))));
            const pathData = { width: activeEraseGesture.width / scale, points: [] };
            object.boardflowErasePaths = [...(object.boardflowErasePaths || []), pathData];
            activeEraseGesture.paths.set(object, pathData);
        });
    }
}
function appendErasePoint(point) {
    if (!activeEraseGesture) return;
    const points = activeEraseGesture.worldPoints;
    const previous = points[points.length - 1] || point;
    if (points.length && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.75) return;
    const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
    const count = Math.max(1, Math.ceil(distance / clamp(activeEraseGesture.width * 0.35, 0.5, 6)));
    for (let index = 1; index <= count; index += 1) {
        points.push({ x: previous.x + (point.x - previous.x) * index / count, y: previous.y + (point.y - previous.y) * index / count });
    }
    discoverEraseTargets(previous, point);
    activeEraseGesture.paths.forEach((pathData, object) => {
        pathData.points = points.map(worldPoint => objectLocalPoint(object, worldPoint));
        rebuildEraseMask(object);
    });
    if (activeEraseGesture.paths.size) activeEraseGesture.changed = true;
    canvas.requestRenderAll();
}
function queueErasePoint(point) {
    pendingErasePoint = point;
    if (eraseAnimationFrame !== null) return;
    eraseAnimationFrame = requestAnimationFrame(() => {
        eraseAnimationFrame = null;
        const nextPoint = pendingErasePoint;
        pendingErasePoint = null;
        if (nextPoint) appendErasePoint(nextPoint);
    });
}
function startEraseGesture(point, eraseAll) {
    clearPendingSnapshot();
    if (!isHistorySuppressed()) pushSnapshotNow();
    activeEraseGesture = { eraseAll, width: eraseWidth, worldPoints: [], paths: new Map(), changed: false };
    appendErasePoint(point);
}
function finishEraseGesture() {
    if (eraseAnimationFrame !== null) {
        cancelAnimationFrame(eraseAnimationFrame);
        eraseAnimationFrame = null;
    }
    if (pendingErasePoint) appendErasePoint(pendingErasePoint);
    pendingErasePoint = null;
    const changed = activeEraseGesture?.changed;
    activeEraseGesture = null;
    if (changed && !isHistorySuppressed()) {
        pushSnapshotNow();
        scheduleCheckpoint();
    }
}
function eraseSketchesAt(point) { queueErasePoint(point); }
function eraseObjectsAt(point) { queueErasePoint(point); }

// Tools stay active until the user switches; the ✏️ chip is the quick way back to pen

// ================= Text tool =================
const fontFamilySel = byId('fontFamilySel');
const fontSizeSel = byId('fontSizeSel');
fontFamilySel.onchange = () => applyFontToActive('fontFamily', fontFamilySel.value);
fontSizeSel.onchange = () => {
    fontSizeSel.value = String(clamp(+fontSizeSel.value || 24, 8, 36));
    applyFontToActive('fontSize', +fontSizeSel.value);
};
function applyFontToActive(prop, val) {
    const o = canvas.getActiveObject();
    if (o && (o.type === 'i-text' || o.type === 'textbox')) { o.set(prop, val); canvas.requestRenderAll(); queueSnapshot(); }
}
function addTextAt(e) {
    const p = canvasPoint(e);
    const txt = new fabric.IText('Text', { left: p.x, top: p.y, fontFamily: fontFamilySel.value, fontSize: clamp(+fontSizeSel.value || 24, 8, 36), fill: pen.color, editable: true, selectable: true, evented: true });
    canvas.add(txt);
    canvas.setActiveObject(txt);
    txt.enterEditing();
    txt.selectAll();
}

// ================= Triangle engine =================
let angleHandleCache = [];
let lastAngleClick = null;
let natLessonVisible = false;
function triangleWorldPts(o) {
    const m = o.calcTransformMatrix();
    const off = o.pathOffset || { x: 0, y: 0 };
    return o.points.map(p => fabric.util.transformPoint({ x: p.x - off.x, y: p.y - off.y }, m));
}
function angleDeg(v, b, c) {
    const u1 = { x: b.x - v.x, y: b.y - v.y }, u2 = { x: c.x - v.x, y: c.y - v.y };
    const d = (u1.x * u2.x + u1.y * u2.y) / ((Math.hypot(u1.x, u1.y) * Math.hypot(u2.x, u2.y)) || 1);
    return Math.acos(clamp(d, -1, 1)) * 180 / Math.PI;
}
function recalcTriangle(target) {
    const xs = target.points.map(p => p.x), ys = target.points.map(p => p.y);
    const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    const minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
    const newOffset = { x: minX + w / 2, y: minY + h / 2 };
    const m = target.calcTransformMatrix();
    const shift = fabric.util.transformPoint({ x: newOffset.x - target.pathOffset.x, y: newOffset.y - target.pathOffset.y }, [m[0], m[1], m[2], m[3], 0, 0]);
    target.width = w; target.height = h; target.pathOffset = newOffset;
    target.left += shift.x; target.top += shift.y;
    target.setCoords();
    target.dirty = true;
}
function setTrianglePointWorld(target, i, worldPt) {
    const local = objectLocalPoint(target, worldPt);
    target.points[i] = { x: local.x + target.pathOffset.x, y: local.y + target.pathOffset.y };
    recalcTriangle(target);
}
function setTriangleAngle(o, i, deg) {
    const w = triangleWorldPts(o);
    const A = w[i], B = w[(i + 1) % 3], C = w[(i + 2) % 3];
    const d = Math.hypot(C.x - B.x, C.y - B.y);
    if (d < 1) return;
    const theta = clamp(deg, 1, 179) * Math.PI / 180;
    const R = d / (2 * Math.sin(theta));
    const M = { x: (B.x + C.x) / 2, y: (B.y + C.y) / 2 };
    let u = { x: -(C.y - B.y) / d, y: (C.x - B.x) / d };
    if ((A.x - M.x) * u.x + (A.y - M.y) * u.y < 0) { u.x = -u.x; u.y = -u.y; }
    const h = Math.sqrt(Math.max(R * R - d * d / 4, 0));
    const s = theta < Math.PI / 2 ? 1 : -1;
    const O = { x: M.x + u.x * h * s, y: M.y + u.y * h * s };
    const dx = A.x - O.x, dy = A.y - O.y;
    const L = Math.hypot(dx, dy) || 1;
    setTrianglePointWorld(o, i, { x: O.x + dx / L * R, y: O.y + dy / L * R });
}
function attachApexControl(poly) {
    poly.controls = Object.assign({}, poly.controls);
    [0, 1, 2].forEach(i => {
        poly.controls['v' + i] = new fabric.Control({
            positionHandler: function (dim, finalMatrix, fabricObject) {
                const p = fabricObject.points[i];
                const off = fabricObject.pathOffset;
                return fabric.util.transformPoint({ x: p.x - off.x, y: p.y - off.y }, fabricObject.calcTransformMatrix());
            },
            actionHandler: function (eventData, transform, x, y) {
                setTrianglePointWorld(transform.target, i, { x: x, y: y });
                return true;
            },
            cursorStyleHandler: function () { return 'crosshair'; },
            render: function (ctx, left, top, styleOverride, fabricObject) {
                ctx.save();
                ctx.translate(left, top);
                ctx.rotate(fabric.util.degreesToRadians(fabricObject.angle));
                ctx.fillStyle = '#007acc';
                ctx.beginPath(); ctx.arc(0, 0, 7, 0, 2 * Math.PI); ctx.fill();
                ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
                ctx.restore();
            }
        });
    });
}
canvas.on('after:render', () => {
    angleHandleCache = [];
    if (natLessonVisible) return;
    const ctx = canvas.contextContainer;
    const vt = canvas.viewportTransform;
    canvas.getObjects().forEach(o => {
        if (!o.isTriangle) return;
        const s = triangleWorldPts(o).map(p => fabric.util.transformPoint(p, vt));
        const cx = (s[0].x + s[1].x + s[2].x) / 3, cy = (s[0].y + s[1].y + s[2].y) / 3;
        for (let i = 0; i < 3; i++) {
            const v = s[i], b = s[(i + 1) % 3], c = s[(i + 2) % 3];
            const deg = angleDeg(v, b, c);
            let ix = cx - v.x, iy = cy - v.y;
            const il = Math.hypot(ix, iy) || 1; ix /= il; iy /= il;
            const hx = v.x + ix * 20, hy = v.y + iy * 20;
            angleHandleCache.push({ obj: o, i: i, x: hx, y: hy, deg: deg });
            ctx.save();
            ctx.beginPath(); ctx.arc(hx, hy, 5, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
            ctx.strokeStyle = '#007acc'; ctx.lineWidth = 1.5; ctx.stroke();
            if (o.angleShow && o.angleShow[i]) {
                const a1 = Math.atan2(b.y - v.y, b.x - v.x);
                const a2 = Math.atan2(c.y - v.y, c.x - v.x);
                let diff = a2 - a1;
                while (diff <= -Math.PI) diff += 2 * Math.PI;
                while (diff > Math.PI) diff -= 2 * Math.PI;
                ctx.beginPath(); ctx.arc(v.x, v.y, 14, a1, a1 + diff, diff < 0);
                ctx.strokeStyle = '#c33'; ctx.lineWidth = 1.5; ctx.stroke();
                ctx.fillStyle = '#c33'; ctx.font = '12px sans-serif';
                ctx.fillText(Math.round(deg) + '°', v.x + ix * 30 - 8, v.y + iy * 30 + 4);
            }
            ctx.restore();
        }
    });
});
function handleAngleClick(e) {
    const rect = canvas.lowerCanvasEl.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    for (const h of angleHandleCache) {
        const dx = h.x - x, dy = h.y - y;
        if (dx * dx + dy * dy <= 100) {
            const o = h.obj;
            if (!o.angleShow) o.angleShow = [false, false, false];
            const now = Date.now();
            if (lastAngleClick && now - lastAngleClick.t < 400 && lastAngleClick.o === o && lastAngleClick.i === h.i) {
                lastAngleClick = null;
                const val = parseFloat(prompt('Set angle at this vertex (1–179°):', Math.round(h.deg)));
                if (isFinite(val) && val > 0 && val < 180) {
                    setTriangleAngle(o, h.i, val);
                    o.angleShow[h.i] = true;
                    canvas.requestRenderAll();
                }
                return true;
            }
            lastAngleClick = { t: now, o: o, i: h.i };
            o.angleShow[h.i] = !o.angleShow[h.i];
            canvas.requestRenderAll();
        }
    }
    return false;
}

// ================= Angle Lens =================
let angleLens = false;
const lensHidden = new Set();
let angleHitCache = [];
let uidCounter = 0;
function uid(o) { if (!o.__uid) o.__uid = ++uidCounter; return o.__uid; }
const ANGLE_PALETTE = ['#e6194b', '#3cb44b', '#f58e26', '#4363d8', '#911eb4', '#008080', '#f032e6', '#bc7400'];
let degColorMap = {};
function colorForDeg(d) {
    const k = Math.round(d);
    if (!(k in degColorMap)) degColorMap[k] = ANGLE_PALETTE[Object.keys(degColorMap).length % ANGLE_PALETTE.length];
    return degColorMap[k];
}
const btnLens = byId('btnLens');
function lensUI() { btnLens.classList.toggle('active', natLessonVisible); }
btnLens.onclick = () => toggleNaturalAngleLesson();
lensUI();
function normDir(d) { const l = Math.hypot(d.x, d.y) || 1; return { x: d.x / l, y: d.y / l }; }
function straightSegment(o) {
    const m = o.calcTransformMatrix();
    const off = o.pathOffset || { x: 0, y: 0 };
    const toW = p => fabric.util.transformPoint({ x: p.x - off.x, y: p.y - off.y }, m);
    if (o.type === 'line') {
        const points = typeof o.calcLinePoints === 'function'
            ? o.calcLinePoints()
            : { x1: -o.width / 2, y1: -o.height / 2, x2: o.width / 2, y2: o.height / 2 };
        const lineToWorld = (x, y) => fabric.util.transformPoint({ x, y }, m);
        return [lineToWorld(points.x1, points.y1), lineToWorld(points.x2, points.y2)];
    }
    if (o.type === 'polygon' && o.isArrow) {
        const start = o.boardflowArrowStart || { x: (o.points[0].x + o.points[6].x) / 2, y: (o.points[0].y + o.points[6].y) / 2 };
        const end = o.boardflowArrowEnd || o.points[3];
        return [toW(start), toW(end)];
    }
    if (o.type === 'polygon' && o.isSketch) return [toW(o.points[0]), toW(o.points[3])];
    if (o.type === 'path' && o.isSketch) {
        const pts = o.path.map(s => ({ x: s[s.length - 2] - off.x, y: s[s.length - 1] - off.y })).filter(p => isFinite(p.x) && isFinite(p.y));
        if (pts.length < 2) return null;
        const a = toW(pts[0]), b = toW(pts[pts.length - 1]);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 20) return null;
        let polyLen = 0;
        for (let i = 1; i < pts.length; i++) { const p = toW(pts[i - 1]), q = toW(pts[i]); polyLen += Math.hypot(q.x - p.x, q.y - p.y); }
        if (polyLen / len > 1.2) return null;
        return [a, b];
    }
    return null;
}
function segIntersect(p1, p2, p3, p4) {
    const d1 = { x: p2.x - p1.x, y: p2.y - p1.y }, d2 = { x: p4.x - p3.x, y: p4.y - p3.y };
    const den = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((p3.x - p1.x) * d2.y - (p3.y - p1.y) * d2.x) / den;
    const u = ((p3.x - p1.x) * d1.y - (p3.y - p1.y) * d1.x) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return { x: p1.x + t * d1.x, y: p1.y + t * d1.y };
}
function handleLensClick(e) {
    const rect = canvas.lowerCanvasEl.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    for (const h of angleHitCache) {
        const dx = h.x - x, dy = h.y - y;
        if (dx * dx + dy * dy <= 121) {
            if (lensHidden.has(h.key)) lensHidden.delete(h.key); else lensHidden.add(h.key);
            canvas.requestRenderAll();
            return true;
        }
    }
    return false;
}
canvas.on('after:render', () => {
    angleHitCache = [];
    if (!angleLens) return;
    degColorMap = {};
    const ctx = canvas.contextContainer;
    const vt = canvas.viewportTransform;
    const segs = [];
    canvas.getObjects().forEach(o => { const seg = straightSegment(o); if (seg) segs.push({ o: o, seg: seg }); });
    for (let a = 0; a < segs.length; a++) {
        for (let b = a + 1; b < segs.length; b++) {
            const P = segIntersect(segs[a].seg[0], segs[a].seg[1], segs[b].seg[0], segs[b].seg[1]);
            if (!P) continue;
            const key = uid(segs[a].o) + '_' + uid(segs[b].o);
            const sp = fabric.util.transformPoint(P, vt);
            angleHitCache.push({ x: sp.x, y: sp.y, key: key });
            if (lensHidden.has(key)) continue;
            const d1 = normDir({ x: segs[a].seg[1].x - segs[a].seg[0].x, y: segs[a].seg[1].y - segs[a].seg[0].y });
            const d2 = normDir({ x: segs[b].seg[1].x - segs[b].seg[0].x, y: segs[b].seg[1].y - segs[b].seg[0].y });
            const rays = [Math.atan2(d1.y, d1.x), Math.atan2(d2.y, d2.x), Math.atan2(-d1.y, -d1.x), Math.atan2(-d2.y, -d2.x)].sort((x, y) => x - y);
            ctx.save();
            for (let i = 0; i < 4; i++) {
                const a1 = rays[i];
                const a2 = i === 3 ? rays[0] + 2 * Math.PI : rays[i + 1];
                const deg = (a2 - a1) * 180 / Math.PI;
                if (deg < 3 || deg > 177) continue;
                const midA = (a1 + a2) / 2;
                const col = colorForDeg(deg);
                ctx.strokeStyle = col; ctx.lineWidth = 2;
                if (Math.abs(deg - 90) < 2) {
                    const s = 10;
                    ctx.beginPath();
                    ctx.moveTo(sp.x + Math.cos(a1) * s, sp.y + Math.sin(a1) * s);
                    ctx.lineTo(sp.x + Math.cos(a1) * s + Math.cos(a2) * s, sp.y + Math.sin(a1) * s + Math.sin(a2) * s);
                    ctx.lineTo(sp.x + Math.cos(a2) * s, sp.y + Math.sin(a2) * s);
                    ctx.stroke();
                } else {
                    ctx.beginPath(); ctx.arc(sp.x, sp.y, 14, a1, a2); ctx.stroke();
                }
                ctx.fillStyle = col; ctx.font = 'bold 11px sans-serif';
                ctx.fillText(Math.round(deg) + '°', sp.x + Math.cos(midA) * 26 - 8, sp.y + Math.sin(midA) * 26 + 4);
            }
            ctx.beginPath(); ctx.arc(sp.x, sp.y, 4, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
            ctx.strokeStyle = '#4363d8'; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.restore();
        }
    }
});

// ================= Insertables =================
let shapeCounter = 0;
const shapeColorInput = byId('shapeColor');
let shapeColor = loadPref('bv-shape-color') || '#315ee8';
shapeColorInput.value = shapeColor;
shapeColorInput.oninput = event => {
    shapeColor = event.target.value;
    savePref('bv-shape-color', shapeColor);
    const active = canvas.getActiveObject();
    if (active?.isShape) {
        active.set({ stroke: shapeColor });
        canvas.requestRenderAll();
        queueSnapshot();
    }
};
function viewCenterWorld() {
    const inv = fabric.util.invertTransform(canvas.viewportTransform);
    return fabric.util.transformPoint(new fabric.Point(canvas.getWidth() / 2, canvas.getHeight() / 2), inv);
}
function addToolObject(obj, autoReturnToPen) {
    const c = viewCenterWorld();
    const off = (shapeCounter++ % 5) * 24;
    const w = obj.width * (obj.scaleX || 1), h = obj.height * (obj.scaleY || 1);
    obj.set({ left: c.x - w / 2 + off, top: c.y - h / 2 + off, selectable: true, evented: true });
    obj.isFile = false;
    canvas.add(obj);
    canvas.setActiveObject(obj);
    setTool('select');
    canvas.requestRenderAll();
}
function addShape(kind) {
    const strokeW = Math.max(2, pen.width);
    const common = { fill: 'transparent', stroke: shapeColor, strokeWidth: strokeW, strokeUniform: true };
    let obj;
    if (kind === 'triangle') {
        obj = new fabric.Polygon([{ x: -70, y: 65 }, { x: 70, y: 65 }, { x: 0, y: -65 }], common);
        obj.isTriangle = true;
        attachApexControl(obj);
    }
    if (kind === 'square')   obj = new fabric.Rect({ ...common, width: 130, height: 130 });
    if (kind === 'circle')   obj = new fabric.Circle({ ...common, radius: 70 });
    obj.isShape = true;
    addToolObject(obj, true);
}
function sketchWorldPolyline(object) {
    if (!object?.path) return [];
    const offset = object.pathOffset || { x: 0, y: 0 };
    const matrix = object.calcTransformMatrix();
    const localPoints = sampleInkPath(object.path);
    return localPoints
        .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
        .map(point => fabric.util.transformPoint({ x: point.x - offset.x, y: point.y - offset.y }, matrix));
}
function chosenInkStrokes() {
    const active = canvas.getActiveObject();
    let strokes = active?.type === 'activeSelection' ? active.getObjects().filter(object => object.isSketch && object.path) : active?.isSketch && active.path ? [active] : [];
    if (!strokes.length) {
        const latest = [...canvas.getObjects()].reverse().find(object => object.isSketch && object.path);
        if (latest) strokes = [latest];
    }
    return strokes;
}
function replaceInkWithShape(strokes, automatic = false) {
    // Custom BoardFlow shape recognition has been retired. MyScript's installed
    // Raw Content model keeps drawings as ink; a native Shape model is not part
    // of this licence/model bundle.
    void strokes; void automatic;
    return null;
    /* Legacy conversion implementation retained below only for old board data.
    const sources = recognition.used.map(index => strokes[index]).filter(Boolean);
    if (!sources.length) return null;
    const layer = objectLayer(sources[0]);
    const sourceColor = sources.find(object => typeof object.stroke === 'string' && object.stroke)?.stroke || pen.color;
    const sourceWidth = Math.max(0.25, Number(sources[0]?.strokeWidth) || penWidth);
    const common = { fill: 'transparent', stroke: sourceColor, strokeWidth: sourceWidth, strokeUniform: true, strokeLineCap: 'round', strokeLineJoin: 'round', isShape: true, boardflowLayer: layer };
    let replacement;
    if (recognition.kind === 'line') {
        replacement = new fabric.Line([recognition.start.x, recognition.start.y, recognition.end.x, recognition.end.y], common);
        replacement.boardflowKind = 'recognized-line';
    }
    if (recognition.kind === 'arrow') {
        replacement = makeArrow(recognition.start.x, recognition.start.y, recognition.end.x, recognition.end.y);
        replacement.set({ fill: sourceColor, stroke: sourceColor, boardflowLayer: layer });
        replacement.boardflowKind = 'recognized-arrow';
    }
    if (recognition.kind === 'triangle') {
        replacement = new fabric.Polygon(recognition.points, common);
        replacement.isTriangle = true;
        replacement.boardflowKind = 'recognized-triangle';
        attachApexControl(replacement);
    }
    if (recognition.kind === 'rectangle') {
        replacement = new fabric.Rect({ ...common, left: recognition.bounds.left, top: recognition.bounds.top, width: recognition.bounds.width, height: recognition.bounds.height });
        replacement.boardflowKind = 'recognized-rectangle';
    }
    if (recognition.kind === 'circle') {
        replacement = new fabric.Circle({
            ...common,
            left: recognition.center.x - recognition.radius,
            top: recognition.center.y - recognition.radius,
            radius: recognition.radius
        });
        replacement.boardflowKind = 'recognized-circle';
    }
    if (recognition.kind === 'ellipse') {
        replacement = new fabric.Ellipse({ ...common, left: recognition.bounds.left, top: recognition.bounds.top, rx: recognition.bounds.width / 2, ry: recognition.bounds.height / 2 });
        replacement.boardflowKind = 'recognized-ellipse';
    }
    if (recognition.kind === 'zigzag' || recognition.kind === 'wave') {
        replacement = new fabric.Polyline(recognition.points, common);
        replacement.boardflowKind = `recognized-${recognition.kind}`;
    }
    if (!replacement) return null;
    pushSnapshotNow();
    setHistorySuppressed(true);
    sources.forEach(object => canvas.remove(object));
    canvas.add(replacement);
    setHistorySuppressed(false);
    if (!automatic) {
        if (replacement.isArrow) {
            canvas.discardActiveObject();
            setTool('pen');
        } else {
            canvas.setActiveObject(replacement);
            setTool('select');
        }
    }
    applyInteractivity();
    pushSnapshotNow();
    scheduleCheckpoint();
    return replacement;
    */
}
function recognizeSelectedShape() {
    const strokes = chosenInkStrokes();
    if (!strokes.length) {
        setStatus('Select handwriting or a sketched shape first.', true);
        return;
    }
    setInkAssistMode('smart');
    convertRecognitionGroups(groupRecognitionInk(strokes));
    setStatus('BoardFlow Raw Content is active. This native recognition preserves drawings as ink; it has no shape conversion model to convert them.');
}
byId('shapeTriangle').onclick = () => addShape('triangle');
byId('shapeSquare').onclick = () => addShape('square');
byId('shapeCircle').onclick = () => addShape('circle');
function makeRuler() {
    const cm = 40, cms = 15, W = cm * cms + 40, H = 70;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(255,235,130,0.30)'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(50,50,50,0.9)'; g.fillStyle = 'rgba(30,30,30,0.95)';
    g.lineWidth = 1; g.font = '11px sans-serif';
    for (let i = 0; i <= cms * 10; i++) {
        const x = 20 + i * (cm / 10);
        const len = i % 10 === 0 ? 24 : i % 5 === 0 ? 16 : 9;
        g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, len); g.stroke();
        if (i % 10 === 0) g.fillText(String(i / 10), x - 3, 38);
    }
    g.strokeRect(0.5, 0.5, W - 1, H - 1);
    return new fabric.Image(c, { opacity: 0.9 });
}
function makeProtractor() {
    const R = 170, pad = 16;
    const W = 2 * (R + pad), H = R + 2 * pad;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const cx = W / 2, cy = H - pad;
    g.fillStyle = 'rgba(150,215,255,0.22)';
    g.beginPath(); g.arc(cx, cy, R, Math.PI, 2 * Math.PI); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(25,55,85,0.9)'; g.fillStyle = 'rgba(15,40,70,0.95)';
    g.lineWidth = 1; g.font = '10px sans-serif';
    for (let a = 0; a <= 180; a++) {
        const rad = a * Math.PI / 180;
        const len = a % 10 === 0 ? 18 : a % 5 === 0 ? 12 : 6;
        g.beginPath();
        g.moveTo(cx + Math.cos(rad) * R, cy - Math.sin(rad) * R);
        g.lineTo(cx + Math.cos(rad) * (R - len), cy - Math.sin(rad) * (R - len));
        g.stroke();
        if (a % 30 === 0) g.fillText(String(a), cx + Math.cos(rad) * (R - 32) - 7, cy - Math.sin(rad) * (R - 32) + 3);
    }
    g.beginPath(); g.moveTo(cx - R, cy + 0.5); g.lineTo(cx + R, cy + 0.5); g.stroke();
    g.beginPath(); g.arc(cx, cy, 3, 0, 7); g.fill();
    return new fabric.Image(c, { opacity: 0.9 });
}
byId('btnRuler').onclick = () => addToolObject(makeRuler(), false);
byId('btnProtractor').onclick = () => addToolObject(makeProtractor(), false);
function addSticky() {
    const c = viewCenterWorld();
    const off = (shapeCounter++ % 5) * 24;
    const note = new fabric.Textbox('Note', { left: c.x - 110 + off, top: c.y - 110 + off, width: 220, fontSize: 20, fontFamily: 'Tahoma, Verdana, sans-serif', fill: '#4a4a00', backgroundColor: '#FFF176', padding: 10, editable: true, selectable: true, evented: true });
    canvas.add(note);
    canvas.setActiveObject(note);
    setTool('select');
    note.enterEditing();
    note.selectAll();
    canvas.requestRenderAll();
}
byId('btnSticky').onclick = addSticky;

// ================= Arrow + Highlighter =================
function arrowPolygonPoints(x1, y1, x2, y2, thickness) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < 2) return [];
    const ux = dx / len, uy = dy / len, px = -uy, py = ux;
    const t = Math.max(0.75, thickness / 2);
    const h = clamp(thickness * 4, 12, Math.min(60, len * 0.45));
    const hw = h * 0.65;
    const bx = x2 - ux * h, by = y2 - uy * h;
    return [
        { x: x1 + px * t, y: y1 + py * t }, { x: bx + px * t, y: by + py * t },
        { x: bx + px * hw, y: by + py * hw }, { x: x2, y: y2 },
        { x: bx - px * hw, y: by - py * hw }, { x: bx - px * t, y: by - py * t },
        { x: x1 - px * t, y: y1 - py * t }
    ];
}
function recalcArrowBounds(target) {
    const xs = target.points.map(point => point.x);
    const ys = target.points.map(point => point.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const nextOffset = { x: minX + (maxX - minX) / 2, y: minY + (maxY - minY) / 2 };
    const previousOffset = target.pathOffset || nextOffset;
    const matrix = target.calcTransformMatrix();
    const shift = fabric.util.transformPoint(
        { x: nextOffset.x - previousOffset.x, y: nextOffset.y - previousOffset.y },
        [matrix[0], matrix[1], matrix[2], matrix[3], 0, 0]
    );
    target.width = Math.max(1, maxX - minX);
    target.height = Math.max(1, maxY - minY);
    target.pathOffset = nextOffset;
    target.left += shift.x;
    target.top += shift.y;
    target.setCoords();
    target.dirty = true;
}
function setArrowEndpointWorld(target, endpoint, worldPoint) {
    const local = objectLocalPoint(target, worldPoint);
    const point = { x: local.x + target.pathOffset.x, y: local.y + target.pathOffset.y };
    if (endpoint === 'start') target.boardflowArrowStart = point;
    else target.boardflowArrowEnd = point;
    const start = target.boardflowArrowStart;
    const end = target.boardflowArrowEnd;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 8) return false;
    target.points = arrowPolygonPoints(start.x, start.y, end.x, end.y, target.boardflowArrowThickness || 2);
    recalcArrowBounds(target);
    return true;
}
function arrowEndpointControl(endpoint) {
    return new fabric.Control({
        positionHandler(_dim, _finalMatrix, object) {
            const point = endpoint === 'start' ? object.boardflowArrowStart : object.boardflowArrowEnd;
            const offset = object.pathOffset;
            return fabric.util.transformPoint({ x: point.x - offset.x, y: point.y - offset.y }, object.calcTransformMatrix());
        },
        actionHandler(_eventData, transform, x, y) {
            return setArrowEndpointWorld(transform.target, endpoint, { x, y });
        },
        cursorStyleHandler() { return 'crosshair'; },
        actionName: 'modifyArrow',
        render(ctx, left, top) {
            ctx.save();
            ctx.translate(left, top);
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#4f7cff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }
    });
}
function attachArrowControls(arrow) {
    if (!arrow.boardflowArrowStart) arrow.boardflowArrowStart = { x: (arrow.points[0].x + arrow.points[6].x) / 2, y: (arrow.points[0].y + arrow.points[6].y) / 2 };
    if (!arrow.boardflowArrowEnd) arrow.boardflowArrowEnd = { x: arrow.points[3].x, y: arrow.points[3].y };
    arrow.boardflowArrowThickness ||= Math.max(1.5, penWidth || 2);
    arrow.controls = { start: arrowEndpointControl('start'), end: arrowEndpointControl('end') };
}
function makeArrow(x1, y1, x2, y2) {
    const thickness = Math.max(1.5, pen.width);
    const pts = arrowPolygonPoints(x1, y1, x2, y2, thickness);
    if (!pts.length) return null;
    const poly = new fabric.Polygon(pts, { fill: pen.color, stroke: pen.color, strokeWidth: 0.5, objectCaching: false });
    poly.isSketch = true;
    poly.isArrow = true;
    poly.boardflowArrowStart = { x: x1, y: y1 };
    poly.boardflowArrowEnd = { x: x2, y: y2 };
    poly.boardflowArrowThickness = thickness;
    attachArrowControls(poly);
    return poly;
}

function setInkAssistMode(mode) {
    rewriteEquation = null;
    inkAssistMode = ['shapes', 'writing', 'equations', 'smart'].includes(mode) ? mode : 'off';
    window.currentRecognitionMode = inkAssistMode;
    recognitionGeneration++;
    recentInkStrokes = [];
    clearTimeout(inkAssistTimer);
    savePref('bv-ink-assist', inkAssistMode);
    setStatus(inkAssistMode === 'smart' ? 'Smart Ink is on. Write text or equations; unrecognized drawings stay as ink. Undo restores your writing.' : inkAssistMode === 'shapes'
        ? 'Auto shapes is on. Draw a line, arrow, triangle, rectangle, circle, zigzag, or wave.'
        : inkAssistMode === 'writing'
            ? 'Handwriting recognition is on. New words convert after a pause; Undo restores ink.'
            : inkAssistMode === 'equations' ? 'Equation scan is on. Native equation recognition converts equations after you finish writing. Undo restores your ink.'
            : 'Ink conversion is off.');
}

async function recognizeHandwrittenObjects(objects, mode = 'equations') {
    const normalizedStrokes = objects
        .map(object => normalizeInkStroke(object, sketchWorldPolyline(object)))
        .filter(Boolean);
    if (!normalizedStrokes.length) return { text: '', latex: '', error: 'No handwriting strokes were supplied.' };

    const desktopBridge = window.boardFlowDesktop;
    if (isElectron() && typeof desktopBridge?.recognizeInk === 'function') {
        return desktopBridge.recognizeInk({
            strokes: normalizedStrokes.map(stroke => stroke.points),
            mode,
            recognitionType: 'text',
            language: 'en-US'
        });
    }
    if (mode !== 'writing') {
        return { text: '', latex: '', error: 'This browser handwriting recognizer supports text only.' };
    }
    const result = await recognizeHandwritingFromStrokes(normalizedStrokes, null, 'en-US', {
        onProgress: progress => {
            const file = progress.file || 'handwriting model';
            if (Number.isFinite(progress.progress)) {
                setStatus(`Downloading ${file}: ${Math.round(progress.progress)}%. This happens only once; your writing stays on this device.`);
            } else if (progress.status === 'initiate') {
                setStatus('Downloading the local handwriting model (about 65 MB, first use only). Your writing stays on this device.');
            } else if (progress.status === 'ready') {
                setStatus('Handwriting model ready. Recognizing locally…');
            } else if (progress.status === 'inference') {
                setStatus('Recognizing handwriting locally…');
            }
        }
    });
    if (!result) {
        return {
            text: '',
            latex: '',
            alternatives: [],
            engine: 'TrOCR small (browser, local)',
            error: 'The browser handwriting model returned no text. Your original ink has been kept.'
        };
    }
    return { ...result, kind: 'text' };
}

function replaceRecognizedInk(objects, kind, text, latex, automatic = false, equationImage = null) {
    const sources = objects.filter(object => canvas.getObjects().includes(object));
    if (!sources.length || sources.length !== objects.length || !sources.every(layerCanEdit) || !text.trim()) return null;
    const previousEquation = sources.find(o => o.boardflowKind === 'equation');
    const boxes = (previousEquation ? [previousEquation] : sources).map(object => object.getBoundingRect());
    const left = Math.min(...boxes.map(box => box.left));
    const top = Math.min(...boxes.map(box => box.top));
    const width = Math.max(30, Math.max(...boxes.map(box => box.left + box.width)) - left);
    const height = Math.max(...boxes.map(box => box.top + box.height)) - top;
    const layer = objectLayer(sources[0]);
    let replacement;
    if (kind === 'text') {
        const zoom = canvas.getZoom();
        const viewport = canvas.viewportTransform;
        const inverse = fabric.util.invertTransform(viewport);
        const margin = Math.min(24, canvas.getWidth() / 10);
        const screenRight = canvas.getWidth() - margin;
        let screenLeft = margin;
        if (currentFile && currentFile.visible !== false) {
            const corners = currentFile.getCoords().map(point => fabric.util.transformPoint(point, viewport));
            const fileLeft = Math.min(...corners.map(point => point.x));
            const fileRight = Math.max(...corners.map(point => point.x));
            const fileTop = Math.min(...corners.map(point => point.y));
            const fileBottom = Math.max(...corners.map(point => point.y));
            if (fileRight > margin && fileLeft < screenRight && fileBottom > 0 && fileTop < canvas.getHeight()) {
                screenLeft = Math.max(margin, fileRight + 24);
                if (screenRight - screenLeft < 80) {
                    setStatus('Move or resize the file to leave room on its right for recognized text. Your ink has been kept.');
                    return null;
                }
            }
        }
        const screenTop = fabric.util.transformPoint(new fabric.Point(left, top), viewport).y;
        const anchor = fabric.util.transformPoint(new fabric.Point(screenLeft, clamp(screenTop, 24, Math.max(24, canvas.getHeight() - 48))), inverse);
        const textWidth = (screenRight - screenLeft) / zoom;
        replacement = new fabric.Textbox(text, {
            left: anchor.x,
            top: anchor.y,
            originX: 'left',
            originY: 'top',
            width: textWidth,
            fontFamily: fontFamilySel.value,
            fontSize: clamp(+fontSizeSel.value || 24, 8, 36),
            lineHeight: 1.25,
            textAlign: 'left',
            fill: sources[0].stroke || pen.color,
            editable: true,
            boardflowLayer: layer,
            boardflowKind: 'recognized-text',
            boardflowPayload: { source: 'handwriting-recognition' }
        });
        // Fabric normally expands a textbox to fit an unbroken word. Keep even
        // long recognition tokens inside the visible column instead.
        if (replacement.width > textWidth) {
            replacement.set({ splitByGrapheme: true, width: textWidth });
            replacement.initDimensions();
        }
        const visibleTop = fabric.util.transformPoint(new fabric.Point(0, 24), inverse).y;
        const visibleBottom = fabric.util.transformPoint(new fabric.Point(0, canvas.getHeight() - 24), inverse).y;
        replacement.set({ top: Math.max(visibleTop, Math.min(replacement.top, visibleBottom - replacement.height)) });
    } else if (equationImage) {
        replacement = equationImage;
        const scale = Math.min(clamp(height, 32, 120) / replacement.height, (canvas.getWidth() - 48) / canvas.getZoom() / replacement.width);
        replacement.set({ left, top, originX: 'left', originY: 'top', scaleX: scale, scaleY: scale,
            boardflowLayer: layer, boardflowKind: 'equation',
            boardflowPayload: { source: 'handwriting-recognition', latex } });
    } else {
        replacement = new fabric.Textbox(text, {
            left,
            top,
            originX: 'left',
            originY: 'top',
            width,
            fontFamily: 'Cambria, Georgia, serif',
            fontSize: clamp(height * 0.8, 16, 96),
            fontWeight: 600,
            fill: sources[0].stroke || pen.color,
            padding: 0,
            textAlign: 'left',
            editable: true,
            boardflowLayer: layer,
            boardflowKind: 'equation',
            boardflowPayload: { source: 'handwriting-recognition', latex }
        });
    }
    let linkedGraph = null;
    const previousId = previousEquation?.boardflowId;
    const oldGraphs = previousId ? canvas.getObjects().filter(o => o.boardflowKind === 'linked-graph' && o.boardflowPayload?.equationId === previousId) : [];
    if (kind === 'equation') {
        replacement.boardflowId = previousId || crypto.randomUUID();
        replacement.boardflowPayload.inkColor = sources[0].boardflowPayload?.inkColor || sources[0].stroke || pen.color;
        replacement.boardflowPayload.expression = smartGraphs?.graphExpression(latex)?.expression;
        replacement.setCoords();
        if (inkAssistMode === 'smart' || oldGraphs.length) {
            linkedGraph = smartGraphs?.createLinkedGraph(fabric, canvas, replacement);
            if (linkedGraph && oldGraphs[0]) {
                const a = replacement.getBoundingRect(), b = oldGraphs[0].getBoundingRect();
                const overlap = a.left < b.left+b.width && a.left+a.width > b.left && a.top < b.top+b.height && a.top+a.height > b.top;
                if (!overlap) linkedGraph.set({left:oldGraphs[0].left,top:oldGraphs[0].top,scaleX:oldGraphs[0].scaleX,scaleY:oldGraphs[0].scaleY});
            }
        }
    }
    pushSnapshotNow();
    setHistorySuppressed(true);
    sources.concat(oldGraphs).forEach(object => canvas.remove(object));
    canvas.add(replacement);
    if (linkedGraph) canvas.add(linkedGraph);
    setHistorySuppressed(false);
    if (!automatic) {
        canvas.setActiveObject(replacement);
        setTool('select');
    } else canvas.discardActiveObject();
    applyInteractivity();
    pushSnapshotNow();
    scheduleCheckpoint();
    return replacement;
}
let editingEquation = null;
let rewriteEquation = null;
const smartEquationEditor = byId('smartEquationEditor');
canvas.on('mouse:dblclick', event => {
    let object = event.target;
    if (object?.boardflowKind === 'linked-graph') object = canvas.getObjects().find(o => o.boardflowId === object.boardflowPayload.equationId);
    if (object?.boardflowKind !== 'equation' || !layerCanEdit(object)) return;
    editingEquation = object;
    byId('smartEquationValue').value = object.boardflowPayload?.latex || object.text || '';
    byId('smartEquationError').textContent = '';
    smartEquationEditor.showModal();
    byId('smartEquationValue').focus();
});
canvas.on('mouse:down', event => {
    const textObject = event.target;
    if (!/Android/i.test(navigator.userAgent)
        || !['i-text', 'textbox'].includes(textObject?.type)
        || textObject.editable === false
        || !layerCanEdit(textObject)) return;
    canvas.setActiveObject(textObject);
    textObject.enterEditing();
    textObject.hiddenTextarea?.focus({ preventScroll: true });
});
byId('smartEquationCancel').onclick = () => smartEquationEditor.close();
byId('smartEquationRewrite').onclick = () => {
    const original = editingEquation;
    smartEquationEditor.close();
    setInkAssistMode('equations');
    rewriteEquation = original;
    setTool('pen');
    setStatus('Write the complete replacement equation in an empty area. The original and its graph stay until recognition succeeds. Change recognition mode to cancel.');
};
smartEquationEditor.addEventListener('close', () => { editingEquation = null; });
byId('smartEquationApply').onclick = async () => {
    const original = editingEquation, value = byId('smartEquationValue').value.trim();
    if (!original || !value) return;
    const button = byId('smartEquationApply');
    button.disabled = true;
    try {
        await smartGraphsReady;
        const result = await window.boardFlowDesktop?.typesetEquation?.(value);
        if (!result?.svg) throw new Error(result?.error || 'Equation editing requires the desktop app.');
        const color = new fabric.Color(original.boardflowPayload?.inkColor || pen.color).toRgb();
        const image = await fabric.FabricImage.fromURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg.replace(/currentColor/g,color))}`);
        if (editingEquation !== original || !smartEquationEditor.open || !canvas.getObjects().includes(original) || !layerCanEdit(original)) return;
        replaceRecognizedInk([original], 'equation', value, value, false, image);
        smartEquationEditor.close();
    } catch (error) { byId('smartEquationError').textContent = error.message; }
    finally { button.disabled = false; }
};
function queueInkAssist(path) {
    if (inkAssistMode === 'off' || !path?.path) return;
    recentInkStrokes = recentInkStrokes.filter(o => canvas.getObjects().includes(o));
    if (!recentInkStrokes.includes(path)) recentInkStrokes.push(path);
    clearTimeout(inkAssistTimer);
    inkAssistTimer = setTimeout(async () => {
        const strokes = recentInkStrokes.filter(object => canvas.getObjects().includes(object));
        if (recognitionPointerDown) return;
        if (!strokes.length) return;
        await convertRecognitionGroups(groupRecognitionInk(strokes));
    }, inkAssistMode === 'shapes' ? 1100 : inkAssistMode === 'smart' ? 1500 : 2400);
}
canvas.on('mouse:down', () => {
    recognitionPointerDown = true;
    recognitionGeneration++;
    clearTimeout(inkAssistTimer);
});
canvas.on('mouse:up', () => { recognitionPointerDown = false; });
window.addEventListener('pointerup', () => { recognitionPointerDown = false; });
window.addEventListener('blur', () => { recognitionPointerDown = false; recognitionGeneration++; clearTimeout(inkAssistTimer); });
function convertVisibleShapes(groups) {
    return convertRecognitionGroups(groups);
}
async function convertRecognitionGroups(groups) {
        const selectedMode = inkAssistMode;
        // Windows Ink is text-only; Auto Shapes remains on its geometry path.
        if (selectedMode === 'shapes') return;
        const mode = selectedMode;
        const generation = recognitionGeneration;
        const textResults = [];
        if (!['shapes', 'writing', 'equations', 'smart'].includes(selectedMode)) return;
        for (const sourceGroup of groups) {
            try {
                const response = await recognizeHandwrittenObjects(sourceGroup, mode);
                if (mode === 'smart') await smartGraphsReady;
                if (response.error) {
                    setStatus(`${response.error} Your original ink has been kept.`, true);
                    continue; 
                }
                const candidates = (response.entries?.length ? response.entries : [{ indices: sourceGroup.map((_, index) => index), result: response }]).map(entry => ({
                    group: entry.indices.map(i => sourceGroup[i]), result: entry.result
                }));
                for (const { group, result } of candidates) {
                    const effectiveMode = result.kind === 'math' ? 'equations'
                        : result.kind === 'text' || (selectedMode === 'writing' && result.text) ? 'writing'
                            : 'drawing';
                    if (selectedMode === 'writing' && effectiveMode !== 'writing') continue;
                    if (selectedMode === 'equations' && effectiveMode !== 'equations') continue;
                    let equationImage = null;
                    if (effectiveMode === 'equations' && result.svg && canAutoConvert(result, effectiveMode)) {
                        const color = new fabric.Color(group[0].stroke || pen.color).toRgb();
                        const svg = result.svg.replace(/currentColor/g, color);
                        equationImage = await fabric.FabricImage.fromURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
                    }
                    if (generation !== recognitionGeneration || selectedMode !== inkAssistMode) return;
                    if (effectiveMode === 'drawing' || !canAutoConvert(result, effectiveMode)) {
                        continue;
                    }
                    
                    if (effectiveMode === 'writing') {
                        const boxes = group.map(o => o.getBoundingRect());
                        const left = Math.min(...boxes.map(b => b.left)), top = Math.min(...boxes.map(b => b.top));
                        textResults.push({group, text:result.text, box:{left,top,
                            width:Math.max(...boxes.map(b => b.left+b.width))-left,
                            height:Math.max(...boxes.map(b => b.top+b.height))-top}});
                    } else {
                        const target = rewriteEquation && canvas.getObjects().includes(rewriteEquation) && objectLayer(rewriteEquation) === objectLayer(group[0]) ? rewriteEquation : null;
                        const replacement = replaceRecognizedInk(target ? [target,...group] : group, 'equation', result.text, result.latex, true, equationImage);
                        if (target && replacement) rewriteEquation = null;
                    }
                }
            } catch (error) {
                setStatus(`${error.message || 'Recognition is unavailable.'} Your original ink has been kept.`, true);
            }
        }
        if (generation !== recognitionGeneration || selectedMode !== inkAssistMode) return;
        const resultsByLayer = new Map();
        textResults.forEach(result => {
            const layer = objectLayer(result.group[0]);
            resultsByLayer.set(layer, [...(resultsByLayer.get(layer) || []), result]);
        });
        for (const results of resultsByLayer.values()) {
            const recognizedText = recognizedTextLines(results.map(result => ({ text: result.text, box: result.box })));
            replaceRecognizedInk(results.flatMap(result => result.group), 'text', recognizedText, '', true);
        }
    return groups.map(group => group.slice(0, 200));
}
function visibleRecognitionGroups() {
    const viewport = canvas.vptCoords;
    const visible = canvas.getObjects().filter(object => {
        const box = object.getBoundingRect();
        return box.left < viewport.br.x && box.left + box.width > viewport.tl.x &&
            box.top < viewport.br.y && box.top + box.height > viewport.tl.y;
    });
    return groupRecognitionInk(visible);
}
function makeHighlight(x1, y1, x2, y2) {
    const line = new fabric.Line([x1, y1, x2, y2], { stroke: hlColor, strokeWidth: Math.max(12, pen.width * 6), opacity: 0.45, strokeLineCap: 'butt', objectCaching: false });
    line.isSketch = true;
    return line;
}
let arrowStart = null, tempArrow = null, hlStart = null, tempHl = null;

// ================= Zoom / pan / view chip =================
byId('btnHome').onclick = () => { canvas.setViewportTransform([1, 0, 0, 1, 0, 0]); updateGridBackground(theme, showGrid, THEMES); updateViewChip(); canvas.requestRenderAll(); };
wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvas.lowerCanvasEl.getBoundingClientRect();
    const p = new fabric.Point(e.clientX - rect.left, e.clientY - rect.top);
    canvas.zoomToPoint(p, clamp(canvas.getZoom() * Math.pow(1.0015, -e.deltaY), 0.2, 5));
    updateGridBackground(theme, showGrid, THEMES);
    updateViewChip();
}, { passive: false });
const activePointers = new Map();
let pinch = null, wasDrawingBeforePinch = false;
wrap.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size === 2) beginPinch();
}, { capture: true });
wrap.addEventListener('pointermove', e => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && activePointers.size === 2) handlePinch();
}, { capture: true, passive: false });
function onPointerEnd(e) {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.delete(e.pointerId);
    if (pinch && activePointers.size < 2) endPinch();
}
wrap.addEventListener('pointerup', onPointerEnd, { capture: true });
wrap.addEventListener('pointercancel', onPointerEnd, { capture: true });
function beginPinch() {
    wasDrawingBeforePinch = canvas.isDrawingMode;
    if (wasDrawingBeforePinch) { canvas.isDrawingMode = false; canvas.upperCanvasEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); }
    arrowStart = null; hlStart = null; inkErasing = false;
    if (tempArrow) { canvas.remove(tempArrow); tempArrow = null; }
    if (tempHl) { canvas.remove(tempHl); tempHl = null; }
    const [a, b] = [...activePointers.values()];
    pinch = { startDist: Math.hypot(b.x - a.x, b.y - a.y) || 1, startZoom: canvas.getZoom(), lastMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}
function handlePinch() {
    const [a, b] = [...activePointers.values()];
    const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const rect = canvas.lowerCanvasEl.getBoundingClientRect();
    const vt = canvas.viewportTransform;
    vt[4] += mid.x - pinch.lastMid.x;
    vt[5] += mid.y - pinch.lastMid.y;
    canvas.zoomToPoint(new fabric.Point(mid.x - rect.left, mid.y - rect.top), clamp(pinch.startZoom * (dist / pinch.startDist), 0.2, 5));
    updateGridBackground(theme, showGrid, THEMES);
    pinch.lastMid = mid;
    updateViewChip();
}
function endPinch() { pinch = null; activePointers.clear(); if (wasDrawingBeforePinch) setTool(tool); updateViewChip(); }

// ================= HUD =================
const hud = byId('hud');
const btnMenu = byId('btnMenu');
const menu = byId('menu');
const btnPenQuick = byId('btnPenQuick');
const pager = byId('pager');
function setHudPos(pos) {
    hud.style.left = ''; hud.style.top = ''; hud.style.bottom = '';
    wrap.classList.toggle('hud-bottom', pos === 'bottom');
    savePref('bv-hud', pos);
}
setHudPos(loadPref('bv-hud') || 'top');
let hudDrag = null, suppressMenuClick = false;
btnMenu.addEventListener('pointerdown', e => { e.preventDefault(); hudDrag = { x: e.clientX, y: e.clientY, moved: false }; btnMenu.setPointerCapture(e.pointerId); });
btnMenu.addEventListener('pointermove', e => {
    if (!hudDrag) return;
    if (!hudDrag.moved && Math.hypot(e.clientX - hudDrag.x, e.clientY - hudDrag.y) > 8) { hudDrag.moved = true; hideMenuNow(); }
    if (hudDrag.moved) { e.preventDefault(); hud.style.left = e.clientX + 'px'; hud.style.top = e.clientY + 'px'; hud.style.bottom = 'auto'; }
});
btnMenu.addEventListener('pointerup', e => {
    if (hudDrag && hudDrag.moved) { setHudPos(e.clientY > window.innerHeight / 2 ? 'bottom' : 'top'); suppressMenuClick = true; }
    hudDrag = null;
});
btnPenQuick.onclick = () => setTool('pen');
function updateQuickPen() {
    btnPenQuick.classList.toggle('active', tool === 'pen');
}

// ================= Menu auto-hide =================
const HIDE_DELAY = 6000;
let hideTimer = null;
function armHide() { clearTimeout(hideTimer); hideTimer = setTimeout(hideMenuNow, HIDE_DELAY); }
function showMenu() { menu.classList.remove('hidden'); hud.classList.remove('menu-closed'); btnMenu.classList.add('open'); updateQuickPen(); armHide(); }
function hideMenuNow() { clearTimeout(hideTimer); menu.classList.add('hidden'); hud.classList.add('menu-closed'); btnMenu.classList.remove('open'); updateQuickPen(); }
hud.classList.toggle('menu-closed', menu.classList.contains('hidden'));
btnMenu.onclick = () => {
    if (presentationMode) { setPresentationMode(false); return; }
    if (suppressMenuClick) { suppressMenuClick = false; return; }
    menu.classList.contains('hidden') ? showMenu() : hideMenuNow();
};
menu.addEventListener('mouseenter', () => clearTimeout(hideTimer));
menu.addEventListener('mouseleave', () => { if (!menu.classList.contains('hidden')) armHide(); });
['click', 'input', 'change'].forEach(ev => menu.addEventListener(ev, () => { if (!menu.classList.contains('hidden')) armHide(); }));
const AUTO_HIDE_IDS = ['btnSelect', 'btnPen', 'btnArrow', 'btnText', 'btnEraserInk', 'btnEraserAll',
    'shapeTriangle', 'shapeSquare', 'shapeCircle', 'btnRuler', 'btnProtractor', 'btnSticky',
    'hlYellow', 'hlPink', 'hlPist'];
menu.addEventListener('click', e => { if (AUTO_HIDE_IDS.includes(e.target.id)) setTimeout(hideMenuNow, 1000); });
menu.addEventListener('click', e => {
    const item = e.target.closest('button, select');
    if (!item || !menu.contains(item)) return;
    item.classList.remove('menu-item-wiggle');
    void item.offsetWidth;
    item.classList.add('menu-item-wiggle');
});
document.addEventListener('pointerdown', e => {
    if (menu.classList.contains('hidden')) return;
    if (!e.target.closest('#menu, #hud')) hideMenuNow();
}, true);

// ================= Keyboard / mouse core =================
let spaceDown = false, panning = false;
function isNativeTextEditor(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.isContentEditable) return true;
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
}
function canvasShortcutBlocked(event) {
    return event.isComposing || event.keyCode === 229 ||
        isNativeTextEditor(event.target) || isNativeTextEditor(document.activeElement);
}
window.addEventListener('keydown', e => {
    if (canvasShortcutBlocked(e)) return;
    const active = canvas.getActiveObject();
    const editing = active && active.isEditing;
    if ((e.ctrlKey || e.metaKey) && !editing) {
        const k = e.key.toLowerCase();
        if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
        if (k === 'y') { e.preventDefault(); redo(); return; }
    }
    if (e.code === 'Space') {
        if (editing) return;
        if (spaceDown) { e.preventDefault(); return; }
        e.preventDefault();
        spaceDown = true;
        canvas.isDrawingMode = false;
        canvas.defaultCursor = 'grab';
        canvas.freeDrawingCursor = 'grab';
        return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !editing) {
        if (!active) return;
        if (!layerCanEdit(active)) return;
        if (active === currentFile) closeCurrentFile();
        else { canvas.remove(active); canvas.requestRenderAll(); }
    }
});
window.addEventListener('keyup', e => {
    if (e.code !== 'Space' || !spaceDown) return;
    spaceDown = false; panning = false;
    setTool(tool);
});
window.addEventListener('pointerup', () => { finishEraseGesture(); inkErasing = false; allErasing = false; });
window.addEventListener('blur', () => { finishEraseGesture(); inkErasing = false; allErasing = false; spaceDown = false; });

canvas.on('mouse:down', opt => {
    if (spaceDown) { panning = true; canvas.selection = false; canvas.setCursor('grabbing'); return; }
    if (angleLens && handleLensClick(opt.e)) return;
    if (typeof natClick === 'function' && natClick(opt.e)) return;
    if (selectedNatHit) closeGeometryTools();
    if (tool === 'eraserInk') { inkErasing = true; startEraseGesture(canvasPoint(opt.e), false); return; }
    if (tool === 'eraserAll') { allErasing = true; startEraseGesture(canvasPoint(opt.e), true); return; }
    if (tool === 'arrow') { arrowStart = canvasPoint(opt.e); tempArrow = null; return; }
    if (tool === 'highlight') { hlStart = canvasPoint(opt.e); tempHl = null; return; }
    if (tool === 'text') {
        if (opt.target && (opt.target.type === 'i-text' || opt.target.type === 'textbox')) return;
        addTextAt(opt.e);
    }
});
canvas.on('mouse:move', opt => {
    if (panning) {
        const vt = canvas.viewportTransform;
        vt[4] += opt.e.movementX; vt[5] += opt.e.movementY;
        updateViewChip();
        canvas.requestRenderAll();
        return;
    }
    const p = canvasPoint(opt.e);
    if (inkErasing) { eraseSketchesAt(p); return; }
    if (allErasing) { eraseObjectsAt(p); return; }
    if (arrowStart) {
        if (tempArrow) canvas.remove(tempArrow);
        tempArrow = makeArrow(arrowStart.x, arrowStart.y, p.x, p.y);
        if (tempArrow) { tempArrow.isFile = false; tempArrow.boardflowTransient = true; canvas.add(tempArrow); }
    }
    if (hlStart) {
        if (tempHl) canvas.remove(tempHl);
        tempHl = makeHighlight(hlStart.x, hlStart.y, p.x, p.y);
        if (tempHl) { tempHl.isFile = false; tempHl.boardflowTransient = true; canvas.add(tempHl); }
    }
});
canvas.on('mouse:up', () => {
    if (panning) { panning = false; canvas.selection = (tool === 'select'); updateGridBackground(theme, showGrid, THEMES); canvas.requestRenderAll(); }
    finishEraseGesture();
    inkErasing = false;
    allErasing = false;
    if (arrowStart) {
        if (tempArrow && (tempArrow.width + tempArrow.height) < 14) {
            canvas.remove(tempArrow);
        } else if (tempArrow) {
            const completedArrow = tempArrow;
            completedArrow.boardflowTransient = false;
            completedArrow.set({ selectable: false, evented: false });
            canvas.discardActiveObject();
            setTool('pen');
            pushSnapshotNow();
            scheduleCheckpoint();
        }
        tempArrow = null; arrowStart = null;
    }
    if (hlStart) {
        if (tempHl && Math.hypot(tempHl.x2 - tempHl.x1, tempHl.y2 - tempHl.y1) < 6) canvas.remove(tempHl);
        else if (tempHl) {
            tempHl.boardflowTransient = false;
            pushSnapshotNow();
            scheduleCheckpoint();
        }
        tempHl = null; hlStart = null;
    }
});

// ================= File state =================
let currentFile = null, fileKind = null, pdfDoc = null, pageNum = 1;
const PDF_BASE_SCALE = 1.5;
const pageLabel = byId('pageLabel');
const btnPrev = byId('btnPrev');
const btnNext = byId('btnNext');
function fitIfNeeded(obj) {
    const zoom = Math.max(0.2, canvas.getZoom());
    const s = Math.min(1, canvas.getWidth() / zoom / obj.width, canvas.getHeight() / zoom / obj.height);
    const topLeft = fabric.util.transformPoint(new fabric.Point(0, 0), fabric.util.invertTransform(canvas.viewportTransform));
    obj.set({
        originX: 'left',
        originY: 'top',
        scaleX: s,
        scaleY: s,
        left: topLeft.x,
        top: topLeft.y
    });
}
function focusObject(obj) {
    if (obj.isFile) {
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        return;
    }
    setTool('select');
    canvas.setActiveObject(obj);
    canvas.requestRenderAll();
}
function updatePageUI() {
    const hasPdfFile = fileKind === 'pdf' && !!currentFile && !!pdfDoc;
    const multi = hasPdfFile && pdfDoc.numPages > 1;
    pager.style.display = hasPdfFile ? 'flex' : 'none';
    pager.setAttribute('aria-label', hasPdfFile ? `File page ${pageNum} of ${pdfDoc.numPages}` : 'File pages');
    btnPrev.disabled = !multi || pageNum <= 1;
    btnNext.disabled = !multi || pageNum >= pdfDoc.numPages;
    pageLabel.textContent = pdfDoc ? `${pageNum} / ${pdfDoc.numPages}` : '–';
}
function closeCurrentFile() {
    if (currentFile) canvas.remove(currentFile);
    currentFile = null; fileKind = null;
    pdfDoc = null; pageNum = 1;
    pageMemory.clear(); boardPage = 0; boardPages = 1; updateBoardPager();
    canvas.discardActiveObject();
    updatePageUI();
    canvas.requestRenderAll();
}
const appStatus = byId('appStatus');
let statusTimer = null;
function setStatus(message, isError = false) {
    clearTimeout(statusTimer);
    appStatus.textContent = message;
    appStatus.classList.toggle('error', isError);
    appStatus.classList.remove('hidden');
    statusTimer = setTimeout(() => appStatus.classList.add('hidden'), isError ? 7000 : 3500);
}
function setSaveStatus(message, isError = false) {
    const status = byId('saveStatus');
    status.textContent = message;
    status.classList.toggle('error', isError);
}
async function renderPageToCanvas(n) {
    return renderPdfPageToCanvas(pdfDoc, n);
}
async function renderPdfPageToCanvas(pdfDocument, n) {
    const page = await pdfDocument.getPage(n);
    const vp = page.getViewport({ scale: PDF_BASE_SCALE });
    const off = document.createElement('canvas');
    off.width = vp.width; off.height = vp.height;
    await page.render({ canvasContext: off.getContext('2d'), viewport: vp }).promise;
    return off;
}
async function showPage(n, isNewFile = false) {
    const off = await renderPageToCanvas(n);
    if (!isNewFile && currentFile && fileKind === 'pdf') {
        const { left, top, scaleX, scaleY } = currentFile;
        currentFile.setElement(off);
        currentFile.set({ left, top, scaleX, scaleY });
    } else {
        const img = new fabric.Image(off, { left: 0, top: 0 });
        img.isFile = true; img.erasable = false;
        fitIfNeeded(img);
        canvas.add(img);
        currentFile = img; fileKind = 'pdf';
        applyFileErasability();
        applyInteractivity();
        focusObject(img);
    }
    pageNum = n;
    updatePageUI();
    canvas.requestRenderAll();
}
const fileInput = byId('fileInput');
const fileContextMenu = byId('fileContextMenu');
let contextFile = null;
let filePressTimer = null;
let filePressOrigin = null;
let lastFileTap = null;

function uploadedFileAt(event) {
    const point = canvas.getScenePoint(event);
    return [...canvas.getObjects()].reverse().find(object =>
        object.isFile && object.visible !== false && object.containsPoint(point)
    ) || null;
}

function isActiveFileAt(event) {
    if (!activeFileForControls) return false;
    if (uploadedFileAt(event) === activeFileForControls) return true;
    if (!canvas.upperCanvasEl.contains(event.target)) return false;
    const bounds = canvas.upperCanvasEl.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * canvas.getWidth() / bounds.width;
    const y = (event.clientY - bounds.top) * canvas.getHeight() / bounds.height;
    const controlRadius = Math.max(
        activeFileForControls.touchCornerSize || 0,
        activeFileForControls.cornerSize || 0,
        22
    );
    const controlPoints = activeFileForControls.oCoords;
    if (controlPoints && Object.entries(controlPoints).some(([name, point]) =>
        ['tl', 'tr', 'bl', 'br', 'ml', 'mt', 'mr', 'mb', 'mtr'].includes(name) &&
        Math.hypot(point.x - x, point.y - y) <= controlRadius
    )) return true;
    return canvas.findTarget(event) === activeFileForControls;
}

function closeFileContextMenu() {
    fileContextMenu.classList.add('hidden');
    contextFile = null;
}

function showFileContextMenu(object, clientX, clientY) {
    if (!object?.isFile) return;
    contextFile = object;
    activeFileForControls = object;
    setTool('select');
    applyInteractivity();
    canvas.setActiveObject(object);
    canvas.requestRenderAll();
    fileContextMenu.classList.remove('hidden');
    const bounds = wrap.getBoundingClientRect();
    const menuBounds = fileContextMenu.getBoundingClientRect();
    const left = clamp(clientX - bounds.left, 8, Math.max(8, bounds.width - menuBounds.width - 8));
    const top = clamp(clientY - bounds.top, 8, Math.max(8, bounds.height - menuBounds.height - 8));
    fileContextMenu.style.left = `${left}px`;
    fileContextMenu.style.top = `${top}px`;
    setStatus('File controls enabled. Drag the file to move it or use a corner handle to resize it.');
}

fileContextMenu.addEventListener('click', event => {
    const action = event.target.closest('[data-file-action]')?.dataset.fileAction;
    if (!action || !contextFile || !canvas.getObjects().includes(contextFile)) return;
    if (action === 'delete') {
        const file = contextFile;
        closeFileContextMenu();
        activeFileForControls = null;
        pushSnapshotNow();
        canvas.remove(file);
        if (currentFile === file) {
            currentFile = canvas.getObjects().find(object => object.isFile) || null;
            if (!currentFile) {
                fileKind = null;
                pdfDoc = null;
                pageNum = 1;
            }
            updatePageUI();
        }
        canvas.discardActiveObject();
        if (tool === 'select') setTool('pen');
        else applyInteractivity();
        pushSnapshotNow();
        scheduleCheckpoint();
        setStatus('Uploaded file deleted. Undo restores it.');
    }
});

wrap.addEventListener('contextmenu', event => {
    const target = uploadedFileAt(event);
    if (!target?.isFile) return;
    event.preventDefault();
    showFileContextMenu(target, event.clientX, event.clientY);
}, true);
wrap.addEventListener('pointerdown', event => {
    const target = uploadedFileAt(event);
    if (!target?.isFile) return;
    if (target === activeFileForControls) return;
    clearTimeout(filePressTimer);
    filePressOrigin = { x: event.clientX, y: event.clientY, target, activated: false };
    if (event.pointerType !== 'touch') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    filePressTimer = setTimeout(() => {
        if (!filePressOrigin || filePressOrigin.target !== target) return;
        filePressOrigin.activated = true;
        lastFileTap = null;
        showFileContextMenu(target, event.clientX, event.clientY);
    }, 650);
}, true);
window.addEventListener('pointermove', event => {
    if (!filePressOrigin) return;
    if (Math.hypot(event.clientX - filePressOrigin.x, event.clientY - filePressOrigin.y) > 10) {
        clearTimeout(filePressTimer);
        filePressTimer = null;
        filePressOrigin = null;
    }
}, { passive: true });
window.addEventListener('pointerup', event => {
    if (filePressOrigin && event.pointerType !== 'pen') {
        const press = filePressOrigin;
        if (!press.activated) {
            const previousTap = lastFileTap;
            if (previousTap?.target === press.target && Date.now() - previousTap.time < 380 &&
                Math.hypot(event.clientX - previousTap.x, event.clientY - previousTap.y) < 28) {
                lastFileTap = null;
                showFileContextMenu(press.target, event.clientX, event.clientY);
            } else {
                lastFileTap = { target: press.target, time: Date.now(), x: event.clientX, y: event.clientY };
            }
        } else {
            lastFileTap = null;
        }
    }
    clearTimeout(filePressTimer);
    filePressTimer = null;
    filePressOrigin = null;
}, true);
window.addEventListener('pointercancel', () => {
    clearTimeout(filePressTimer);
    filePressTimer = null;
    filePressOrigin = null;
});
document.addEventListener('pointerdown', event => {
    if (event.target.closest('#fileContextMenu')) return;
    closeFileContextMenu();
    if (activeFileForControls && !isActiveFileAt(event)) {
        activeFileForControls = null;
        applyInteractivity();
    }
}, true);
window.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeFileContextMenu();
});

byId('btnUpload').onclick = () => {
    hideMenuNow();
    fileInput.click();
};
fileInput.onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    await startupReady;
    const isBoard = /\.(boardview|json)$/i.test(file.name);
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    const isImage = file.type.startsWith('image/');
    if (!isBoard && !isPdf && !isImage) {
        setStatus('That file type is not supported. Choose a PDF, image, or .boardview file.', true);
        return;
    }
    setStatus(`Opening ${file.name}…`);
    try {
        if (isBoard) {
            if (!await openBoardFile(file)) throw new Error('The lesson file is invalid or damaged.');
        } else {
            // Decode the replacement before touching the live lesson. A bad PDF
            // or image must never erase the board the teacher is currently using.
            const preparedFile = await prepareFileImport(file);
            const uploadedData = await file.arrayBuffer();
            setHistorySuppressed(true);
            closeCurrentFile();
            removeAnnotationsSilent();
            setHistorySuppressed(false);
            commitPreparedFileImport(preparedFile);
            lastUploadedFile = { name: file.name, type: file.type, data: uploadedData };
            resetHistory();
            await saveCheckpoint();
        }
        setStatus(`${file.name} is now on the board.`);
    } catch (error) {
        console.error('Unable to open uploaded file', error);
        setStatus(`Could not open ${file.name}. ${error.message || 'Please try another file.'}`, true);
    }
};
async function prepareFileImport(file) {
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    if (isPdf) {
        const pdfDocument = await loadPdfDocument(await file.arrayBuffer());
        const pageCanvas = await renderPdfPageToCanvas(pdfDocument, 1);
        const image = new fabric.Image(pageCanvas, { left: 0, top: 0 });
        image.isFile = true;
        image.erasable = false;
        fitIfNeeded(image);
        return { kind: 'pdf', pdfDocument, image };
    }
    if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        try {
            const image = await fabric.Image.fromURL(url);
            image.set({ left: 0, top: 0 });
            image.isFile = true;
            image.erasable = false;
            fitIfNeeded(image);
            return { kind: 'image', pdfDocument: null, image };
        } finally {
            URL.revokeObjectURL(url);
        }
    }
    throw new Error('Unsupported file type.');
}
function commitPreparedFileImport(preparedFile) {
    canvas.add(preparedFile.image);
    currentFile = preparedFile.image;
    fileKind = preparedFile.kind;
    pdfDoc = preparedFile.pdfDocument;
    pageNum = 1;
    applyFileErasability();
    applyInteractivity();
    focusObject(currentFile);
    updatePageUI();
    canvas.requestRenderAll();
}
async function openFile(file) {
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    const isImg = file.type.startsWith('image/');
    if (isPdf) {
        const buf = await file.arrayBuffer();
        pdfDoc = await loadPdfDocument(buf);
        await showPage(1, true);
    } else if (isImg) {
        const url = URL.createObjectURL(file);
        try {
            const img = await fabric.Image.fromURL(url);
            img.set({ left: 0, top: 0 });
            img.isFile = true; img.erasable = false;
            fitIfNeeded(img);
            canvas.add(img);
            currentFile = img; fileKind = 'image';
            applyFileErasability();
            applyInteractivity();
            focusObject(img);
        } finally {
            URL.revokeObjectURL(url);
        }
    } else throw new Error('Unsupported file type.');
}
async function openBoardFile(file) {
    let data, canvasState;
    try {
        const text = await file.text();
        data = JSON.parse(text);
        canvasState = validateBoardLessonData(data, new Blob([text]).size, THEMES, LAYER_IDS);
        if (!canvasState) throw new Error('bad');
        // Fabric performs a second, detached validation pass before the live
        // canvas is cleared. This catches malformed serialized objects too.
        const stagingCanvas = new fabric.StaticCanvas(document.createElement('canvas'));
        await stagingCanvas.loadFromJSON(canvasState);
        stagingCanvas.dispose();
    } catch (error) {
        console.error('Unable to read lesson file', error);
        return false;
    }
    setHistorySuppressed(true);
    closeCurrentFile();
    removeAnnotationsSilent();
    setHistorySuppressed(false);
    await canvas.loadFromJSON(canvasState);
    canvas.getObjects().forEach(object => {
        if (object.isTriangle) attachApexControl(object);
        if (object.isArrow) attachArrowControls(object);
        if (object.boardflowEraseSpots?.length || object.boardflowErasePaths?.length) rebuildEraseMask(object);
    });
    currentFile = canvas.getObjects().find(o => o.isFile) || null;
    fileKind = currentFile ? (data.fileKind || 'image') : null;
    pdfDoc = null;
    pageNum = data.pageNum || 1;
    pageMemory.clear();
    if (data.memory) Object.entries(data.memory).forEach(([k, v]) => pageMemory.set(k, v));
    boardPages = data.boardPages || 1;
    boardPage = data.boardPage || 0;
    pageMemory.set(memKey(boardPage, pageNum), annotationsJSON());
    updateBoardPager();
    if (data.viewport && data.viewport.length === 6) canvas.setViewportTransform(data.viewport);
    theme = data.theme || theme;
    showGrid = (data.grid === undefined) ? showGrid : !!data.grid;
    if (data.layers) {
        LAYER_IDS.forEach(layer => {
            if (data.layers[layer]) layerState[layer] = {
                visible: data.layers[layer].visible !== false,
                locked: !!data.layers[layer].locked
            };
        });
        persistLayerState();
    }
    applyTheme();
    updatePageUI();
    updateViewChip();
    setTool(tool);
    resetHistory();
    return true;
}
async function loadLessonData(data) {
    const file = new File([JSON.stringify(data)], 'boardflow-version.boardview', { type: 'application/json' });
    return openBoardFile(file);
}
async function loadClassroomLessonData(data) {
    const localStudentStates = appMode === 'student'
        ? canvas.getObjects().filter(object => objectLayer(object) === 'student').map(object => object.toObject(CUSTOM_OBJECT_PROPERTIES))
        : [];
    const loaded = await loadLessonData(data);
    if (!loaded || !localStudentStates.length) return loaded;
    setHistorySuppressed(true);
    canvas.getObjects().filter(object => objectLayer(object) === 'student').forEach(object => canvas.remove(object));
    const localStudentObjects = await fabric.util.enlivenObjects(localStudentStates);
    localStudentObjects.forEach(object => canvas.add(object));
    setHistorySuppressed(false);
    applyInteractivity();
    resetHistory();
    return true;
}
btnPrev.onclick = () => flipPage(-1);
btnNext.onclick = () => flipPage(1);
function memKey(bp, pp) { return bp + ':' + pp; }
async function swapAnnotations(newKey) {
    setHistorySuppressed(true);
    canvas.discardActiveObject();
    removeAnnotationsSilent();
    setHistorySuppressed(false);
    const saved = pageMemory.get(newKey);
    if (saved) await applyAnnotationStateAsync(saved);
    resetHistory();
}
async function flipPage(delta) {
    if (!pdfDoc) return;
    const n = pageNum + delta;
    if (n < 1 || n > pdfDoc.numPages) return;
    stashPage(memKey(boardPage, pageNum));
    await showPage(n);
    await swapAnnotations(memKey(boardPage, n));
}
async function flipBoard(delta) {
    const n = boardPage + delta;
    if (n < 0 || n >= boardPages) return;
    stashPage(memKey(boardPage, pageNum));
    boardPage = n;
    updateBoardPager();
    await swapAnnotations(memKey(n, pageNum));
}
async function addBoardPage() {
    stashPage(memKey(boardPage, pageNum));
    boardPages += 1;
    boardPage = boardPages - 1;
    updateBoardPager();
    await swapAnnotations(memKey(boardPage, pageNum));
}
function deleteBoardPage() {
    if (boardPages <= 1) return;
    const removedPage = boardPage;
    const shiftedMemory = new Map();
    pageMemory.forEach((value, key) => {
        const [pageIndexText, pdfPageText] = key.split(':');
        const pageIndex = +pageIndexText;
        if (pageIndex === removedPage) return;
        const nextIndex = pageIndex > removedPage ? pageIndex - 1 : pageIndex;
        shiftedMemory.set(memKey(nextIndex, +pdfPageText), value);
    });
    pageMemory.clear();
    shiftedMemory.forEach((value, key) => pageMemory.set(key, value));
    boardPages -= 1;
    boardPage = Math.min(removedPage, boardPages - 1);
    updateBoardPager();
    swapAnnotations(memKey(boardPage, pageNum)).then(() => {
        scheduleCheckpoint();
        setStatus(`Page ${removedPage + 1} deleted.`);
    });
}
function updateBoardPager() {
    const bp = byId('bpager');
    if (!bp) return;
    bp.style.display = boardPages > 1 ? 'flex' : 'none';
    bp.setAttribute('aria-label', `Board page ${boardPage + 1} of ${boardPages}`);
    byId('bpageLabel').textContent = (boardPage + 1) + ' / ' + boardPages;
    byId('btnBPrev').disabled = boardPage <= 0;
    byId('btnBNext').disabled = boardPage >= boardPages - 1;
    byId('btnBDelete').disabled = boardPages <= 1;
}
const _bp1 = byId('btnBPrev'); if (_bp1) _bp1.onclick = () => flipBoard(-1);
const _bp2 = byId('btnBNext'); if (_bp2) _bp2.onclick = () => flipBoard(1);
const _bp3 = byId('btnBAdd'); if (_bp3) _bp3.onclick = addBoardPage;
const _bp4 = byId('btnBDelete'); if (_bp4) _bp4.onclick = deleteBoardPage;
const _np = byId('btnNewPage'); if (_np) _np.onclick = addBoardPage;
async function applyLessonTemplate(template) {
    if (appMode !== 'teacher') {
        setStatus('Lesson templates are available in Teacher mode.', true);
        return;
    }
    await addBoardPage();
    const previousLayer = activeLayer;
    activeLayer = 'lesson';
    if (template === 'grid' || template === 'coordinate') {
        showGrid = true;
        applyTheme();
    }
    const center = viewCenterWorld();
    if (template === 'coordinate') {
        const width = Math.min(720, canvas.getWidth() * 0.72);
        const height = Math.min(520, canvas.getHeight() * 0.66);
        const axisStyle = { stroke: '#475569', strokeWidth: 2, strokeUniform: true, isShape: true, boardflowLayer: 'lesson' };
        const horizontal = new fabric.Line([center.x - width / 2, center.y, center.x + width / 2, center.y], axisStyle);
        const vertical = new fabric.Line([center.x, center.y - height / 2, center.x, center.y + height / 2], axisStyle);
        canvas.add(horizontal, vertical);
    }
    if (template === 'exit') {
        const title = new fabric.Textbox('Exit ticket', { left: center.x - 260, top: center.y - 210, width: 520, fontFamily: 'Cambria, Georgia, serif', fontWeight: 700, fontSize: 34, fill: '#172554', boardflowLayer: 'lesson' });
        const prompt = new fabric.Textbox('What is the most important idea you learned today?', { left: center.x - 260, top: center.y - 125, width: 520, fontFamily: 'Tahoma, Verdana, sans-serif', fontSize: 22, fill: '#334155', boardflowLayer: 'lesson' });
        const answerBox = new fabric.Rect({ left: center.x - 260, top: center.y - 40, width: 520, height: 230, fill: 'rgba(79,124,255,.04)', stroke: '#94a3b8', strokeWidth: 2, strokeDashArray: [9, 7], strokeUniform: true, isShape: true, boardflowLayer: 'student' });
        canvas.add(title, prompt, answerBox);
    }
    activeLayer = previousLayer;
    applyInteractivity();
    resetHistory();
    scheduleCheckpoint();
    setStatus(`${template === 'blank' ? 'Blank' : template[0].toUpperCase() + template.slice(1)} lesson page added.`);
}
function stashPage(key) {
    if (hasInk()) pageMemory.set(key, annotationsJSON());
    else pageMemory.delete(key);
    scheduleCheckpoint();
}

// ================= Countdown timer =================
const timerWidget = byId('timerWidget');
const timerText = byId('timerText');
const timerButton = byId('btnTimer');
let timerSeconds = 0;
let timerEndTime = 0;
let timerInterval = null;
function timerIsRunning() { return timerInterval !== null; }
function renderTimer() {
    const minutes = Math.floor(timerSeconds / 60);
    const seconds = timerSeconds % 60;
    timerText.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    timerWidget.classList.toggle('running', timerIsRunning());
    byId('tStart').textContent = timerIsRunning() ? 'Ⅱ' : '▶';
    byId('tStart').title = timerIsRunning() ? 'Pause timer' : 'Start timer';
    classroomSuite?.broadcastTimer(timerSeconds, timerIsRunning());
}
function stopTimer() {
    if (timerInterval !== null) clearInterval(timerInterval);
    timerInterval = null;
    renderTimer();
}
function updateTimerFromClock() {
    timerSeconds = Math.max(0, Math.ceil((timerEndTime - Date.now()) / 1000));
    if (timerSeconds === 0) {
        stopTimer();
        setStatus('Time is up.');
        return;
    }
    renderTimer();
}
function addTimerSeconds(seconds) {
    timerSeconds += seconds;
    if (timerIsRunning()) timerEndTime += seconds * 1000;
    renderTimer();
}
function syncClassroomTimer(seconds, running) {
    stopTimer();
    timerSeconds = Math.max(0, Math.round(Number(seconds) || 0));
    if (running && timerSeconds > 0) {
        timerEndTime = Date.now() + timerSeconds * 1000;
        timerInterval = setInterval(updateTimerFromClock, 250);
    }
    timerWidget.classList.remove('hidden');
    renderTimer();
}
timerButton.onclick = () => {
    const opening = timerWidget.classList.contains('hidden');
    timerWidget.classList.toggle('hidden', !opening);
    timerButton.classList.toggle('active', opening);
    if (opening) hideMenuNow();
};
byId('tPlus1').onclick = () => addTimerSeconds(60);
byId('tPlus5').onclick = () => addTimerSeconds(300);
byId('tStart').onclick = () => {
    if (timerIsRunning()) {
        updateTimerFromClock();
        stopTimer();
        return;
    }
    if (timerSeconds <= 0) timerSeconds = 60;
    timerEndTime = Date.now() + timerSeconds * 1000;
    timerInterval = setInterval(updateTimerFromClock, 250);
    renderTimer();
};
byId('tReset').onclick = () => {
    stopTimer();
    timerSeconds = 0;
    renderTimer();
};
byId('tClose').onclick = () => {
    timerWidget.classList.add('hidden');
    timerButton.classList.remove('active');
};
renderTimer();
// ================= Export / dialog =================
async function exportPNG() {
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    const filename = 'boardflow-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.png';
    const dataUrl = canvas.toDataURL({ format: 'png' });
    if (activeSubjectFolder) {
        try {
            const permission = await activeSubjectFolder.requestPermission({ mode: 'readwrite' });
            if (permission === 'granted') {
                const blob = await fetch(dataUrl).then(response => response.blob());
                const fileHandle = await activeSubjectFolder.getFileHandle(filename, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(blob);
                await writable.close();
                return;
            }
        } catch (error) {
            console.error('Unable to save board in the subject folder', error);
        }
    }
    const a = document.createElement('a');
    a.download = filename;
    a.href = dataUrl;
    a.click();
}
function serializedCanvasState() {
    // Fabric v7 ignores arguments passed to canvas.toJSON(). Its toObject()
    // counterpart forwards this allow-list to every canvas object, including
    // children of groups, so BoardFlow metadata survives save/share round trips.
    const state = canvas.toObject(CUSTOM_OBJECT_PROPERTIES);
    state.objects?.forEach(object => {
        if (object.boardflowEraseSpots?.length || object.boardflowErasePaths?.length) delete object.clipPath;
    });
    return state;
}
function buildLessonData(subjectId = activeSubjectId) {
    return {
        app: 'BoardFlow',
        version: 2,
        updatedAt: new Date().toISOString(),
        subjectId,
        objects: serializedCanvasState(),
        fileKind,
        pageNum,
        boardPage,
        boardPages,
        memory: Object.fromEntries(pageMemory),
        viewport: canvas.viewportTransform,
        theme,
        grid: showGrid,
        layers: layerState
    };
}
const dlg = byId('dialog');
let suppressSaveOnClose = false;
function askSaveChanges() {
    return new Promise(resolve => {
        clearTimeout(hideTimer);
        dlg.classList.remove('hidden');
        const done = v => { dlg.classList.add('hidden'); if (!menu.classList.contains('hidden')) armHide(); resolve(v); };
        byId('dlgSave').onclick = () => done('export');
        byId('dlgDont').onclick = () => done('close');
        byId('dlgCancel').onclick = () => done('cancel');
    });
}
async function requestClose() {
    try {
        if (hasInk()) {
            const text = byId('saveDialogText');
            text.textContent = boardPages > 1
                ? 'Export the current page as a PNG before closing? Your editable lesson is autosaved for recovery.'
                : 'Export this board as a PNG before closing? Your editable lesson is autosaved for recovery.';
            const answer = await askSaveChanges();
            if (answer === 'cancel') return false;
            if (answer === 'export') await exportPNG();
        }
        await saveCheckpoint('last');
        if (activeSubjectId) await saveCheckpoint(`subject:${activeSubjectId}`);
        suppressSaveOnClose = true;
        return true;
    } catch (error) {
        console.error('Unable to finish saving before closing', error);
        setStatus('Could not finish saving. Keep BoardFlow open and try again.', true);
        return false;
    }
};

// ================= Subjects workspace =================
const subjectPanel = byId('subjPanel');
const subjectList = byId('subjList');
const subjectNameInput = byId('subjName');
const subjectFolderStatus = byId('subjFolderStatus');
const subjectSuggestions = byId('subjectSuggestions');
const subjectForm = byId('subjForm');
const subjectLabel = byId('subjectLabel');
const dateElements = {
    month: byId('dateMonth'),
    day: byId('dateDay'),
    ordinal: byId('dateOrdinal'),
    year: byId('dateYear')
}

// Handle close request differently based on platform
if (isElectron()) {
    window.boardFlowDesktop.onCloseRequested(requestClose);
} else if (isWeb()) {
    // In web browsers, we don't need the close confirmation dialog
    window.addEventListener('beforeunload', (event) => {
        if (!suppressSaveOnClose) {
            event.preventDefault();
            event.returnValue = '';
            return '';
        }
    });
}

let appWorkspaceFolder = null;
let activeSubjectId = null;
let activeSubjectFolder = null;
let subjectSelectionVersion = 0;
let subjectEditMode = false;
const subjectLessonStorageKey = subjectId => `boardflow-subject-lesson:${subjectId}`;
const subjectColors = ['#2f80ed', '#27ae60', '#e67e22', '#8e44ad', '#d35400', '#16a085', '#c0392b', '#2980b9'];
const safeWorkspaceName = value => (String(value || '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/[. ]+$/g, '').trim() || 'Subject').slice(0, 80);

async function ensureAppWorkspace() {
    if (isElectron() && window.boardFlowDesktop?.getWorkspace) {
        let workspacePath = await window.boardFlowDesktop.getWorkspace();
        if (!workspacePath) workspacePath = await window.boardFlowDesktop.chooseWorkspace();
        if (!workspacePath) return null;
        subjectFolderStatus.textContent = `BoardFlow workspace: ${workspacePath}`;
        return { type: 'desktop', name: workspacePath.split(/[\\/]/).pop() };
    } else if (isWeb() || isCapacitor()) {
        const workspaceName = isCapacitor() ? 'BoardFlow device storage' : 'BoardFlow browser storage';
        subjectFolderStatus.textContent = `${workspaceName}; editable recovery is stored locally.`;
        return { type: 'web', name: workspaceName };
    }
    
    if (!window.showDirectoryPicker) {
        subjectFolderStatus.textContent = 'Workspace folder selection requires the BoardFlow desktop app or a current Chromium browser.';
        return null;
    }
    appWorkspaceFolder ||= await getAppFolder();
    if (appWorkspaceFolder) {
        const permission = await appWorkspaceFolder.queryPermission?.({ mode: 'readwrite' });
        if (permission === 'granted' || !appWorkspaceFolder.queryPermission) return { type: 'browser', handle: appWorkspaceFolder, name: appWorkspaceFolder.name };
        if (await appWorkspaceFolder.requestPermission?.({ mode: 'readwrite' }) === 'granted') return { type: 'browser', handle: appWorkspaceFolder, name: appWorkspaceFolder.name };
    }
    try {
        appWorkspaceFolder = await window.showDirectoryPicker({ id: 'boardflow-workspace', mode: 'readwrite' });
        await putAppFolder(appWorkspaceFolder);
        subjectFolderStatus.textContent = `BoardFlow workspace: ${appWorkspaceFolder.name}`;
        return { type: 'browser', handle: appWorkspaceFolder, name: appWorkspaceFolder.name };
    } catch (error) {
        if (error.name !== 'AbortError') console.error('Unable to choose BoardFlow workspace', error);
        return null;
    }
}

function emptySubjectLesson(subjectId, subjectName) {
    return JSON.stringify({
        app: 'BoardFlow',
        version: 2,
        subjectId,
        subjectName,
        createdAt: new Date().toISOString(),
        objects: { objects: [] },
        fileKind: null,
        pageNum: 1,
        boardPage: 0,
        boardPages: 1,
        memory: {},
        viewport: [1, 0, 0, 1, 0, 0],
        theme,
        grid: showGrid
    });
}

async function createSubjectWorkspace(subjectId, subjectName) {
    const workspace = await ensureAppWorkspace();
    if (!workspace) return null;
    const folderName = safeWorkspaceName(subjectName);
    const content = emptySubjectLesson(subjectId, subjectName);
    if (workspace.type === 'desktop') {
        return window.boardFlowDesktop.createSubjectWorkspace({ folderName, content });
    }
    if (workspace.type === 'web') {
        localStorage.setItem(subjectLessonStorageKey(subjectId), content);
        return { folderName };
    }
    const folderHandle = await workspace.handle.getDirectoryHandle(folderName, { create: true });
    const fileHandle = await folderHandle.getFileHandle(`${folderName}.boardview`, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
    await putSubjectFolder(subjectId, folderHandle);
    return { folderName, folderHandle };
}

async function writeSubjectLessonFile(subjectId) {
    const subject = readSubjects().find(entry => entry.id === subjectId);
    if (!subject) return;
    const content = JSON.stringify(buildLessonData(subjectId));
    if (window.boardFlowDesktop?.writeSubjectFile) {
        await window.boardFlowDesktop.writeSubjectFile({ folderName: subject.folderName, content });
        return;
    }
    const folderHandle = await readSubjectFolderHandle(subjectId);
    if (!folderHandle) {
        if (isWeb() || isCapacitor()) localStorage.setItem(subjectLessonStorageKey(subjectId), content);
        return;
    }
    const permission = await folderHandle.queryPermission?.({ mode: 'readwrite' });
    if (permission && permission !== 'granted' && await folderHandle.requestPermission?.({ mode: 'readwrite' }) !== 'granted') return;
    const fileHandle = await folderHandle.getFileHandle(`${subject.folderName}.boardview`, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
}
function updateSubjectLabel(subject) {
    subjectLabel.textContent = subject ? subject.name : '';
    subjectLabel.classList.toggle('hidden', !subject);
    updateDateLabel(dateElements);
}
function currentFileVisualState() {
    if (!currentFile) return null;
    const eraseSpots = currentFile.boardflowEraseSpots || [];
    const erasePaths = currentFile.boardflowErasePaths || [];
    return {
        left: currentFile.left,
        top: currentFile.top,
        originX: currentFile.originX,
        originY: currentFile.originY,
        scaleX: currentFile.scaleX,
        scaleY: currentFile.scaleY,
        angle: currentFile.angle,
        skewX: currentFile.skewX,
        skewY: currentFile.skewY,
        flipX: currentFile.flipX,
        flipY: currentFile.flipY,
        opacity: currentFile.opacity,
        boardflowEraseSpots: eraseSpots,
        boardflowErasePaths: erasePaths,
        clipPath: eraseSpots.length || erasePaths.length ? null : currentFile.clipPath?.toObject() || null
    };
}
async function restoreCurrentFileVisualState(state) {
    if (!currentFile || !state) return;
    const { clipPath, boardflowEraseSpots, boardflowErasePaths, ...properties } = state;
    currentFile.set(properties);
    currentFile.boardflowEraseSpots = boardflowEraseSpots || [];
    currentFile.boardflowErasePaths = boardflowErasePaths || [];
    if (currentFile.boardflowEraseSpots.length || currentFile.boardflowErasePaths.length) {
        rebuildEraseMask(currentFile);
    } else if (clipPath) {
        const [restoredClipPath] = await fabric.util.enlivenObjects([clipPath]);
        currentFile.clipPath = restoredClipPath;
    } else {
        currentFile.clipPath = null;
        currentFile.dirty = true;
    }
    currentFile.setCoords();
    canvas.requestRenderAll();
}
async function saveCheckpoint(checkpointKey, subjectIdOverride) {
    if (hasInk()) pageMemory.set(memKey(boardPage, pageNum), annotationsJSON());
    else pageMemory.delete(memKey(boardPage, pageNum));
    const checkpointSubjectId = subjectIdOverride === undefined ? activeSubjectId : subjectIdOverride;
    const checkpoint = {
        file: lastUploadedFile,
        fileState: currentFileVisualState(),
        subjectId: checkpointSubjectId,
        pageNum,
        boardPage,
        boardPages,
        memory: Object.fromEntries(pageMemory),
        annotations: annotationsJSON(),
        viewport: canvas.viewportTransform,
        theme,
        grid: showGrid,
        layers: layerState
    };
    const key = checkpointKey || (activeSubjectId ? `subject:${activeSubjectId}` : 'last');
    await putCheckpoint(key, checkpoint);
    setSaveStatus(`Autosaved for recovery · ${new Date().toLocaleTimeString()}`);
    classroomSuite?.captureAutomaticVersion().catch(error => console.error('Unable to save lesson version', error));
    classroomSuite?.broadcastBoard();
    if (checkpointSubjectId) {
        try {
            await writeSubjectLessonFile(checkpointSubjectId);
        } catch (error) {
            console.error('Unable to update the subject lesson file', error);
            setSaveStatus('Recovery saved; subject file update failed.', true);
            setStatus('Recovery copy saved, but the subject lesson file could not be updated.', true);
        }
    }
}
async function restoreCheckpoint(checkpointKey) {
    const checkpoint = await getCheckpoint(checkpointKey || 'last');
    if (!checkpoint) return false;
    setSaveStatus('Recovered local lesson');
    setHistorySuppressed(true);
    closeCurrentFile();
    removeAnnotationsSilent();
    lastUploadedFile = checkpoint.file || null;
    activeSubjectId = checkpoint.subjectId || loadPref(ACTIVE_SUBJECT_STORE) || null;
    activeSubjectFolder = activeSubjectId ? await readSubjectFolderHandle(activeSubjectId) : null;
    updateSubjectLabel(activeSubjectId ? readSubjects().find(entry => entry.id === activeSubjectId) : null);
    if (checkpoint.file) {
        const file = new File([checkpoint.file.data], checkpoint.file.name, { type: checkpoint.file.type });
        await openFile(file);
        pageNum = checkpoint.pageNum || 1;
        if (pdfDoc && pageNum > 1) await showPage(pageNum);
        await restoreCurrentFileVisualState(checkpoint.fileState);
    } else {
        pageNum = 1;
    }
    boardPage = checkpoint.boardPage || 0;
    boardPages = checkpoint.boardPages || 1;
    pageMemory.clear();
    if (checkpoint.memory) Object.entries(checkpoint.memory).forEach(([key, value]) => pageMemory.set(key, value));
    await applyAnnotationStateAsync(checkpoint.annotations || pageMemory.get(memKey(boardPage, pageNum)) || '[]');
    if (checkpoint.viewport && checkpoint.viewport.length === 6) canvas.setViewportTransform(checkpoint.viewport);
    theme = checkpoint.theme || theme;
    showGrid = checkpoint.grid === undefined ? showGrid : !!checkpoint.grid;
    if (checkpoint.layers) {
        LAYER_IDS.forEach(layer => {
            if (checkpoint.layers[layer]) layerState[layer] = {
                visible: checkpoint.layers[layer].visible !== false,
                locked: !!checkpoint.layers[layer].locked
            };
        });
        persistLayerState();
    }
    applyTheme();
    updateBoardPager();
    updatePageUI();
    setHistorySuppressed(false);
    resetHistory();
    return true;
}
function clearWorkspace() {
    setHistorySuppressed(true);
    closeCurrentFile();
    removeAnnotationsSilent();
    lastUploadedFile = null;
    pageMemory.clear();
    boardPage = 0;
    boardPages = 1;
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    updateBoardPager();
    updateViewChip();
    updatePageUI();
    setHistorySuppressed(false);
    resetHistory();
}
const saveSubjectFolderHandle = putSubjectFolder;
const readSubjectFolderHandle = getSubjectFolder;
function requestSubjectDeletion(subject) {
    const deleteDialog = byId('subjectDeleteDialog');
    const passwordInput = byId('subjectDeletePassword');
    const errorMessage = byId('subjectDeleteError');
    const requiresPassword = Boolean(subject.deletePinHash || subject.password);
    byId('subjectDeleteText').textContent = requiresPassword
        ? `Enter the deletion password to remove “${subject.name}”. This cannot be undone.`
        : `Remove “${subject.name}”? This cannot be undone.`;
    passwordInput.value = '';
    passwordInput.classList.toggle('hidden', !requiresPassword);
    errorMessage.classList.add('hidden');
    deleteDialog.classList.remove('hidden');
    return new Promise(resolve => {
        const finish = result => {
            deleteDialog.classList.add('hidden');
            document.removeEventListener('keydown', onKeyDown);
            resolve(result);
        };
        const confirmDeletion = async () => {
            if (requiresPassword) {
                const inputPin = passwordInput.value;
                const matches = subject.deletePinHash
                    ? await hashDeletePin(inputPin) === subject.deletePinHash
                    : inputPin === subject.password;
                if (!matches) {
                    errorMessage.classList.remove('hidden');
                    passwordInput.select();
                    return;
                }
            }
            finish(true);
        };
        const onKeyDown = event => {
            if (event.key === 'Escape') finish(false);
            if (event.key === 'Enter') confirmDeletion();
        };
        byId('subjectDeleteCancel').onclick = () => finish(false);
        byId('subjectDeleteConfirm').onclick = confirmDeletion;
        document.addEventListener('keydown', onKeyDown);
        setTimeout(() => (requiresPassword ? passwordInput : byId('subjectDeleteCancel')).focus(), 0);
    });
}
function renderSubjects() {
    const subjects = readSubjects().slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    subjectSuggestions.innerHTML = '';
    subjects.forEach(subject => {
        const option = document.createElement('option');
        option.value = subject.name;
        subjectSuggestions.appendChild(option);
    });
    subjectList.innerHTML = '';
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'subj-edit-toggle';
    editButton.textContent = subjectEditMode ? '✓ Done' : '✎ Edit';
    editButton.addEventListener('click', () => {
        subjectEditMode = !subjectEditMode;
        subjectForm.classList.toggle('hidden', !subjectEditMode);
        renderSubjects();
        if (subjectEditMode) setTimeout(() => subjectNameInput.focus(), 0);
    });
    subjectList.appendChild(editButton);
    if (!subjects.length) {
        subjectList.innerHTML = '<div class="empty-state">No subjects yet. Add your first subject to choose the main BoardFlow workspace.</div>';
        subjectList.prepend(editButton);
        return;
    }
    subjects.forEach((subject, index) => {
        const row = document.createElement('div');
        row.className = 'subj-row';
        const item = document.createElement('div');
        item.className = 'subj-item';
        const color = subject.color || subjectColors[index % subjectColors.length];
        item.style.backgroundColor = color;
        const name = document.createElement('span');
        name.className = 'subj-name';
        name.title = subject.name;
        name.textContent = subject.name;
        item.appendChild(name);
        item.addEventListener('click', () => {
            if (subjectEditMode) {
                const colorInput = item.querySelector('.subj-color');
                if (colorInput) colorInput.click();
                return;
            }
            updateSubjectLabel(subject);
            subjectPanel.classList.add('hidden');
            openSubject(subject.id).catch(error => console.error('Unable to open subject workspace', error));
        });
        if (subjectEditMode) {
            const colorInput = document.createElement('input');
            colorInput.className = 'subj-color';
            colorInput.type = 'color';
            colorInput.value = color;
            colorInput.title = `Choose color for ${subject.name}`;
            colorInput.addEventListener('click', event => event.stopPropagation());
            colorInput.addEventListener('change', event => {
                const updated = readSubjects().map(entry => entry.id === subject.id ? { ...entry, color: event.target.value } : entry);
                writeSubjects(updated);
                renderSubjects();
            });
            item.appendChild(colorInput);
            const deleteButton = document.createElement('button');
            deleteButton.className = 'subj-delete';
            deleteButton.type = 'button';
            deleteButton.textContent = '×';
            deleteButton.title = `Delete ${subject.name}`;
            deleteButton.addEventListener('click', async event => {
                event.stopPropagation();
                if (!await requestSubjectDeletion(subject)) return;
                const remaining = readSubjects().filter(entry => entry.id !== subject.id);
                writeSubjects(remaining);
                if (activeSubjectId === subject.id) {
                    activeSubjectId = null;
                    savePref(ACTIVE_SUBJECT_STORE, '');
                }
                renderSubjects();
            });
            row.appendChild(deleteButton);
        }
        row.appendChild(item);
        subjectList.appendChild(row);
    });
}
async function openSubject(id) {
    const subject = readSubjects().find(entry => entry.id === id);
    if (!subject) return;
    subjectSelectionVersion += 1;
    const previousCheckpointKey = activeSubjectId ? 'subject:' + activeSubjectId : 'last';
    const previousSubjectId = activeSubjectId;
    activeSubjectId = id;
    savePref(ACTIVE_SUBJECT_STORE, id);
    updateSubjectLabel(subject);
    await saveCheckpoint(previousCheckpointKey, previousSubjectId);
    activeSubjectFolder = await readSubjectFolderHandle(id);
    if (!(await restoreCheckpoint('subject:' + id))) clearWorkspace();
    activeSubjectId = id;
    activeSubjectFolder = await readSubjectFolderHandle(id);
    updateSubjectLabel(subject);
    subjectPanel.classList.add('hidden');
}
byId('btnSubjects').onclick = () => {
    subjectPanel.classList.toggle('hidden');
    if (!subjectPanel.classList.contains('hidden')) {
        hideMenuNow();
        subjectEditMode = false;
        subjectForm.classList.add('hidden');
        renderSubjects();
    }
};
byId('subjClose').onclick = () => subjectPanel.classList.add('hidden');
document.addEventListener('pointerdown', event => {
    if (subjectPanel.classList.contains('hidden')) return;
    if (event.target.closest('#subjPanel, #btnSubjects, #subjectDeleteDialog')) return;
    subjectPanel.classList.add('hidden');
}, true);
byId('subjCreate').onclick = async () => {
    const name = subjectNameInput.value.trim();
    if (!name) { subjectNameInput.focus(); return; }
    if (readSubjects().some(subject => subject.name.localeCompare(name, undefined, { sensitivity: 'base' }) === 0)) {
        subjectFolderStatus.textContent = 'A subject with that name already exists.';
        subjectNameInput.focus();
        return;
    }
    const id = 'subject-' + Date.now().toString(36);
    const deletePin = byId('subjPwd').value.trim();
    subjectFolderStatus.textContent = 'Preparing the subject workspace…';
    let workspace;
    try {
        workspace = await createSubjectWorkspace(id, name);
    } catch (error) {
        console.error('Unable to create subject workspace', error);
        subjectFolderStatus.textContent = `Could not create the subject folder: ${error.message || 'Please choose another workspace.'}`;
        return;
    }
    if (!workspace) {
        subjectFolderStatus.textContent = 'Subject creation was cancelled because no workspace folder was selected.';
        return;
    }
    const subjects = readSubjects();
    subjects.push({
        id,
        name,
        folderName: workspace.folderName,
        color: subjectColors[subjects.length % subjectColors.length],
        deletePinHash: deletePin ? await hashDeletePin(deletePin) : null
    });
    writeSubjects(subjects);
    if (workspace.folderHandle) await saveSubjectFolderHandle(id, workspace.folderHandle);
    subjectNameInput.value = '';
    byId('subjPwd').value = '';
    subjectFolderStatus.textContent = `Created ${workspace.folderName}/${workspace.folderName}.boardview`;
    renderSubjects();
};

// ================= Natural Angle Recognition (NAT) Module =================
let natHits = [];
let natRevealed = new Set();
const natEndpointLabels = new Map();
const natCrossingLabels = new Map();
const natActive = true;
let natIdCounter = 0;
const natPalette = ['#e6194b','#3cb44b','#f58e26','#4363d8','#911eb4','#008080','#f032e6','#bc7400'];
const natLetters = 'abcdefghijklmnopqrstuvwxyz';
let natEndpointCounter = 0;
let natCrossingCounter = 0;
const btnAngles = byId('btnAngles');
const geometryToolRail = byId('geometryToolRail');
const geometryInsight = byId('geometryInsight');
let selectedNatHit = null;
function setGeometryToolRailVisible(visible) {
    geometryToolRail.classList.toggle('hidden', !visible);
    if (!visible) geometryInsight.classList.add('hidden');
}
function closeGeometryTools() {
    selectedNatHit = null;
    natRevealed.clear();
    setGeometryToolRailVisible(false);
    geometryToolRail.querySelectorAll('button.active').forEach(button => button.classList.remove('active'));
    canvas.requestRenderAll();
}
function showGeometryInsight(title, text) {
    geometryInsight.querySelector('h4').textContent = title;
    geometryInsight.querySelector('p').textContent = text;
    geometryInsight.classList.remove('hidden');
}
function runGeometryTool(tool, button) {
    if (!selectedNatHit) return;
    geometryToolRail.querySelectorAll('button.active').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    const angle = Math.round(selectedNatHit.deg);
    const results = {
        pairs: ['Angle relationships', `Selected angle: ${angle}°\nSupplementary: ${180 - angle}°\nComplementary: ${Math.max(0, 90 - angle)}°`],
        vertical: ['Vertically opposite', `The opposite angle is also ${angle}°.`],
        parallel: ['Parallel-line relationships', `Selected angle: ${angle}°\nSelect another crossing to compare corresponding angles.`],
        triangle: ['Triangle angle sum', `Remaining triangle angles total ${180 - angle}°.`],
        exercise: ['Missing-angle exercise', `180° − ${angle}° = ${180 - angle}°`],
        trig: ['Trigonometry', `sin ${angle}° = ${Math.sin(angle * Math.PI / 180).toFixed(3)}\ncos ${angle}° = ${Math.cos(angle * Math.PI / 180).toFixed(3)}\ntan ${angle}° = ${Math.tan(angle * Math.PI / 180).toFixed(3)}`],
        pythagoras: ['Pythagoras theorem', 'Select two sides of a right triangle to calculate the missing side.'],
        area: ['Perimeter and area', 'Select a closed shape to calculate its perimeter and area.'],
        measure: ['Angle measurement', `Measured angle: ${angle}°`]
    };
    const result = results[tool];
    if (result) showGeometryInsight(result[0], result[1]);
}
geometryToolRail.querySelectorAll('[data-geometry-tool]').forEach(button => {
    button.addEventListener('click', event => {
        event.stopPropagation();
        runGeometryTool(button.dataset.geometryTool, button);
    });
});
function updateAngleButton() {
    const segments = canvas.getObjects().filter(isRecognizedAngleLine).map(straightSegment).filter(Boolean);
    const hasCrossingLines = segments.some((first, index) => segments.slice(index + 1).some(second => segIntersect(first[0], first[1], second[0], second[1])));
    const hasShapeAngles = canvas.getObjects().some(object => shapeAngleGeometry(object)?.points.length >= 3);
    const hasAngles = hasCrossingLines || hasShapeAngles;
    btnAngles.classList.toggle('hidden', !hasAngles);
    if (!hasAngles && natLessonVisible) {
        natLessonVisible = false;
        closeGeometryTools();
    }
    btnAngles.classList.toggle('active', natLessonVisible);
    lensUI();
}
function toggleNaturalAngleLesson() {
    const hasAngleSources = canvas.getObjects().some(object => shapeAngleGeometry(object)?.points.length >= 3)
        || (() => {
            const segments = canvas.getObjects().filter(isRecognizedAngleLine).map(straightSegment).filter(Boolean);
            return segments.some((first, index) => segments.slice(index + 1).some(second => segIntersect(first[0], first[1], second[0], second[1])));
        })();
    if (!hasAngleSources) {
        setStatus('Add a straight-edged shape or two crossing straight lines first.', true);
        hideMenuNow();
        return;
    }
    natLessonVisible = !natLessonVisible;
    natRevealed.clear();
    selectedNatHit = null;
    setGeometryToolRailVisible(false);
    canvas.requestRenderAll();
    updateAngleButton();
    hideMenuNow();
}
btnAngles.onclick = toggleNaturalAngleLesson;
function nextNatLetter() {
    const index = natEndpointCounter++;
    if (index < natLetters.length) return natLetters[index].toUpperCase();
    return (natLetters[Math.floor(index / natLetters.length) - 1] + natLetters[index % natLetters.length]).toUpperCase();
}
function endpointLabels(o) {
    const id = uid(o);
    if (!natEndpointLabels.has(id)) natEndpointLabels.set(id, [nextNatLetter(), nextNatLetter()]);
    return natEndpointLabels.get(id);
}
function assignStraightLineLabels() {
    let labelIndex = 0;
    canvas.getObjects().forEach(o => {
        if (!isRecognizedAngleLine(o)) return;
        const labels = [String.fromCharCode(65 + labelIndex), String.fromCharCode(66 + labelIndex)];
        labelIndex += 2;
        natEndpointLabels.set(uid(o), labels);
    });
    natEndpointCounter = labelIndex;
}

function crossingLabel(key) {
    if (!natCrossingLabels.has(key)) {
        const index = natCrossingCounter++;
        natCrossingLabels.set(key, index < 26 ? String.fromCharCode(90 - index) : 'X' + (index + 1));
    }
    return natCrossingLabels.get(key);
}

function crossingPointKey(point) {
    return Math.round(point.x * 10) + '_' + Math.round(point.y * 10);
}

function natStraight(o) {
    if (!isRecognizedAngleLine(o)) return null;
    const segment = straightSegment(o);
    return segment ? { p1: segment[0], p2: segment[1] } : null;
}

function isRecognizedAngleLine(object) {
    return object?.type === 'line' && object.boardflowKind === 'recognized-line';
}

function shapeAngleGeometry(object) {
    if (!object?.isShape || object.isArrow || object.boardflowKind === 'recognized-wave') return null;
    if (object.type === 'rect') return { points: object.getCoords(), closed: true };
    if (object.type === 'polygon') return { points: triangleWorldPts(object), closed: true };
    if (object.type === 'polyline' && object.boardflowKind === 'recognized-zigzag') {
        return {
            points: object.points.map(p => ({ x: p.x + object.left, y: p.y + object.top })),
            closed: false
        };
    }
    return null;
}

canvas.on('object:added', historyTrigger);

// Diagnostic function for smart math results
window.__getLastSmartMathResult = function() {
    return window.__lastSmartMathResult;
};

// Diagnostic function for table recognition
window.__getLastTableResult = function() {
    return window.__lastTableResult;
};

// Diagnostic function for workspace state
window.__getWorkspaceState = function() {
    if (window.classroomSuite) {
        return {
            boards: window.classroomSuite.getBoards(),
            activeBoardId: window.classroomSuite.getActiveBoardId(),
            canvasState: canvas.toJSON()
        };
    }
    return null;
};

function triangleWorld(object) {
    if (object.type === 'triangle') {
        return { points: triangleWorldPts(object), closed: false };
    }
    return null;
}

function natClick(e) {
    if (!e || !canvas) return false;
    const rect = canvas.lowerCanvasEl?.getBoundingClientRect();
    if (!rect) return false;
    
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    let nearest = null;
    let nearestDistance = Infinity;
    for (const hit of natHits) {
        const dist = Math.sqrt((hit.x - clickX)**2 + (hit.y - clickY)**2);
        if (dist <= 32 && dist < nearestDistance) {
            nearest = hit;
            nearestDistance = dist;
        }
    }
    if (!nearest) return false;
    selectedNatHit = nearest;
    natRevealed.clear();
    natRevealed.add(nearest.key);
    setGeometryToolRailVisible(true);
    geometryInsight.classList.add('hidden');
    canvas.requestRenderAll();
    return true;
}

// Diagnostic function for workspace state - exposing classroom suite state
window.__getWorkspaceState = () => window.classroomSuite?.getWorkspaceState();

canvas.on('after:render', () => {
    natHits = [];
    if (!natActive) return;
    assignStraightLineLabels();
    updateAngleButton();
    if (!natLessonVisible) return;
    natCrossingLabels.clear();
    natCrossingCounter = 0;
    const ctx = canvas.contextContainer;
    if (!ctx) return;
    ctx.save();

    // 1. Collect all straight segments
    const natSegments = [];
    canvas.getObjects().forEach(o => {
        const ends = natStraight(o);
        if (ends) {
            const p1 = fabric.util.transformPoint(ends.p1, canvas.viewportTransform);
            const p2 = fabric.util.transformPoint(ends.p2, canvas.viewportTransform);
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            let angle = Math.atan2(dy, dx) * 180 / Math.PI;
            if (angle < 0) angle += 180; // mod 180
            natSegments.push({ o, p1, p2, angle });
        }
    });

    // 2. Parallel groups
    const natGroups = [];
    natSegments.forEach(seg => {
        let matched = false;
        for (const g of natGroups) {
            let diff = Math.abs(g.angle - seg.angle);
            if (diff > 90) diff = 180 - diff;
            if (diff <= 2) {
                g.members.push(seg);
                matched = true;
                break;
            }
        }
        if (!matched) {
            natGroups.push({ angle: seg.angle, members: [seg] });
        }
    });

    natGroups.forEach((g, groupIndex) => {
        const color = natPalette[groupIndex % natPalette.length];
        g.members.forEach((seg) => {
            // Chevron marks at midpoint
            if (g.members.length >= 2) {
                const mx = (seg.p1.x + seg.p2.x) / 2;
                const my = (seg.p1.y + seg.p2.y) / 2;
                const chevrons = Math.min(g.members.length, 3);
                const dx = seg.p2.x - seg.p1.x;
                const dy = seg.p2.y - seg.p1.y;
                const len = Math.sqrt(dx*dx + dy*dy) || 1;
                const ux = dx / len, uy = dy / len;
                const nx = -uy, ny = ux;
                const spacing = 6;
                ctx.save();
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                for (let c = 0; c < chevrons; c++) {
                    const offset = (c - (chevrons - 1) / 2) * spacing;
                    const cx = mx + nx * offset;
                    const cy = my + ny * offset;
                    const size = 8;
                    ctx.beginPath();
                    ctx.moveTo(cx - ux * size + nx * size * 0.5, cy - uy * size + ny * size * 0.5);
                    ctx.lineTo(cx, cy);
                    ctx.lineTo(cx - ux * size - nx * size * 0.5, cy - uy * size - ny * size * 0.5);
                    ctx.stroke();
                }
                ctx.restore();
            }
            
            // Endpoint markers
            [{ x: seg.p1.x, y: seg.p1.y }, { x: seg.p2.x, y: seg.p2.y }].forEach(pt => {
                const wp = fabric.util.transformPoint(pt, fabric.util.invertTransform(canvas.viewportTransform));
                ctx.beginPath();
                ctx.arc(wp.x, wp.y, 3, 0, 2 * Math.PI);
                ctx.fillStyle = color;
                ctx.fill();
            });
        });
    });

    // 3. Crossings and angles
    for (let a = 0; a < natSegments.length; a++) {
        for (let b = 0; b < natSegments.length; b++) {
            if (a >= b) continue; // Avoid duplicate checks and self-comparison
            const hit = segIntersect(natSegments[a].p1, natSegments[a].p2, natSegments[b].p1, natSegments[b].p2);
            if (!hit) continue;
            
            const key = crossingPointKey(hit);
            if (natCrossingLabels.has(key)) continue; // Already processed
            
            const va = normDir({ x: natSegments[a].p2.x - natSegments[a].p1.x, y: natSegments[a].p2.y - natSegments[a].p1.y });
            const vb = normDir({ x: natSegments[b].p2.x - natSegments[b].p1.x, y: natSegments[b].p2.y - natSegments[b].p1.y });
            
            // Calculate both possible angles (acute and obtuse)
            let angle = Math.acos(clamp(va.x * vb.x + va.y * vb.y, -1, 1)) * 180 / Math.PI;
            if (angle > 90) angle = 180 - angle;
            
            const wp = fabric.util.transformPoint(hit, fabric.util.invertTransform(canvas.viewportTransform));
            
            // Draw angle arc
            const angA = Math.atan2(va.y, va.x);
            const angB = Math.atan2(vb.y, vb.x);
            let startAngle = Math.min(angA, angB);
            let endAngle = Math.max(angA, angB);
            
            // Choose the smaller angle sweep
            if (endAngle - startAngle > Math.PI) {
                startAngle += 2 * Math.PI;
                const temp = startAngle;
                startAngle = endAngle;
                endAngle = temp;
            }
            
            ctx.beginPath();
            ctx.arc(wp.x, wp.y, 12, startAngle, endAngle);
            ctx.strokeStyle = '#888';
            ctx.lineWidth = 1;
            ctx.stroke();
            
            // Label angle
            const label = Math.round(angle) + '°';
            const textWidth = ctx.measureText(label).width;
            ctx.fillStyle = '#eee';
            ctx.fillRect(wp.x - textWidth / 2 - 2, wp.y - 7, textWidth + 4, 14);
            ctx.fillStyle = '#000';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, wp.x, wp.y);
            
            natCrossingLabels.set(key, { x: hit.x, y: hit.y, angle: angle });
            natHits.push({ x: wp.x, y: wp.y, key: key, deg: angle });
        }
    }

    const labeledSegments = new Map();
    natSegments.forEach(seg => {
        labeledSegments.set(uid(seg.o), seg);
    });
    labeledSegments.forEach(seg => {
        const labels = endpointLabels(seg.o);
        ctx.save();
        ctx.fillStyle = '#000';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 4;
        [seg.p1, seg.p2].forEach((point, index) => {
            const dx = point.x - (seg.p1.x + seg.p2.x) / 2;
            const dy = point.y - (seg.p1.y + seg.p2.y) / 2;
            const length = Math.hypot(dx, dy) || 1;
            const offset = 14;
            const labelX = point.x + (dx / length) * offset;
            const labelY = point.y + (dy / length) * offset;
            ctx.strokeText(labels[index], labelX, labelY);
            ctx.fillText(labels[index], labelX, labelY);
        });
        ctx.restore();
    });

    // 4. Interior angles for every straight-edged shape
    canvas.getObjects().forEach(object => {
        const geometry = shapeAngleGeometry(object);
        if (!geometry || geometry.points.length < 3) return;
        const points = geometry.points.map(point => fabric.util.transformPoint(point, canvas.viewportTransform));
        const centroid = points.reduce((total, point) => ({ x: total.x + point.x / points.length, y: total.y + point.y / points.length }), { x: 0, y: 0 });
        const startIndex = geometry.closed ? 0 : 1;
        const endIndex = geometry.closed ? points.length : points.length - 1;
        for (let index = startIndex; index < endIndex; index += 1) {
            const vertex = points[index];
            const previous = points[(index - 1 + points.length) % points.length];
            const next = points[(index + 1) % points.length];
            const degrees = angleDeg(vertex, previous, next);
            const before = normDir({ x: previous.x - vertex.x, y: previous.y - vertex.y });
            const after = normDir({ x: next.x - vertex.x, y: next.y - vertex.y });
            let inward = geometry.closed
                ? { x: centroid.x - vertex.x, y: centroid.y - vertex.y }
                : { x: before.x + after.x, y: before.y + after.y };
            inward = normDir(inward);
            const marker = { x: vertex.x + inward.x * 20, y: vertex.y + inward.y * 20 };
            const key = `shape_${uid(object)}_${index}`;
            const color = colorForDeg(degrees);
            natHits.push({ x: marker.x, y: marker.y, key, deg: degrees, midRay: Math.atan2(inward.y, inward.x) * 180 / Math.PI, shape: object });
            ctx.save();
            ctx.beginPath();
            ctx.arc(marker.x, marker.y, 8, 0, 2 * Math.PI);
            ctx.fillStyle = selectedNatHit?.key === key ? color : 'rgba(255,255,255,0.95)';
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.stroke();
            if (natRevealed.has(key)) {
                ctx.fillStyle = color;
                ctx.font = 'bold 11px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(`${Math.round(degrees)}°`, marker.x, marker.y - 9);
            }
            ctx.restore();
        }
    });

    // 5. Triangle and side labels
    canvas.getObjects().forEach(o => {
        if (o.isTriangle) {
            const sWorld = triangleWorldPts(o);
            if (!sWorld || sWorld.length < 3) return;
            const s = sWorld.map(pt => fabric.util.transformPoint(pt, canvas.viewportTransform));
            
            const centroid = {
                x: (s[0].x + s[1].x + s[2].x) / 3,
                y: (s[0].y + s[1].y + s[2].y) / 3
            };
            
            const pushOut = (pt, r) => {
                const dx = pt.x - centroid.x;
                const dy = pt.y - centroid.y;
                const dist = Math.sqrt(dx*dx + dy*dy) || 1;
                return { x: pt.x + (dx/dist)*r, y: pt.y + (dy/dist)*r };
            };
            
            const corners = ['A', 'B', 'C'];
            s.forEach((pt, i) => {
                const labelPt = pushOut(pt, 20);
                ctx.save();
                ctx.fillStyle = '#000';
                ctx.font = 'bold 16px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(corners[i], labelPt.x, labelPt.y);
                ctx.restore();
            });
            
            const sides = [
                { pts: [s[1], s[2]], label: 'a' },
                { pts: [s[2], s[0]], label: 'b' },
                { pts: [s[0], s[1]], label: 'c' }
            ];
            
            sides.forEach(side => {
                const mid = { x: (side.pts[0].x + side.pts[1].x)/2, y: (side.pts[0].y + side.pts[1].y)/2 };
                const labelPt = pushOut(mid, 20);
                ctx.save();
                ctx.fillStyle = '#000';
                ctx.font = 'italic 16px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(side.label, labelPt.x, labelPt.y);
                ctx.restore();
            });
        }
    });

    ctx.restore();
});
// ================= Bridge for the Mathematics module =================
window.BF = {
    canvas: canvas,
    fabric: fabric,
    isReady: false,
    getAngleHits: () => natHits.map(hit => ({ x: hit.x, y: hit.y, key: hit.key, deg: hit.deg, revealed: natRevealed.has(hit.key) })),
    clamp: clamp,
    viewCenterWorld: viewCenterWorld,
    penColor: () => pen.color,
    insertCanvas: function (cnv, metadata = {}) {
        const img = new fabric.Image(cnv, {});
        const c = viewCenterWorld();
        const z = canvas.getZoom();
        const maxW = (canvas.getWidth() / z) * 0.8;
        const s = Math.min(1, maxW / cnv.width);
        img.set({ left: c.x - (cnv.width * s) / 2, top: c.y - (cnv.height * s) / 2, scaleX: s, scaleY: s, selectable: true, evented: true });
        img.isFile = false;
        img.boardflowId = metadata.id || crypto.randomUUID();
        img.boardflowKind = metadata.kind || 'visualization';
        img.boardflowPayload = metadata.payload || null;
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.requestRenderAll();
        return img;
    },
    insertEquation: function (label, payload = {}) {
        const equation = new fabric.Textbox(label, {
            width: 340,
            fontFamily: 'Cambria, Georgia, serif',
            fontSize: 30,
            fontWeight: 600,
            fill: '#172554',
            backgroundColor: '#eff6ff',
            padding: 18,
            textAlign: 'center'
        });
        equation.boardflowId = crypto.randomUUID();
        equation.boardflowKind = 'equation';
        equation.boardflowPayload = payload;
        addToolObject(equation, false);
        return equation;
    }
};

const mathToolsPromise = import('./math-tools.js').catch(error => {
    console.error('Unable to load mathematics tools', error);
    return null;
});
createMathIntelligence({
    canvas,
    onAction: async suggestion => {
        if (!await mathToolsPromise) return;
        window.dispatchEvent(new CustomEvent('boardflow:math-action', { detail: suggestion }));
    }
});

function openMathForEquation(value) {
    const expression = String(value).includes('=') ? String(value).split('=').slice(1).join('=').trim() : String(value).trim();
    mathToolsPromise.then(module => {
        if (!module) return;
        window.dispatchEvent(new CustomEvent('boardflow:math-action', { detail: { kind: 'equation', expression } }));
    });
}

classroomSuite = createClassroomSuite({
    canvas,
    fabric,
    getLessonData: () => buildLessonData(),
    loadLessonData,
    loadClassroomLessonData,
    getSubjectId: () => activeSubjectId,
    setStatus,
    closeMenu: hideMenuNow,
    insertEquation: (label, payload) => window.BF.insertEquation(label, payload),
    openMathForEquation,
    recognizeShape: recognizeSelectedShape,
    recognizeHandwriting: recognizeHandwrittenObjects,
    visibleRecognitionGroups,
    convertRecognitionGroups,
    convertVisibleShapes,
    replaceRecognizedInk,
    applyTemplate: applyLessonTemplate,
    layers: {
        getState: classroomLayerState,
        setMode: setAppMode,
        setActive: setActiveLayer,
        setVisible: setLayerVisible,
        setLocked: setLayerLocked,
        setPresentation: setPresentationMode
    },
    input: {
        getPalmRejection: () => palmRejection,
        setPalmRejection: value => { palmRejection = !!value; savePref('bv-palm-rejection', palmRejection ? '1' : '0'); },
        getBeautifyInk: () => beautifyInk,
        setBeautifyInk: value => {
            beautifyInk = !!value;
            pen.decimate = beautifyInk ? 0.3 : 0.05;
            savePref('bv-beautify-ink', beautifyInk ? '1' : '0');
        },
        getInkAssistMode: () => inkAssistMode,
        setInkAssistMode
    },
    timer: {
        getState: () => ({ seconds: timerSeconds, running: timerIsRunning() }),
        sync: syncClassroomTimer
    }
});

// ================= Init =================
updatePageUI();
updateViewChip();
updateSubjectLabel(activeSubjectId ? readSubjects().find(entry => entry.id === activeSubjectId) : null);
applyTheme();
setAppMode(appMode);
setTool('pen');
showMenu();
resetHistory();
window.dispatchEvent(new Event('bf-ready'));
setTimeout(() => {
    const startupSelectionVersion = subjectSelectionVersion;
    const preferredSubjectId = loadPref(ACTIVE_SUBJECT_STORE);
    const startupCheckpointKey = preferredSubjectId ? `subject:${preferredSubjectId}` : 'last';
    restoreCheckpoint(startupCheckpointKey).then(() => {
        if (startupSelectionVersion === subjectSelectionVersion) {
            updateSubjectLabel(activeSubjectId ? readSubjects().find(entry => entry.id === activeSubjectId) : null);
        }
    }).catch(error => console.error('Unable to restore checkpoint', error)).finally(() => {
        window.BF.isReady = true;
        resolveStartupReady();
    });
}, 0);
