const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('boardFlowDesktop', {
    getWorkspace: () => ipcRenderer.invoke('boardflow:get-workspace'),
    chooseWorkspace: () => ipcRenderer.invoke('boardflow:choose-workspace'),
    createSubjectWorkspace: details => ipcRenderer.invoke('boardflow:create-subject-workspace', details),
    writeSubjectFile: details => ipcRenderer.invoke('boardflow:write-subject-file', details),
    startClassroom: () => ipcRenderer.invoke('boardflow:classroom-start'),
    stopClassroom: () => ipcRenderer.invoke('boardflow:classroom-stop'),
    broadcastClassroom: message => ipcRenderer.send('boardflow:classroom-broadcast', message),
    // Updated to work with the new native recognition placeholder
    recognizeInk: details => ipcRenderer.invoke('boardflow:recognize-ink', details),
    typesetEquation: latex => ipcRenderer.invoke('boardflow:typeset-equation', latex),
    onClassroomMessage(callback) {
        ipcRenderer.on('boardflow:classroom-message', (_event, message) => callback(message));
    },
    onCloseRequested(callback) {
        ipcRenderer.on('boardflow:close-requested', async () => {
            try {
                ipcRenderer.send('boardflow:close-response', Boolean(await callback()));
            } catch (error) {
                console.error('Unable to complete close request', error);
                ipcRenderer.send('boardflow:close-response', false);
            }
        });
    }
});