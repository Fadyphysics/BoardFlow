function createHistoryManager({
    canvas,
    fabric,
    customObjectProperties,
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
}) {
    const maxHistory = 50;
    const undoStack = [];
    const redoStack = [];
    let snapshotTimer = null;
    let suppressHistory = false;
    let applying = false;

    function annotationsJSON() {
        return JSON.stringify(canvas.getObjects()
            .filter(object => !object.isFile && !object.boardflowTransient)
            .map(object => {
                const state = object.toObject(customObjectProperties);
                if (object.boardflowEraseSpots?.length || object.boardflowErasePaths?.length) delete state.clipPath;
                return state;
            }));
    }

    function historyJSON() {
        return JSON.stringify({ annotations: JSON.parse(annotationsJSON()), fileState: currentFileVisualState() });
    }

    function updateQuickInkActions() {
        const content = canvas.getObjects().some(object =>
            !object.isFile && !object.boardflowTransient && layerCanEdit(object));
        byId('btnUndoQuick').disabled = applying || undoStack.length < 2;
        byId('btnClearQuick').disabled = applying || !content;
    }

    function pushSnapshotNow() {
        const snapshot = historyJSON();
        if (undoStack.length && undoStack[undoStack.length - 1] === snapshot) {
            updateQuickInkActions();
            return;
        }
        undoStack.push(snapshot);
        if (undoStack.length > maxHistory) undoStack.shift();
        redoStack.length = 0;
        updateQuickInkActions();
    }

    function clearEditableAnnotations() {
        if (applying) return;
        const objects = canvas.getObjects()
            .filter(object => !object.isFile && !object.boardflowTransient && layerCanEdit(object));
        if (!objects.length) return;
        clearTimeout(snapshotTimer);
        cancelInkRecognition();
        pushSnapshotNow();
        suppressHistory = true;
        try {
            canvas.discardActiveObject();
            objects.forEach(object => canvas.remove(object));
        } finally {
            suppressHistory = false;
        }
        pushSnapshotNow();
        canvas.requestRenderAll();
        scheduleCheckpoint();
    }

    function queueSnapshot() {
        clearTimeout(snapshotTimer);
        snapshotTimer = setTimeout(() => {
            if (!suppressHistory) pushSnapshotNow();
        }, 80);
    }

    function clearPendingSnapshot() {
        clearTimeout(snapshotTimer);
        snapshotTimer = null;
    }

    function resetHistory() {
        clearTimeout(snapshotTimer);
        undoStack.length = 0;
        redoStack.length = 0;
        pushSnapshotNow();
    }

    function applyAnnotationStateAsync(stateStr) {
        if (applying) return Promise.resolve();
        applying = true;
        suppressHistory = true;
        updateQuickInkActions();
        clearTimeout(snapshotTimer);
        return new Promise(resolve => {
            canvas.getObjects().filter(object => !object.isFile).forEach(object => canvas.remove(object));
            canvas.discardActiveObject();
            let objects = [];
            try {
                objects = JSON.parse(stateStr || '[]');
            } catch {
                objects = [];
            }
            const finish = () => {
                canvas.getObjects().forEach(object => {
                    if (object.isTriangle) attachApexControl(object);
                    if (object.isArrow) attachArrowControls(object);
                    if (object.boardflowEraseSpots?.length || object.boardflowErasePaths?.length) rebuildEraseMask(object);
                });
                canvas.requestRenderAll();
                applyInteractivity();
                applyFileErasability();
                suppressHistory = false;
                applying = false;
                updateQuickInkActions();
                resolve();
            };
            if (!objects.length) return finish();
            fabric.util.enlivenObjects(objects)
                .then(enlivenedObjects => {
                    enlivenedObjects.forEach(object => canvas.add(object));
                    finish();
                })
                .catch(error => {
                    console.error('Unable to restore canvas objects', error);
                    finish();
                });
        });
    }

    async function applyHistoryStateAsync(stateStr) {
        let state;
        try {
            state = JSON.parse(stateStr);
        } catch {
            state = { annotations: [] };
        }
        const annotations = Array.isArray(state) ? state : state.annotations || [];
        await applyAnnotationStateAsync(JSON.stringify(annotations));
        if (!Array.isArray(state)) await restoreCurrentFileVisualState(state.fileState);
        canvas.requestRenderAll();
    }

    function undo() {
        if (applying) return;
        clearTimeout(snapshotTimer);
        pushSnapshotNow();
        if (undoStack.length < 2) return;
        redoStack.push(undoStack.pop());
        applyHistoryStateAsync(undoStack[undoStack.length - 1]).then(scheduleCheckpoint);
    }

    function redo() {
        if (!redoStack.length || applying) return;
        const snapshot = redoStack.pop();
        undoStack.push(snapshot);
        applyHistoryStateAsync(snapshot).then(scheduleCheckpoint);
    }

    function historyTrigger(event) {
        if (suppressHistory || event?.target?.boardflowTransient) return;
        updateQuickInkActions();
        queueSnapshot();
        scheduleCheckpoint();
    }

    return {
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
        isSuppressed: () => suppressHistory,
        isApplying: () => applying,
        setSuppressed(value) {
            suppressHistory = value;
        }
    };
}

export { createHistoryManager };
