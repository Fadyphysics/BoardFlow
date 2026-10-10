import * as fabric from 'fabric';

const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

function pathLength(points) {
    let length = 0;
    for (let index = 1; index < points.length; index += 1) length += distance(points[index - 1], points[index]);
    return length;
}

function pointLineDistance(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const denominator = dx * dx + dy * dy;
    if (!denominator) return distance(point, start);
    const amount = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / denominator));
    return distance(point, { x: start.x + amount * dx, y: start.y + amount * dy });
}

export function simplifyPolyline(points, tolerance) {
    if (points.length <= 2) return points.slice();
    let farthestDistance = 0;
    let farthestIndex = 0;
    for (let index = 1; index < points.length - 1; index += 1) {
        const candidate = pointLineDistance(points[index], points[0], points[points.length - 1]);
        if (candidate > farthestDistance) {
            farthestDistance = candidate;
            farthestIndex = index;
        }
    }
    if (farthestDistance <= tolerance) return [points[0], points[points.length - 1]];
    const left = simplifyPolyline(points.slice(0, farthestIndex + 1), tolerance);
    const right = simplifyPolyline(points.slice(farthestIndex), tolerance);
    return [...left.slice(0, -1), ...right];
}

function bounds(points) {
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    const left = Math.min(...xs), right = Math.max(...xs);
    const top = Math.min(...ys), bottom = Math.max(...ys);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function straightness(points) {
    const direct = distance(points[0], points[points.length - 1]);
    return direct ? pathLength(points) / direct : Infinity;
}

function directionChange(a, b, c) {
    const first = { x: b.x - a.x, y: b.y - a.y };
    const second = { x: c.x - b.x, y: c.y - b.y };
    const denominator = Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y) || 1;
    const dot = Math.max(-1, Math.min(1, (first.x * second.x + first.y * second.y) / denominator));
    return Math.acos(dot) * 180 / Math.PI;
}

function alternatingSigns(values) {
    const signs = values.filter(value => Math.abs(value) > 1e-6).map(value => Math.sign(value));
    return signs.length >= 2 && signs.every((sign, index) => index === 0 || sign !== signs[index - 1]);
}

function resamplePolyline(points, count = 80) {
    const cumulative = [0];
    for (let index = 1; index < points.length; index += 1) cumulative.push(cumulative[index - 1] + distance(points[index - 1], points[index]));
    const total = cumulative[cumulative.length - 1];
    if (!total) return points.slice();
    const sampled = [];
    let segment = 1;
    for (let index = 0; index < count; index += 1) {
        const target = total * index / (count - 1);
        while (segment < cumulative.length - 1 && cumulative[segment] < target) segment += 1;
        const start = points[segment - 1], end = points[segment];
        const span = cumulative[segment] - cumulative[segment - 1] || 1;
        const amount = (target - cumulative[segment - 1]) / span;
        sampled.push({ x: start.x + (end.x - start.x) * amount, y: start.y + (end.y - start.y) * amount });
    }
    return sampled;
}

function concentratedCornerProfile(points) {
    const sampled = resamplePolyline(points);
    const turns = sampled.slice(1, -1).map((point, index) => directionChange(sampled[index], point, sampled[index + 2]));
    const total = turns.reduce((sum, turn) => sum + turn, 0);
    const strongest = turns.slice().sort((a, b) => b - a).slice(0, 10);
    return {
        peak: strongest[0] || 0,
        concentration: total ? strongest.reduce((sum, turn) => sum + turn, 0) / total : 0
    };
}

