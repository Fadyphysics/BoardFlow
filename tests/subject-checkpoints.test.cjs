const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
test.after(() => require('../scripts/myscript-bridge.cjs').closeRecognitionWorkers());

const root = path.resolve(__dirname, '..', 'www');
let fixtureDir;
let fixturePath;
let largeFixturePath;
let pdfFixturePath;
let invalidPdfFixturePath;
let invalidBoardFixturePath;
let server;
let browser;
let baseUrl;

function createServer() {
    return http.createServer((request, response) => {
        const requested = decodeURIComponent((request.url || '/').split('?')[0]);
        const filePath = path.resolve(root, '.' + requested);
        if (!filePath.startsWith(root) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            response.writeHead(404);
            response.end();
            return;
        }
        const contentType = filePath.endsWith('.html')
            ? 'text/html'
            : /\.m?js$/.test(filePath)
                ? 'text/javascript'
                : filePath.endsWith('.css')
                    ? 'text/css'
                    : 'application/octet-stream';
        response.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(response);
    });
}

function createMinimalPdf() {
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 4 0 R >>',
        '<< /Length 0 >>\nstream\n\nendstream'
    ];
    let body = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => {
        offsets.push(Buffer.byteLength(body));
        body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = Buffer.byteLength(body);
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    body += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(body);
}

async function openApp(initStorage, contextOptions = {}) {
    const context = await browser.newContext(contextOptions);
    await context.addInitScript(() => {
        if (!localStorage.getItem('e2e-seeded')) {
            localStorage.setItem('boardflow-subjects', JSON.stringify([
                { id: 'alpha', name: 'Alpha', folderName: 'Test', color: '#2f80ed' },
                { id: 'beta', name: 'Beta', folderName: 'Test', color: '#27ae60' }
            ]));
            localStorage.removeItem('boardflow-active-subject');
            localStorage.setItem('e2e-seeded', '1');
        }
    });
    if (initStorage) await context.addInitScript(initStorage);
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', error => pageErrors.push(error));
    page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.goto(`${baseUrl}/index.html`);
    try {
        await page.waitForFunction(() => Boolean(window.BF?.isReady), null, { timeout: 10000 });
    } catch (error) {
        assert.fail(`BoardFlow failed to initialize: ${pageErrors.map(item => item.message).join('; ') || error.message}`);
    }
    return { consoleErrors, context, page, pageErrors };
}

async function ensureMenuOpen(page) {
    if (!await page.locator('#menu').isVisible()) {
        await page.locator('#btnMenu').click();
    }
    await page.locator('#menu').waitFor({ state: 'visible' });
}

async function openClassroomStudioForTest(page) {
    await page.locator('#btnClassroomRail').evaluate(button => button.click());
    await page.locator('#classroomPanel').waitFor({ state: 'visible' });
}

test.before(async () => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boardflow-test-'));
    fixturePath = path.join(fixtureDir, 'checkpoint.svg');
    largeFixturePath = path.join(fixtureDir, 'large-upload.svg');
    pdfFixturePath = path.join(fixtureDir, 'one-page.pdf');
    invalidPdfFixturePath = path.join(fixtureDir, 'broken.pdf');
    invalidBoardFixturePath = path.join(fixtureDir, 'broken.boardview');
    fs.writeFileSync(fixturePath, '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="red"/></svg>');
    fs.writeFileSync(largeFixturePath, '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1600"><rect width="2400" height="1600" fill="red"/></svg>');
    fs.writeFileSync(pdfFixturePath, createMinimalPdf());
    fs.writeFileSync(invalidPdfFixturePath, '%PDF-not-a-real-document');
    fs.writeFileSync(invalidBoardFixturePath, JSON.stringify({
        app: 'BoardFlow',
        objects: { objects: [] },
        viewport: [0, 0, 0, 0, 0, 0]
    }));
    server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
});

test.after(async () => {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(fixtureDir, { recursive: true, force: true });
});

test('scratch-out deletes letters and shapes, protects files, and supports Undo', async () => {
    const {context,page,pageErrors}=await openApp();
    try {
        await page.evaluate(()=>{
            const {canvas:c,fabric:f}=window.BF;
            c.add(new f.Textbox('ABC 123',{left:100,top:220,width:250,fontSize:30,originX:'left',originY:'top'}));
            c.add(new f.Rect({left:400,top:220,width:30,height:30,originX:'left',originY:'top',isShape:true}));
            c.add(new f.Rect({left:400,top:220,width:30,height:30,originX:'left',originY:'top',isFile:true}));
            const scratch=(x1,x2,y)=>{
                const path=new f.Path(Array.from({length:9},(_,i)=>`${i?'L':'M'} ${i%2?x2:x1} ${y+i*2}`).join(' '),{stroke:'red',fill:''});
                c.add(path);c.fire('path:created',{path});
            };
            const text=c.getObjects().find(o=>o.text);
            text.measureLine(0);
            const cell=text.__charBounds[0][1];
            scratch(100+cell.left-2,100+cell.left+cell.width+2,225);
        });
        assert.equal(await page.evaluate(()=>window.BF.canvas.getObjects().find(o=>o.text)?.text),'AC 123');
        await page.locator('#btnUndoQuick').click();
        await page.waitForFunction(()=>window.BF.canvas.getObjects().some(o=>o.text==='ABC 123'));
        assert.equal(await page.evaluate(()=>window.BF.canvas.getObjects().filter(o=>o.isSketch).length),0);
        await page.evaluate(()=>{
            const {canvas:c,fabric:f}=window.BF;
            // A short flat scratch entirely inside the shape must also work.
            const path=new f.Path(Array.from({length:5},(_,i)=>`${i?'L':'M'} ${i%2?425:405} 235`).join(' '),{stroke:'red',fill:''});
            c.add(path);c.fire('path:created',{path});
        });
        assert.equal(await page.evaluate(()=>window.BF.canvas.getObjects().some(o=>o.isShape)),false);
        assert.equal(await page.evaluate(()=>window.BF.canvas.getObjects().filter(o=>o.isFile).length),1);
        await page.locator('#btnUndoQuick').click();
        await page.waitForFunction(()=>window.BF.canvas.getObjects().some(o=>o.isShape));
        await ensureMenuOpen(page);
        const sizes=await page.evaluate(()=>{
            const menu=document.querySelector('#menu'),hud=document.querySelector('.hud');
            return {menu:menu.getBoundingClientRect().width/menu.offsetWidth,hud:hud.getBoundingClientRect().width/hud.offsetWidth,center:menu.getBoundingClientRect().x+menu.getBoundingClientRect().width/2,canvas:window.BF.canvas.width,wrap:document.querySelector('#canvasWrap').clientWidth};
        });
        assert.ok(Math.abs(sizes.menu-.8)<.01, JSON.stringify(sizes));
        assert.ok(Math.abs(sizes.hud-.8)<.01);
        assert.equal(sizes.canvas,sizes.wrap);
        assert.ok(Math.abs(sizes.center-sizes.wrap/2)<1);
        assert.deepEqual(pageErrors,[]);
    } finally { await context.close(); }
});

test('quick undo and clear controls stay available and Clear is fully undoable', async () => {
    const {context,page}=await openApp();
    try {
        assert.equal(await page.locator('#btnUndoQuick').isVisible(),true);
        assert.equal(await page.locator('#btnClearQuick').isVisible(),true);
        await page.locator('#fileInput').setInputFiles(fixturePath);
        await page.waitForFunction(()=>window.BF.canvas.getObjects().some(o=>o.isFile));
        await page.waitForFunction(()=>document.querySelector('#appStatus').textContent.includes('is now on the board.'));
        await page.evaluate(()=>{
            const c=window.BF.canvas, f=window.BF.fabric;
            c.add(new f.Path('M 100 310 L 150 360',{stroke:'#ef4444',fill:'',isSketch:true}));
            c.add(new f.Textbox('Keep my text',{left:200,top:300,width:200,fontSize:18}));
            // Clear before the debounced history snapshot has had time to run.
            document.querySelector('#btnClearQuick').click();
        });
        assert.equal(await page.locator('#btnClearQuick').isDisabled(),true);
        assert.equal(await page.locator('#btnUndoQuick').isEnabled(),true);
        assert.equal(await page.evaluate(()=>window.BF.canvas.getObjects().filter(o=>!o.isFile).length),0);
        assert.equal(await page.evaluate(()=>window.BF.canvas.getObjects().filter(o=>o.isFile).length),1);
        await page.locator('#btnUndoQuick').click();
        await page.waitForFunction(()=>window.BF.canvas.getObjects().some(o=>o.text==='Keep my text'));
        assert.equal(await page.evaluate(()=>window.BF.canvas.getObjects().filter(o=>o.isSketch).length),1);
        assert.equal(await page.evaluate(()=>window.BF.canvas.getObjects().filter(o=>o.isFile).length),1);
        assert.equal(await page.locator('#btnClearQuick').isEnabled(),true);
        await ensureMenuOpen(page);
        await page.locator('#btnRedo').click();
        await page.waitForFunction(()=>window.BF.canvas.getObjects().filter(o=>!o.isFile).length===0);
        await page.locator('#btnUndoQuick').click();
        await page.waitForFunction(()=>window.BF.canvas.getObjects().some(o=>o.isSketch));
        await page.locator('#btnClear').click();
        await page.locator('#btnUndoQuick').click();
        await page.waitForFunction(()=>window.BF.canvas.getObjects().some(o=>o.text==='Keep my text'));
    } finally {await context.close();}
});

test.skip('recognition shortcuts directly convert existing and new ink without a dialog', async () => {
    const { context, page } = await openApp();
    try {
        await page.evaluate(() => {
            window.boardFlowDesktop = { recognizeInk: async () => ({ text: 'Hello', confidence: 0.99 }) };
            const stroke = new window.BF.fabric.Path('M 100 100 L 130 120 L 150 100', { stroke: '#123456', fill: '', isSketch: true });
            window.BF.canvas.add(stroke);
        });
        assert.deepEqual(await page.locator('#hud > button').evaluateAll(nodes => nodes.slice(2, 5).map(n => n.textContent)), ['◇', 'a', '∛']);
        await page.locator('#btnInkRecognition').click();
        await page.waitForFunction(() => window.BF.canvas.getObjects().some(o => o.text === 'Hello'));
        assert.equal(await page.locator('#equationDialog').isVisible(), false);
        assert.equal(await page.evaluate(() => window.BF.canvas.getObjects().some(o => o.text === 'Hello' && o.boardflowKind === 'recognized-text')), true);
        await ensureMenuOpen(page);
        await page.locator('#btnPen').click();
        await page.evaluate(() => {
            window.boardFlowDesktop.recognizeInk = async () => ({ text: 'New word', confidence: 0.99 });
            const stroke = new window.BF.fabric.Path('M 300 300 L 330 320 L 350 300', { stroke: '#123456', fill: '', isSketch: true });
            window.BF.canvas.add(stroke);
            window.BF.canvas.fire('path:created', { path: stroke });
        });
        await page.waitForFunction(() => window.BF.canvas.getObjects().some(o => o.text === 'New word'));
        assert.equal(await page.evaluate(() => window.BF.canvas.isDrawingMode), true);
        await page.evaluate(() => {
            window.boardFlowDesktop.recognizeInk = async () => ({ text: 'y = x', latex: 'y=x', confidence: 0.99, kind: 'math' });
            const stroke = new window.BF.fabric.Path('M 400 300 L 430 320 L 450 300', { stroke: '#123456', fill: '', isSketch: true });
            window.BF.canvas.add(stroke);
        });
        await page.locator('#btnEquationRecognition').click();
        assert.equal(await page.locator('#btnInkRecognition').getAttribute('aria-pressed'), 'false');
        await page.waitForFunction(() => window.BF.canvas.getObjects().some(o => o.boardflowKind === 'equation' && o.text === 'y = x'));
        assert.equal(await page.locator('#equationDialog').isVisible(), false);
        await ensureMenuOpen(page);
        await page.locator('#btnUndo').click();
        await page.waitForFunction(() => !window.BF.canvas.getObjects().some(o => o.text === 'y = x'));
        assert.equal(await page.evaluate(() => window.BF.canvas.getObjects().some(o => o.isSketch)), true);
        await page.locator('#btnEquationRecognition').click();
        assert.equal(await page.locator('#btnEquationRecognition').getAttribute('aria-pressed'), 'false');
    } finally {
        await context.close();
    }
});

