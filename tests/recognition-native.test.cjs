const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

test('installed Windows recognizer returns its real confidence and engine type', {
    skip: process.platform !== 'win32' || !fs.existsSync('C:/Program Files/Common Files/Microsoft Shared/Ink/Microsoft.Ink.dll')
}, () => {
    const strokes = [
        [{x:20,y:10},{x:20,y:100}],
        [{x:20,y:55},{x:70,y:55}],
        [{x:70,y:10},{x:70,y:100}]
    ];
    const output = execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('scripts/recognize-ink.ps1')], {
        input: JSON.stringify({strokes,language:'en-US'}),encoding:'utf8',windowsHide:true,timeout:20000
    });
    const result = JSON.parse(output.trim());
    assert.equal(result.error, undefined);
    assert.equal(result.kind, 'text');
    assert.ok(['Strong','Intermediate','Poor'].includes(result.confidenceLevel));
    assert.equal(result.text.trim(), 'H');
    console.log('Windows letter H confidence:', result.confidenceLevel);
});