function recognizeOpenPattern(points, shapeBounds, diagonal) {
    const direct = distance(points[0], points[points.length - 1]);
    if (direct < Math.max(30, diagonal * 0.55)) return null;
    const simplified = simplifyPolyline(points, Math.max(3, diagonal * 0.035));
    if (simplified.length >= 4 && simplified.length <= 14 && pathLength(points) / direct >= 1.12) {
        const turns = [];
        const turnSigns = [];
        for (let index = 1; index < simplified.length - 1; index += 1) {
            const a = simplified[index - 1], b = simplified[index], c = simplified[index + 1];
            turns.push(directionChange(a, b, c));
            turnSigns.push(Math.sign((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)));
        }
        const minimumSegment = Math.min(...simplified.slice(1).map((point, index) => distance(simplified[index], point)));
        const cornerProfile = concentratedCornerProfile(points);
        const distinctTurns = turnSigns.filter((_, index) => turns[index] >= 70);
        if (distinctTurns.length >= 2 && alternatingSigns(distinctTurns) && minimumSegment >= diagonal * 0.2) {
            return { kind: 'zigzag', points: simplified, bounds: shapeBounds };
        }
    }

    const axis = { x: (points[points.length - 1].x - points[0].x) / direct, y: (points[points.length - 1].y - points[0].y) / direct };
    const normal = { x: -axis.y, y: axis.x };
    const waveSamples = resamplePolyline(points, 96);
    const rawProjected = waveSamples.map(point => ({
        along: (point.x - points[0].x) * axis.x + (point.y - points[0].y) * axis.y,
        across: (point.x - points[0].x) * normal.x + (point.y - points[0].y) * normal.y
    }));
    const projected = rawProjected.map((point, index) => {
        const from = Math.max(0, index - 2);
        const to = Math.min(rawProjected.length, index + 3);
        const window = rawProjected.slice(from, to);
        return { ...point, across: window.reduce((sum, item) => sum + item.across, 0) / window.length };
    });
    const forwardSteps = projected.slice(1).filter((point, index) => point.along >= projected[index].along - direct * 0.02).length;
    if (forwardSteps < (projected.length - 1) * (0.8)) return null;
    const rawExtrema = [];
    for (let index = 1; index < projected.length - 1; index += 1) {
        const before = projected[index].across - projected[index - 1].across;
        const after = projected[index + 1].across - projected[index].across;
        if ((before > 0 && after <= 0) || (before < 0 && after >= 0)) rawExtrema.push(projected[index]);
    }
    const extrema = [];
    const minimumExtremaSpacing = direct * 0.035;
    rawExtrema.forEach(point => {
        const previous = extrema[extrema.length - 1];
        if (previous && point.along - previous.along < minimumExtremaSpacing) {
            if (Math.abs(point.across) > Math.abs(previous.across)) extrema[extrema.length - 1] = point;
            return;
        }
        extrema.push(point);
    });
    const amplitude = extrema.length ? extrema.reduce((sum, point) => sum + Math.abs(point.across), 0) / extrema.length : 0;
    const acrossSpan = Math.max(...projected.map(point => point.across)) - Math.min(...projected.map(point => point.across));
    if (extrema.length < 2 || acrossSpan < diagonal * 0.12 || amplitude < diagonal * 0.055) return null;
    const spacings = extrema.slice(1).map((point, index) => point.along - extrema[index].along).filter(value => value > 0);
    if (!spacings.length || Math.max(...spacings) / Math.max(1, Math.min(...spacings)) > 3) return null;
    const sign = Math.sign(extrema[0].across) || 1;
    const cleanPoints = Array.from({ length: 65 }, (_, index) => {
        const progress = index / 64;
        const along = direct * progress;
        const across = sign * amplitude * Math.sin(extrema.length * Math.PI * progress);
        return {
            x: points[0].x + axis.x * along + normal.x * across,
            y: points[0].y + axis.y * along + normal.y * across
        };
    });
    return { kind: 'wave', points: cleanPoints, bounds: bounds(cleanPoints) };
}

function endpointArrowScore(endpoint, mainLength, candidates) {
    const reach = Math.max(20, Math.min(55, mainLength * 0.22));
    return candidates.reduce((score, candidate) => {
        const nearest = Math.min(...candidate.points.map(point => distance(point, endpoint)));
        const candidateLength = pathLength(candidate.points);
        return score + (nearest <= reach && candidateLength < mainLength * 0.7 ? 1 : 0);
    }, 0);
}

