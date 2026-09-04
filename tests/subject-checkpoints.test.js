const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const fixtureDir = path.join(__dirname, 'fixtures');
const fixturePath = path.join(fixtureDir, 'checkpoint.svg');
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
        const contentType = filePath.endsWith('.html') ? 'text/html' : filePath.endsWith('.js') ? 'text/javascript' : filePath.endsWith('.css') ? 'text/css' : 'application/octet-stream';
        response.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(response);
    });
}

async function openApp() {
    const context = await browser.newContext();
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
    const page = await context.newPage();
    await page.goto(`${baseUrl}/index.html`);
    await page.locator('#btnMenu').waitFor();
    return { context, page };
}

async function ensureMenuOpen(page) {
    if (await page.locator('#menu').evaluate(element => element.classList.contains('hidden'))) {
        await page.locator('#btnMenu').click();
    }
}

test.before(async () => {
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(fixturePath, '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="red"/></svg>');
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

test('subjects are sorted and edit mode exposes compact delete controls', async () => {
    const { context, page } = await openApp();
    await ensureMenuOpen(page);
    await page.locator('#btnSubjects').click();
    assert.deepEqual(await page.locator('.subj-name').allTextContents(), ['Alpha', 'Beta']);
    await page.locator('.subj-edit-toggle').click();
    assert.equal(await page.locator('.subj-delete').count(), 2);
    assert.equal(await page.locator('.subj-delete').first().textContent(), '×');
    await context.close();
});

test('subject deletion requires confirmation', async () => {
    const { context, page } = await openApp();
    await ensureMenuOpen(page);
    await page.locator('#btnSubjects').click();
    await page.locator('.subj-edit-toggle').click();
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('.subj-delete').first().click();
    assert.equal(await page.locator('.subj-name').count(), 2);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('.subj-delete').first().click();
    assert.equal(await page.locator('.subj-name').count(), 1);
    await context.close();
});

test('selected subject and uploaded file recover after reload', async () => {
    const { context, page } = await openApp();
    await ensureMenuOpen(page);
    await page.locator('#btnSubjects').click();
    await page.locator('.subj-item').filter({ hasText: 'Beta' }).click();
    await page.waitForTimeout(500);
    await page.locator('#fileInput').setInputFiles(fixturePath);
    await page.waitForTimeout(700);
    assert.equal(await page.locator('#subjectLabel').textContent(), 'Beta');
    await page.reload();
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('#subjectLabel').textContent(), 'Beta');
    await context.close();
});
