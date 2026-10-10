const globals = require('globals');

module.exports = [
    {
        ignores: ['android/**', 'dist/**', 'libs/**', 'node_modules/**', 'www/**', 'jspdf.umd.min.js']
    },
    {
        files: ['src/renderer/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: globals.browser
        },
        rules: {
            'no-dupe-keys': 'error',
            'no-redeclare': 'error',
            'no-undef': 'error',
            'no-unreachable': 'error'
        }
    },
    {
        files: ['tests/unit/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.node, ...globals.browser }
        },
        rules: {
            'no-dupe-keys': 'error',
            'no-redeclare': 'error',
            'no-undef': 'error',
            'no-unreachable': 'error'
        }
    },
    {
        files: ['main.cjs', 'preload.cjs', 'scripts/*.cjs', 'vite.config.cjs', 'eslint.config.cjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: { ...globals.node, ...globals.browser }
        },
        rules: {
            'no-dupe-keys': 'error',
            'no-redeclare': 'error',
            'no-undef': 'error',
            'no-unreachable': 'error'
        }
    },
    {
        files: ['tests/*.test.cjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: { ...globals.node, ...globals.browser }
        },
        rules: {
            'no-dupe-keys': 'error',
            'no-redeclare': 'error',
            'no-undef': 'error',
            'no-unreachable': 'error'
        }
    }
];
