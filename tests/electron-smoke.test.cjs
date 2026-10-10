const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');

test('Electron starts the generated renderer through the sandboxed preload bridge', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boardflow-electron-'));
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boardflow-workspace-'));
    fs.writeFileSync(path.join(userDataDir, 'workspace.json'), JSON.stringify({ path: workspaceDir }));
    const application = await electron.launch({
        args: ['.', `--user-data-dir=${userDataDir}`],
        cwd: root
    });

    try {
        const window = await application.firstWindow();
        await window.waitForFunction(() => Boolean(window.BF?.isReady), null, { timeout: 10000 });
        assert.equal(await window.title(), 'BoardFlow');
        assert.equal(await window.evaluate(() => typeof window.boardFlowDesktop?.onCloseRequested), 'function');
        assert.equal(await window.evaluate(() => typeof window.boardFlowDesktop?.chooseWorkspace), 'function');
        assert.equal(await window.evaluate(() => typeof window.boardFlowDesktop?.startClassroom), 'function');
        assert.equal(await window.evaluate(() => typeof window.boardFlowDesktop?.recognizeInk), 'function');
        const inkResult = await window.evaluate(() => window.boardFlowDesktop.recognizeInk({
            language: 'en-US',
            strokes: [[{ x: 10, y: 10 }, { x: 10, y: 50 }, { x: 40, y: 50 }]]
        }));
        assert.match(inkResult.engine, /Handwriting Recognizer|Windows Ink/);
        assert.ok(inkResult.text);
        if (process.env.BOARDFLOW_TEST_MYSCRIPT === '1') {
            const textResult = await window.evaluate(() => window.boardFlowDesktop.recognizeInk({
                mode: 'writing', strokes: [[{x:10,y:10},{x:10,y:60}], [{x:10,y:35},{x:50,y:35}], [{x:50,y:10},{x:50,y:60}]]
            }));
            assert.equal(textResult.engine, 'MyScript iink');
            assert.equal(textResult.kind, 'text');
            assert.equal(textResult.text, 'H');
            const mathResult = await window.evaluate(() => window.boardFlowDesktop.recognizeInk({
                mode: 'equations',
                strokes: [[{ x: 10, y: 10 }, { x: 35, y: 35 }, { x: 60, y: 60 }],
                    [{ x: 60, y: 10 }, { x: 35, y: 35 }, { x: 10, y: 60 }]]
            }));
            assert.equal(mathResult.engine, 'MyScript iink');
            assert.equal(mathResult.kind, 'math');
            assert.match(mathResult.latex, /^[xX]$/);
            assert.match(mathResult.svg, /<svg/);
            const mixed = await window.evaluate(() => window.boardFlowDesktop.recognizeInk({mode:'smart',strokes:[
                [{x:40,y:10},{x:40,y:45}],[{x:10,y:60},{x:75,y:60}],[{x:40,y:75},{x:40,y:110}]
            ]}));
            assert.equal(mixed.kind,'mixed');
            assert.equal(mixed.entries[0].result.kind,'math');
            const typeset = await window.evaluate(()=>window.boardFlowDesktop.typesetEquation('y=x^{2}'));
            assert.match(typeset.svg,/<svg/);
        }
        const created = await window.evaluate(() => window.boardFlowDesktop.createSubjectWorkspace({
            folderName: 'Mathematics',
            content: '{"app":"BoardFlow","objects":{"objects":[]}}'
        }));
        assert.equal(created.folderName, 'Mathematics');
        await window.evaluate(() => window.boardFlowDesktop.writeSubjectFile({
            folderName: 'Mathematics',
            content: '{"updated":true}'
        }));
        assert.equal(fs.readFileSync(path.join(workspaceDir, 'Mathematics', 'Mathematics.boardview'), 'utf8'), '{"updated":true}');
        assert.equal(await window.evaluate(() => window.open('https://example.com') === null), true);
        assert.equal(application.windows().length, 1);
        await window.locator('#btnClassroomRail').evaluate(button => button.click());
        await window.locator('[data-classroom-tab="session"]').click();
        await window.locator('#btnStartSession').click();
        await window.locator('#sessionCard:not(.hidden)').waitFor();
        const classroom = await window.evaluate(() => ({
            code: document.querySelector('#sessionCode').textContent,
            url: document.querySelector('#sessionUrl').value,
            qrLength: document.querySelector('#sessionQr').toDataURL().length
        }));
        assert.match(classroom.code, /^\d{6}$/);
        assert.ok(classroom.qrLength > 500);
        const response = await fetch(classroom.url);
        assert.equal(response.status, 200);
        assert.match(await response.text(), /Classroom Studio/);
        await window.evaluate(() => {
            window.boardFlowDesktop.onClassroomMessage(message => { window.__classroomProbe = message; });
        });
        const messageResponse = await fetch(`${classroom.url.split('/classroom')[0]}/classroom/message?code=${classroom.code}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'assessment-response', assessmentId: 'test-assessment', answer: '42' })
        });
        assert.equal(messageResponse.status, 204);
        await window.waitForFunction(() => window.__classroomProbe?.answer === '42');
        const invalidMessage = await fetch(`${classroom.url.split('/classroom')[0]}/classroom/message?code=${classroom.code}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'board-state', state: { objects: [] } })
        });
        assert.equal(invalidMessage.status, 400);
        await window.locator('#btnStopSession').click();
    } finally {
        await application.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
});