test.skip('browser without a handwriting API runs the local model and converts writing', async () => {
    const { context, page } = await openApp();
    try {
        await page.evaluate(() => {
            delete window.boardFlowDesktop;
            Object.defineProperty(navigator, 'createHandwritingRecognizer', { configurable: true, value: undefined });
            window.Worker = class {
                postMessage(request) {
                    window.__handwritingImage = request.image;
                    setTimeout(() => this.onmessage({
                        data: {
                            type: 'result',
                            id: request.id,
                            result: {
                                text: 'Hello from browser',
                                alternatives: [],
                                engine: 'TrOCR small (browser, local)',
                                kind: 'text'
                            }
                        }
                    }), 0);
                }
                terminate() {}
            };
            window.BF.canvas.add(new window.BF.fabric.Path('M 100 100 L 130 120 L 150 100', {
                stroke: '#123456',
                fill: '',
                isSketch: true
            }));
        });
        await page.locator('#btnInkRecognition').click();
        await page.waitForFunction(() => window.BF.canvas.getObjects().some(object => object.text === 'Hello from browser'));
        assert.deepEqual(await page.evaluate(() => ({
            recognized: window.BF.canvas.getObjects().some(object => object.text === 'Hello from browser' && object.boardflowKind === 'recognized-text'),
            sourceInkKept: window.BF.canvas.getObjects().some(object => object.isSketch),
            pngPrepared: window.__handwritingImage?.startsWith('data:image/png;base64,')
        })), { recognized: true, sourceInkKept: false, pngPrepared: true });
        assert.match(await page.locator('#recognitionEngineStatus').textContent(), /Local TrOCR model/);
    } finally {
        await context.close();
    }
});

test.skip('deactivating handwriting recognition discards an in-flight conversion', async () => {
    const { context, page } = await openApp();
    try {
        await page.locator('#btnInkRecognition').click();
        await page.evaluate(() => {
            window.boardFlowDesktop = { recognizeInk: () => new Promise(resolve => { window.finishTestRecognition = resolve; }) };
            const stroke = new window.BF.fabric.Path('M 100 100 L 130 120 L 150 100', { stroke: '#123456', fill: '', isSketch: true });
            window.BF.canvas.add(stroke);
            window.BF.canvas.fire('path:created', { path: stroke });
        });
        await page.waitForFunction(() => typeof window.finishTestRecognition === 'function');
        await page.locator('#btnInkRecognition').click();
        await page.evaluate(() => window.finishTestRecognition({ text: 'Do not insert', confidence: 0.99 }));
        await page.waitForTimeout(150);
        assert.equal(await page.evaluate(() => window.BF.canvas.getObjects().some(o => o.text === 'Do not insert')), false);
        assert.equal(await page.evaluate(() => window.BF.canvas.getObjects().some(o => o.isSketch)), true);
    } finally {
        await context.close();
    }
});

test.skip('recognized writing uses menu typography and forms ordered lines in one text block', async () => {
    const {context,page} = await openApp();
    try {
        await ensureMenuOpen(page);
        await page.locator('#fontFamilySel').selectOption('Arial, sans-serif');
        await page.locator('#fontSizeSel').fill('18');
        await page.locator('#fontSizeSel').dispatchEvent('change');
        await page.evaluate(() => {
            const words=['wife','my','I love'];
            window.boardFlowDesktop={recognizeInk:async()=>({text:words.shift(),confidence:0.99})};
            for(const [x,y] of [[100,250],[350,108],[100,100]]) {
                const stroke=new window.BF.fabric.Path(`M ${x} ${y} L ${x+20} ${y+40}`,{isSketch:true,stroke:'#ef4444',fill:''});
                window.BF.canvas.add(stroke);
            }
        });
        await page.locator('#btnInkRecognition').click();
        await page.waitForFunction(()=>window.BF.canvas.getObjects().some(o=>o.boardflowKind==='recognized-text'));
        const text=await page.evaluate(()=>window.BF.canvas.getObjects().filter(o=>o.boardflowKind==='recognized-text').map(o=>({
            text:o.text,fontFamily:o.fontFamily,fontSize:o.fontSize,lineHeight:o.lineHeight,width:o.width
        })));
        assert.equal(text.length,1);
        assert.equal(text[0].text,'I love my\nwife');
        assert.equal(text[0].fontFamily,'Arial, sans-serif');
        assert.equal(text[0].fontSize,18);
        assert.equal(text[0].lineHeight,1.25);
        assert.ok(text[0].width>500);
    } finally {await context.close();}
});

test('Auto Shapes remains available while handwriting and equation controls stay removed', async () => {
    const { context, page } = await openApp();
    try {
        await page.evaluate(() => {
            for (const x of [100, 350]) {
                window.BF.canvas.add(new window.BF.fabric.Path(`M ${x} 100 L ${x+90} 102 L ${x+92} 180 L ${x} 180 Z`, {stroke:'#ef4444',fill:'',isSketch:true}));
            }
        });
        await page.locator('#btnAutoShapes').click();
        assert.equal(await page.evaluate(() => window.currentRecognitionMode), 'shapes');
        assert.equal(await page.evaluate(() => window.BF.canvas.getObjects().filter(o => o.isSketch).length), 2);
        assert.equal(await page.locator('#btnInkRecognition').count(), 0);
        assert.equal(await page.locator('#btnEquationRecognition').count(), 0);
    } finally { await context.close(); }
});

test.skip('recognition does not commit while the next stroke is still being drawn', async () => {
    const { context, page } = await openApp();
    try {
        await page.locator('#btnInkRecognition').click();
        await page.evaluate(() => {
            window.boardFlowDesktop = {recognizeInk: () => new Promise(resolve => {window.completePendingInk=resolve;})};
            const p=new window.BF.fabric.Path('M 100 200 Q 150 100 200 200', {stroke:'#ef4444',fill:'',isSketch:true});
            window.BF.canvas.add(p);window.BF.canvas.fire('path:created',{path:p});
        });
        await page.waitForFunction(() => !!window.completePendingInk);
        await page.mouse.move(1000,600);await page.mouse.down();
        await page.evaluate(() => window.completePendingInk({text:'Partial',confidence:0.99}));
        await page.waitForTimeout(150);
        assert.equal(await page.evaluate(() => window.BF.canvas.getObjects().some(o=>o.text==='Partial')),false);
        await page.mouse.up();
    } finally {await context.close();}
});

test.skip('MyScript converts visible fraction ink into a formatted equation and Undo restores it', {
    skip: process.env.BOARDFLOW_TEST_MYSCRIPT !== '1'
}, async () => {
    const { context, page } = await openApp();
    try {
        const { recognizeMath } = require('../scripts/myscript-bridge.cjs');
        await page.exposeFunction('nativeMathForTest', details => {
            assert.equal(details.mode, 'equations');
            return recognizeMath(details.strokes, path.resolve(__dirname, '..'));
        });
        await page.evaluate(() => {
            window.boardFlowDesktop = { recognizeInk: window.nativeMathForTest };
            for (const commands of ['M 240 110 L 240 145', 'M 210 160 L 275 160', 'M 240 175 L 240 210']) {
                window.BF.canvas.add(new window.BF.fabric.Path(commands, { stroke: '#ef4444', fill: '', isSketch: true }));
            }
        });
        await page.locator('#btnEquationRecognition').click();
        await page.waitForFunction(() => window.BF.canvas.getObjects().some(o => o.boardflowKind === 'equation'), null, { timeout: 30000 });
        const result = await page.evaluate(() => {
            const eq = window.BF.canvas.getObjects().find(o => o.boardflowKind === 'equation');
            return { type: eq.type, latex: eq.boardflowPayload.latex, image: decodeURIComponent(eq.getSrc()), box: eq.getBoundingRect(), ink: window.BF.canvas.getObjects().filter(o => o.isSketch).length };
        });
        assert.match(result.latex, /\\frac\s*\{1\}\s*\{1\}/);
        assert.equal(result.type, 'image');
        assert.match(result.image, /rgb\(239,68,68\)/);
        assert.equal(result.ink, 0);
        assert.ok(result.box.left >= 200 && result.box.top >= 100);
        assert.equal(await page.locator('#equationDialog').isVisible(), false);
        if (await page.locator('#menu').isVisible()) await page.locator('#btnMenu').click();
        await page.screenshot({ path: path.resolve('MyScript/bin/recognition-test.png') });
        await ensureMenuOpen(page);
        await page.locator('#btnUndo').click();
        await page.waitForFunction(() => !window.BF.canvas.getObjects().some(o => o.boardflowKind === 'equation'));
        assert.equal(await page.evaluate(() => window.BF.canvas.getObjects().filter(o => o.isSketch).length), 3);
    } finally { await context.close(); }
});

test.skip('Smart Ink links graphs, preserves unclassified ink, and updates equation and graph atomically', async () => {
    const {context,page}=await openApp();
    try {
        const {typesetEquation}=require('../scripts/typeset-equation.cjs');
        const svg=await typesetEquation('y=\\frac{6}{x}');
        await page.exposeFunction('typesetForTest',async latex=>({svg:await typesetEquation(latex)}));
        await page.evaluate(svg=>{
            window.boardFlowDesktop={typesetEquation:window.typesetForTest,recognizeInk:async request=>{
                if(request.mode!=='smart') throw new Error('Expected smart mode');
                return {kind:'mixed',entries:[{indices:[0],result:{kind:'math',text:'y=6/x',latex:'y=\\frac{6}{x}',svg,engine:'MyScript iink',status:'recognized'}}]};
            }};
            window.BF.canvas.add(new window.BF.fabric.Path('M 200 310 L 260 350',{isSketch:true,stroke:'#ef4444',fill:''}));
            window.BF.canvas.add(new window.BF.fabric.Path('M 260 360 L 300 390',{isSketch:true,stroke:'#ef4444',fill:''}));
        },svg);
        await page.locator('#btnSmartInk').click();
        await page.waitForFunction(()=>window.BF.canvas.getObjects().some(o=>o.boardflowKind==='linked-graph'));
        assert.equal(await page.evaluate(()=>window.BF.canvas.getObjects().filter(o=>o.isSketch).length),1);
        await page.evaluate(()=>{
            const eq=window.BF.canvas.getObjects().find(o=>o.boardflowKind==='equation');
            window.BF.canvas.fire('mouse:dblclick',{target:eq});
        });
        await page.locator('#smartEquationValue').fill('y=3-x^{2}');
        await page.locator('#smartEquationApply').click();
        await page.waitForFunction(()=>window.BF.canvas.getObjects().some(o=>o.boardflowKind==='linked-graph' && o.boardflowPayload.expression==='3-x^(2)'));
        const links=await page.evaluate(()=>{
            const eq=window.BF.canvas.getObjects().find(o=>o.boardflowKind==='equation');
            const graph=window.BF.canvas.getObjects().find(o=>o.boardflowKind==='linked-graph');
            return {eq:eq.boardflowId,source:graph.boardflowPayload.equationId,latex:eq.boardflowPayload.latex};
        });
        assert.equal(links.eq,links.source);
        assert.equal(await page.evaluate(()=>{
            const eq=window.BF.canvas.getObjects().find(o=>o.boardflowKind==='equation').getBoundingRect();
            const graph=window.BF.canvas.getObjects().find(o=>o.boardflowKind==='linked-graph').getBoundingRect();
            return eq.left<graph.left+graph.width && eq.left+eq.width>graph.left && eq.top<graph.top+graph.height && eq.top+eq.height>graph.top;
        }),false);
        if(await page.locator('#menu').isVisible()) await page.locator('#btnMenu').click();
        await page.screenshot({path:path.resolve('MyScript/bin/smart-graph-test.png')});
        await ensureMenuOpen(page); await page.locator('#btnUndo').click();
        await page.waitForFunction(()=>window.BF.canvas.getObjects().some(o=>o.boardflowKind==='equation' && o.boardflowPayload.latex==='y=\\frac{6}{x}'));
        assert.equal(await page.evaluate(()=>window.BF.canvas.getObjects().filter(o=>o.boardflowKind==='linked-graph').length),1);
        await page.evaluate(()=>window.BF.canvas.fire('mouse:dblclick',{target:window.BF.canvas.getObjects().find(o=>o.boardflowKind==='equation')}));
        await page.locator('#smartEquationRewrite').click();
        const replacementSvg=await typesetEquation('y=x^{2}');
        await page.evaluate(svg=>{
            window.boardFlowDesktop.recognizeInk=async()=>({text:'y=x^2',latex:'y=x^{2}',svg,kind:'math',engine:'MyScript iink',status:'recognized'});
            const stroke=new window.BF.fabric.Path('M 800 310 L 850 400',{isSketch:true,stroke:'#ef4444',fill:''});
            window.BF.canvas.add(stroke);window.BF.canvas.fire('path:created',{path:stroke});
        },replacementSvg);
        await page.waitForFunction(()=>window.BF.canvas.getObjects().some(o=>o.boardflowKind==='equation' && o.boardflowPayload.latex==='y=x^{2}'));
        assert.equal(await page.evaluate(()=>window.BF.canvas.getObjects().filter(o=>o.boardflowKind==='equation').length),1);
        assert.equal(await page.evaluate(()=>window.BF.canvas.getObjects().find(o=>o.boardflowKind==='equation').boardflowId),links.eq);
        await ensureMenuOpen(page);await page.locator('#btnUndo').click();
        await page.waitForFunction(()=>window.BF.canvas.getObjects().some(o=>o.boardflowKind==='equation' && o.boardflowPayload.latex==='y=\\frac{6}{x}'));
    } finally {await context.close();}
});