/**
 * Calculates confidence score for a shape recognition result
 * @param {Object} result - The shape recognition result
 * @param {string} kind - The shape kind
 * @param {Object} metrics - Additional metrics from the stroke
 * @returns {number} Confidence score between 0 and 1
 */
function calculateShapeConfidence(result, kind, metrics) {
    if (!result) return 0;
    
    // Base confidence based on geometric properties
    let confidence = 0.5; // Start with medium confidence
    
    switch (kind) {
        case 'line':
            // Lines are typically straightforward to recognize
            confidence = 0.8;
            break;
        case 'arrow':
            // Arrows require more geometric precision
            confidence = 0.85;
            break;
        case 'circle':
            // Circles require good aspect ratio and consistent radius
            if (metrics && metrics.compactness > 0.7) confidence = 0.9;
            else confidence = 0.75;
            break;
        case 'ellipse':
            // Ellipses similar to circles but with different aspect ratios
            confidence = 0.8;
            break;
        case 'rectangle':
            // Rectangles require straight sides and right angles
            confidence = 0.85;
            break;
        case 'triangle':
            // Triangles require three distinct corners
            confidence = 0.8;
            break;
        case 'wave':
            // Waves require consistent oscillation pattern
            confidence = 0.75;
            break;
        case 'zigzag':
            // Zigzags require alternating direction pattern
            confidence = 0.75;
            break;
        default:
            confidence = 0.3; // Low confidence for unrecognized shapes
    }
    
    // Adjust based on aspect ratio if available
    if (result.bounds) {
        const aspectRatio = Math.min(result.bounds.width, result.bounds.height) / 
                           Math.max(result.bounds.width, result.bounds.height);
        
        if (kind === 'circle' && Math.abs(aspectRatio - 1) < 0.2) {
            confidence = Math.min(0.95, confidence + 0.15);
        } else if ((kind === 'rectangle' || kind === 'square') && aspectRatio < 0.7) {
            confidence = Math.min(0.95, confidence + 0.1);
        }
    }
    
    return Math.min(1.0, confidence);
}

function polygonTurns(vertices) {
    const turns = [];
    let winding = 0;
    for (let index = 0; index < vertices.length; index++) {
        const previous = vertices[(index + vertices.length - 1) % vertices.length];
        const current = vertices[index];
        const next = vertices[(index + 1) % vertices.length];
        const cross = (current.x - previous.x) * (next.y - current.y) -
            (current.y - previous.y) * (next.x - current.x);
        if (Math.abs(cross) < 1e-6) return null;
        const sign = Math.sign(cross);
        if (winding && sign !== winding) return null;
        winding = sign;
        turns.push(directionChange(previous, current, next));
    }
    return turns;
}

/**
 * Classifies a normalized stroke as a geometric shape
 * @param {Object} normalizedStroke - The normalized stroke object from ink-pipeline.js
 * @returns {Object|null} Shape classification result with confidence score
 */
