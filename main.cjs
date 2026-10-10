const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { randomInt, randomUUID } = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { fileURLToPath, pathToFileURL } = require('url');

// Removed MyScript SDK references since it has been removed from the project
// const { recognizeMath, recognizeText, recognizeSmart, closeRecognitionWorkers } = require('./scripts/myscript-bridge.cjs');

const approvedClosures = new WeakSet();
let isQuitting = false;
let classroomServer = null;
let classroomSession = null;
const classroomClients = new Set();

function localIPv4Address() {
    const interfaces = os.networkInterfaces();
    for (const entries of Object.values(interfaces)) {
        for (const entry of entries || []) {
            if (entry.family === 'IPv4' && !entry.internal) return entry.address;
        }
    }
    return '127.0.0.1';
}

function classroomMessage(message) {
    const data = `data: ${JSON.stringify(message)}\n\n`;
    classroomClients.forEach(response => response.write(data));
}

function mimeType(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    return ({
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2'
    })[extension] || 'application/octet-stream';
}

function safeWebFile(urlPath) {
    const webRoot = path.resolve(__dirname, 'www');
    const cleanPath = urlPath === '/' || urlPath === '/classroom' ? '/index.html' : urlPath;
    const target = path.resolve(webRoot, `.${decodeURIComponent(cleanPath.split('?')[0])}`);
    const relative = path.relative(webRoot, target);
    return relative.startsWith('..') || path.isAbsolute(relative) ? null : target;
}

async function startClassroomServer(sender) {
    if (classroomServer && classroomSession) return classroomSession;
    const code = String(randomInt(100000, 1000000));
    classroomServer = http.createServer(async (request, response) => {
        try {
            const requestUrl = new URL(request.url, 'http://boardflow.local');
            if (requestUrl.pathname === '/classroom/events') {
                if (requestUrl.searchParams.get('code') !== code) {
                    response.writeHead(403).end('Invalid classroom code');
                    return;
                }
                response.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    Connection: 'keep-alive'
                });
                response.write(`data: ${JSON.stringify({ type: 'connected', code })}\n\n`);
                classroomClients.add(response);
                sender.send('boardflow:classroom-message', { type: 'student-connected' });
                request.on('close', () => classroomClients.delete(response));
                return;
            }
            if (requestUrl.pathname === '/classroom/message' && request.method === 'POST') {
                if (requestUrl.searchParams.get('code') !== code) {
                    response.writeHead(403).end('Invalid classroom code');
                    return;
                }
                let body = '';
                for await (const chunk of request) {
                    body += chunk;
                    if (body.length > 64 * 1024) {
                        response.writeHead(413).end('Message too large');
                        request.destroy();
                        return;
                    }
                }
                let message;
                try {
                    message = JSON.parse(body || '{}');
                } catch {
                    response.writeHead(400).end('Invalid JSON');
                    return;
                }
                if (message?.type !== 'assessment-response' ||
                    typeof message.assessmentId !== 'string' ||
                    !/^[A-Za-z0-9-]{1,100}$/.test(message.assessmentId) ||
                    typeof message.answer !== 'string' ||
                    !message.answer.trim() ||
                    message.answer.length > 4000) {
                    response.writeHead(400).end('Invalid assessment response');
                    return;
                }
                sender.send('boardflow:classroom-message', message);
                response.writeHead(204).end();
                return;
            }
            const filePath = safeWebFile(requestUrl.pathname);
            if (!filePath) {
                response.writeHead(403).end('Forbidden');
                return;
            }
            const content = await fs.promises.readFile(filePath);
            response.writeHead(200, { 'Content-Type': mimeType(filePath), 'Cache-Control': 'no-store' });
            response.end(content);
        } catch (error) {
            response.writeHead(error.code === 'ENOENT' ? 404 : 500).end('BoardFlow classroom server error');
        }
    });
    await new Promise((resolve, reject) => {
        classroomServer.once('error', reject);
        classroomServer.listen(0, '0.0.0.0', resolve);
    });
    const port = classroomServer.address().port;
    classroomSession = { code, url: `http://${localIPv4Address()}:${port}/classroom?role=student&session=${code}` };
    return classroomSession;
}

async function stopClassroomServer() {
    classroomClients.forEach(response => response.end());
    classroomClients.clear();
    if (classroomServer) await new Promise(resolve => classroomServer.close(resolve));
    classroomServer = null;
    classroomSession = null;
}

function workspaceConfigFile() {
    return path.join(app.getPath('userData'), 'workspace.json');
}

async function readWorkspacePath() {
    try {
        const config = JSON.parse(await fs.promises.readFile(workspaceConfigFile(), 'utf8'));
        return typeof config.path === 'string' && fs.existsSync(config.path) ? config.path : null;
    } catch {
        return null;
    }
}