test.skip('MyScript text conversion respects menu typography and Undo', {
    skip: process.env.BOARDFLOW_TEST_MYSCRIPT !== '1'
}, async () => {
    const { context, page } = await openApp();
    try {
        const { recognizeText } = require('../scripts/myscript-bridge.cjs');
        await page.exposeFunction('nativeTextForTest', details => {
            assert.equal(details.mode, 'writing');
            return recognizeText(details.strokes, path.resolve(__dirname, '..'));
        });
        await ensureMenuOpen(page);
        await page.locator('#fontFamilySel').selectOption('Arial, sans-serif');
        await page.locator('#fontSizeSel').fill('18');
        await page.locator('#fontSizeSel').dispatchEvent('change');
        await page.evaluate(() => {
            window.boardFlowDesktop = { recognizeInk: window.nativeTextForTest };
            for (const commands of ['M 120 310 L 120 400', 'M 120 355 L 170 355', 'M 170 310 L 170 400']) {
                window.BF.canvas.add(new window.BF.fabric.Path(commands, { stroke: '#ef4444', fill: '', isSketch: true }));
            }
        });
        await page.locator('#btnInkRecognition').click();
        await page.waitForFunction(() => window.BF.canvas.getObjects().some(o => o.text === 'H' && o.boardflowKind === 'recognized-text'));
        const text = await page.evaluate(() => {
            const o = window.BF.canvas.getObjects().find(o => o.boardflowKind === 'recognized-text');
            return { font: o.fontFamily, size: o.fontSize, color: o.fill, editable: o.editable };
        });
        assert.deepEqual(text, { font: 'Arial, sans-serif', size: 18, color: '#ef4444', editable: true });
        assert.equal(await page.locator('#equationDialog').isVisible(), false);
        await ensureMenuOpen(page);
        await page.locator('#btnUndo').click();
        await page.waitForFunction(() => !window.BF.canvas.getObjects().some(o => o.boardflowKind === 'recognized-text'));
        assert.equal(await page.evaluate(() => window.BF.canvas.getObjects().filter(o => o.isSketch).length), 3);
    } finally { await context.close(); }
});

test.skip('Windows handwritten letter converts to text through the real native engine', {
    skip: process.platform !== 'win32' || !fs.existsSync('C:/Program Files/Common Files/Microsoft Shared/Ink/Microsoft.Ink.dll')
}, async () => {
    const {context, page} = await openApp();
    try {
        await page.exposeFunction('nativeInkForTest', details => JSON.parse(execFileSync('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts/recognize-ink.ps1')
        ], {input:JSON.stringify(details),encoding:'utf8',windowsHide:true,timeout:20000}).trim()));
        await page.evaluate(() => {
            window.boardFlowDesktop = {recognizeInk: window.nativeInkForTest};
            for (const commands of ['M 120 110 L 120 200', 'M 120 155 L 170 155', 'M 170 110 L 170 200']) {
                window.BF.canvas.add(new window.BF.fabric.Path(commands, {stroke:'#ef4444',fill:'',isSketch:true}));
            }
        });
        await page.locator('#btnInkRecognition').click();
        await page.waitForFunction(() => window.BF.canvas.getObjects().some(o => o.text === 'H' && o.boardflowKind === 'recognized-text'));
        assert.equal(await page.evaluate(() => window.BF.canvas.getObjects().some(o => o.isSketch)), false);
        assert.equal(await page.locator('#equationDialog').isVisible(), false);
    } finally {await context.close();}
});

test.skip('recognition notices remain clear of the bottom toolbar and above menus', async () => {
    const {context,page} = await openApp();
    try {
        const button = await page.locator('#btnMenu').boundingBox();
        await page.mouse.move(button.x+10,button.y+10);
        await page.mouse.down();await page.mouse.move(640,680,{steps:8});await page.mouse.up();
        await page.locator('#btnInkRecognition').click();
        await ensureMenuOpen(page);
        const boxes = await page.evaluate(() => {
            const status=document.querySelector('#appStatus'), hud=document.querySelector('#hud'), menu=document.querySelector('#menu');
            return {status:status.getBoundingClientRect().toJSON(),hud:hud.getBoundingClientRect().toJSON(),
                statusZ:Number(getComputedStyle(status).zIndex),menuZ:Number(getComputedStyle(menu).zIndex)};
        });
        assert.ok(boxes.status.bottom < boxes.hud.top);
        assert.ok(boxes.statusZ > boxes.menuZ);
        await page.screenshot({path:path.join(os.tmpdir(),'boardflow-status-clear.png')});
    } finally {await context.close();}
});

test.skip('recognized text fits visible screen edges under pan and zoom and aligns with a displayed file', async () => {
    const {context,page} = await openApp();
    try {
        for (const withFile of [false,true]) {
            if (withFile) {
                await page.locator('#fileInput').setInputFiles(fixturePath);
                await page.waitForFunction(()=>window.BF.canvas.getObjects().some(o=>o.isFile));
            }
            await page.evaluate(() => {
                const {canvas,fabric}=window.BF;
                canvas.setViewportTransform([2,0,0,2,-300,-150]);
                const file=canvas.getObjects().find(o=>o.isFile);
                if(file){file.set({left:250,top:125,scaleX:2,scaleY:2});file.setCoords();}
                window.boardFlowDesktop={recognizeInk:async()=>({text:'Averylongword'.repeat(35),confidence:0.99})};
                canvas.add(new fabric.Path('M 500 200 L 520 220 L 530 200',{isSketch:true,stroke:'#ef4444',fill:''}));
            });
            await page.locator('#btnInkRecognition').click();
            await page.waitForFunction(()=>window.BF.canvas.getObjects().some(o=>o.boardflowKind==='recognized-text'));
            const position=await page.evaluate(()=>{
                const {canvas,fabric}=window.BF;
                const obj=canvas.getObjects().find(o=>o.boardflowKind==='recognized-text');
                const corners=obj.getCoords().map(p=>fabric.util.transformPoint(p,canvas.viewportTransform));
                const file=canvas.getObjects().find(o=>o.isFile);
                const fileRight=file?Math.max(...file.getCoords().map(p=>fabric.util.transformPoint(p,canvas.viewportTransform).x)):null;
                return {left:Math.min(...corners.map(p=>p.x)),right:Math.max(...corners.map(p=>p.x)),width:canvas.getWidth(),fileRight};
            });
            assert.ok(Math.abs(position.left-(withFile?position.fileRight+24:24))<3,JSON.stringify(position));
            assert.ok(position.right<=position.width-20,JSON.stringify(position));
            await page.locator('#btnInkRecognition').click();
        }
    } finally {await context.close();}
});

test('subjects are sorted and edit mode exposes compact delete controls', async () => {
    const { context, page } = await openApp();
    await ensureMenuOpen(page);
    await page.locator('#btnSubjects').click();
    assert.deepEqual(await page.locator('.subj-name').allTextContents(), ['Alpha', 'Beta']);
    await page.locator('.subj-edit-toggle').click();
    assert.equal(await page.locator('.subj-delete').count(), 2);
    assert.equal(await page.locator('.subj-delete').first().textContent(), '×');
    assert.equal(await page.locator('#btnSaveLesson').count(), 0);
    await context.close();
});

test('classroom modes, layers, Ink Free, and presentation-safe mode are connected', async () => {
    const { context, page } = await openApp();
    await ensureMenuOpen(page);
    assert.equal(await page.locator('#fontFamilySel option').filter({ hasText: 'Ink Free' }).count(), 1);
    await openClassroomStudioForTest(page);
    await page.locator('#studioMode').selectOption('student');
    assert.equal(await page.locator('body').evaluate(element => element.classList.contains('student-mode')), true);
    assert.equal(await page.locator('#layerSelect').inputValue(), 'student');
    await page.evaluate(() => window.BF.insertEquation('x + 1 = 3'));
    assert.equal(await page.evaluate(() => window.BF.canvas.getActiveObject().boardflowLayer), 'student');
    await page.locator('#btnPresentation').click();
    assert.equal(await page.locator('body').evaluate(element => element.classList.contains('presentation-safe')), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('body').evaluate(element => element.classList.contains('presentation-safe')), false);
    await context.close();
});