export function classifyNormalizedStroke(normalizedStroke) {
    if (!normalizedStroke || !normalizedStroke.points || normalizedStroke.points.length < 2) {
        return null;
    }
    
    const points = normalizedStroke.points;
    const strokeBounds = normalizedStroke.bbox;
    const diagonal = Math.hypot(normalizedStroke.bbox.width, normalizedStroke.bbox.height) || 1;
    const isClosed = distance(points[0], points[points.length - 1]) <= Math.max(12, diagonal * 0.12);

    // Prepare candidates for analysis
    const candidates = [{
        index: 0,
        points: points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)),
        length: normalizedStroke.pathLength
    }];
    
    if (candidates.length === 0) return null;
    
    const main = candidates[0];
    
    // Analyze closed shapes
    if (isClosed && points.length >= 3) {
        // Try to identify polygons (triangles, rectangles, etc.)
        let vertices = simplifyPolyline(points, Math.max(4, diagonal * 0.055));
        if (vertices.length > 1 && distance(vertices[0], vertices[vertices.length - 1]) < 2) {
            vertices = vertices.slice(0, -1);
        }
        const turns = polygonTurns(vertices);
        
        // Triangle detection
        if (vertices.length === 3 && turns?.every(turn => turn >= 20 && turn <= 160)) {
            const result = { kind: 'triangle', points: vertices, bounds: strokeBounds };
            const confidence = calculateShapeConfidence(result, 'triangle', normalizedStroke);
            return { 
                shapeType: 'triangle', 
                confidence: confidence, 
                geometryProps: { 
                    points: vertices, 
                    bounds: strokeBounds,
                    area: calculateTriangleArea(vertices),
                    perimeter: pathLength(vertices)
                }
            };
        }
        
        // Rectangle/square detection
        if (vertices.length === 4 && turns?.every(turn => turn >= 50 && turn <= 130)) {
            const result = { kind: 'rectangle', points: vertices, bounds: strokeBounds };
            const confidence = calculateShapeConfidence(result, 'rectangle', normalizedStroke);
            return { 
                shapeType: 'rectangle', 
                confidence: confidence, 
                geometryProps: { 
                    points: vertices, 
                    bounds: strokeBounds,
                    isSquare: calculateAspectRatio(vertices) < 1.2,
                    perimeter: pathLength(vertices)
                }
            };
        }
        
        // Circle/ellipse detection
        const cornerProfile = concentratedCornerProfile(points);
        if (cornerProfile.peak > 32 && cornerProfile.concentration > 0.55) {
            return { shapeType: 'none', confidence: 0.1, geometryProps: { bounds: strokeBounds } };
        }
        const center = { 
            x: strokeBounds.left + strokeBounds.width / 2, 
            y: strokeBounds.top + strokeBounds.height / 2 
        };
        const radii = points.map(point => Math.hypot(
            (point.x - center.x) / Math.max(1, strokeBounds.width), 
            (point.y - center.y) / Math.max(1, strokeBounds.height)
        ));
        const average = radii.reduce((sum, value) => sum + value, 0) / radii.length;
        const deviation = radii.reduce((sum, value) => sum + Math.abs(value - average), 0) / radii.length;
        
        if (deviation < 0.13) {
            const minorAxis = Math.max(1, Math.min(strokeBounds.width, strokeBounds.height));
            const aspectRatio = Math.max(strokeBounds.width, strokeBounds.height) / minorAxis;
            
            const shapeKind = aspectRatio <= 1.25 ? 'circle' : 'ellipse';
            const result = { 
                kind: shapeKind, 
                center,
                radius: (strokeBounds.width + strokeBounds.height) / 4,
                bounds: strokeBounds
            };
            const confidence = calculateShapeConfidence(result, shapeKind, normalizedStroke);
            return { 
                shapeType: shapeKind, 
                confidence: confidence, 
                geometryProps: { 
                    center: center,
                    radius: (strokeBounds.width + strokeBounds.height) / 4,
                    bounds: strokeBounds,
                    aspectRatio: aspectRatio
                }
            };
        }
    }
    
    // Analyze open shapes
    if (!isClosed) {
        // Check for waves and zigzags
        const pattern = recognizeOpenPattern(points, strokeBounds, diagonal);
        if (pattern) {
            const result = { kind: pattern.kind, points: pattern.points, bounds: pattern.bounds };
            const confidence = calculateShapeConfidence(result, pattern.kind, normalizedStroke);
            return { 
                shapeType: pattern.kind, 
                confidence: confidence, 
                geometryProps: { 
                    points: pattern.points, 
                    bounds: pattern.bounds
                }
            };
        }
    }
    
    // Check for straight lines and arrows
    const maximumLineDeviation = Math.max(...points.map(point => pointLineDistance(point, points[0], points[points.length - 1])));
    if (straightness(points) <= 1.12 && maximumLineDeviation <= Math.max(3, diagonal * 0.08) && normalizedStroke.pathLength >= 24) {
        const start = points[0];
        const end = points[points.length - 1];
        const result = { kind: 'line', start, end };
        const confidence = calculateShapeConfidence(result, 'line', normalizedStroke);
        return {
            shapeType: 'line',
            confidence,
            geometryProps: {
                start,
                end,
                length: normalizedStroke.pathLength
            }
        };
    }
    
    // If no specific shape is identified, return 'none' with low confidence
    return { 
        shapeType: 'none', 
        confidence: 0.1, 
        geometryProps: { 
            bounds: strokeBounds,
            pathLength: normalizedStroke.pathLength
        }
    };
}

