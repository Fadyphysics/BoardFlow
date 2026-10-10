using System;
using System.IO;
using System.Collections.Generic;
using System.Text;
using System.Web.Script.Serialization;
using MyScript.IInk;

// Keep the engine warm, but isolate each request's ink in a fresh recognizer.
internal static class RecognizeMath
{
    public sealed class Point { public float x { get; set; } public float y { get; set; } }
    public sealed class Request { public Point[][] strokes { get; set; } public string mode { get; set; } }
    sealed class Listener : IRecognizerListener
    {
        public string Error;
        public void OnError(Recognizer recognizer, RecognizerError error, string message) { Error = message; }
        public void ResultChanged(Recognizer recognizer, string result) { }
    }
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
    static PointerEvent[] Events(Point[][] strokes)
    {
        var events = new List<PointerEvent>();
        long time = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        int id = 1;
        foreach (var stroke in strokes)
        {
            if (stroke == null || stroke.Length < 2 || stroke.Length > 2000) throw new ArgumentException("Invalid stroke");
            events.Add(new PointerEvent(PointerEventType.DOWN, stroke[0].x, stroke[0].y, time++, .5f, PointerType.PEN, id));
            for (int i = 1; i < stroke.Length - 1; i++) events.Add(new PointerEvent(PointerEventType.MOVE, stroke[i].x, stroke[i].y, time++, .5f, PointerType.PEN, id));
            var end = stroke[stroke.Length - 1];
            events.Add(new PointerEvent(PointerEventType.UP, end.x, end.y, time++, .5f, PointerType.PEN, id++));
        }
        return events.ToArray();
    }
    // Raw Content must use the actual MyScript editor, not a batch recognizer:
    // this exposes MyScript item IDs, history, gestures, conversion and erase.
    static object RecognizeInteractive(Engine engine, Request request)
    {
        string packagePath = Path.Combine(Path.GetTempPath(), "boardflow-" + Guid.NewGuid().ToString("N") + ".iink");
        try
        {
            var package = engine.CreatePackage(packagePath);
            var part = package.CreatePart("Raw Content", 10000f, 10000f);
            using (var editor = engine.CreateOffscreenEditor(25.4f / 96, 25.4f / 96))
            {
                editor.Configuration.SetStringArray("configuration-manager.search-path", new[] {
                    Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "../vendor/recognition-assets/conf"))
                });
                editor.Configuration.SetString("raw-content.configuration.analyzer.bundle", "raw-content2");
                editor.Configuration.SetString("raw-content.configuration.analyzer.name", "standard");
                editor.Configuration.SetString("raw-content.configuration.text.bundle", "en_US");
                editor.Configuration.SetString("raw-content.configuration.text.name", "text");
                editor.Configuration.SetString("raw-content.configuration.math.bundle", "math2");
                editor.Configuration.SetString("raw-content.configuration.math.name", "standard");
                editor.Configuration.SetStringArray("raw-content.classification.types", new[] { "text", "math", "drawing" });
                editor.Configuration.SetStringArray("raw-content.recognition.types", new[] { "text", "math" });
                editor.Configuration.SetStringArray("raw-content.pen.gestures", new[] { "scratch-out", "strike-through", "insert", "join", "surround", "underline" });
                editor.Configuration.SetBoolean("export.jiix.ranges", true);
                editor.Configuration.SetBoolean("export.jiix.strokes", true);
                editor.Configuration.SetBoolean("export.jiix.ids", true);
                editor.Configuration.SetBoolean("export.jiix.math-label", true);
                editor.SetPart(part, true);
                string[] itemIds = editor.AddStrokes(Events(request.strokes), true);
                editor.WaitForIdle();
                string jiix = editor.Export_(new string[0], MimeType.JIIX).Trim();
                return new { text = "", jiix, itemIds, kind = "mixed", engine = "MyScript iink Interactive Ink", status = "recognized", interactive = true };
            }
        }
        finally
        {
            try { engine.DeletePackage(packagePath); } catch { }
            try { if (File.Exists(packagePath)) File.Delete(packagePath); } catch { }
        }
    }
    static object Recognize(Engine engine, string input)
    {
        string kind = "math";
        try
        {
            var request = Json.Deserialize<Request>(input);
            bool writing = request.mode == "writing", smart = request.mode == "smart";
            kind = smart ? "mixed" : writing ? "text" : "math";
            if (request.strokes == null || request.strokes.Length > 200) throw new ArgumentException("Invalid stroke count");
            if (smart) return RecognizeInteractive(engine, request);
            using (var recognizer = engine.CreateRecognizer(25.4f / 96, 25.4f / 96, smart ? "Raw Content" : writing ? "Text" : "Math"))
            {
                var listener = new Listener();
                recognizer.AddListener(listener);
                long time = 0;
                foreach (var stroke in request.strokes)
                {
                    if (stroke == null || stroke.Length < 2 || stroke.Length > 2000) throw new ArgumentException("Invalid stroke");
                    recognizer.PointerDown(stroke[0].x, stroke[0].y, time++, 0.5f);
                    for (int i = 1; i < stroke.Length - 1; i++) recognizer.PointerMove(stroke[i].x, stroke[i].y, time++, 0.5f);
                    var end = stroke[stroke.Length - 1];
                    recognizer.PointerUp(end.x, end.y, time++, 0.5f);
                }
                recognizer.WaitForIdle();
                if (listener.Error != null) throw new InvalidOperationException(listener.Error);
                string text = recognizer.GetResult(smart ? MimeType.JIIX : writing ? MimeType.TEXT : MimeType.LATEX).Trim();
                return new { text = smart ? "" : text, jiix = smart ? text : null, latex = writing || smart ? null : text, kind, engine = "MyScript iink", status = "recognized" };
            }
        }
        catch (Exception error) { return new { text = "", kind, engine = "MyScript iink", error = error.Message }; }
    }
    static int Main(string[] args)
    {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        try
        {
            using (var engine = Engine.Create(MyScript.Certificate.MyCertificate.Bytes))
            {
                engine.Configuration.SetStringArray("recognizer.configuration-manager.search-path", new[] {
                    Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "../vendor/recognition-assets/conf"))
                });
                // OffscreenEditor uses the general configuration namespace, not
                // recognizer.*. Configure the installed advanced Raw Content,
                // English and math2 bundles explicitly.
                engine.Configuration.SetStringArray("configuration-manager.search-path", new[] {
                    Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "../vendor/recognition-assets/conf"))
                });
                engine.Configuration.SetString("raw-content.configuration.analyzer.bundle", "raw-content2");
                engine.Configuration.SetString("raw-content.configuration.analyzer.name", "standard");
                engine.Configuration.SetString("raw-content.configuration.text.bundle", "en_US");
                engine.Configuration.SetString("raw-content.configuration.text.name", "text");
                engine.Configuration.SetString("raw-content.configuration.math.bundle", "math2");
                engine.Configuration.SetString("raw-content.configuration.math.name", "standard");
                engine.Configuration.SetBoolean("offscreen-editor.history-manager.enable", true);
                engine.Configuration.SetStringArray("raw-content.pen.gestures", new[] { "scratch-out", "strike-through", "insert", "join", "surround", "underline" });
                engine.Configuration.SetString("recognizer.lang", "en_US");
                engine.Configuration.SetStringArray("recognizer.raw-content.classification.types", new[] { "text", "math", "drawing" });
                engine.Configuration.SetStringArray("recognizer.raw-content.recognition.types", new[] { "text", "math" });
                engine.Configuration.SetBoolean("export.jiix.ranges", true);
                engine.Configuration.SetBoolean("export.jiix.strokes", false);
                engine.Configuration.SetBoolean("export.jiix.math-label", true);
                if (args.Length > 0 && args[0] == "--server")
                {
                    string input;
                    while ((input = Console.ReadLine()) != null) { Console.WriteLine(Json.Serialize(Recognize(engine, input))); Console.Out.Flush(); }
                }
                else Console.WriteLine(Json.Serialize(Recognize(engine, Console.In.ReadToEnd())));
            }
            return 0;
        }
        catch (Exception error)
        {
            Console.WriteLine(Json.Serialize(new { text = "", engine = "MyScript iink", stage = "initialize-engine", error = error.Message }));
            return 1;
        }
    }
}