test('teacher controls are removed and the quick toolbar follows its requested order', async () => {
    const { context, page } = await openApp();
    assert.equal(await page.locator('#btnPenQuick').isVisible(), true);
    assert.equal(await page.locator('#pager').isVisible(), false);
    if (!await page.locator('#menu').evaluate(element => element.classList.contains('hidden'))) await page.locator('#btnMenu').click();
    const hudOrder = await page.locator('#hud > button').evaluateAll(elements => elements.map(element => element.id));
    assert.deepEqual(hudOrder.slice(0, 7), [
        'btnMenu', 'btnPenQuick', 'btnUndoQuick', 'btnEraserInk',
        'btnEraserAll', 'btnClearQuick', 'btnAutoShapes'
    ]);
    assert.equal(await page.locator('#classroomRail').evaluate(element => element.classList.contains('hidden')), true);
    assert.equal(await page.locator('#btnVirtualKeyboard').count(), 0);
    const toolbarIcons = await page.evaluate(() => {
        document.querySelector('#viewChip').style.display = 'flex';
        document.querySelector('#pager').style.display = 'flex';
        const ids = ['btnPenQuick', 'btnUndoQuick', 'btnEraserInk', 'btnEraserAll', 'btnClearQuick', 'btnAutoShapes', 'btnHome'];
        return ids.map(id => {
            const button = document.getElementById(id);
            const { width, height } = button.getBoundingClientRect();
            const style = getComputedStyle(button);
            return {
                id, width, height, font: style.fontFamily, color: style.color,
                background: style.backgroundColor, border: style.borderColor
            };
        });
    });
    assert.ok(toolbarIcons.every(({ width, height }) =>
        Math.abs(width - toolbarIcons[0].width) < 0.1 &&
        Math.abs(height - toolbarIcons[0].height) < 0.1
    ), JSON.stringify(toolbarIcons));
    assert.equal(toolbarIcons[0].font, toolbarIcons[4].font);
    assert.equal(toolbarIcons[0].color, toolbarIcons[4].color);
    assert.ok(toolbarIcons.every(({ width, height }) =>
        Math.abs(width - 28.8) < 0.1 && Math.abs(height - 28.8) < 0.1
    ), JSON.stringify(toolbarIcons));
    assert.ok(toolbarIcons.every(({ color, background, border }) =>
        color === 'rgb(185, 255, 102)' &&
        background === 'rgba(0, 0, 0, 0)' &&
        border === 'rgba(0, 0, 0, 0)'
    ), JSON.stringify(toolbarIcons));
    const pageControls = await page.evaluate(() =>
        ['btnPrev', 'btnNext', 'btnHome'].map(id => {
            const button = document.getElementById(id);
            const { width, height } = button.getBoundingClientRect();
            const style = getComputedStyle(button);
            return { id, width, height, color: style.color, background: style.backgroundColor, border: style.borderColor };
        })
    );
    assert.ok(pageControls.every(({ width, height }) =>
        Math.abs(width - 28.8) < 0.1 && Math.abs(height - 28.8) < 0.1
    ), JSON.stringify(pageControls));
    assert.ok(pageControls.every(({ color, background, border }) =>
        color === 'rgb(185, 255, 102)' &&
        background === 'rgba(0, 0, 0, 0)' &&
        border === 'rgba(0, 0, 0, 0)'
    ), JSON.stringify(pageControls));
    const hudStyle = await page.locator('#hud').evaluate(element => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, border: style.borderColor, shadow: style.boxShadow };
    });
    assert.deepEqual(hudStyle, {
        background: 'rgba(0, 0, 0, 0)',
        border: 'rgba(0, 0, 0, 0)',
        shadow: 'none'
    });
    await page.locator('#btnMenu').click();
    await page.locator('#btnPen').click();
    assert.equal(await page.locator('#btnPen').evaluate(button => button.classList.contains('menu-item-wiggle')), true);
    assert.equal(await page.locator('#saveStatus').getAttribute('role'), 'status');
    assert.equal(await page.locator('#dlgSave').textContent(), 'Export PNG');
    await context.close();
});

test('PWA manifest is installable and the board shell reloads offline', async () => {
    const { context, page, pageErrors } = await openApp();
    try {
        const manifestLink = await page.locator('link[rel="manifest"]').getAttribute('href');
        const manifestResponse = await page.request.get(new URL(manifestLink, page.url()).href);
        assert.equal(manifestResponse.status(), 200);
        const manifest = await manifestResponse.json();
        assert.equal(manifest.name, 'BoardFlow');
        assert.equal(manifest.display, 'standalone');
        assert.deepEqual(manifest.icons.map(icon => icon.sizes), ['192x192', '512x512']);

        const worker = await page.evaluate(async () => {
            const registration = await navigator.serviceWorker.ready;
            return { scope: registration.scope, script: registration.active?.scriptURL };
        });
        assert.match(worker.script, /service-worker\.js$/);
        assert.ok(worker.scope.endsWith('/'), worker.scope);

        await context.setOffline(true);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForFunction(() => Boolean(window.BF?.isReady), null, { timeout: 10000 });
        assert.equal(await page.title(), 'BoardFlow');
        assert.deepEqual(pageErrors.map(error => error.message), []);
    } finally {
        await context.setOffline(false);
        await context.close();
    }
});

test('equation scanning controls and engine status are removed from the interface', async () => {
    const { context, page } = await openApp();
    assert.equal(await page.locator('#btnRecognizeEquation').count(), 0);
    assert.equal(await page.locator('#btnEquationRecognition').count(), 0);
    assert.equal(await page.locator('#recognitionEngineStatus').count(), 0);
    await context.close();
});

test('lesson templates create a fresh recoverable page and manual versions are listed', async () => {
    const { context, page } = await openApp();
    await ensureMenuOpen(page);
    await openClassroomStudioForTest(page);
    await page.locator('[data-classroom-tab="lesson"]').click();
    await page.locator('[data-template="coordinate"]').click();
    await page.waitForFunction(() => document.querySelector('#bpageLabel')?.textContent === '2 / 2');
    assert.equal(await page.evaluate(() => window.BF.canvas.getObjects().filter(object => object.boardflowLayer === 'lesson').length >= 2), true);
    await page.locator('#btnSaveVersion').click();
    await page.waitForFunction(() => document.querySelectorAll('.version-item').length > 0);
    assert.equal(await page.locator('.version-item').count() > 0, true);
    await context.close();
});

test('subject names are editable and the first subject creates an automatic workspace file', async () => {
    const { context, page } = await openApp();
    await page.evaluate(() => {
        window.__workspaceCalls = [];
        window.boardFlowDesktop = {
            getWorkspace: async () => null,
            chooseWorkspace: async () => 'C:\\BoardFlow Workspace',
            createSubjectWorkspace: async details => {
                window.__workspaceCalls.push(details);
                return { folderName: details.folderName, lessonPath: `C:\\BoardFlow Workspace\\${details.folderName}\\${details.folderName}.boardview` };
            },
            writeSubjectFile: async () => null
        };
    });
    await ensureMenuOpen(page);
    await page.locator('#btnSubjects').click();
    await page.locator('.subj-edit-toggle').click();
    await page.locator('#subjName').fill('Physics');
    await page.locator('#subjPwd').fill('secret');
    assert.equal(await page.locator('#subjName').inputValue(), 'Physics');
    assert.equal(await page.locator('#menu').evaluate(element => element.classList.contains('hidden')), true);
    await page.locator('#subjCreate').click();
    await page.locator('.subj-name', { hasText: 'Physics' }).waitFor();

    const result = await page.evaluate(() => ({
        calls: window.__workspaceCalls,
        subject: JSON.parse(localStorage.getItem('boardflow-subjects')).find(entry => entry.name === 'Physics')
    }));
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].folderName, 'Physics');
    assert.equal(JSON.parse(result.calls[0].content).subjectName, 'Physics');
    assert.ok(result.subject.deletePinHash);
    assert.notEqual(result.subject.deletePinHash, 'secret');
    await context.close();
});

test('web subject creation stores its lesson file without a directory handle', async () => {
    const { context, page } = await openApp();
    await ensureMenuOpen(page);
    await page.locator('#btnSubjects').click();
    await page.locator('.subj-edit-toggle').click();
    await page.locator('#subjName').fill('Browser Biology');
    await page.locator('#subjCreate').click();
    await page.locator('.subj-name', { hasText: 'Browser Biology' }).waitFor();

    const lesson = await page.evaluate(() => {
        const subject = JSON.parse(localStorage.getItem('boardflow-subjects'))
            .find(entry => entry.name === 'Browser Biology');
        return {
            status: document.querySelector('#subjFolderStatus').textContent,
            lesson: JSON.parse(localStorage.getItem(`boardflow-subject-lesson:${subject.id}`))
        };
    });
    assert.equal(lesson.lesson.subjectName, 'Browser Biology');
    assert.equal(lesson.lesson.subjectId.startsWith('subject-'), true);
    assert.match(lesson.status, /Created Browser Biology\/Browser Biology\.boardview/);
    await context.close();
});

test('Capacitor subject creation uses local device storage when folder picking is unavailable', async () => {
    const { context, page } = await openApp(() => { window.Capacitor = {}; });
    await ensureMenuOpen(page);
    await page.locator('#btnSubjects').click();
    await page.locator('.subj-edit-toggle').click();
    await page.locator('#subjName').fill('Device Biology');
    await page.locator('#subjCreate').click();
    await page.locator('.subj-name', { hasText: 'Device Biology' }).waitFor();
    const result = await page.evaluate(() => {
        const subject = JSON.parse(localStorage.getItem('boardflow-subjects'))
            .find(entry => entry.name === 'Device Biology');
        return {
            status: document.querySelector('#subjFolderStatus').textContent,
            saved: Boolean(localStorage.getItem(`boardflow-subject-lesson:${subject.id}`))
        };
    });
    assert.match(result.status, /Created Device Biology/);
    assert.equal(result.saved, true);
    await context.close();
});

test('subject deletion requires confirmation', async () => {
    const { context, page } = await openApp();
    await ensureMenuOpen(page);
    await page.locator('#btnSubjects').click();
    await page.locator('.subj-edit-toggle').click();
    await page.locator('.subj-delete').first().click();
    await page.locator('#subjectDeleteDialog').waitFor({ state: 'visible' });
    await page.locator('#subjectDeleteCancel').click();
    assert.equal(await page.locator('.subj-name').count(), 2);
    await page.locator('.subj-delete').first().click();
    await page.locator('#subjectDeleteConfirm').click();
    assert.equal(await page.locator('.subj-name').count(), 1);
    await context.close();
});

test('subject deletion PIN rejects an incorrect value and accepts the correct value', async () => {
    const { context, page } = await openApp();
    await page.evaluate(() => {
        localStorage.setItem('boardflow-subjects', JSON.stringify([{
            id: 'locked',
            name: 'Locked',
            folderName: 'Test',
            color: '#8e44ad',
            deletePinHash: '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4'
        }]));
    });
    await page.reload();
    await page.waitForFunction(() => Boolean(window.BF?.isReady));
    await ensureMenuOpen(page);
    await page.locator('#btnSubjects').click();
    await page.locator('.subj-edit-toggle').click();

    await page.locator('.subj-delete').click();
    await page.locator('#subjectDeletePassword').fill('wrong');
    await page.locator('#subjectDeleteConfirm').click();
    await page.locator('#subjectDeleteError').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.subj-name').count(), 1);

    await page.locator('#subjectDeletePassword').fill('1234');
    await page.locator('#subjectDeleteConfirm').click();
    await page.waitForFunction(() => document.querySelectorAll('.subj-name').length === 0);
    assert.equal(await page.locator('.subj-name').count(), 0);
    await context.close();
});

test('subject editor remains inside a phone-sized viewport', async () => {
    const { context, page } = await openApp();
    await page.setViewportSize({ width: 390, height: 844 });
    await ensureMenuOpen(page);
    await page.locator('#btnSubjects').click();
    await page.locator('.subj-edit-toggle').click();

    const formBounds = await page.locator('#subjForm').boundingBox();
    assert.ok(formBounds);
    assert.ok(formBounds.x >= 0);
    assert.ok(formBounds.x + formBounds.width <= 390);

    await context.close();
});

test('pen drawing and the lazy mathematics bundle add board objects without runtime errors', async () => {
    const { consoleErrors, context, page, pageErrors } = await openApp();
    if (!await page.locator('#menu').evaluate(element => element.classList.contains('hidden'))) {
        await page.locator('#btnMenu').click();
    }
    const board = page.locator('.upper-canvas');
    const bounds = await board.boundingBox();
    assert.ok(bounds);

    await page.mouse.move(bounds.x + 80, bounds.y + 100);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 180, bounds.y + 160, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(() => window.BF.canvas.getObjects().some(object => object.isSketch));

    const beforeMathInsert = await page.evaluate(() => window.BF.canvas.getObjects().length);
    await page.waitForFunction(() => document.querySelector('#mathPanel')?.dataset.ready === 'true');
    await ensureMenuOpen(page);
    await page.locator('#btnMath').click();
    const layers = await page.evaluate(() => ({
        math: Number(getComputedStyle(document.querySelector('#mathPanel')).zIndex),
        menu: Number(getComputedStyle(document.querySelector('#menu')).zIndex)
    }));
    assert.ok(layers.menu > layers.math);
    await page.locator('#gInsert').click();
    await page.waitForFunction(expected => window.BF.canvas.getObjects().length > expected, beforeMathInsert);

    assert.deepEqual(pageErrors.map(error => error.message), []);
    assert.deepEqual(consoleErrors, []);
    await context.close();
});

