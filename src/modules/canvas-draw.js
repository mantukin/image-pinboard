import { debounce } from './ui-features.js';
import { invoke, DOM, state, canvasState } from './store.js';
import { canvasCoordinatesFromClient } from './canvas-ops.js';

export function renderDrawings() {
    if (!DOM.canvasDrawingLayer) return;
    const ctx = DOM.canvasDrawingLayer.getContext('2d');
    ctx.clearRect(0, 0, DOM.canvasDrawingLayer.width, DOM.canvasDrawingLayer.height);

    ctx.imageSmoothingEnabled = false;
    ctx.save();
    ctx.translate(canvasState.x, canvasState.y);
    ctx.scale(canvasState.scale, canvasState.scale);

    for (const stroke of state.drawingStrokes) {
        let path = stroke.cachedLinePath;
        if (!(path instanceof Path2D) || stroke.cachedLen !== stroke.points.length) {
            path = new Path2D();
            const pLen = stroke.points.length;
            if (pLen > 0) {
                path.moveTo(stroke.points[0].x, stroke.points[0].y);
                for (let i = 1; i < pLen; i++) {
                    path.lineTo(stroke.points[i].x, stroke.points[i].y);
                }
            }
            stroke.cachedLinePath = path;
            stroke.cachedLen = pLen;
        }

        const size = stroke.size || (stroke.isEraser ? 12 : 2);
        ctx.lineWidth = size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (stroke.isEraser) {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = 'rgba(0,0,0,1)';
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = stroke.color;
        }

        if (stroke.points.length === 1) {
            const offset = -Math.floor(size / 2);
            ctx.fillStyle = ctx.strokeStyle;
            ctx.fillRect(Math.floor(stroke.points[0].x) + offset, Math.floor(stroke.points[0].y) + offset, size, size);
        } else if (path) {
            ctx.stroke(path);
        }
    }
    ctx.restore();
}

export function updateDrawCursor(clientX, clientY) {
    if (!DOM.drawCursor || state.currentDrawingTool === 'pan') return;

    DOM.drawCursor.classList.remove('hidden');
    const size = state.currentDrawingTool === 'brush' ? state.brushSize : state.eraserSize;
    const ptr = canvasCoordinatesFromClient(clientX, clientY);
    const offset = -Math.floor(size / 2);

    const worldLeft = Math.floor(ptr.x) + offset;
    const worldTop = Math.floor(ptr.y) + offset;

    const localScreenLeft = (worldLeft * canvasState.scale) + canvasState.x;
    const localScreenTop = (worldTop * canvasState.scale) + canvasState.y;
    const drawnSize = size * canvasState.scale;

    DOM.drawCursor.style.left = `${localScreenLeft}px`;
    DOM.drawCursor.style.top = `${localScreenTop}px`;
    DOM.drawCursor.style.width = `${drawnSize}px`;
    DOM.drawCursor.style.height = `${drawnSize}px`;
}

export function setDrawingTool(tool) {
    state.currentDrawingTool = tool;
    if (DOM.toolPanBtn) DOM.toolPanBtn.classList.toggle('active', tool === 'pan');
    if (DOM.toolBrushBtn) DOM.toolBrushBtn.classList.toggle('active', tool === 'brush');
    if (DOM.toolEraserBtn) DOM.toolEraserBtn.classList.toggle('active', tool === 'eraser');

    if (tool !== 'pan') {
        DOM.canvasView.classList.add('drawing-mode');
        if (DOM.drawSizePicker) {
            DOM.drawSizePicker.value = tool === 'brush' ? state.brushSize : state.eraserSize;
        }
        updateDrawCursor(state.lastMouseX, state.lastMouseY);
    } else {
        DOM.canvasView.classList.remove('drawing-mode');
        if (DOM.drawCursor) DOM.drawCursor.classList.add('hidden');
    }
}

export const queueDrawingSave = debounce(async () => {
    try {
        const cleanStrokes = state.drawingStrokes.map(s => ({
            isEraser: s.isEraser,
            color: s.color,
            size: s.size,
            points: s.points
        }));
        await invoke('save_canvas_drawings', { drawings: JSON.stringify(cleanStrokes) });
    } catch (error) {
        console.error('Failed to save drawings:', error);
    }
}, 500);
