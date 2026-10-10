import * as fabric from 'fabric';

const overlap = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));

/**
 * Gets stroke information from a normalized stroke object
 * @param {Object} normalizedStroke - Normalized stroke from ink-pipeline.js
 * @returns {Object} Stroke analysis information
 */
function strokeInfo(normalizedStroke) {
    const bbox = normalizedStroke.bbox;
    const points = normalizedStroke.points || [];
    
    if (points.length === 0) {
        return {
            normalizedStroke,
            bbox,
            cx: bbox.left + bbox.width / 2,
            cy: bbox.top + bbox.height / 2,
            horizontal: false,
            vertical: false,
            diagonal: false,
            angle: 0,
            closed: false,
            tiny: Math.max(bbox.width, bbox.height) < 15
        };
    }
    
    const first = points[0] || { x: 0, y: 0 };
    const last = points[points.length - 1] || first;
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const diagonal = Math.abs(dx) > 3 && Math.abs(dy) > 3;
    
    return {
        normalizedStroke,
        bbox,
        cx: bbox.left + bbox.width / 2,
        cy: bbox.top + bbox.height / 2,
        horizontal: bbox.width > Math.max(7, bbox.height * 2.4),
        vertical: bbox.height > Math.max(7, bbox.width * 2.4),
        diagonal,
        angle,
        closed: points.length > 3 && Math.hypot(last.x - first.x, last.y - first.y) < Math.max(8, Math.hypot(bbox.width, bbox.height) * 0.42),
        tiny: Math.max(bbox.width, bbox.height) < 15
    };
}

function closeEnough(a, b) {
    const xOverlap = overlap(a.bbox.left, a.bbox.left + a.bbox.width, b.bbox.left, b.bbox.left + b.bbox.width);
    const yOverlap = overlap(a.bbox.top, a.bbox.top + a.bbox.height, b.bbox.top, b.bbox.top + b.bbox.height);
    const nearX = Math.abs(a.cx - b.cx) < Math.max(18, (a.bbox.width + b.bbox.width) * 0.55);
    const nearY = Math.abs(a.cy - b.cy) < Math.max(22, (a.bbox.height + b.bbox.height) * 1.7);
    return (xOverlap > 0 && nearY) || (yOverlap > 0 && nearX);
}

function groupStrokes(strokes) {
    const groups = [];
    strokes.forEach(stroke => {
        const matching = groups.filter(group => group.some(item => closeEnough(item, stroke)));
        if (!matching.length) {
            groups.push([stroke]);
            return;
        }
        matching[0].push(stroke);
        matching.slice(1).forEach(group => {
            matching[0].push(...group);
            groups.splice(groups.indexOf(group), 1);
        });
    });
    return groups.sort((a, b) => Math.min(...a.map(item => item.bbox.left)) - Math.min(...b.map(item => item.bbox.left)));
}

function recognizeGroup(group) {
    const horizontal = group.filter(stroke => stroke.horizontal);
    const vertical = group.filter(stroke => stroke.vertical);
    const diagonal = group.filter(stroke => stroke.diagonal);
    const tiny = group.filter(stroke => stroke.tiny);
    
    if (horizontal.length >= 2 && !vertical.length) return { symbol: '=', confidence: 0.92 };
    if (horizontal.length && vertical.length) return { symbol: '+', confidence: 0.88 };
    if (horizontal.length && tiny.length >= 2) return { symbol: '÷', confidence: 0.82 };
    if (diagonal.length >= 2 && Math.sign(diagonal[0].angle) !== Math.sign(diagonal[1].angle)) return { symbol: 'x', confidence: 0.78 };
    if (group.some(stroke => stroke.closed)) return { symbol: '0', confidence: 0.72 };
    if (horizontal.length) return { symbol: '-', confidence: 0.86 };
    if (vertical.length) return { symbol: '1', confidence: 0.8 };
    if (diagonal.length === 1) return { symbol: '/', confidence: 0.55 };
    return { symbol: '?', confidence: 0.25 };
}

/**
 * Converts a recognized equation to LaTeX format
 * @param {Array} symbols - Array of recognized symbols
 * @returns {string} LaTeX representation of the equation
 */
function symbolsToLatex(symbols) {
    let latex = '';
    let i = 0;
    
    while (i < symbols.length) {
        const symbol = symbols[i];
        
        // Handle special cases for math formatting
        switch (symbol.symbol) {
            case '/': // Fraction
                // Look ahead for numerator and denominator
                if (i > 0 && i < symbols.length - 1) {
                    const prevSymbol = symbols[i - 1];
                    const nextSymbol = symbols[i + 1];
                    
                    // Create fraction: \frac{numerator}{denominator}
                    latex += `\\frac{${prevSymbol.symbol}}{${nextSymbol.symbol}}`;
                    i += 2; // Skip the next symbol since we used it
                } else {
                    latex += symbol.symbol;
                }
                break;
                
            case '^': // Exponent
                if (i > 0 && i < symbols.length - 1) {
                    const base = symbols[i - 1];
                    const exponent = symbols[i + 1];
                    
                    // Create superscript: base^{exponent}
                    latex += `${base.symbol}^{${exponent.symbol}}`;
                    i += 2; // Skip the next symbol since we used it
                } else {
                    latex += symbol.symbol;
                }
                break;
                
            case '√': // Square root
                if (i < symbols.length - 1) {
                    const radicand = symbols[i + 1];
                    
                    // Create square root: \sqrt{radicand}
                    latex += `\\sqrt{${radicand.symbol}}`;
                    i += 1; // Skip the next symbol since we used it
                } else {
                    latex += `\\sqrt{}`;
                }
                break;
                
            default:
                latex += symbol.symbol;
                break;
        }
        
        if (i < symbols.length - 1 && symbol.symbol !== '/' && symbol.symbol !== '^' && symbol.symbol !== '√') {
            i++;
        } else if (i < symbols.length - 1) {
            // Already incremented in the special cases
        } else {
            i++;
        }
    }
    
    return latex;
}