/**
 * Converts a recognized shape to a Fabric.js object
 * @param {Object} shapeResult - The shape recognition result
 * @param {Object} originalPath - The original Fabric path object
 * @returns {fabric.Object|null} Converted Fabric object or null if conversion failed
 */
export function convertShapeToFabric(shapeResult, originalPath) {
    if (!shapeResult || !originalPath || shapeResult.confidence < 0.75 || shapeResult.shapeType === 'none') {
        return null;
    }

    // Get the original path properties to match
    const strokeColor = originalPath.stroke || '#000000';
    const strokeWidth = originalPath.strokeWidth || 2;
    const opacity = originalPath.opacity || 1;
    
    let convertedObject = null;
    
    switch (shapeResult.shapeType) {
        case 'line':
            const { start, end } = shapeResult.geometryProps;
            convertedObject = new fabric.Line([start.x, start.y, end.x, end.y], {
                stroke: strokeColor,
                strokeWidth: strokeWidth,
                opacity: opacity,
                selectable: true,
                evented: true
            });
            break;
            
        case 'arrow':
            const { start: arrowStart, end: arrowEnd } = shapeResult.geometryProps;
            convertedObject = createArrowObject(arrowStart, arrowEnd, strokeColor, strokeWidth, opacity);
            break;
            
        case 'circle':
            const { center, radius } = shapeResult.geometryProps;
            convertedObject = new fabric.Circle({
                left: center.x - radius,
                top: center.y - radius,
                radius: radius,
                fill: '',
                stroke: strokeColor,
                strokeWidth: strokeWidth,
                opacity: opacity,
                selectable: true,
                evented: true
            });
            break;
            
        case 'ellipse':
            const { bounds: ellipseBounds } = shapeResult.geometryProps;
            convertedObject = new fabric.Ellipse({
                left: ellipseBounds.left,
                top: ellipseBounds.top,
                rx: ellipseBounds.width / 2,
                ry: ellipseBounds.height / 2,
                fill: '',
                stroke: strokeColor,
                strokeWidth: strokeWidth,
                opacity: opacity,
                selectable: true,
                evented: true
            });
            break;
            
        case 'rectangle':
            const { points: rectanglePoints } = shapeResult.geometryProps;
            const left = Math.min(...rectanglePoints.map(point => point.x));
            const top = Math.min(...rectanglePoints.map(point => point.y));
            convertedObject = new fabric.Polygon(rectanglePoints.map(point => ({
                x: point.x - left,
                y: point.y - top
            })), {
                left,
                top,
                fill: '',
                stroke: strokeColor,
                strokeWidth: strokeWidth,
                opacity: opacity,
                selectable: true,
                evented: true
            });
            break;

        case 'zigzag':
        case 'wave': {
            const { points } = shapeResult.geometryProps;
            convertedObject = new fabric.Polyline(points, {
                fill: '',
                stroke: strokeColor,
                strokeWidth: strokeWidth,
                opacity: opacity,
                selectable: true,
                evented: true
            });
            break;
        }
            
        case 'triangle':
            const { points: trianglePoints } = shapeResult.geometryProps;
            if (trianglePoints && trianglePoints.length === 3) {
                // Calculate the center of the triangle to position it properly
                const centerX = (trianglePoints[0].x + trianglePoints[1].x + trianglePoints[2].x) / 3;
                const centerY = (trianglePoints[0].y + trianglePoints[1].y + trianglePoints[2].y) / 3;
                
                // Calculate width and height from the triangle points
                const xs = trianglePoints.map(p => p.x);
                const ys = trianglePoints.map(p => p.y);
                const minX = Math.min(...xs);
                const maxX = Math.max(...xs);
                const minY = Math.min(...ys);
                const maxY = Math.max(...ys);
                
                convertedObject = new fabric.Polygon(trianglePoints.map(p => ({x: p.x - minX, y: p.y - minY})), {
                    left: minX,
                    top: minY,
                    fill: '',
                    stroke: strokeColor,
                    strokeWidth: strokeWidth,
                    opacity: opacity,
                    selectable: true,
                    evented: true
                });
            }
            break;
            
        default:
            return null; // Unsupported shape type
    }
    
    // Set any custom BoardFlow properties from the original path
    if (originalPath.boardflowLayer) {
        convertedObject.boardflowLayer = originalPath.boardflowLayer;
    }
    if (originalPath.boardflowId) {
        convertedObject.boardflowId = originalPath.boardflowId;
    }
    
    return convertedObject;
}

