const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const androidDir = path.join(root, 'android');
const javaExecutable = process.platform === 'win32' ? 'java.exe' : 'java';

function installedJdks(parent) {
    if (!parent || !fs.existsSync(parent)) return [];
    return fs.readdirSync(parent, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(parent, entry.name))
        .sort()
        .reverse();
}

function firstValid(candidates, marker) {
    return candidates.find(candidate => candidate && fs.existsSync(path.join(candidate, marker)));
}

const javaHome = firstValid([
    process.env.JAVA_HOME,
    path.join(process.env.ProgramFiles || '', 'Android', 'Android Studio', 'jbr'),
    ...installedJdks(path.join(process.env.ProgramFiles || '', 'Eclipse Adoptium')),
    ...installedJdks(path.join(process.env.ProgramFiles || '', 'Java'))
], path.join('bin', javaExecutable));

const androidHome = firstValid([
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk')
], 'platform-tools');

if (!javaHome) throw new Error('Java 21 was not found. Install Android Studio or a JDK 21 distribution.');
if (!androidHome) throw new Error('Android SDK was not found. Install it with Android Studio or set ANDROID_HOME.');

const isWindows = process.platform === 'win32';
const command = isWindows ? process.env.ComSpec : './gradlew';
const args = isWindows ? ['/d', '/c', 'gradlew.bat', 'assembleDebug'] : ['assembleDebug'];
const result = spawnSync(command, args, {
    cwd: androidDir,
    env: { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: androidHome },
    stdio: 'inherit'
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