/**
 * Recognizes an equation from normalized strokes
 * @param {Array} normalizedStrokes - Array of normalized strokes from ink-pipeline.js
 * @returns {Object} Recognition result with text, confidence, and symbols
 */
export function recognizeInkEquation(normalizedStrokes) {
    if (!Array.isArray(normalizedStrokes) || normalizedStrokes.length === 0) {
        return { text: '', confidence: 0, symbols: [] };
    }
    
    // Convert normalized strokes to stroke info objects
    const strokeInfos = normalizedStrokes
        .filter(stroke => stroke?.bbox && Array.isArray(stroke.points))
        .map(stroke => strokeInfo(stroke));
    if (!strokeInfos.length) return { text: '', confidence: 0, symbols: [] };
    
    // Group related strokes
    const groups = groupStrokes(strokeInfos);
    
    // Recognize symbols from each group
    const symbols = groups.map(group => {
        const recognition = recognizeGroup(group);
        // Calculate overall confidence based on individual stroke confidences
        const avgConfidence = group.reduce((sum, stroke) => sum + recognition.confidence, 0) / group.length;
        return {
            ...recognition,
            confidence: avgConfidence,
            bbox: group[0].bbox
        };
    });
    
    if (symbols.length === 0) {
        return { text: '', confidence: 0, symbols: [] };
    }
    
    // Calculate overall confidence as average of all symbol confidences
    const overallConfidence = symbols.reduce((sum, symbol) => sum + symbol.confidence, 0) / symbols.length;
    
    // Convert symbols to LaTeX
    const latex = symbolsToLatex(symbols);
    
    // Convert to readable text as well
    let text = '';
    symbols.forEach(symbol => {
        text += symbol.symbol;
    });
    
    return {
        text: text,
        latex: latex,
        confidence: overallConfidence,
        symbols: symbols,
        equationType: classifyEquationType(symbols)
    };
}

/**
 * Classifies the type of equation based on symbols
 * @param {Array} symbols - Array of recognized symbols
 * @returns {string} Equation type classification
 */
function classifyEquationType(symbols) {
    const symbolText = symbols.map(s => s.symbol).join('');
    
    if (symbolText.includes('=')) return 'equation';
    if (symbolText.includes('/') && symbolText.includes('{')) return 'fraction';
    if (symbolText.includes('^')) return 'exponential';
    if (symbolText.includes('√')) return 'radical';
    if (['+', '-', '*', '÷'].some(op => symbolText.includes(op))) return 'expression';
    
    return 'unknown';
}

/**
 * Creates a Fabric object for displaying the recognized equation
 * @param {Object} recognitionResult - Result from recognizeInkEquation
 * @param {Object} originalBBox - Original bounding box for positioning
 * @param {string} textColor - Text color for the equation display
 * @returns {fabric.Text|fabric.Group|null} Fabric object for the equation
 */
export function createEquationObject(recognitionResult, originalBBox, textColor = '#ffffff') {
    if (!recognitionResult || !recognitionResult.text || recognitionResult.confidence < 0.5) {
        return null;
    }
    
    const text = recognitionResult.text;
    
    // Calculate font size based on the original bounding box
    const fontSize = Math.max(16, Math.min(originalBBox.height * 0.8, 36));
    
    // Create a Fabric text object for the recognized equation
    const equationObject = new fabric.Text(text, {
        left: originalBBox.left,
        top: originalBBox.top,
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
        // Store recognition info for reference
        boardflowOriginalStrokes: recognitionResult.symbols,
        boardflowRecognitionResult: recognitionResult
    });
    
    // Position the equation object within the original stroke bounds
    equationObject.set({
        top: originalBBox.top + (originalBBox.height - equationObject.height) / 2
    });
    
    return equationObject;
}

/**
 * Main function to recognize equations from normalized strokes and convert to canvas objects
 * @param {Array} normalizedStrokes - Array of normalized strokes from ink-pipeline.js
 * @param {Object} desktopBridge - Desktop bridge for enhanced recognition (optional)
 * @returns {Promise<Object|null>} Recognition result with converted equation object
 */
export async function recognizeAndConvertEquation(normalizedStrokes, desktopBridge) {
    // Perform equation recognition
    const recognitionResult = recognizeInkEquation(normalizedStrokes);
    
    if (!recognitionResult || recognitionResult.confidence < 0.5 || !recognitionResult.text) {
        return null;
    }
    
    // Determine the overall bounding box for positioning
    let overallBBox = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    
    normalizedStrokes.forEach(stroke => {
        const bbox = stroke.bbox;
        overallBBox.left = Math.min(overallBBox.left, bbox.left);
        overallBBox.top = Math.min(overallBBox.top, bbox.top);
        overallBBox.right = Math.max(overallBBox.right, bbox.left + bbox.width);
        overallBBox.bottom = Math.max(overallBBox.bottom, bbox.top + bbox.height);
    });
    
    overallBBox = {
        left: overallBBox.left,
        top: overallBBox.top,
        width: overallBBox.right - overallBBox.left,
        height: overallBBox.bottom - overallBBox.top
    };
    
    // Create a Fabric object for the recognized equation
    const equationObject = createEquationObject(recognitionResult, overallBBox);
    
    return {
        text: recognitionResult.text,
        latex: recognitionResult.latex,
        confidence: recognitionResult.confidence,
        equationType: recognitionResult.equationType,
        symbols: recognitionResult.symbols,
        equationObject: equationObject
    };
}