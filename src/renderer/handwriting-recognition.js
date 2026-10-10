import { recognizeHandwritingImage } from './browser-handwriting-recognition.js';
import * as fabric from 'fabric';

const LATEX_REPLACEMENTS = [
    [/√/g, '\\sqrt{}'],
    [/×/g, '\\times '],
    [/÷/g, '\\div '],
    [/≤/g, '\\le '],
    [/≥/g, '\\ge '],
    [/≠/g, '\\ne '],
    [/≈/g, '\\approx '],
    [/π/g, '\\pi '],
    [/∞/g, '\\infty '],
    [/²/g, '^{2}'],
    [/³/g, '^{3}'],
    [/⁴/g, '^{4}'],
    [/→/g, '\\to ']
];

export function textToLatex(value) {
    let latex = String(value || '').trim();
    LATEX_REPLACEMENTS.forEach(([pattern, replacement]) => { latex = latex.replace(pattern, replacement); });
    latex = latex.replace(/\b([A-Za-z0-9]+)\s*\/\s*([A-Za-z0-9]+)\b/g, '\\frac{$1}{$2}');
    latex = latex.replace(/\^\s*([A-Za-z0-9+-]+)/g, '^{$1}');
    return latex;
}

export async function recognizeHandwritingFromStrokes(normalizedStrokes, desktopBridge, language = 'en-US', options = {}) {
    const strokes = normalizedStrokes
        .filter(stroke => stroke?.points?.length >= 2)
        .map(convertNormalizedStrokeToPoints);
    if (!strokes.length) return null;

    let result = null;
    try {
        result = await recognizeWithPlatformApi(strokes, language);
    } catch (error) {
        console.warn('Platform handwriting recognition failed:', error);
    }
    if (!result && desktopBridge && typeof desktopBridge.recognizeInk === 'function') {
        try {
            result = await desktopBridge.recognizeInk({
                strokes,
                mode: 'writing',
                recognitionType: 'text',
                language
            });
            if (result) result = { ...result, engine: result.engine || 'Native handwriting recognizer' };
        } catch (error) {
            console.warn('Native handwriting recognition failed:', error);
        }
    }
    if (!result && !desktopBridge) {
        if (typeof Worker !== 'function') throw new Error('This browser does not support local handwriting recognition workers.');
        const image = renderHandwritingImage(normalizedStrokes);
        result = await recognizeHandwritingImage(image, options.onProgress);
    }
    return result?.text ? result : null;
}

async function recognizeWithPlatformApi(strokes, language) {
    if (typeof navigator.createHandwritingRecognizer !== 'function' || typeof globalThis.HandwritingStroke !== 'function') return null;
    const recognizer = await navigator.createHandwritingRecognizer({ languages: [language] });
    try {
        const drawing = recognizer.startDrawing({ recognitionType: 'text', inputType: 'stylus', alternatives: 5 });
        let timestamp = 0;
        strokes.forEach(points => {
            const stroke = new globalThis.HandwritingStroke();
            points.forEach(point => stroke.addPoint({ x: point.x, y: point.y, t: timestamp++ }));
            drawing.addStroke(stroke);
        });
        const predictions = await drawing.getPrediction();
        return {
            text: predictions[0]?.text || '',
            alternatives: predictions.map(prediction => prediction.text).filter(Boolean),
            engine: 'Platform handwriting recognizer'
        };
    } finally {
        recognizer.finish();
    }
}

/**
 * Converts a normalized stroke to the format expected by handwriting recognition
 * @param {Object} normalizedStroke - The normalized stroke from ink-pipeline.js
 * @returns {Array} Array of points in the format expected by handwriting recognition
 */
function convertNormalizedStrokeToPoints(normalizedStroke) {
    if (!normalizedStroke || !normalizedStroke.points) {
        return [];
    }
    
    // Convert normalized stroke points to the format expected by handwriting recognition
    return normalizedStroke.points.map((point, index) => ({
        x: point.x,
        y: point.y,
        t: Number.isFinite(point.t) ? point.t : index * 16
    }));
}

