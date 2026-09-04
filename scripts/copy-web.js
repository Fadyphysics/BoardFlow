const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'www');
const files = [
    'index.html',
    'app.js',
    'math.js',
    'manifest.webmanifest',
    'service-worker.js',
    'icon.png'
];

fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(path.join(destination, 'libs'), { recursive: true });
for (const file of files) fs.copyFileSync(path.join(root, file), path.join(destination, file));
for (const file of ['fabric.min.js', 'pdf.min.js', 'pdf.worker.min.js', 'math.min.js', 'jspdf.umd.min.js']) {
    fs.copyFileSync(path.join(root, 'libs', file), path.join(destination, 'libs', file));
}