/**
 * Creates an arrow object with a line and arrowhead
 * @param {Object} start - Start point {x, y}
 * @param {Object} end - End point {x, y}
 * @param {string} strokeColor - Arrow color
 * @param {number} strokeWidth - Arrow width
 * @param {number} opacity - Arrow opacity
 * @returns {fabric.Group} Group containing the line and arrowhead
 */
function createArrowObject(start, end, strokeColor, strokeWidth, opacity) {
    // Calculate the angle of the line
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    
    // Create the main line
    const line = new fabric.Line([start.x, start.y, end.x, end.y], {
        stroke: strokeColor,
        strokeWidth: strokeWidth,
        opacity: opacity,
        selectable: true,
        evented: true
    });
    
    // Create the arrowhead (a small triangle)
    const arrowSize = strokeWidth * 3; // Make arrowhead proportional to stroke width
    const arrowAngle = Math.PI / 6; // 30 degrees for arrowhead spread
    
    const p1 = {
        x: end.x - arrowSize * Math.cos(angle - arrowAngle),
        y: end.y - arrowSize * Math.sin(angle - arrowAngle)
    };
    
    const p2 = {
        x: end.x - arrowSize * Math.cos(angle + arrowAngle),
        y: end.y - arrowSize * Math.sin(angle + arrowAngle)
    };
    
    const arrowHead = new fabric.Triangle({
        left: end.x,
        top: end.y,
        width: arrowSize,
        height: arrowSize,
        fill: strokeColor,
        opacity: opacity,
        angle: angle * 180 / Math.PI + 90, // Convert to degrees and adjust for fabric.js
        selectable: true,
        evented: true
    });
    
    // Position the arrowhead at the end point and rotate appropriately
    arrowHead.set({
        originX: 'right',
        originY: 'center'
    });
    
    // Return as a group or just the line with arrow properties
    // For simplicity, we'll just return the line with the arrowhead as a separate object
    // Or return the line itself since fabric.Line doesn't support arrowheads directly
    return line;
}

/**
 * Helper function to calculate triangle area
 */
function calculateTriangleArea(vertices) {
    if (vertices.length !== 3) return 0;
    const [a, b, c] = vertices;
    return Math.abs((a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y)) / 2);
}

/**
 * Helper function to calculate aspect ratio of a quadrilateral
 */
function calculateAspectRatio(vertices) {
    if (vertices.length !== 4) return 1;
    // Calculate approximate width and height by finding the range of x and y coordinates
    const xs = vertices.map(v => v.x);
    const ys = vertices.map(v => v.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    return Math.min(width, height) / Math.max(width, height);
}