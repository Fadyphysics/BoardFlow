# BoardFlow

BoardFlow is a shared whiteboard renderer packaged for Windows with Electron and for Android with Capacitor. The browser renderer is built once into `www/`; both desktop and Android consume that generated output.

## Project structure

```text
src/renderer/             Browser UI and feature modules
  app.js                  Canvas and board interaction coordinator
  math-tools.js           Lazily loaded mathematics tools
  math-intelligence.js    Canvas-aware equation and data suggestions
  classroom-suite.js      Modes, layers, live sessions, assessments, templates, history
  equation-recognition.js Local stroke-to-symbol recognition
  handwriting-recognition.js Platform/Windows handwriting adapter and LaTeX conversion
  ink-shape-recognition.js Hand-drawn line, arrow, polygon, circle, zigzag, and wave classifier
  pdf-service.js          Lazily loaded PDF.js boundary
  persistence.js          LocalStorage and IndexedDB access
  dom.js                  Required-element lookup
  date.js                 Date-label formatting
  security.js             Deletion-PIN hashing
  index.html
  styles.css
main.cjs                  Electron main process
preload.cjs               Sandboxed Electron bridge
android/                  Capacitor Android project
tests/                    Unit and Playwright tests
www/                      Generated renderer output (ignored by Git)
dist/                     Generated Electron packages (ignored by Git)
```

## Requirements

- Node.js 22 or newer
- npm
- Playwright Chromium for E2E tests: `npx playwright install chromium`
- Android Studio, Android SDK, and JDK 21 for Android builds

## Commands

```bash
npm install
npm start                 # build and launch Electron
npm run dev:web           # renderer development server
npm run preview:web       # build and open a local browser preview
npm run build:web         # generate www/
npm test                  # syntax, lint, unit, browser E2E, and Electron smoke checks
npm run audit             # dependency security audit
npm run android:sync      # build renderer and sync Capacitor
npm run android:build     # create Android debug APK
npm run build:windows     # create Windows installer and portable build
```

Do not double-click `www/index.html` in Chrome. Modern browsers block JavaScript modules loaded from a `file://` address. Use `start-boardflow.cmd`, `npm start`, or `npm run preview:web`; packaged desktop and Android builds load the same files through their supported application runtimes.

On Android, tap an editable canvas text object to enter text editing and open the device's native on-screen keyboard. Other platforms continue to use their normal physical or system keyboards.

For PWA development, run `npm run preview:web` and open the localhost URL in a supported browser. Once the service worker is active, reload once while online; then verify that BoardFlow reopens with the network disabled. On GitHub Pages, choose **Install app** in the browser's install menu (or **Add to Home Screen** on mobile).

## Architecture and data

The renderer runs without Node.js access. Electron exposes a narrow workspace, close-confirmation, and local-classroom bridge through `preload.cjs`; context isolation and sandboxing are enabled explicitly.

Subjects and lightweight preferences are stored in LocalStorage. Checkpoints and directory handles are stored in the versioned `boardflow-library` IndexedDB database. Persistence operations are isolated in `src/renderer/persistence.js` so future schema migrations have one home.

When the first subject is created, the desktop app asks for one main BoardFlow workspace folder. Every subject then receives its own automatically created folder and `.boardview` lesson file, which is refreshed as the subject checkpoint is saved. An optional deletion password is hashed locally and is required before that subject can be deleted.

The optional deletion PIN is protection against accidental deletion, not account authentication. New PINs are stored as SHA-256 hashes; legacy plain-text values remain readable only for migration compatibility.

The browser build is installable as a Progressive Web App (PWA) from a secure origin. Its service worker caches the app shell and same-origin assets as they are used, so the board can reopen offline after its first online load. Browser subjects and lessons remain local to that browser profile; they do not sync with desktop or Android storage.

GitHub Pages deployment is automated on pushes to `main` by `.github/workflows/deploy-pages.yml`. The public PWA will be available at `https://fadyphysics.github.io/BoardFlow/` after the first successful Pages deployment. In GitHub repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions** if deployment is not enabled yet.

The static PWA cannot host a live classroom session: that feature requires the temporary local-network server provided by the desktop app. Use the Windows or Android app to host a classroom.

Smart Math listens to canvas objects rather than operating as an isolated calculator. Data tables and typed `y = ...` or `f(x) = ...` equations offer contextual chart or graph workflows. Inserted tables, equations, charts, graphs, and circle visualizations retain their semantic metadata in saved checkpoints and lesson files.

Classroom Studio adds Teacher and Student modes, four independently visible/lockable layers, palm rejection, pen-pressure-aware strokes, handwriting and shape cleanup, editable equation recognition, lesson templates, and automatic IndexedDB version history. Presentation-safe mode locks editing and removes setup controls until `Esc` or the menu button is pressed. Auto Shapes cleans lines, arrows, polygons, forgiving circles, elongated ellipses, zigzags, and smooth waves while retaining the source ink color. Auto Shapes and Handwriting modes are mutually exclusive so straight letter strokes are not mistaken for geometry. The desktop build uses an installed Windows Ink handwriting recognizer and keeps conversion behind an editable text/LaTeX confirmation.

The desktop app can host a temporary live classroom on the local network. Students on the same Wi-Fi open the generated link or QR code in a modern browser; board updates, the countdown timer, polls, and exit tickets are sent through the temporary session. Ending the session closes the local server and invalidates the six-digit join code.

## Release checklist

1. Run `npm ci`, then `npm test`.
2. Run `npm audit` and resolve any high or critical findings.
3. On Windows, run `npm run build:windows`; on an Android-capable machine, run `npm run android:build`.
4. Before release, manually verify autosave/reload recovery, PNG export, PDF paging and replacement, eraser precision, and file save/reopen.
5. Test classroom sharing with a separate student device: teacher notes must remain absent, and answers should appear only after **Reveal answer layer**.
6. Test pen latency, touch targets, subject creation/storage, and student-browser joining on each supported physical device. Simulator/browser tests do not replace these checks.