test('shape outlines keep a constant thickness when resized', async () => {
    const { context, page } = await openApp();
    await ensureMenuOpen(page);
    await page.locator('#shapeSquare').click();

    const result = await page.evaluate(() => {
        const shape = window.BF.canvas.getActiveObject();
        const originalWidth = shape.strokeWidth;
        shape.scaleX = 2.75;
        shape.scaleY = 1.8;
        shape.setCoords();
        window.BF.canvas.fire('object:modified', { target: shape });
        return {
            originalWidth,
            resizedWidth: shape.strokeWidth,
            scaleX: shape.scaleX,
            strokeUniform: shape.strokeUniform
        };
    });

    assert.equal(result.strokeUniform, true);
    assert.equal(result.resizedWidth, result.originalWidth);
    assert.equal(result.scaleX, 2.75);
    await context.close();
});

test('grid toggle renders a repeating canvas pattern', async () => {
    const { context, page } = await openApp();
    assert.equal(await page.locator('#btnTheme').evaluate(button => button.classList.contains('active')), true);
    assert.equal(await page.locator('#btnGrid').evaluate(button => button.classList.contains('active')), true);
    assert.deepEqual(await page.evaluate(() => ({
        theme: localStorage.getItem('bv-theme'),
        grid: localStorage.getItem('bv-grid')
    })), { theme: 'dark', grid: '1' });
    await ensureMenuOpen(page);
    await page.locator('#btnGrid').click();
    await page.locator('#btnGrid').click();

    const grid = await page.evaluate(() => ({
        active: document.querySelector('#btnGrid').classList.contains('active'),
        hasLegacyImage: Boolean(window.BF.canvas.backgroundImage),
        isPattern: window.BF.canvas.backgroundColor instanceof window.BF.fabric.Pattern,
        patternSize: [
            window.BF.canvas.backgroundColor?.source?.width,
            window.BF.canvas.backgroundColor?.source?.height
        ]
    }));
    assert.deepEqual(grid, {
        active: true,
        hasLegacyImage: false,
        isPattern: true,
        patternSize: [20, 20]
    });
    const board = page.locator('.upper-canvas');
    const bounds = await board.boundingBox();
    await page.mouse.move(bounds.x + 300, bounds.y + 250);
    await page.mouse.wheel(0, -500);
    const zoomGrid = await page.evaluate(() => ({
        zoom: window.BF.canvas.getZoom(),
        sourceSize: window.BF.canvas.backgroundColor.source.width,
        lineWidth: window.BF.canvas.boardflowGridLineWidth,
        patternScale: window.BF.canvas.backgroundColor.patternTransform[0]
    }));
    assert.ok(zoomGrid.zoom > 1);
    assert.equal(zoomGrid.sourceSize, 20);
    assert.equal(zoomGrid.lineWidth, 1.5);
    assert.ok(Math.abs(zoomGrid.patternScale * zoomGrid.zoom - 1) < 0.001, JSON.stringify(zoomGrid));
    assert.ok(Math.abs(zoomGrid.sourceSize * zoomGrid.patternScale * zoomGrid.zoom - 20) < 0.001, JSON.stringify(zoomGrid));
    await context.close();
});

test('dark grid becomes the default for legacy preferences without replacing custom themes', async () => {
    const legacy = await openApp(() => {
        localStorage.setItem('bv-theme', 'light');
        localStorage.setItem('bv-grid', '0');
    });
    try {
        assert.deepEqual(await legacy.page.evaluate(() => ({
            theme: localStorage.getItem('bv-theme'),
            grid: localStorage.getItem('bv-grid')
        })), { theme: 'dark', grid: '1' });
    } finally {
        await legacy.context.close();
    }

    const customized = await openApp(() => {
        localStorage.setItem('bv-theme', 'light');
        localStorage.setItem('bv-grid', '1');
    });
    try {
        assert.deepEqual(await customized.page.evaluate(() => ({
            theme: localStorage.getItem('bv-theme'),
            grid: localStorage.getItem('bv-grid')
        })), { theme: 'light', grid: '1' });
    } finally {
        await customized.context.close();
    }
});

test('removed workspace and recognition controls stay out of the visible interface', async () => {
    const { context, page } = await openApp();
    try {
        assert.deepEqual(await page.evaluate(() =>
            [
                'btnClassroomRailToggle', 'btnInkRecognition', 'btnEquationRecognition',
                'btnRecognizeEquation', 'btnClassroom', 'recognitionEngineStatus'
            ]
                .filter(id => document.getElementById(id))
        ), []);
    } finally {
        await context.close();
    }
});

test('tapping canvas text on Android enters editing and focuses the native keyboard input', async () => {
    const { context, page, pageErrors } = await openApp(undefined, {
        isMobile: true,
        hasTouch: true,
        viewport: { width: 430, height: 900 },
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
    });
    try {
        await ensureMenuOpen(page);
        await page.locator('#btnSelect').click();
        const editingState = await page.evaluate(() => {
            const text = new window.BF.fabric.IText('Tap to edit', {
                left: 100,
                top: 100,
                fontSize: 32,
                fill: '#ffffff'
            });
            window.BF.canvas.add(text);
            window.BF.canvas.fire('mouse:down', { target: text, e: { pointerType: 'touch' } });
            return {
                type: window.BF.canvas.getActiveObject()?.type,
                isEditing: text.isEditing,
                textareaFocused: document.activeElement === text.hiddenTextarea
            };
        });
        assert.deepEqual(editingState, { type: 'i-text', isEditing: true, textareaFocused: true });
        assert.deepEqual(pageErrors, []);
    } finally {
        await context.close();
    }
});

test('uploaded files require deliberate activation before move or resize controls appear', async () => {
    const { context, page, pageErrors } = await openApp();
    try {
        await page.locator('#fileInput').setInputFiles(fixturePath);
        await page.waitForFunction(() => window.BF.canvas.getObjects().some(object => object.isFile));
        const initial = await page.evaluate(() => {
            const file = window.BF.canvas.getObjects().find(object => object.isFile);
            return { left: file.left, top: file.top, selectable: file.selectable };
        });
        assert.equal(initial.left, 0);
        assert.equal(initial.top, 0);
        assert.equal(initial.selectable, false);

        const point = await page.evaluate(() => {
            const bounds = document.querySelector('.upper-canvas').getBoundingClientRect();
            return { x: bounds.left + 30, y: bounds.top + 30 };
        });
        const pointer = async (type, pointerType = 'touch') => page.evaluate(({ x, y, type, pointerType }) => {
            const target = type === 'pointerup' ? window : document.querySelector('.upper-canvas');
            target.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType, pointerId: 1
            }));
        }, { ...point, type, pointerType });

        await pointer('pointerdown', 'mouse');
        await pointer('pointerup', 'mouse');
        assert.equal(await page.locator('#fileContextMenu').isVisible(), false);
        await pointer('pointerdown', 'mouse');
        await pointer('pointerup', 'mouse');
        await page.locator('#fileContextMenu').waitFor({ state: 'visible' });
        assert.equal(await page.evaluate(() => {
            const file = window.BF.canvas.getObjects().find(object => object.isFile);
            return file.selectable && file.hasControls && window.BF.canvas.getActiveObject() === file;
        }), true);
        assert.deepEqual(await page.locator('#fileContextMenu [role="menuitem"]').allTextContents(), ['Delete']);
        const resizeHandle = await page.evaluate(() => {
            const canvas = window.BF.canvas;
            const file = canvas.getObjects().find(object => object.isFile);
            const rect = canvas.upperCanvasEl.getBoundingClientRect();
            return { x: rect.left + file.oCoords.br.x, y: rect.top + file.oCoords.br.y };
        });
        await page.mouse.click(resizeHandle.x, resizeHandle.y);
        assert.equal(await page.evaluate(() => {
            const canvas = window.BF.canvas;
            const file = canvas.getObjects().find(object => object.isFile);
            return file.selectable && canvas.getActiveObject() === file;
        }), true);
        await page.locator('.upper-canvas').click({ position: { x: 500, y: 500 } });
        assert.equal(await page.evaluate(() => window.BF.canvas.getObjects().find(object => object.isFile).selectable), false);

        await pointer('pointerdown');
        await pointer('pointerup');
        await page.waitForTimeout(80);
        assert.equal(await page.locator('#fileContextMenu').isVisible(), false);
        assert.equal(await page.evaluate(() => {
            const file = window.BF.canvas.getObjects().find(object => object.isFile);
            return file.selectable || window.BF.canvas.getActiveObject() === file;
        }), false);

        await pointer('pointerdown');
        await page.waitForTimeout(700);
        await page.locator('#fileContextMenu').waitFor({ state: 'visible' });
        await pointer('pointerup');
        await page.locator('#fileContextMenu').getByRole('menuitem', { name: 'Delete' }).click();
        await page.waitForFunction(() => !window.BF.canvas.getObjects().some(object => object.isFile));
        assert.deepEqual(pageErrors, []);
    } finally {
        await context.close();
    }
});

