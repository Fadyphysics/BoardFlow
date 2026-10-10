# Local Windows text and math recognition

## Smart Ink workflow

- Restart the development app and click **✦ Smart Ink**. It scans editable ink
  and automatically distinguishes English text and math for new writing after a
  1.5-second pause. Existing a/∛/shape modes remain available.
- Mixed recognition uses the official raw-content2 model. Only whole, disjoint
  stroke ranges explicitly classified as text/math are replaced; drawing and
  partial/ambiguous ranges are retained. The classified groups are recognized
  by their respective Text/Math models, not text heuristics.
- Supported `y=...` / `f(x)=...` equations get a linked graph automatically.
  Current graph bounds are x/y −10…10; supported expressions include arithmetic,
  powers, fractions, roots, sin/cos/tan/log/exp/abs. Other equations still render
  without an automatic graph. Graphs are separate, not shared multi-curve axes.
- Choose **Select**, then double-click an equation or its linked graph to edit
  the equation/LaTeX. Applying it redraws the graph. **Rewrite with pen** instead
  lets you write a complete replacement equation in empty space; the original
  and its graph remain until a successful recognition replaces them. Changing
  recognition mode cancels the pending rewrite. This is not character-by-character
  scratch-out/overwrite editing from the promotional video.
- Undo restores the equation and graph together. Text keeps the prior user-selected
  typography and file-edge layout, rather than forcing all text into in-place layout.

The native engine now runs as a reusable background worker. Requests are serialized,
with a fresh recognizer per request to prevent cross-page ink contamination.
Crashes/timeouts retain source ink; later requests can restart the worker.
Electron closes the worker on quit. Tests and standalone scripts using the bridge
must call `closeRecognitionWorkers()` when finished. No handwriting is sent to a
cloud recognition service.

BoardFlow's equation mode sends only the grouped pen coordinates to a separate
x64 MyScript iink 4.5.0 process. It exports LaTeX; local MathJax 4.1.3 renders that
as an SVG equation. No cloud handwriting API or server key is used. MyScript's
device licensing may require internet activation and access to its local licence
storage. Recognition itself uses the downloaded math2 model.

The `a` button also uses MyScript, with the English (`en_US`) text model. Text
remains editable and uses the chosen menu font/size and existing line/file-edge
layout. The Windows Ink helper remains available for legacy callers without a
mode; the toolbar does not silently fall back to it on a MyScript error. Shape
recognition stays with BoardFlow, preserving its circle preference, waves,
zigzags and angle integration. MyScript supports a Shape recognizer, but a full
replacement is not recommended without testing those custom behaviours.
The native integration is Windows-only, not an Android integration.

## Development setup

1. Keep the Windows developer certificate at `MyScript/MyCertificate.cs`.
2. From the BoardFlow directory run
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/setup-myscript.ps1`.
   This downloads the official NuGet Windows SDK, math2 and English text models and
   compiles the helper with the existing x64 .NET Framework compiler. A separate
   dotnet SDK is not needed. Requires the .NET Framework supported by the SDK
   (the official example targets 4.8.1).
3. Run `npm start` (or double-click `start-boardflow.cmd` in File Explorer).

The certificate, vendor files and compiled output are Git-ignored. Never paste
the certificate into logs, commit it, or distribute a development licence as a
production licence. Preserve the vendor licence notices. This change does not
package or install BoardFlow; release packaging/native asset inclusion and
production licence approval must be handled separately before distribution.

## Verification

- `npm run check` and `npm run test:unit`
- In PowerShell: `$env:BOARDFLOW_TEST_MYSCRIPT='1'; node --test tests/myscript-native.test.cjs`
- After `npm run build:web`, run
  `node --test --test-name-pattern='MyScript converts' tests/subject-checkpoints.test.cjs`
  with the same environment variable. This calls the real engine from the browser
  test and checks the formatted fraction, original ink colour and Undo.

Native tests need access to MyScript's device licence storage. They are opt-in
so normal CI doesn't activate developer devices. A restricted sandbox can return
an `initialize-engine` error even when ordinary desktop execution works.

Click ∛ to scan existing editable ink and convert subsequent equations after a
writing pause. Conversion is a best candidate, not a guarantee of correctness;
no artificial confidence score is assigned. Undo restores the source ink.
Failures and empty results preserve ink. Rendered equations retain their LaTeX
in `boardflowPayload.latex`; they are SVG images, not inline-editable text boxes.

Sources: https://github.com/MyScript/interactive-ink-examples-wpf and
https://developer.myscript.com/doc/interactive-ink/4.5/android/advanced/recognizers/
(shared Recognizer API configuration), https://docs.mathjax.org/en/latest/server/direct.html.
