import QRCode from 'qrcode';
import { deleteVersion, getAllVersions, putVersion, savePreference, loadPreference } from './persistence.js';
import { recognizeInkEquation } from './equation-recognition.js';
import { textToLatex } from './handwriting-recognition.js';
import { normalizeInkStroke } from './ink-pipeline.js';
import { isElectron, isCapacitor, isWeb } from './utils/host.js';

const byId = id => document.getElementById(id);
const versionKey = () => `version:${Date.now()}:${crypto.randomUUID()}`;

export function createClassroomSuite(api) {
    const panel = byId('classroomPanel');
    const classroomRail = byId('classroomRail');
    const classroomRailToggle = byId('btnClassroomRailToggle');
    const sessionCard = byId('sessionCard');
    const query = new URLSearchParams(location.search);
    const joinedSession = query.get('session');
    const layerColors = { lesson: '#94a3b8', teacher: '#4f7cff', student: '#22c55e', answers: '#f59e0b' };
    const layerLabels = { lesson: 'Lesson material', teacher: 'Teacher annotations', student: 'Student annotations', answers: 'Answer layer' };
    let session = null;
    let assessment = null;
    let responses = [];
    let lastAutomaticVersion = 0;
    let lastTimerBroadcast = '';
    let boardRevision = 0;
    let latestStudentBoardRevision = 0;
    let studentBoardLoadQueue = Promise.resolve();
    let answersRevealedToStudents = false;
    let recognitionInk = [];
    let recognitionRequest = 0;

    // Multi-board workspace management
    let boards = [];
    let activeBoardId = null;
    let boardCounter = 0;

    // Initialize from saved data
    function initialize() {
        try {
            const savedData = loadPreference('bv-classroom-boards');
            if (savedData) {
                const parsed = JSON.parse(savedData);
                boards = parsed.boards || [];
                activeBoardId = parsed.activeBoardId || null;

                // Ensure we have at least one board
                if (boards.length === 0) {
                    addNewBoard('Board 1');
                } else if (!activeBoardId && boards.length > 0) {
                    activeBoardId = boards[0].id;
                }
            } else {
                addNewBoard('Board 1');
            }
        } catch (error) {
            console.warn('Could not load classroom suite data, creating default:', error);
            addNewBoard('Board 1');
        }
    }

    // Add a new board
    function addNewBoard(name = null) {
        const boardName = name || `Board ${++boardCounter}`;
        const newBoardId = `board-${Date.now()}-${boardCounter}`;

        const newBoard = {
            id: newBoardId,
            name: boardName,
            active: false,
            order: boards.length,
            createdAt: Date.now(),
            state: null
        };

        boards.push(newBoard);

        // If this is the first board, make it active
        if (boards.length === 1) {
            activeBoardId = newBoardId;
            newBoard.active = true;
        }

        saveBoards();
        renderBoardTabs();

        // If we just made the first board active, initialize the canvas
        if (boards.length === 1) {
            api.clearLesson();
        }

        return newBoardId;
    }

    // Delete a board
    function deleteBoard(boardId) {
        if (boards.length <= 1) {
            api.setStatus("Cannot delete the last board", true);
            return false;
        }

        const boardIndex = boards.findIndex(b => b.id === boardId);
        if (boardIndex === -1) return false;

        // If deleting the active board, switch to another board
        if (boardId === activeBoardId) {
            const otherBoards = boards.filter(b => b.id !== boardId);
            if (otherBoards.length > 0) {
                switchToBoard(otherBoards[0].id);
            }
        }

        // Remove the board
        boards = boards.filter(b => b.id !== boardId);

        // Update orders
        boards.forEach((board, index) => {
            board.order = index;
        });

        saveBoards();
        renderBoardTabs();
    }

    // Switch to a different board
    function switchToBoard(boardId) {
        const currentBoard = boards.find(b => b.id === activeBoardId);
        const targetBoard = boards.find(b => b.id === boardId);

        if (!targetBoard || activeBoardId === boardId) return;

        // Save current board state
        if (currentBoard) {
            currentBoard.state = api.getLessonData();
            currentBoard.active = false;
        }

        // Activate the target board
        targetBoard.active = true;
        activeBoardId = boardId;

        // Restore target board state
        if (targetBoard.state) {
            api.loadLessonData(targetBoard.state);
        } else {
            // Initialize with empty state
            if (typeof api.clearLesson === 'function') {
                api.clearLesson();
            } else if (typeof api.clearCanvas === 'function') {
                api.clearCanvas();
            } else if (api.canvas) {
                api.canvas.clear();
            }
        }

        saveBoards();
        renderBoardTabs();

        api.setStatus(`Switched to ${targetBoard.name}`);
    }

    // Render board tabs/ui elements
    function renderBoardTabs() {
        // Update board count display if element exists
        const bpageLabel = byId('bpageLabel');
        if (bpageLabel) {
            const activeBoard = boards.find(b => b.id === activeBoardId);
            const activeIndex = activeBoard ? boards.indexOf(activeBoard) + 1 : 1;
            bpageLabel.textContent = `${activeIndex} / ${boards.length}`;
        }

        // Update button states
        const btnBPrev = byId('btnBPrev');
        const btnBNext = byId('btnBNext');
        const btnBDelete = byId('btnBDelete');

        if (btnBPrev) {
            const activeBoard = boards.find(b => b.id === activeBoardId);
            const activeIndex = activeBoard ? boards.indexOf(activeBoard) : 0;
            btnBPrev.disabled = activeIndex <= 0;
        }

        if (btnBNext) {
            const activeBoard = boards.find(b => b.id === activeBoardId);
            const activeIndex = activeBoard ? boards.indexOf(activeBoard) : 0;
            btnBNext.disabled = activeIndex >= boards.length - 1;
        }

        if (btnBDelete) {
            btnBDelete.disabled = boards.length <= 1;
        }
    }

    // Navigation functions that mirror the old boardPage system
    function goToPreviousBoard() {
        const currentIndex = getActiveBoardIndex();
        if (currentIndex > 0) {
            const prevBoard = boards[currentIndex - 1];
            if (prevBoard) {
                switchToBoard(prevBoard.id);
            }
        }
    }

    function goToNextBoard() {
        const currentIndex = getActiveBoardIndex();
        if (currentIndex < boards.length - 1) {
            const nextBoard = boards[currentIndex + 1];
            if (nextBoard) {
                switchToBoard(nextBoard.id);
            }
        }
    }

    // Save boards to preferences
    function saveBoards() {
        // Store only essential data, not the full canvas state in preferences
        const boardsToSave = boards.map(board => ({
            id: board.id,
            name: board.name,
            order: board.order,
            createdAt: board.createdAt,
            // Don't save the full state in preferences to avoid bloating storage
            // The state is managed separately
        }));

        const dataToSave = {
            boards: boardsToSave,
            activeBoardId: activeBoardId
        };

        savePreference('bv-classroom-boards', JSON.stringify(dataToSave));
    }

    // Getters
    function getActiveBoardId() {
        return activeBoardId;
    }

    function getActiveBoardIndex() {
        const activeBoard = boards.find(b => b.id === activeBoardId);
        return activeBoard ? boards.indexOf(activeBoard) : 0;
    }

    function getBoardCount() {
        return boards.length;
    }

    function getAllBoards() {
        return [...boards];
    }

    // Initialize when module loads
    initialize();

    // Set up global BF bridge for backward compatibility
    if (typeof window !== 'undefined') {
        window.BF = window.BF || {};

        // These functions will be connected to the UI buttons later when classroomSuite is initialized
        window.BF.addBoard = addNewBoard;
        window.BF.deleteBoard = deleteBoard;
        window.BF.goToPreviousBoard = goToPreviousBoard;
        window.BF.goToNextBoard = goToNextBoard;
    }

    // Add a new board
    function addNewBoardLegacy() {
        const newBoardId = `board-${Date.now()}`;
        const newBoard = {
            id: newBoardId,
            name: `Board ${boards.length + 1}`,
            active: false,
            order: boards.length,
            createdAt: Date.now(),
            state: null // Will be populated when switched to
        };

        boards.push(newBoard);
        saveBoards();
        renderBoardTabs();

        // Switch to the new board
        switchToBoard(newBoardId);
    }

    // Delete a board
    function deleteBoardLegacy(boardId) {
        if (boards.length <= 1) {
            // Don't allow deletion of the last board
            api.setStatus('Cannot delete the last board.', true);
            return;
        }

        const boardToDelete = boards.find(b => b.id === boardId);
        if (!boardToDelete) return;

        // If deleting the active board, switch to another board first
        if (boardId === activeBoardId) {
            const otherBoards = boards.filter(b => b.id !== boardId);
            if (otherBoards.length > 0) {
                switchToBoard(otherBoards[0].id);
            }
        }

        // Remove the board
        boards = boards.filter(b => b.id !== boardId);

        // Update orders
        boards.forEach((board, index) => {
            board.order = index;
        });

        saveBoards();
        renderBoardTabs();
    }

    // Switch to a different board
    function switchToBoardLegacy(boardId) {
        const currentBoard = boards.find(b => b.id === activeBoardId);
        const targetBoard = boards.find(b => b.id === boardId);

        if (!targetBoard || activeBoardId === boardId) return;

        // Save current board state
        if (currentBoard) {
            currentBoard.state = api.getLessonData();
            currentBoard.active = false;
        }

        // Activate the target board
        targetBoard.active = true;
        activeBoardId = boardId;

        // Restore target board state
        if (targetBoard.state) {
            api.loadLessonData(targetBoard.state);
        } else {
            // Initialize with empty state
            if (typeof api.clearLesson === 'function') {
                api.clearLesson();
            } else if (typeof api.clearCanvas === 'function') {
                api.clearCanvas();
            } else if (api.canvas) {
                api.canvas.clear();
            }
        }

        saveBoards();
        renderBoardTabs();

        api.setStatus(`Switched to ${targetBoard.name}`);
    }

    // Duplicate a board
    function duplicateBoard(boardId) {
        const sourceBoard = boards.find(b => b.id === boardId);
        if (!sourceBoard) return;

        const newBoardId = `board-${Date.now()}`;
        const duplicatedBoard = {
            id: newBoardId,
            name: `${sourceBoard.name} Copy`,
            active: false,
            order: boards.length,
            createdAt: Date.now(),
            state: sourceBoard.state // Copy the state
        };

        boards.push(duplicatedBoard);
        saveBoards();
        renderBoardTabs();

        // Switch to the duplicated board
        switchToBoard(newBoardId);
    }

    // Rename a board
    function renameBoard(boardId, newName) {
        const board = boards.find(b => b.id === boardId);
        if (board) {
            board.name = newName;
            saveBoards();
            renderBoardTabs();
        }
    }

    // Reorder boards
    function reorderBoards(newOrder) {
        newOrder.forEach((boardId, index) => {
            const board = boards.find(b => b.id === boardId);
            if (board) {
                board.order = index;
            }
        });

        saveBoards();
        renderBoardTabs();
    }

    // Save boards to preferences
    function saveBoardsLegacy() {
        // Store only essential data, not the full canvas state in preferences
        const boardsToSave = boards.map(board => ({
            id: board.id,
            name: board.name,
            active: board.active,
            order: board.order,
            createdAt: board.createdAt
        }));
        savePreference('boards', JSON.stringify(boardsToSave));
    }

    // Export all boards as a combined workspace
    function exportAllBoards() {
        const workspaceData = {
            app: 'BoardFlow',
            version: 2,
            exportedAt: new Date().toISOString(),
            totalBoards: boards.length,
            boards: boards.map(board => ({
                id: board.id,
                name: board.name,
                order: board.order,
                createdAt: board.createdAt,
                state: board.state
            }))
        };
        return workspaceData;
    }

    // Load a complete workspace
    function loadWorkspace(workspaceData) {
        if (!workspaceData || !workspaceData.boards) {
            api.setStatus && api.setStatus("Invalid workspace data", true);
            return false;
        }

        // Clear existing boards
        boards = [];
        activeBoardId = null;

        // Load the new boards
        workspaceData.boards.forEach(boardData => {
            const newBoard = {
                id: boardData.id,
                name: boardData.name,
                active: false,
                order: boardData.order,
                createdAt: boardData.createdAt,
                state: boardData.state
            };
            boards.push(newBoard);
        });

        // Sort boards by order
        boards.sort((a, b) => a.order - b.order);

        // Make first board active
        if (boards.length > 0) {
            activeBoardId = boards[0].id;
            boards[0].active = true;
        }

        saveBoards();
        renderBoardTabs();

        // Switch to first board if it exists
        if (boards.length > 0) {
            switchToBoard(boards[0].id);
        }

        api.setStatus && api.setStatus(`Loaded workspace with ${workspaceData.boards.length} boards`);
        return true;
    }

    // Save full workspace session
    function saveWorkspaceSession(filename = null) {
        try {
            const workspaceData = exportAllBoards();
            const blob = new Blob([JSON.stringify(workspaceData, null, 2)], { type: 'application/json' });

            if (isElectron() && window.boardFlowDesktop) {
                // Use electron file save dialog
                window.boardFlowDesktop.saveFile(blob, filename || 'workspace.boardflow', 'BoardFlow Workspace Files (*.boardflow)');
            } else {
                // Use browser download
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename || 'workspace.boardflow';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }

            api.setStatus(`Workspace saved with ${boards.length} boards`, false);
        } catch (error) {
            console.error('Save workspace error:', error);
            api.setStatus('Workspace save failed: ' + error.message, true);
        }
    }

    // Load workspace session
    async function loadWorkspaceSession(file) {
        try {
            let content;
            if (file instanceof File) {
                content = await file.text();
            } else if (typeof file === 'string') {
                content = file;
            } else {
                throw new Error('Invalid file input');
            }

            const workspaceData = JSON.parse(content);

            if (workspaceData.version !== 2 || workspaceData.app !== 'BoardFlow') {
                throw new Error('Unsupported workspace version or application');
            }

            // Use the loadWorkspace method which handles the board loading
            const success = loadWorkspace(workspaceData);

            if (!success) {
                throw new Error('Failed to load workspace');
            }

        } catch (error) {
            console.error('Load workspace error:', error);
            api.setStatus('Workspace load failed: ' + error.message, true);
        }
    }

    function selectTab(name) {
        panel.querySelectorAll('[data-classroom-tab]').forEach(button => button.classList.toggle('active', button.dataset.classroomTab === name));
        panel.querySelectorAll('[data-classroom-section]').forEach(section => section.classList.toggle('on', section.dataset.classroomSection === name));
        if (name === 'lesson') renderVersions();
    }

    function renderLayers() {
        const state = api.layers.getState();
        byId('modeSelect').value = state.mode;
        byId('studioMode').value = state.mode;
        byId('layerSelect').value = state.active;
        byId('layerList').innerHTML = '';
        Object.keys(layerLabels).forEach(layer => {
            const row = document.createElement('div');
            row.className = `layer-row${state.active === layer ? ' active' : ''}`;
            row.style.setProperty('--layer-color', layerColors[layer]);
            row.innerHTML = `<button class="layer-name" data-action="active"><i></i><span>${layerLabels[layer]}</span></button><button class="layer-toggle" data-action="visible" title="Show or hide layer">${state.layers[layer].visible ? '◉' : '○'}</button><button class="layer-toggle" data-action="locked" title="Lock or unlock layer">${state.layers[layer].locked ? '🔒' : '🔓'}</button>`;
            row.querySelector('[data-action="active"]').onclick = () => { api.layers.setActive(layer); renderLayers(); };
            row.querySelector('[data-action="visible"]').onclick = () => { api.layers.setVisible(layer, !state.layers[layer].visible); renderLayers(); };
            row.querySelector('[data-action="locked"]').onclick = () => { api.layers.setLocked(layer, !state.layers[layer].locked); renderLayers(); };
            byId('layerList').append(row);
        });
    }

    function selectedInk() {
        const active = api.canvas.getActiveObject();
        if (active?.type === 'activeSelection') return active.getObjects().filter(object => object.isSketch);
        if (active?.isSketch) return [active];
        return api.canvas.getObjects().filter(object => object.isSketch && object.visible !== false);
    }

    function renderRecognitionMode() {
        const mode = api.input.getInkAssistMode();
        const shapeButtons = [byId('btnAutoShapes'), byId('studioAutoShapes')];
        const writingButtons = [byId('btnInkRecognition'), byId('studioInkRecognition')];
        shapeButtons.forEach(button => {
            if (button) {
                button.classList.toggle('active', mode === 'shapes');
                button.setAttribute('aria-pressed', String(mode === 'shapes'));
            }
        });
        writingButtons.forEach(button => {
            if (button) {
                button.classList.toggle('active', mode === 'writing');
                button.setAttribute('aria-pressed', String(mode === 'writing'));
            }
        });
        const equationButton = byId('btnEquationRecognition');
        if (equationButton) {
            equationButton.classList.toggle('active', mode === 'equations');
            equationButton.setAttribute('aria-pressed', String(mode === 'equations'));
        }
        const smartInkButton = byId('btnSmartInk');
        if (smartInkButton) {
            smartInkButton.classList.toggle('active', mode === 'smart');
            smartInkButton.setAttribute('aria-pressed', String(mode === 'smart'));
        }
    }

    function toggleRecognitionMode(mode) {
        recognitionRequest++;
        const equationDialog = byId('equationDialog');
        if (equationDialog) {
            equationDialog.classList.add('hidden');
        }
        api.input.setInkAssistMode(api.input.getInkAssistMode() === mode ? 'off' : mode);
        renderRecognitionMode();
        if (api.input.getInkAssistMode() === 'shapes' && mode === 'shapes') api.convertVisibleShapes(api.visibleRecognitionGroups());
        if (api.input.getInkAssistMode() === mode && (mode === 'writing' || mode === 'equations')) {
            const groups = api.visibleRecognitionGroups();
            if (groups.length) api.convertRecognitionGroups(groups);
        }
    }

    function setCompactControlsOpen(open) {
        const visible = !!open;
        classroomRail.classList.toggle('hidden', !visible);
        classroomRailToggle?.setAttribute('aria-expanded', String(visible));
    }

    async function openEquationRecognition(objects = selectedInk(), mode = 'equations') {
        recognitionInk = objects;
        const requestId = ++recognitionRequest;
        const dialog = byId('equationDialog');
        byId('recognizedEquation').value = '';
        byId('recognizedLatex').value = '';
        byId('recognitionConfidence').textContent = objects.length ? 'Recognizing handwriting…' : 'Select handwritten strokes first, or write on the board.';
        dialog.classList.remove('hidden');
        if (!objects.length) return;
        let platformResult;
        try {
            platformResult = await api.recognizeHandwriting(objects, mode);
        } catch {
            if (requestId === recognitionRequest) byId('recognitionConfidence').textContent = 'Recognition is unavailable. Keep the original ink or enter a correction.';
            return;
        }
        if (requestId !== recognitionRequest || dialog.classList.contains('hidden')) return;
        const geometric = mode === 'writing'
            ? { text: '', confidence: 0 }
            : recognizeInkEquation(objects.map(object => normalizeInkStroke(object)).filter(Boolean));
        const result = platformResult?.text ? platformResult : { text: geometric.text, confidence: geometric.confidence, engine: 'BoardFlow math stroke recognizer', alternatives: [] };
        byId('recognizedEquation').value = result.text || '';
        byId('recognizedLatex').value = result.latex || textToLatex(result.text);
        const alternatives = result.alternatives?.filter(value => value && value !== result.text).slice(0, 3) || [];
        const confidence = Number.isFinite(result.confidence) ? ` · ${Math.round(result.confidence * 100)}% confidence` : '';
        byId('recognitionConfidence').textContent = result.text
            ? `${result.engine || 'Local recognizer'}${confidence}. Review before converting.${alternatives.length ? ` Alternatives: ${alternatives.join(' · ')}` : ''}`
            : 'The local recognizer was unsure. Type the correct text or LaTeX before converting.';
        setTimeout(() => byId('recognizedEquation').focus(), 0);
    }

    function closeEquationRecognition() {
        recognitionRequest++;
        byId('equationDialog').classList.add('hidden');
    }

    function insertRecognizedEquation(graph) {
        const value = byId('recognizedEquation').value.trim();
        if (!value) return;
        const latex = byId('recognizedLatex').value.trim() || textToLatex(value);
        api.replaceRecognizedInk(recognitionInk, 'equation', value, latex);
        api.replaceRecognizedInk(recognitionInk, 'equation', value, latex);
        closeEquationRecognition();
        if (graph) api.openMathForEquation(value);
    }

    function insertRecognizedText() {
        const value = byId('recognizedEquation').value.trim();
        if (!value) return;
        api.replaceRecognizedInk(recognitionInk, 'text', value, '');
        closeEquationRecognition();
    }

    async function saveVersion(automatic = false) {
        if (automatic && Date.now() - lastAutomaticVersion < 5 * 60 * 1000) return;
        const createdAt = new Date().toISOString();
        const entry = {
            key: versionKey(),
            subjectId: api.getSubjectId() || 'general',
            createdAt,
            automatic,
            state: api.getLessonData()
        };
        await putVersion(entry.key, entry);
        lastAutomaticVersion = Date.now();
        if (!automatic) {
            api.setStatus('Lesson version saved.');
            await renderVersions();
        }
    }

    async function renderVersions() {
        const list = byId('versionList');
        const subjectId = api.getSubjectId() || 'general';
        const versions = (await getAllVersions())
            .filter(item => item.subjectId === subjectId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 12);
        list.innerHTML = '';
        if (!versions.length) {
            list.innerHTML = '<div class="empty-state">Versions are captured while you teach. You can also save one now.</div>';
            return;
        }
        versions.forEach(entry => {
            const row = document.createElement('div');
            row.className = 'version-item';
            const date = new Date(entry.createdAt);
            row.innerHTML = `<span>${entry.automatic ? 'Auto' : 'Saved'} · ${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><span><button data-action="restore">Restore</button><button data-action="delete" title="Delete version">×</button></span>`;
            row.querySelector('[data-action="restore"]').onclick = async () => {
                await api.loadLessonData(entry.state);
                api.setStatus('Earlier lesson version restored.');
            };
            row.querySelector('[data-action="delete"]').onclick = async () => { await deleteVersion(entry.key); renderVersions(); };
            list.append(row);
        });
    }

    function renderResults() {
        const container = byId('assessmentResults');
        container.replaceChildren();
        if (!assessment || !responses.length) {
            const empty = document.createElement('span');
            empty.textContent = 'No responses yet.';
            container.append(empty);
            return;
        }
        if (assessment.kind === 'ticket') {
            responses.forEach((response, index) => {
                const row = document.createElement('div');
                const student = assessment.anonymous ? `Student ${index + 1}` : (response.student || `Student ${index + 1}`);
                row.textContent = `${student}: ${String(response.answer)}`;
                container.append(row);
            });
            return;
        }
        const options = Array.isArray(assessment.options) ? assessment.options.map(String) : [];
        const counts = new Map(options.map(option => [option, 0]));
        responses.forEach(response => {
            const answer = String(response.answer);
            if (counts.has(answer)) counts.set(answer, counts.get(answer) + 1);
        });
        const max = Math.max(1, ...counts.values());
        counts.forEach((count, option) => {
            const row = document.createElement('div');
            row.className = 'result-bar';
            const label = document.createElement('span');
            label.textContent = option;
            const bar = document.createElement('i');
            bar.style.width = `${Math.round(count / max * 100)}%`;
            const total = document.createElement('b');
            total.textContent = String(count);
            row.append(label, bar, total);
            container.append(row);
        });
    }

    function launchAssessment(kind) {
        const prompt = byId('assessmentPrompt').value.trim() || (kind === 'ticket' ? 'What is one thing you learned today?' : 'Choose your answer');
        const options = kind === 'poll' ? byId('assessmentOptions').value.split(',').map(item => item.trim()).filter(Boolean).slice(0, 6) : [];
        assessment = { type: 'assessment', id: crypto.randomUUID(), kind, prompt, options, anonymous: byId('assessmentAnonymous').checked };
        responses = [];
        renderResults();
        broadcast(assessment);
        api.setStatus(session ? 'Question sent to the class.' : 'Question is ready. Start a live session to send it to students.');
    }

    function showStudentAssessment(message) {
        assessment = message;
        const card = byId('studentAssessment');
        byId('studentQuestion').textContent = message.prompt;
        const choices = byId('studentChoices');
        const text = byId('studentTextAnswer');
        choices.replaceChildren();
        choices.classList.toggle('hidden', message.kind !== 'poll');
        text.classList.toggle('hidden', message.kind === 'poll');
        (Array.isArray(message.options) ? message.options : []).forEach(option => {
            const label = document.createElement('label');
            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'studentAnswer';
            input.value = String(option);
            label.append(input, document.createTextNode(` ${String(option)}`));
            choices.append(label);
        });
        card.classList.remove('hidden');
    }

    async function submitStudentAnswer() {
        if (!assessment || !joinedSession) return;
        const answer = assessment.kind === 'poll'
            ? document.querySelector('input[name="studentAnswer"]:checked')?.value
            : byId('studentTextAnswer').value.trim();
        if (!answer) return;
        let response;
        try {
            response = await fetch(`/classroom/message?code=${encodeURIComponent(joinedSession)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'assessment-response', assessmentId: assessment.id, answer })
            });
        } catch (error) {
            console.error('Unable to send classroom response', error);
            api.setStatus('Could not send your answer. Check the classroom connection and try again.', true);
            return;
        }
        if (!response.ok) {
            api.setStatus(`Your answer was not accepted (HTTP ${response.status}). Try again.`, true);
            return;
        }
        byId('studentAssessment').classList.add('hidden');
        api.setStatus('Your answer was sent.');
    }

    function broadcast(message) {
        if (isElectron() && window.boardFlowDesktop?.broadcastClassroom) {
            window.boardFlowDesktop.broadcastClassroom(message);
        }
        // In web mode, we won't broadcast as there's no classroom server
    }

    function studentSafeLessonData(includeAnswers = answersRevealedToStudents) {
        const state = structuredClone(api.getLessonData());
        const excludedLayers = includeAnswers ? new Set(['teacher']) : new Set(['teacher', 'answers']);
        const projectObjects = objects => (objects || []).flatMap(object => {
            if (excludedLayers.has(object.boardflowLayer)) return [];
            const projected = { ...object };
            if (Array.isArray(object.objects)) {
                projected.objects = projectObjects(object.objects);
                if (object.type?.toLowerCase() === 'group' && projected.objects.length === 0) return [];
            }
            return [projected];
        });
        if (state.objects?.objects) state.objects.objects = projectObjects(state.objects.objects);
        if (state.memory && typeof state.memory === 'object') {
            for (const [key, annotations] of Object.entries(state.memory)) {
                try {
                    const objects = JSON.parse(annotations);
                    state.memory[key] = JSON.stringify(projectObjects(objects));
                } catch (error) {
                    console.error('Unable to filter saved classroom page annotations', error);
                    delete state.memory[key];
                }
            }
        }
        if (state.layers) {
            state.layers = { ...state.layers };
            for (const layer of excludedLayers) {
                if (state.layers[layer]) state.layers[layer] = { ...state.layers[layer], visible: false, locked: true };
            }
            if (includeAnswers && state.layers.answers) {
                state.layers.answers = { ...state.layers.answers, visible: true };
            }
        }
        return state;
    }

    function broadcastBoard(includeAnswers = answersRevealedToStudents) {
        broadcast({
            type: 'board-state',
            revision: ++boardRevision,
            state: studentSafeLessonData(includeAnswers)
        });
    }

    function broadcastTimer(seconds, running) {
        broadcast({ type: 'timer', seconds, running });
    }

    async function startSession() {
        if (!isElectron() || !window.boardFlowDesktop?.startClassroom) {
            api.setStatus('Live classrooms are available in the BoardFlow desktop app.', true);
            return;
        }
        session = await window.boardFlowDesktop.startClassroom();
        answersRevealedToStudents = false;
        byId('sessionCode').textContent = session.code;
        byId('sessionUrl').value = session.url;
        await QRCode.toCanvas(byId('sessionQr'), session.url, { width: 180, margin: 1, color: { dark: '#101827', light: '#ffffff' } });
        sessionCard.classList.remove('hidden');
        byId('btnStartSession').classList.add('hidden');
        broadcastBoard(false);
    }

    async function stopSession() {
        if (isElectron()) {
            await window.boardFlowDesktop?.stopClassroom?.();
        }
        session = null;
        answersRevealedToStudents = false;
        sessionCard.classList.add('hidden');
        byId('btnStartSession').classList.remove('hidden');
    }

    function connectStudent() {
        if (!joinedSession) return;
        api.layers.setMode('student', true);
        const modeSelect = byId('modeSelect');
        const studioMode = byId('studioMode');
        modeSelect.disabled = true;
        studioMode.disabled = true;
        studioMode.disabled = true;
        const source = new EventSource(`/classroom/events?code=${encodeURIComponent(joinedSession)}`);
        source.onmessage = event => {
            const message = JSON.parse(event.data);
            if (message.type === 'board-state') {
                const revision = Number.isSafeInteger(message.revision)
                    ? message.revision
                    : latestStudentBoardRevision + 1;
                if (revision <= latestStudentBoardRevision) return;
                latestStudentBoardRevision = revision;
                studentBoardLoadQueue = studentBoardLoadQueue.then(async () => {
                    if (revision !== latestStudentBoardRevision) return;
                    await api.loadClassroomLessonData(message.state);
                    api.layers.setMode('student', true);
                }).catch(error => {
                    console.error('Unable to apply classroom board update', error);
                    api.setStatus('Unable to load the latest classroom board update.', true);
                });
            }
            if (message.type === 'assessment') showStudentAssessment(message);
            if (message.type === 'timer') api.timer.sync(message.seconds, message.running);
        };
        source.onerror = () => api.setStatus('The classroom connection was interrupted.', true);
    }

    panel.querySelectorAll('[data-classroom-tab]').forEach(button => button.onclick = () => selectTab(button.dataset.classroomTab));
    const openStudio = () => { api.closeMenu(); setCompactControlsOpen(false); panel.classList.remove('hidden'); selectTab('layers'); renderLayers(); renderRecognitionMode(); };
    byId('btnClassroomRail').onclick = openStudio;
    if (classroomRailToggle) classroomRailToggle.onclick = event => {
        event.stopPropagation();
        setCompactControlsOpen(classroomRail.classList.contains('hidden'));
    };
    document.addEventListener('pointerdown', event => {
        if (classroomRail.classList.contains('hidden')) return;
        if (event.target.closest('#classroomRail, #btnClassroomRailToggle')) return;
        setCompactControlsOpen(false);
    }, true);
    byId('classroomClose').onclick = () => panel.classList.add('hidden');
    byId('modeSelect').onchange = event => { api.layers.setMode(event.target.value); renderLayers(); };
    byId('studioMode').onchange = event => { api.layers.setMode(event.target.value); renderLayers(); };
    byId('layerSelect').onchange = event => { api.layers.setActive(event.target.value); renderLayers(); };
    byId('palmRejection').checked = api.input.getPalmRejection();
    byId('palmRejection').onchange = event => api.input.setPalmRejection(event.target.checked);
    byId('beautifyInk').checked = api.input.getBeautifyInk();
    byId('beautifyInk').onchange = event => api.input.setBeautifyInk(event.target.checked);
    byId('btnRecognizeShape').onclick = () => api.recognizeShape();
    byId('btnAutoShapes').onclick = () => toggleRecognitionMode('shapes');
    byId('equationCancel').onclick = closeEquationRecognition;
    byId('recognizedTextInsert').onclick = insertRecognizedText;
    byId('equationInsert').onclick = () => insertRecognizedEquation(false);
    byId('equationGraph').onclick = () => insertRecognizedEquation(true);
    byId('recognizedEquation').oninput = event => { byId('recognizedLatex').value = textToLatex(event.target.value); };
    byId('btnPresentation').onclick = () => api.layers.setPresentation(true);
    byId('btnStartSession').onclick = startSession;
    byId('btnStopSession').onclick = stopSession;
    byId('btnCopySession').onclick = async () => { await navigator.clipboard.writeText(session.url); api.setStatus('Classroom link copied.'); };
    byId('btnShareBoard').onclick = () => { broadcastBoard(); api.setStatus('Current board sent to students.'); };
    byId('btnLaunchPoll').onclick = () => launchAssessment('poll');
    byId('btnExitTicket').onclick = () => launchAssessment('ticket');
    byId('btnRevealAnswers').onclick = () => {
        answersRevealedToStudents = true;
        api.layers.setVisible('answers', true);
        broadcastBoard(true);
        renderLayers();
    };
    byId('studentSubmit').onclick = submitStudentAnswer;
    byId('btnSaveVersion').onclick = () => saveVersion(false);
    panel.querySelectorAll('[data-template]').forEach(button => button.onclick = () => api.applyTemplate(button.dataset.template));
    if (isElectron()) {
        window.boardFlowDesktop.onClassroomMessage(message => {
            if (message.type === 'student-connected') {
                broadcastBoard();
                const timer = api.timer.getState();
                broadcast({ type: 'timer', ...timer });
            }
            if (message.type === 'assessment-response' && assessment?.id === message.assessmentId) {
                responses.push(message);
                renderResults();
            }
        });
    }
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && api.layers.getState().presentation) api.layers.setPresentation(false);
    });
    connectStudent();
    renderLayers();
    renderRecognitionMode();

    // Return the public API
    return {
        addNewBoard,
        deleteBoard,
        switchToBoard,
        duplicateBoard,
        renameBoard,
        reorderBoards,
        getActiveBoardId,
        getActiveBoardIndex,
        getBoardCount,
        getAllBoards,
        goToPreviousBoard,
        goToNextBoard,
        exportAllBoards,
        loadWorkspace,
        saveWorkspaceSession,
        loadWorkspaceSession,
        renderBoardTabs,
        renderLayers,
        captureAutomaticVersion: () => saveVersion(true),
        broadcastBoard,
        broadcastTimer
    };
}
