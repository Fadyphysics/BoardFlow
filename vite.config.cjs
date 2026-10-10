const { defineConfig } = require('vite');

module.exports = defineConfig({
    root: 'src/renderer',
    base: './',
    publicDir: 'public',
    build: {
        outDir: '../../www',
        emptyOutDir: true,
        target: 'chrome120',
        chunkSizeWarningLimit: 700,
        sourcemap: false
    }
});