function safeFolderName(value) {
    const name = String(value || '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/[. ]+$/g, '').trim();
    return (name || 'Subject').slice(0, 80);
}

async function subjectWorkspace(folderName) {
    const root = await readWorkspacePath();
    if (!root) throw new Error('Choose a BoardFlow workspace folder first.');
    const safeName = safeFolderName(folderName);
    const folderPath = path.resolve(root, safeName);
    const relative = path.relative(path.resolve(root), folderPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid subject folder.');
    await fs.promises.mkdir(folderPath, { recursive: true });
    return { folderPath, safeName };
}

ipcMain.handle('boardflow:get-workspace', () => readWorkspacePath());
ipcMain.handle('boardflow:choose-workspace', async event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
        title: 'Choose the main BoardFlow workspace folder',
        buttonLabel: 'Use this folder',
        properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const workspacePath = path.resolve(result.filePaths[0]);
    await fs.promises.mkdir(path.dirname(workspaceConfigFile()), { recursive: true });
    await fs.promises.writeFile(workspaceConfigFile(), JSON.stringify({ path: workspacePath }), 'utf8');
    return workspacePath;
});
ipcMain.handle('boardflow:create-subject-workspace', async (_event, details) => {
    const { folderPath, safeName } = await subjectWorkspace(details?.folderName);
    const lessonPath = path.join(folderPath, `${safeName}.boardview`);
    try {
        await fs.promises.writeFile(lessonPath, String(details?.content || ''), { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
    return { folderName: safeName, lessonPath };
});
ipcMain.handle('boardflow:write-subject-file', async (_event, details) => {
    const { folderPath, safeName } = await subjectWorkspace(details?.folderName);
    const lessonPath = path.join(folderPath, `${safeName}.boardview`);
    const temporaryPath = `${lessonPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await fs.promises.writeFile(temporaryPath, String(details?.content || ''), { encoding: 'utf8', flag: 'wx' });
        await fs.promises.rename(temporaryPath, lessonPath);
    } catch (error) {
        await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
        throw error;
    }
    return lessonPath;
});
ipcMain.handle('boardflow:classroom-start', event => startClassroomServer(event.sender));
ipcMain.handle('boardflow:classroom-stop', () => stopClassroomServer());
ipcMain.on('boardflow:classroom-broadcast', (_event, message) => classroomMessage(message));

function recognizeWithWindowsInk(strokes) {
    if (process.platform !== 'win32') {
        return Promise.resolve({ text: '', alternatives: [], engine: 'Windows Ink', error: 'Windows Ink recognition is only available on Windows.' });
    }
    const scriptPath = app.isPackaged
        ? path.join(`${app.getAppPath()}.unpacked`, 'scripts', 'recognize-ink.ps1')
        : path.join(__dirname, 'scripts', 'recognize-ink.ps1');
    return new Promise((resolve, reject) => {
        const processHandle = execFile('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            scriptPath
        ], {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 20000,
            maxBuffer: 1024 * 1024
        }, (error, stdout) => {
            if (error) {
                reject(error);
                return;
            }
            try {
                resolve(JSON.parse(stdout.trim()));
            } catch (parseError) {
                reject(new Error(`Windows Ink returned an invalid response: ${parseError.message}`));
            }
        });
        processHandle.stdin.end(JSON.stringify({ strokes }));
    });
}

ipcMain.handle('boardflow:recognize-ink', async (_event, details) => {
    const sourceStrokes = Array.isArray(details?.strokes) ? details.strokes.slice(0, 200) : [];
    const strokes = sourceStrokes.map(stroke => Array.isArray(stroke)
        ? stroke.slice(0, 2000).map(point => ({
            x: Math.max(-100000, Math.min(100000, Number(point?.x) || 0)),
            y: Math.max(-100000, Math.min(100000, Number(point?.y) || 0))
        }))
        : []);
    if (!strokes.some(stroke => stroke.length > 1)) return { text: '', alternatives: [], engine: 'Native recognition', error: 'No handwriting strokes were supplied.' };
    if (details?.mode === 'equations' || details?.recognitionType === 'math') {
        return { text: '', alternatives: [], engine: 'Windows Ink', error: 'Windows Ink recognizes handwriting, but equation recognition is not available in this build.' };
    }
    try {
        return await recognizeWithWindowsInk(strokes);
    } catch (error) {
        console.error('Windows Ink recognition failed', error);
        return { text: '', alternatives: [], engine: 'Windows Ink', error: error.message || 'Windows Ink recognition failed.' };
    }
});

ipcMain.handle('boardflow:typeset-equation', async (_event, latex) => {
    try { return { svg: await require('./scripts/typeset-equation.cjs').typesetEquation(latex) }; }
    catch { return { error: 'This equation could not be formatted. Check the expression.' }; }
});

ipcMain.on('boardflow:close-response', (event, canClose) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || !canClose) return;
    approvedClosures.add(win);
    win.close();
});

function createWindow() {
    const rendererFile = path.resolve(__dirname, 'www', 'index.html');
    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        icon: path.join(__dirname, 'icon.png'),
        autoHideMenuBar: true,
        backgroundColor: '#1010cc',
        title: 'BoardFlow',
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false
        }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, navigationUrl) => {
        try {
            const target = new URL(navigationUrl);
            if (target.protocol === 'file:' && path.resolve(fileURLToPath(target)) === rendererFile) return;
        } catch {
            // Invalid and non-file destinations are never valid renderer routes.
        }
        event.preventDefault();
    });
    win.loadURL(pathToFileURL(rendererFile).toString());
    win.on('close', event => {
        if (isQuitting || approvedClosures.has(win)) return;
        event.preventDefault();
        win.webContents.send('boardflow:close-requested');
    });
}

app.whenReady().then(createWindow);
app.on('before-quit', () => {
    // Removed MyScript SDK cleanup since it has been removed from the project
    // closeRecognitionWorkers();
    isQuitting = true;
    stopClassroomServer().catch(() => {});
});
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});