test('erasers mask only touched content and keep uploaded files and shapes on the board', async () => {
    const { consoleErrors, context, page, pageErrors } = await openApp();
    await page.locator('#fileInput').setInputFiles(fixturePath);
    await page.waitForFunction(() => window.BF.canvas.getObjects().some(object => object.isFile));
    await ensureMenuOpen(page);
    await page.locator('#btnEraserAll').click();
    await page.mouse.move(44, 44);
    await page.mouse.down();
    await page.mouse.move(58, 44, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(50);
    const fileResult = await page.evaluate(() => {
        const file = window.BF.canvas.getObjects().find(object => object.isFile);
        const context = window.BF.canvas.lowerCanvasEl.getContext('2d');
        const retina = window.BF.canvas.getRetinaScaling();
        const pixelAt = (x, y) => Array.from(context.getImageData(Math.round(x * retina), Math.round(y * retina), 1, 1).data);
        return {
            exists: Boolean(file),
            paths: file?.boardflowErasePaths?.length || 0,
            points: file?.boardflowErasePaths?.[0]?.points?.length || 0,
            inverted: Boolean(file?.clipPath?.inverted),
            maskType: file?.clipPath?.type,
            erasedPixel: pixelAt(50, 44),
            untouchedPixel: pixelAt(70, 70)
        };
    });
    assert.equal(fileResult.exists, true);
    assert.equal(fileResult.paths, 1, JSON.stringify(fileResult));
    assert.ok(fileResult.points >= 2, JSON.stringify(fileResult));
    assert.equal(fileResult.inverted, true);
    assert.equal(fileResult.maskType, 'path');
    assert.ok(fileResult.erasedPixel[0] < 80, JSON.stringify(fileResult));
    assert.ok(fileResult.untouchedPixel[0] > 200, JSON.stringify(fileResult));

    await ensureMenuOpen(page);
    await page.locator('#shapeSquare').click();
    const shapeCenter = await page.evaluate(() => {
        const shape = window.BF.canvas.getActiveObject();
        const center = window.BF.fabric.util.transformPoint(shape.getCenterPoint(), window.BF.canvas.viewportTransform);
        return { x: center.x, y: center.y };
    });
    await ensureMenuOpen(page);
    await page.locator('#btnEraserInk').click();
    await page.mouse.move(shapeCenter.x - 65, shapeCenter.y);
    await page.mouse.down();
    await page.mouse.move(shapeCenter.x - 45, shapeCenter.y, { steps: 5 });
    await page.mouse.up();
    const shapeResult = await page.evaluate(() => {
        const shape = window.BF.canvas.getObjects().find(object => object.isShape);
        const file = window.BF.canvas.getObjects().find(object => object.isFile);
        return {
            shapeExists: Boolean(shape),
            shapePaths: shape?.boardflowErasePaths?.length || 0,
            filePaths: file?.boardflowErasePaths?.length || 0
        };
    });
    assert.equal(shapeResult.shapeExists, true);
    assert.equal(shapeResult.shapePaths, 1, JSON.stringify(shapeResult));
    assert.equal(shapeResult.filePaths, fileResult.paths);
    await page.waitForTimeout(700);
    await page.reload();
    await page.waitForFunction(() => Boolean(window.BF?.isReady));
    const restored = await page.evaluate(() => {
        const file = window.BF.canvas.getObjects().find(object => object.isFile);
        const context = window.BF.canvas.lowerCanvasEl.getContext('2d');
        const retina = window.BF.canvas.getRetinaScaling();
        const erasedPixel = Array.from(context.getImageData(Math.round(50 * retina), Math.round(44 * retina), 1, 1).data);
        return { fileExists: Boolean(file), paths: file?.boardflowErasePaths?.length || 0, erasedPixel };
    });
    assert.equal(restored.fileExists, true);
    assert.equal(restored.paths, fileResult.paths);
    assert.ok(restored.erasedPixel[0] < 80, JSON.stringify(restored));
    assert.deepEqual(pageErrors.map(error => error.message), []);
    assert.deepEqual(consoleErrors, []);
    await context.close();
});

test('Undo restores complete All Eraser and Ink Eraser gestures', async () => {
    const { context, page } = await openApp();
    await page.locator('#fileInput').setInputFiles(fixturePath);
    await page.waitForFunction(() => window.BF.canvas.getObjects().some(object => object.isFile));
    await ensureMenuOpen(page);
    await page.locator('#btnEraserAll').click();
    await page.mouse.move(42, 44);
    await page.mouse.down();
    await page.mouse.move(62, 44, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(() => window.BF.canvas.getObjects().find(object => object.isFile)?.boardflowErasePaths?.length === 1);
    await ensureMenuOpen(page);
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => !window.BF.canvas.getObjects().find(object => object.isFile)?.boardflowErasePaths?.length);
    await page.waitForTimeout(50);
    const restoredFilePixel = await page.evaluate(() => {
        const context = window.BF.canvas.lowerCanvasEl.getContext('2d');
        const retina = window.BF.canvas.getRetinaScaling();
        return Array.from(context.getImageData(Math.round(52 * retina), Math.round(44 * retina), 1, 1).data);
    });
    assert.ok(restoredFilePixel[1] < 80, JSON.stringify(restoredFilePixel));

    await ensureMenuOpen(page);
    await page.locator('#shapeSquare').click();
    const edge = await page.evaluate(() => {
        const shape = window.BF.canvas.getActiveObject();
        const center = window.BF.fabric.util.transformPoint(shape.getCenterPoint(), window.BF.canvas.viewportTransform);
        return { x: center.x - 65, y: center.y };
    });
    await ensureMenuOpen(page);
    await page.locator('#btnEraserInk').click();
    await page.mouse.move(edge.x, edge.y - 10);
    await page.mouse.down();
    await page.mouse.move(edge.x, edge.y + 10, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(() => window.BF.canvas.getObjects().find(object => object.isShape)?.boardflowErasePaths?.length === 1);
    await ensureMenuOpen(page);
    await page.locator('#btnUndo').click();
    await page.waitForTimeout(500);
    const restoredShape = await page.evaluate(() => {
        const shape = window.BF.canvas.getObjects().find(object => object.isShape);
        return { exists: Boolean(shape), paths: shape?.boardflowErasePaths?.length || 0 };
    });
    assert.deepEqual(restoredShape, { exists: true, paths: 0 });
    await context.close();
});

test('uploaded files stay locked until activated while Select can manipulate sketches', async () => {
    const { context, page } = await openApp();
    await page.locator('#fileInput').setInputFiles(fixturePath);
    await page.waitForFunction(() => window.BF.canvas.getObjects().some(object => object.isFile));
    let state = await page.evaluate(() => {
        const file = window.BF.canvas.getObjects().find(object => object.isFile);
        return { active: window.BF.canvas.getActiveObject() === file, selectable: file.selectable, selectTool: document.querySelector('#btnSelect').classList.contains('active') };
    });
    assert.deepEqual(state, { active: false, selectable: false, selectTool: false });
    await ensureMenuOpen(page);
    await page.locator('#btnPen').click();
    await page.locator('#menu').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.BF.canvas.getObjects().find(object => object.isFile).selectable), false);
    await page.mouse.move(220, 240);
    await page.mouse.down();
    await page.mouse.move(360, 300, { steps: 10 });
    await page.mouse.up();
    state = await page.evaluate(() => {
        const objects = window.BF.canvas.getObjects();
        return {
            fileSelectable: objects.find(object => object.isFile).selectable,
            sketchSelectable: objects.find(object => object.isSketch).selectable
        };
    });
    assert.deepEqual(state, { fileSelectable: false, sketchSelectable: false });
    await ensureMenuOpen(page);
    await page.locator('#btnSelect').click();
    state = await page.evaluate(() => {
        const objects = window.BF.canvas.getObjects();
        return {
            fileSelectable: objects.find(object => object.isFile).selectable,
            sketchSelectable: objects.find(object => object.isSketch).selectable
        };
    });
    assert.deepEqual(state, { fileSelectable: false, sketchSelectable: true });
    await page.locator('.upper-canvas').click({ button: 'right', position: { x: 30, y: 30 } });
    await page.locator('#fileContextMenu').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => {
        const canvas = window.BF.canvas;
        const file = canvas.getObjects().find(object => object.isFile);
        return file.selectable && canvas.getActiveObject() === file;
    }), true);
    await context.close();
});

test('the subject list closes after selection or touching outside it', async () => {
    const { context, page } = await openApp();
    await ensureMenuOpen(page);
    await page.locator('#btnSubjects').click();
    await page.locator('.subj-item').first().click();
    assert.equal(await page.locator('#subjPanel').evaluate(element => element.classList.contains('hidden')), true);
    await ensureMenuOpen(page);
    await page.locator('#btnSubjects').click();
    await page.mouse.click(120, 180);
    assert.equal(await page.locator('#subjPanel').evaluate(element => element.classList.contains('hidden')), true);
    await context.close();
});

test('board pages can be added and deleted', async () => {
    const { context, page } = await openApp();
    await ensureMenuOpen(page);
    await page.locator('#btnNewPage').click();
    await page.locator('#bpager').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#bpageLabel').textContent(), '2 / 2');
    assert.equal(await page.locator('#btnBDelete').isEnabled(), true);
    await page.locator('#btnBDelete').click();
    await page.waitForFunction(() => document.querySelector('#bpageLabel').textContent === '1 / 1');
    assert.equal(await page.locator('#bpager').isVisible(), false);
    await context.close();
});

test('countdown timer opens, counts, pauses, and resets', async () => {
    const { context, page } = await openApp();
    await ensureMenuOpen(page);
    await page.locator('#btnTimer').click();
    await page.locator('#timerWidget').waitFor({ state: 'visible' });
    await page.locator('#tPlus1').click();
    assert.equal(await page.locator('#timerText').textContent(), '01:00');
    await page.locator('#tStart').click();
    await page.waitForFunction(() => document.querySelector('#timerText').textContent === '00:59', null, { timeout: 2500 });
    await page.locator('#tStart').click();
    assert.equal(await page.locator('#timerWidget').evaluate(element => element.classList.contains('running')), false);
    await page.locator('#tReset').click();
    assert.equal(await page.locator('#timerText').textContent(), '00:00');
    await context.close();
});

test('pen and text controls include fine widths and 8–36 text sizes', async () => {
    const { context, page } = await openApp();
    const controls = await page.evaluate(() => ({
        penMin: document.querySelector('#inkSize').min,
        penStep: document.querySelector('#inkSize').step,
        textMin: document.querySelector('#fontSizeSel').min,
        textMax: document.querySelector('#fontSizeSel').max
    }));
    assert.deepEqual(controls, { penMin: '0.25', penStep: '0.25', textMin: '8', textMax: '36' });
    await context.close();
});

test('shape color is independent, remembered, and applied to inserted shapes', async () => {
    const { context, page } = await openApp();
    await ensureMenuOpen(page);
    await page.locator('#shapeColor').fill('#12a06a');
    await page.locator('#shapeSquare').click();
    assert.equal(await page.evaluate(() => window.BF.canvas.getActiveObject().stroke), '#12a06a');
    assert.equal(await page.locator('#inkColor').inputValue(), '#ff3333');
    await page.reload();
    await page.waitForFunction(() => Boolean(window.BF?.isReady));
    assert.equal(await page.locator('#shapeColor').inputValue(), '#12a06a');
    await context.close();
});

test('Auto shapes converts a hand-drawn straight stroke into an inserted line', async () => {
    const { context, page } = await openApp();
    if (!await page.locator('#menu').evaluate(element => element.classList.contains('hidden'))) await page.locator('#btnMenu').click();
    await page.locator('#btnAutoShapes').click();
    assert.equal(await page.locator('#btnAutoShapes').getAttribute('aria-pressed'), 'true');
    await page.mouse.move(260, 300);
    await page.mouse.down();
    await page.mouse.move(470, 302, { steps: 18 });
    await page.mouse.up();
    await page.waitForFunction(() => window.BF.canvas.getObjects().some(object => object.boardflowKind === 'recognized-line'));
    const recognizedShape = await page.evaluate(() => {
        const line = window.BF.canvas.getObjects().find(object => object.boardflowKind === 'recognized-line');
        const lines = window.BF.canvas.getObjects().filter(object => object.boardflowKind === 'recognized-line');
        const bounds = line.getBoundingRect();
        return {
            recognizedLineCount: lines.length,
            rawInkRemoved: !window.BF.canvas.getObjects().some(object => object.type === 'path' && object.isSketch),
            stroke: line.stroke,
            bounds: { left: bounds.left, top: bounds.top, width: bounds.width }
        };
    });
    assert.equal(recognizedShape.recognizedLineCount, 1);
    assert.equal(recognizedShape.rawInkRemoved, true);
    assert.equal(recognizedShape.stroke, '#ff3333');
    assert.ok(Math.abs(recognizedShape.bounds.left - 260) < 20);
    assert.ok(Math.abs(recognizedShape.bounds.top - 300) < 20);
    assert.ok(Math.abs(recognizedShape.bounds.width - 210) < 30);
    await context.close();
});

test('hand-drawn shapes remain ink while Auto Shapes is off', async () => {
    const { context, page } = await openApp();
    await page.mouse.move(260, 300);
    await page.mouse.down();
    await page.mouse.move(470, 302, { steps: 18 });
    await page.mouse.up();
    await page.waitForFunction(() => window.BF.canvas.getObjects().some(object => object.type === 'path'));
    assert.deepEqual(await page.evaluate(() => ({
        mode: window.currentRecognitionMode,
        paths: window.BF.canvas.getObjects().filter(object => object.type === 'path').length,
        recognized: window.BF.canvas.getObjects().filter(object => object.boardflowKind?.startsWith('recognized-')).length
    })), { mode: 'off', paths: 1, recognized: 0 });
    await context.close();
});