export function renderHandwritingImage(normalizedStrokes) {
    const canvas = document.createElement('canvas');
    const size = 384;
    const padding = 36;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot prepare an image for handwriting recognition.');

    const strokes = normalizedStrokes
        .map(stroke => stroke.points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)))
        .filter(points => points.length > 1);
    const points = strokes.flat();
    if (!points.length) throw new Error('No handwriting strokes were supplied.');
    const left = Math.min(...points.map(point => point.x));
    const top = Math.min(...points.map(point => point.y));
    const width = Math.max(1, Math.max(...points.map(point => point.x)) - left);
    const height = Math.max(1, Math.max(...points.map(point => point.y)) - top);
    const scale = Math.min((size - padding * 2) / width, (size - padding * 2) / height);
    const offsetX = (size - width * scale) / 2;
    const offsetY = (size - height * scale) / 2;

    context.fillStyle = '#fff';
    context.fillRect(0, 0, size, size);
    context.strokeStyle = '#111';
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = Math.max(5, Math.min(16, 4 * scale));
    strokes.forEach(stroke => {
        context.beginPath();
        stroke.forEach((point, index) => {
            const x = offsetX + (point.x - left) * scale;
            const y = offsetY + (point.y - top) * scale;
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
        });
        context.stroke();
    });
    return canvas.toDataURL('image/png');
}

/**
 * Recognizes handwriting from normalized strokes
 * @param {Object} normalizedStroke - The normalized stroke from ink-pipeline.js
 * @param {Object} desktopBridge - Desktop bridge for native recognition (optional)
 * @param {string} language - Language code for recognition (default: 'en-US')
 * @returns {Promise<Object|null>} Recognition result or null if unsuccessful
 */
export async function recognizeHandwritingFromStroke(normalizedStroke, desktopBridge, language = 'en-US') {
    if (!normalizedStroke || !normalizedStroke.points || normalizedStroke.points.length < 2) {
        return null;
    }
    return recognizeHandwritingFromStrokes([normalizedStroke], desktopBridge, language);
}

/**
 * Converts recognized handwriting to a Fabric text object
 * @param {Object} recognitionResult - The result from handwriting recognition
 * @param {Object} normalizedStroke - The original normalized stroke
 * @param {string} textColor - Color for the text (default: #ffffff for dark theme)
 * @returns {fabric.Text|fabric.IText|null} Fabric text object or null if conversion fails
 */
export function createTextObjectFromRecognition(recognitionResult, normalizedStroke, textColor = '#ffffff') {
    if (!recognitionResult || !recognitionResult.text || !normalizedStroke || !normalizedStroke.bbox) {
        return null;
    }
    
    const bbox = normalizedStroke.bbox;
    const text = recognitionResult.text;
    
    // Calculate font size based on the height of the original stroke
    const fontSize = Math.max(12, Math.min(bbox.height * 0.8, 48)); // Reasonable font size range
    
    // Create a Fabric text object positioned at the top-left of the original stroke
    const textObject = new fabric.IText(text, {
        left: bbox.left,
        top: bbox.top,
        fontSize: fontSize,
        fill: textColor,
        fontFamily: 'Arial, sans-serif',
        originX: 'left',
        originY: 'top',
        selectable: true,
        evented: true,
        hasControls: true,
        hasBorders: true,
        padding: 5,
        lockRotation: true,
        // Store original stroke info for reference
        boardflowOriginalStroke: normalizedStroke,
        boardflowRecognitionResult: recognitionResult
    });
    
    // Adjust the position so the text appears centered relative to the original stroke bounds
    textObject.set({
        top: bbox.top + (bbox.height - textObject.height) / 2
    });
    
    return textObject;
}

/**
 * Main handwriting recognition function that connects to the ink pipeline
 * @param {Object} normalizedStroke - The normalized stroke from ink-pipeline.js
 * @param {Object} desktopBridge - Desktop bridge for native recognition (optional)
 * @param {string} language - Language code for recognition (default: 'en-US')
 * @param {string} mode - Recognition mode (default: 'writing')
 * @returns {Promise<Object|null>} Recognition result with converted text object
 */
export async function recognizeHandwriting(normalizedStroke, desktopBridge, language = 'en-US', mode = 'writing') {
    if (mode !== 'writing') {
        return null;
    }
    
    // Perform handwriting recognition on the normalized stroke
    const recognitionResult = await recognizeHandwritingFromStroke(normalizedStroke, desktopBridge, language);
    
    if (!recognitionResult) {
        return null;
    }
    
    // Create a Fabric text object from the recognition result
    const textObject = createTextObjectFromRecognition(recognitionResult, normalizedStroke);
    
    return {
        text: recognitionResult.text,
        alternatives: recognitionResult.alternatives,
        engine: recognitionResult.engine,
        confidence: recognitionResult.confidence || 0.8, // Default confidence for successful recognition
        textObject: textObject
    };
}