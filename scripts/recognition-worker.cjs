const { spawn } = require('child_process');
const { createInterface } = require('readline');

function createRecognitionWorker(executable, launch = spawn) {
    let child = null, active = null, timer = null;
    const queue = [];
    function stop(message = 'Recognition worker stopped.') {
        const old = child;
        child = null;
        clearTimeout(timer);
        if (active) { active.reject(new Error(message)); active = null; }
        while (queue.length) queue.shift().reject(new Error(message));
        old?.kill();
    }
    function pump() {
        if (active || !queue.length) return;
        if (!child) {
            const process = launch(executable, ['--server'], { windowsHide: true, stdio: ['pipe','pipe','ignore'] });
            child = process;
            process.on('error', () => { if (child === process) stop('MyScript could not start.'); });
            process.on('exit', () => { if (child === process) stop('MyScript stopped unexpectedly.'); });
            process.stdin.on('error', () => { if (child === process) stop('MyScript input closed.'); });
            createInterface({ input: process.stdout }).on('line', line => {
                if (child !== process || !active) return;
                clearTimeout(timer);
                const request = active; active = null;
                try { request.resolve(JSON.parse(line)); } catch { request.reject(new Error('Invalid MyScript response.')); }
                pump();
            });
        }
        active = queue.shift();
        timer = setTimeout(() => stop('MyScript timed out. Your ink is unchanged.'), 30000);
        child.stdin.write(JSON.stringify(active.payload) + '\n');
    }
    return {
        request(payload) {
            if (queue.length >= 8) return Promise.reject(new Error('Recognition is busy. Try again after a pause.'));
            return new Promise((resolve,reject) => { queue.push({payload,resolve,reject}); pump(); });
        },
        close: stop
    };
}
module.exports = { createRecognitionWorker };