test('Auto Shapes recognizes zigzags and waves without changing ink color', async () => {
    const { context, page } = await openApp();
    await ensureMenuOpen(page);
    await page.locator('#inkColor').fill('#d12b55');
    await page.locator('#shapeColor').fill('#315ee8');
    await page.locator('#btnMenu').click();
    await page.locator('#btnAutoShapes').click();
    const draw = async points => {
        await page.mouse.move(points[0][0], points[0][1]);
        await page.mouse.down();
        for (const point of points.slice(1)) await page.mouse.move(point[0], point[1], { steps: 2 });
        await page.mouse.up();
    };
    await draw([[180, 270], [225, 215], [270, 270], [315, 215], [360, 270], [405, 215]]);
    await page.waitForFunction(() => window.BF.canvas.getObjects().some(object => object.boardflowKind === 'recognized-zigzag'));
    const wave = Array.from({ length: 41 }, (_, index) => [520 + index * 6, 300 + Math.sin(index / 40 * Math.PI * 6) * 34]);
    await draw(wave);
    await page.waitForFunction(() => window.BF.canvas.getObjects().some(object => object.boardflowKind === 'recognized-wave'));
    assert.deepEqual(await page.evaluate(() => window.BF.canvas.getObjects()
        .filter(object => ['recognized-zigzag', 'recognized-wave'].includes(object.boardflowKind))
        .map(object => ({ kind: object.boardflowKind, stroke: object.stroke, type: object.type }))), [
        { kind: 'recognized-zigzag', stroke: '#d12b55', type: 'polyline' },
        { kind: 'recognized-wave', stroke: '#d12b55', type: 'polyline' }
    ]);
    await context.close();
});

test('Auto Shapes snaps a reasonably round hand sketch to a true circle', async () => {
    const { context, page } = await openApp();
    if (await page.locator('#menu').isVisible()) await page.locator('#btnMenu').click();
    await page.locator('#btnAutoShapes').click();
    const points = [
        [560, 250], [596, 257], [622, 280], [630, 315], [616, 347], [588, 365],
        [552, 369], [517, 354], [494, 328], [489, 296], [505, 269], [529, 253], [560, 250]
    ];
    await page.mouse.move(points[0][0], points[0][1]);
    await page.mouse.down();
    for (const point of points.slice(1)) await page.mouse.move(point[0], point[1], { steps: 3 });
    await page.mouse.up();
    await page.waitForFunction(() => window.BF.canvas.getObjects().some(object => object.boardflowKind === 'recognized-circle'));
    assert.deepEqual(await page.evaluate(() => {
        const circle = window.BF.canvas.getObjects().find(object => object.boardflowKind === 'recognized-circle');
        return { type: circle.type, round: Math.abs(circle.getScaledWidth() - circle.getScaledHeight()) < 0.01 };
    }), { type: 'circle', round: true });
    await context.close();
});

test('a completed arrow stays fixed and can still be undone', async () => {
    const { context, page } = await openApp();
    await ensureMenuOpen(page);
    await page.locator('#btnArrow').click();
    await page.mouse.move(260, 300);
    await page.mouse.down();
    await page.mouse.move(430, 360, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const result = await page.evaluate(() => {
        const arrow = window.BF.canvas.getObjects().find(object => object.isArrow);
        return {
            active: Boolean(window.BF.canvas.getActiveObject()),
            isArrow: Boolean(arrow?.isArrow),
            selectable: arrow?.selectable,
            evented: arrow?.evented,
            penToolActive: document.querySelector('#btnPen').classList.contains('active')
        };
    });
    assert.deepEqual(result, { active: false, isArrow: true, selectable: false, evented: false, penToolActive: true });
    await ensureMenuOpen(page);
    await page.locator('#btnSelect').click();
    assert.deepEqual(await page.evaluate(() => {
        const arrow = window.BF.canvas.getObjects().find(object => object.isArrow);
        return { selectable: arrow.selectable, evented: arrow.evented };
    }), { selectable: false, evented: false });
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => !window.BF.canvas.getObjects().some(object => object.isArrow));
    await context.close();
});

test('crossing auto-straightened lines reveal the angle lesson and arrows do not', async () => {
    const { context, page } = await openApp();
    await page.evaluate(() => {
        const { canvas, fabric } = window.BF;
        const arrow = new fabric.Polygon([{ x: 0, y: 0 }, { x: 120, y: 40 }, { x: 0, y: 80 }], { fill: '#333' });
        arrow.isArrow = true;
        canvas.add(arrow);
        canvas.requestRenderAll();
    });
    assert.equal(await page.locator('#btnAngles').evaluate(element => element.classList.contains('hidden')), true);
    await page.evaluate(() => {
        const { canvas, fabric } = window.BF;
        const first = new fabric.Line([180, 180, 420, 360], { stroke: '#315ee8', strokeWidth: 2 });
        const second = new fabric.Line([180, 360, 420, 180], { stroke: '#315ee8', strokeWidth: 2 });
        first.boardflowKind = 'recognized-line';
        second.boardflowKind = 'recognized-line';
        first.isShape = true;
        second.isShape = true;
        canvas.add(first, second);
        canvas.requestRenderAll();
    });
    await page.waitForFunction(() => !document.querySelector('#btnAngles').classList.contains('hidden'));
    await page.locator('#btnAngles').click();
    await page.waitForFunction(() => window.BF.canvas.contextContainer && document.querySelector('#btnAngles').classList.contains('active'));
    assert.equal(await page.locator('#btnAngles').getAttribute('title'), 'Show angles for lines and shapes');
    const markerPoints = await page.evaluate(() => {
        const { canvas, fabric } = window.BF;
        const segments = canvas.getObjects().filter(object => object.boardflowKind === 'recognized-line').map(object => {
            const matrix = object.calcTransformMatrix();
            const points = object.calcLinePoints();
            const world = point => fabric.util.transformPoint(point, matrix);
            return [world({ x: points.x1, y: points.y1 }), world({ x: points.x2, y: points.y2 })];
        });
        const [a, b] = segments;
        const d1 = { x: a[1].x - a[0].x, y: a[1].y - a[0].y };
        const d2 = { x: b[1].x - b[0].x, y: b[1].y - b[0].y };
        const denominator = d1.x * d2.y - d1.y * d2.x;
        const t = ((b[0].x - a[0].x) * d2.y - (b[0].y - a[0].y) * d2.x) / denominator;
        const crossing = { x: a[0].x + t * d1.x, y: a[0].y + t * d1.y };
        const directions = [
            Math.atan2(d1.y, d1.x), Math.atan2(d2.y, d2.x),
            Math.atan2(-d1.y, -d1.x), Math.atan2(-d2.y, -d2.x)
        ].sort((x, y) => x - y);
        return directions.map((start, index) => {
            const end = index === 3 ? directions[0] + 2 * Math.PI : directions[index + 1];
            const middle = (start + end) / 2;
            return [crossing.x + Math.cos(middle) * 26, crossing.y + Math.sin(middle) * 26];
        });
    });
    for (const point of markerPoints) {
        await page.mouse.click(point[0], point[1]);
        if (!await page.locator('#geometryToolRail').evaluate(element => element.classList.contains('hidden'))) break;
    }
    assert.equal(await page.locator('#geometryToolRail').evaluate(element => element.classList.contains('hidden')), false);
    await page.locator('[data-geometry-tool="measure"]').click();
    assert.match(await page.locator('#geometryInsight').textContent(), /Measured angle:\s*\d+°/);
    await context.close();
});

test('the angle lesson calculates every corner on inserted straight-edged shapes', async () => {
    const { context, page } = await openApp();
    await ensureMenuOpen(page);
    await page.locator('#shapeSquare').click();
    await ensureMenuOpen(page);
    await page.locator('#shapeTriangle').click();
    await page.waitForFunction(() => !document.querySelector('#btnAngles').classList.contains('hidden'));
    await ensureMenuOpen(page);
    await page.locator('#btnLens').click();
    await page.waitForFunction(() => window.BF.getAngleHits().length === 7);
    const marker = await page.evaluate(() => window.BF.getAngleHits().find(hit => Math.abs(hit.deg - 90) < 0.01));
    assert.equal(marker.revealed, false);
    await page.mouse.click(marker.x + 18, marker.y);
    await page.waitForFunction(key => window.BF.getAngleHits().find(hit => hit.key === key)?.revealed === true, marker.key);
    assert.equal(await page.locator('#geometryToolRail').evaluate(element => element.classList.contains('hidden')), false);
    await page.locator('[data-geometry-tool="measure"]').click();
    assert.match(await page.locator('#geometryInsight').textContent(), /Measured angle:\s*90°/);
    await context.close();
});

test('a value table offers a contextual chart workflow', async () => {
    const { consoleErrors, context, page, pageErrors } = await openApp();
    await page.waitForFunction(() => document.querySelector('#mathPanel')?.dataset.ready === 'true');
    await ensureMenuOpen(page);
    await page.locator('#btnMath').click();
    await page.locator('#mTabStat').click();
    await page.locator('#stTable').click();

    await page.locator('#mathSuggestion').waitFor({ state: 'visible' });
    assert.match(await page.locator('#mathSuggestionTitle').textContent(), /table/i);
    await page.locator('#mathSuggestionAction').click();
    assert.equal(await page.locator('#secStat').evaluate(element => element.classList.contains('on')), true);
    assert.equal(await page.locator('#stType').inputValue(), 'bar');
    assert.match(await page.locator('#stData').inputValue(), /^4\n7/);
    assert.deepEqual(pageErrors.map(error => error.message), []);
    assert.deepEqual(consoleErrors, []);
    await context.close();
});

test('typed equations offer graphing and circle visualizations insert on the board', async () => {
    const { consoleErrors, context, page, pageErrors } = await openApp();
    await page.waitForFunction(() => document.querySelector('#mathPanel')?.dataset.ready === 'true');
    await page.evaluate(() => {
        const equation = new window.BF.fabric.IText('y = 2*x + 1', { left: 100, top: 100 });
        window.BF.canvas.add(equation);
    });

    await page.locator('#mathSuggestion').waitFor({ state: 'visible' });
    await page.locator('#mathSuggestionAction').click();
    assert.equal(await page.locator('#secGraph').evaluate(element => element.classList.contains('on')), true);
    assert.equal(await page.locator('#gPreset').inputValue(), 'custom');
    assert.equal(await page.locator('#gCustom').inputValue(), '2*x + 1');

    await page.locator('#mTabCircle').click();
    await page.locator('#cRadius').fill('7');
    await page.locator('#cInsert').click();
    await page.waitForFunction(() => window.BF.canvas.getObjects().some(object => object.boardflowKind === 'circle-visualization'));
    assert.match(await page.locator('#cInfo').textContent(), /circumference/);
    assert.deepEqual(pageErrors.map(error => error.message), []);
    assert.deepEqual(consoleErrors, []);
    await context.close();
});

test('the lazy PDF worker renders an uploaded first page', async () => {
    const { consoleErrors, context, page, pageErrors } = await openApp();
    assert.equal(await page.locator('#pager').isVisible(), false);
    await page.locator('#fileInput').setInputFiles(pdfFixturePath);
    try {
        await page.waitForFunction(() => window.BF.canvas.getObjects().some(object => object.isFile), null, { timeout: 10000 });
    } catch (error) {
        assert.fail(`PDF page was not rendered: ${[...pageErrors.map(item => item.message), ...consoleErrors].join('; ') || error.message}`);
    }

    assert.equal(await page.locator('#pageLabel').textContent(), '1 / 1');
    assert.equal(await page.locator('#pager').isVisible(), true);
    assert.equal(await page.locator('#pager').getAttribute('aria-label'), 'File page 1 of 1');
    assert.doesNotMatch(await page.locator('#pager').textContent(), /PDF/i);
    assert.deepEqual(pageErrors.map(error => error.message), []);
    assert.deepEqual(consoleErrors, []);
    await context.close();
});

