const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        icon: path.join(__dirname, 'icon.png'),
        autoHideMenuBar: true,
        backgroundColor: '#1010cc',
        title: 'BoardFlow'
    });
    win.loadFile('index.html');
    let closing = false;
    win.on('close', event => {
        if (closing) return;
        event.preventDefault();
        win.webContents.executeJavaScript('window.boardFlowRequestClose ? window.boardFlowRequestClose() : true')
            .then(canClose => {
                if (!canClose) return;
                closing = true;
                win.close();
            })
            .catch(() => {
                closing = true;
                win.close();
            });
    });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());