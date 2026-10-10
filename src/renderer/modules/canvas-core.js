import * as fabric from 'fabric';
import { byId } from '../dom.js';

const GRID_SIZE = 20;
const canvas = new fabric.Canvas('board', {
    backgroundColor: '#121212',
    preserveObjectStacking: true,
    renderOnAddRemove: false
});
const wrap = byId('canvasWrap');
const viewChip = byId('viewChip');
const zoomLabel = byId('zoomLabel');

function createGridPattern(size = GRID_SIZE, color = '#2a2a2a') {
    const source = document.createElement('canvas');
    source.width = size;
    source.height = size;
    const context = source.getContext('2d');

    context.strokeStyle = color;
    context.lineWidth = 0.5;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(0, size);
    context.lineTo(size, size);
    context.stroke();

    return new fabric.Pattern({ source, repeat: 'repeat' });
}

canvas.backgroundColor = createGridPattern();
canvas.renderAll();
fabric.FabricObject.prototype.set({
    transparentCorners: false,
    cornerColor: '#007acc',
    cornerSize: 11,
    borderColor: '#007acc',
    borderScaleFactor: 1.5,
    padding: 2
});

function resizeCanvas() {
    canvas.setDimensions({ width: wrap.clientWidth, height: wrap.clientHeight });
    canvas.requestRenderAll();
}

function updateViewChip() {
    const transform = canvas.viewportTransform;
    const changed = Math.abs(transform[0] - 1) > 0.001
        || Math.abs(transform[4]) > 0.5
        || Math.abs(transform[5]) > 0.5;
    viewChip.style.display = changed ? 'flex' : 'none';
    zoomLabel.textContent = `${Math.round(transform[0] * 100)}%`;
}

function updateGridBackground(theme, showGrid, themes) {
    canvas.backgroundImage = null;
    if (!showGrid) {
        canvas.backgroundColor = themes[theme].bg;
        canvas.requestRenderAll();
        return;
    }

    const source = document.createElement('canvas');
    source.width = GRID_SIZE;
    source.height = GRID_SIZE;
    const context = source.getContext('2d');
    const zoom = Math.max(0.2, canvas.getZoom());
    const gridLineWidth = 1.5;
    const inverseZoom = 1 / zoom;
    canvas.boardflowGridLineWidth = gridLineWidth;
    context.fillStyle = themes[theme].bg;
    context.fillRect(0, 0, GRID_SIZE, GRID_SIZE);
    context.strokeStyle = themes[theme].grid;
    context.lineWidth = gridLineWidth;
    context.beginPath();
    context.moveTo(gridLineWidth / 2, 0);
    context.lineTo(gridLineWidth / 2, GRID_SIZE);
    context.moveTo(0, gridLineWidth / 2);
    context.lineTo(GRID_SIZE, gridLineWidth / 2);
    context.stroke();

    canvas.backgroundColor = new fabric.Pattern({
        source,
        repeat: 'repeat',
        patternTransform: [inverseZoom, 0, 0, inverseZoom, 0, 0]
    });
    canvas.requestRenderAll();
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

export { canvas, wrap, resizeCanvas, updateViewChip, updateGridBackground };