test('a rejected PDF upload leaves the current board and undo history intact', async () => {
    const { context, page } = await openApp();
    await page.evaluate(() => {
        const equation = new window.BF.fabric.Textbox('PRIVATE EQUATION', { left: 120, top: 120, width: 220 });
        equation.boardflowId = 'preserved-equation';
        equation.boardflowLayer = 'teacher';
        window.BF.canvas.add(equation);
    });
    await page.waitForTimeout(150);
    const before = await page.evaluate(() => ({
        objects: window.BF.canvas.getObjects().map(object => object.toObject(['boardflowId', 'boardflowLayer'])),
        viewport: [...window.BF.canvas.viewportTransform]
    }));

    await page.locator('#fileInput').setInputFiles(invalidPdfFixturePath);
    await page.waitForFunction(() => document.querySelector('#appStatus')?.classList.contains('error'));
    const after = await page.evaluate(() => ({
        objects: window.BF.canvas.getObjects().map(object => object.toObject(['boardflowId', 'boardflowLayer'])),
        viewport: [...window.BF.canvas.viewportTransform]
    }));
    assert.deepEqual(after, before);
    assert.match(await page.locator('#appStatus').textContent(), /Could not open broken\.pdf/);
    await context.close();
});

test('a malformed board document leaves the current board intact', async () => {
    const { context, page } = await openApp();
    await page.evaluate(() => {
        const note = new window.BF.fabric.Textbox('Keep this lesson', { left: 80, top: 90, width: 180 });
        note.boardflowId = 'preserved-note';
        window.BF.canvas.add(note);
    });
    const before = await page.evaluate(() => window.BF.canvas.getObjects().map(object => object.toObject(['boardflowId'])));

    await page.locator('#fileInput').setInputFiles(invalidBoardFixturePath);
    await page.waitForFunction(() => document.querySelector('#appStatus')?.classList.contains('error'));
    const after = await page.evaluate(() => window.BF.canvas.getObjects().map(object => object.toObject(['boardflowId'])));
    assert.deepEqual(after, before);
    assert.match(await page.locator('#appStatus').textContent(), /Could not open broken\.boardview/);
    await context.close();
});

test('large uploaded images fit the screen at the visible top-left and report success', async () => {
    const { consoleErrors, context, page, pageErrors } = await openApp();
    await page.evaluate(() => {
        window.BF.canvas.setViewportTransform([1, 0, 0, 1, -1200, -900]);
        window.BF.canvas.requestRenderAll();
    });
    await page.locator('#fileInput').setInputFiles(largeFixturePath);
    await page.waitForFunction(() => window.BF.canvas.getObjects().some(object => object.isFile));
    assert.equal(await page.locator('#pager').isVisible(), false);
    await page.waitForFunction(() => document.querySelector('#appStatus').textContent.includes('now on the board'));
    const position = await page.evaluate(() => {
        const object = window.BF.canvas.getObjects().find(item => item.isFile);
        const corners = object.getCoords().map(point => window.BF.fabric.util.transformPoint(point, window.BF.canvas.viewportTransform));
        const screenTopLeft = corners[0];
        return {
            x: screenTopLeft.x,
            y: screenTopLeft.y,
            right: Math.max(...corners.map(point => point.x)),
            bottom: Math.max(...corners.map(point => point.y)),
            canvasWidth: window.BF.canvas.getWidth(),
            canvasHeight: window.BF.canvas.getHeight(),
            scale: object.scaleX,
            status: document.querySelector('#appStatus').textContent
        };
    });
    assert.ok(Math.abs(position.x) < 2, JSON.stringify(position));
    assert.ok(Math.abs(position.y) < 2, JSON.stringify(position));
    assert.ok(position.right <= position.canvasWidth, JSON.stringify(position));
    assert.ok(position.bottom <= position.canvasHeight, JSON.stringify(position));
    assert.ok(position.scale < 1, JSON.stringify(position));
    assert.match(position.status, /now on the board/);
    assert.deepEqual(pageErrors.map(error => error.message), []);
    assert.deepEqual(consoleErrors, []);
    await context.close();
});

test('selected subject and uploaded file recover after reload', async () => {
    const { consoleErrors, context, page, pageErrors } = await openApp();
    await ensureMenuOpen(page);
    await page.locator('#btnSubjects').click();
    await page.locator('.subj-item').filter({ hasText: 'Beta' }).click();
    await page.waitForTimeout(500);
    await page.locator('#fileInput').setInputFiles(fixturePath);
    await page.waitForTimeout(700);
    assert.equal(await page.locator('#subjectLabel').textContent(), 'Beta');
    assert.equal(await page.evaluate(() => window.BF.canvas.getObjects().filter(object => object.isFile).length), 1);
    await page.reload();
    try {
        await page.waitForFunction(() => window.BF.canvas.getObjects().some(object => object.isFile), null, { timeout: 10000 });
    } catch (error) {
        assert.fail(`Uploaded file was not restored: ${[...pageErrors.map(item => item.message), ...consoleErrors].join('; ') || error.message}`);
    }
    assert.equal(await page.locator('#subjectLabel').textContent(), 'Beta');
    assert.equal(await page.evaluate(() => window.BF.canvas.getObjects().filter(object => object.isFile).length), 1);
    await context.close();
});

test('classroom sharing preserves public metadata and only reveals answers on request', async () => {
    const { context, page } = await openApp();
    await page.evaluate(() => {
        const { canvas, fabric } = window.BF;
        window.__sharedBoardMessages = [];
        window.boardFlowDesktop = {
            startClassroom: async () => ({ code: 'TEST01', url: 'http://127.0.0.1/classroom?session=TEST01' }),
            broadcastClassroom: message => window.__sharedBoardMessages.push(message)
        };

        const source = new fabric.Rect({ left: 40, top: 40, width: 80, height: 50, fill: '#dceaff' });
        Object.assign(source, {
            isFile: true,
            boardflowId: 'source-file',
            boardflowKind: 'uploaded-file',
            boardflowLayer: 'lesson',
            boardflowPayload: { name: 'source.pdf', page: 2 },
            boardflowErasePaths: [{ width: 12, points: [{ x: 45, y: 45 }, { x: 50, y: 50 }] }]
        });

        const arrow = new fabric.Line([160, 60, 260, 120], { stroke: '#c22', strokeWidth: 4 });
        Object.assign(arrow, {
            isArrow: true,
            boardflowId: 'arrow-1',
            boardflowKind: 'arrow',
            boardflowLayer: 'teacher',
            boardflowArrowStart: { x: 160, y: 60 },
            boardflowArrowEnd: { x: 260, y: 120 },
            boardflowArrowThickness: 4
        });

        const equation = new fabric.Textbox('y = x + 1', { left: 50, top: 160, width: 180 });
        Object.assign(equation, {
            boardflowId: 'equation-1',
            boardflowKind: 'equation',
            boardflowLayer: 'teacher',
            boardflowPayload: { latex: 'y=x+1', source: 'recognition' }
        });
        const answer = new fabric.Textbox('PRIVATE ANSWER', { left: 50, top: 220, width: 180 });
        Object.assign(answer, {
            boardflowId: 'answer-1',
            boardflowLayer: 'answers'
        });

        const child = new fabric.Circle({ radius: 20, fill: '#fff', stroke: '#24a' });
        Object.assign(child, {
            boardflowId: 'group-child',
            boardflowKind: 'circle-visualization',
            boardflowLayer: 'student',
            boardflowPayload: { radius: 5 }
        });
        const group = new fabric.Group([child], { left: 300, top: 60 });
        Object.assign(group, {
            boardflowId: 'group-1',
            boardflowKind: 'visualization-group',
            boardflowLayer: 'student',
            boardflowPayload: { label: 'circle' }
        });

        canvas.add(source, arrow, equation, answer, group);
    });

    await ensureMenuOpen(page);
    await openClassroomStudioForTest(page);
    await page.locator('[data-classroom-tab="session"]').click();
    await page.locator('#btnStartSession').click();
    const state = await page.evaluate(() => window.__sharedBoardMessages.find(message => message.type === 'board-state')?.state.objects.objects);
    const findById = (objects, id) => {
        for (const object of objects || []) {
            if (object.boardflowId === id) return object;
            const nested = findById(object.objects, id);
            if (nested) return nested;
        }
        return null;
    };
    const source = findById(state, 'source-file');
    const arrow = findById(state, 'arrow-1');
    const equation = findById(state, 'equation-1');
    const group = findById(state, 'group-1');
    const child = findById(state, 'group-child');

    assert.deepEqual(source.boardflowPayload, { name: 'source.pdf', page: 2 });
    assert.deepEqual(source.boardflowErasePaths, [{ width: 12, points: [{ x: 45, y: 45 }, { x: 50, y: 50 }] }]);
    assert.equal(source.boardflowLayer, 'lesson');
    assert.equal(arrow, null);
    assert.equal(equation, null);
    assert.equal(findById(state, 'answer-1'), null);
    assert.deepEqual(group.boardflowPayload, { label: 'circle' });
    assert.deepEqual(child.boardflowPayload, { radius: 5 });

    await page.locator('[data-classroom-tab="assess"]').click();
    await page.locator('#btnRevealAnswers').click();
    const revealedState = await page.evaluate(() =>
        window.__sharedBoardMessages.filter(message => message.type === 'board-state').at(-1)?.state.objects.objects
    );
    assert.ok(findById(revealedState, 'answer-1'));
    assert.equal(findById(revealedState, 'arrow-1'), null);
    await context.close();
});

test('canvas shortcuts leave subject, assessment, math, and recognition editors in control', async () => {
    const { context, page } = await openApp();
    await page.evaluate(() => {
        const object = new window.BF.fabric.Rect({ left: 30, top: 30, width: 40, height: 40, fill: '#2f80ed' });
        window.BF.canvas.add(object);
        window.BF.canvas.setActiveObject(object);
        window.__shortcutObject = object;
    });
    await page.waitForTimeout(150);
    const objectCount = await page.evaluate(() => window.BF.canvas.getObjects().length);
    const reactivate = () => page.evaluate(() => window.BF.canvas.setActiveObject(window.__shortcutObject));
    const typeAndBackspace = async (selector, text) => {
        await reactivate();
        const editor = page.locator(selector);
        await editor.fill('');
        await editor.focus();
        await page.keyboard.type(text);
        assert.equal(await editor.inputValue(), text);
        await page.keyboard.press('Backspace');
        assert.equal(await editor.inputValue(), text.slice(0, -1));
        assert.equal(await page.evaluate(() => window.BF.canvas.getObjects().length), objectCount);
    };

    await ensureMenuOpen(page);
    await page.locator('#btnSubjects').click();
    await page.locator('.subj-edit-toggle').click();
    await typeAndBackspace('#subjName', 'English Lesson');

    await page.mouse.click(10, 100);
    await page.locator('#subjPanel').waitFor({ state: 'hidden' });
    await ensureMenuOpen(page);
    await openClassroomStudioForTest(page);
    await page.locator('[data-classroom-tab="assess"]').click();
    await typeAndBackspace('#assessmentPrompt', 'Exit ticket');

    await page.locator('#classroomClose').click();
    await page.waitForFunction(() => document.querySelector('#mathPanel')?.dataset.ready === 'true');
    await ensureMenuOpen(page);
    await page.locator('#btnMath').click();
    await page.locator('#mTabGraph').click();
    await page.locator('#gPreset').selectOption('custom');
    await typeAndBackspace('#gCustom', 'x + 1');

    await page.evaluate(() => document.querySelector('#equationDialog').classList.remove('hidden'));
    await typeAndBackspace('#recognizedEquation', 'y = x');

    await page.locator('#equationCancel').click();
    await ensureMenuOpen(page);
    await page.locator('#btnSubjects').click();
    await page.locator('.subj-edit-toggle').click();
    const subjectEditor = page.locator('#subjName');
    await subjectEditor.fill('');
    await subjectEditor.focus();
    await page.keyboard.type('Undo proof');
    await reactivate();
    await subjectEditor.focus();
    await page.keyboard.press('Control+z');
    assert.notEqual(await subjectEditor.inputValue(), 'Undo proof');
    assert.equal(await page.evaluate(() => window.BF.canvas.getObjects().length), objectCount);
    await context.close();
});
