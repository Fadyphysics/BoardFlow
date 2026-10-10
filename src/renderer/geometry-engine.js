/**
 * Geometry Engine - Analyzes geometric properties of Fabric.js objects
 * Provides spatial math calculations and visual overlays for canvas objects
 */

/**
 * Calculates the Euclidean distance between two points
 * @param {Object} p1 - Point {x, y}
 * @param {Object} p2 - Point {x, y}
 * @returns {number} Distance between points
 */
function distance(p1, p2) {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

/**
 * Calculates the angle of a line in degrees relative to horizontal
 * @param {Object} p1 - Start point {x, y}
 * @param {Object} p2 - End point {x, y}
 * @returns {number} Angle in degrees (0-360)
 */
function lineAngle(p1, p2) {
    const radians = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    let degrees = radians * (180 / Math.PI);
    if (degrees < 0) degrees += 360;
    return degrees;
}

/**
 * Calculates the slope of a line
 * @param {Object} p1 - Start point {x, y}
 * @param {Object} p2 - End point {x, y}
 * @returns {number} Slope of the line
 */
function lineSlope(p1, p2) {
    if (p2.x === p1.x) return Infinity; // Vertical line
    return (p2.y - p1.y) / (p2.x - p1.x);
}

/**
 * Finds the midpoint of a line segment
 * @param {Object} p1 - Start point {x, y}
 * @param {Object} p2 - End point {x, y}
 * @returns {Object} Midpoint {x, y}
 */
function lineMidpoint(p1, p2) {
    return {
        x: (p1.x + p2.x) / 2,
        y: (p1.y + p2.y) / 2
    };
}

/**
 * Calculates intersection point of two line segments
 * @param {Object} line1 - First line {x1, y1, x2, y2}
 * @param {Object} line2 - Second line {x1, y1, x2, y2}
 * @returns {Object|null} Intersection point {x, y} or null if no intersection
 */
function findLineIntersection(line1, line2) {
    const x1 = line1.x1, y1 = line1.y1, x2 = line1.x2, y2 = line1.y2;
    const x3 = line2.x1, y3 = line2.y1, x4 = line2.x2, y4 = line2.y2;
    
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-10) return null; // Lines are parallel
    
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
    
    // Check if intersection is within both line segments
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
        return {
            x: x1 + t * (x2 - x1),
            y: y1 + t * (y2 - y1)
        };
    }
    
    return null;
}

/**
 * Calculates the area of a polygon using the shoelace formula
 * @param {Array} points - Array of points [{x, y}]
 * @returns {number} Area of the polygon
 */
function polygonArea(points) {
    if (points.length < 3) return 0;
    
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    return Math.abs(area) / 2;
}

/**
 * Calculates the perimeter of a polygon
 * @param {Array} points - Array of points [{x, y}]
 * @returns {number} Perimeter of the polygon
 */
function polygonPerimeter(points) {
    if (points.length < 2) return 0;
    
    let perimeter = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        perimeter += distance(points[i], points[j]);
    }
    return perimeter;
}

/**
 * Calculates interior angles of a polygon
 * @param {Array} points - Array of points [{x, y}]
 * @returns {Array} Array of angles in degrees
 */
function polygonInteriorAngles(points) {
    if (points.length < 3) return [];
    
    const angles = [];
    for (let i = 0; i < points.length; i++) {
        const prev = points[(i - 1 + points.length) % points.length];
        const current = points[i];
        const next = points[(i + 1) % points.length];
        
        const angle1 = Math.atan2(prev.y - current.y, prev.x - current.x);
        const angle2 = Math.atan2(next.y - current.y, next.x - current.x);
        
        let diff = angle2 - angle1;
        if (diff < 0) diff += 2 * Math.PI;
        
        angles.push(diff * (180 / Math.PI));
    }
    return angles;
}

/**
 * Analyzes a Fabric line object
 * @param {fabric.Line} line - Fabric line object
 * @returns {Object} Geometric properties
 */
function analyzeLine(line) {
    const p1 = { x: line.x1, y: line.y1 };
    const p2 = { x: line.x2, y: line.y2 };
    
    return {
        type: 'line',
        length: distance(p1, p2),
        angle: lineAngle(p1, p2),
        slope: lineSlope(p1, p2),
        midpoint: lineMidpoint(p1, p2),
        start: p1,
        end: p2
    };
}

/**
 * Analyzes a Fabric rectangle object
 * @param {fabric.Rect} rect - Fabric rectangle object
 * @returns {Object} Geometric properties
 */
function analyzeRectangle(rect) {
    const left = rect.left;
    const top = rect.top;
    const width = rect.width;
    const height = rect.height;
    
    const vertices = [
        { x: left, y: top },
        { x: left + width, y: top },
        { x: left + width, y: top + height },
        { x: left, y: top + height }
    ];
    
    return {
        type: 'rectangle',
        vertices: vertices,
        area: Math.abs(width * height),
        perimeter: 2 * (Math.abs(width) + Math.abs(height)),
        width: Math.abs(width),
        height: Math.abs(height),
        center: { x: left + width / 2, y: top + height / 2 },
        interiorAngles: [90, 90, 90, 90]
    };
}

/**
 * Analyzes a Fabric triangle object
 * @param {fabric.Triangle} triangle - Fabric triangle object
 * @returns {Object} Geometric properties
 */
function analyzeTriangle(triangle) {
    // Get the three vertices of the triangle
    const left = triangle.left || 0;
    const top = triangle.top || 0;
    const width = triangle.width || 0;
    const height = triangle.height || 0;
    
    // Calculate vertices based on fabric's triangle positioning
    const vertices = [
        { x: left, y: top + height },  // Bottom left
        { x: left + width / 2, y: top }, // Top center
        { x: left + width, y: top + height } // Bottom right
    ];
    
    return {
        type: 'triangle',
        vertices: vertices,
        area: polygonArea(vertices),
        perimeter: polygonPerimeter(vertices),
        interiorAngles: polygonInteriorAngles(vertices),
        center: {
            x: (vertices[0].x + vertices[1].x + vertices[2].x) / 3,
            y: (vertices[0].y + vertices[1].y + vertices[2].y) / 3
        }
    };
}

/**
 * Analyzes a Fabric polygon object
 * @param {fabric.Polygon} polygon - Fabric polygon object
 * @returns {Object} Geometric properties
 */
function analyzePolygon(polygon) {
    const originalPoints = polygon.points;
    const left = polygon.left || 0;
    const top = polygon.top || 0;
    
    // Transform points to absolute coordinates
    const vertices = originalPoints.map(point => ({
        x: left + point.x,
        y: top + point.y
    }));
    
    return {
        type: 'polygon',
        vertices: vertices,
        area: polygonArea(vertices),
        perimeter: polygonPerimeter(vertices),
        interiorAngles: polygonInteriorAngles(vertices),
        center: calculateCentroid(vertices)
    };
}

/**
 * Analyzes a Fabric circle object
 * @param {fabric.Circle} circle - Fabric circle object
 * @returns {Object} Geometric properties
 */
function analyzeCircle(circle) {
    return {
        type: 'circle',
        center: { x: circle.left + circle.radius, y: circle.top + circle.radius },
        radius: circle.radius,
        diameter: 2 * circle.radius,
        circumference: 2 * Math.PI * circle.radius,
        area: Math.PI * Math.pow(circle.radius, 2)
    };
}

/**
 * Analyzes a Fabric ellipse object
 * @param {fabric.Ellipse} ellipse - Fabric ellipse object
 * @returns {Object} Geometric properties
 */
function analyzeEllipse(ellipse) {
    return {
        type: 'ellipse',
        center: { x: ellipse.left + ellipse.rx, y: ellipse.top + ellipse.ry },
        rx: ellipse.rx,
        ry: ellipse.ry,
        circumference: Math.PI * (3 * (ellipse.rx + ellipse.ry) - 
                      Math.sqrt((3 * ellipse.rx + ellipse.ry) * (ellipse.rx + 3 * ellipse.ry))),
        area: Math.PI * ellipse.rx * ellipse.ry
    };
}

/**
 * Calculates centroid of a polygon
 * @param {Array} vertices - Array of vertex points
 * @returns {Object} Centroid point
 */
function calculateCentroid(vertices) {
    if (vertices.length === 0) return { x: 0, y: 0 };
    
    let signedArea = 0;
    let cx = 0;
    let cy = 0;
    
    for (let i = 0; i < vertices.length; i++) {
        const j = (i + 1) % vertices.length;
        const factor = (vertices[i].x * vertices[j].y - vertices[j].x * vertices[i].y);
        signedArea += factor;
        cx += (vertices[i].x + vertices[j].x) * factor;
        cy += (vertices[i].y + vertices[j].y) * factor;
    }
    
    signedArea /= 2;
    cx /= (6 * signedArea);
    cy /= (6 * signedArea);
    
    return { x: cx, y: cy };
}

/**
 * Checks if two lines are parallel (within 3 degrees)
 * @param {Object} line1 - First line analysis result
 * @param {Object} line2 - Second line analysis result
 * @returns {boolean} True if lines are parallel
 */
function areLinesParallel(line1, line2) {
    if (line1.type !== 'line' || line2.type !== 'line') return false;
    
    const angleDiff = Math.abs(line1.angle - line2.angle);
    const normalizedAngleDiff = Math.min(angleDiff, 180 - angleDiff);
    
    return normalizedAngleDiff <= 3; // Within 3 degrees
}

/**
 * Checks if two lines are perpendicular (90 degrees ± 3 degrees)
 * @param {Object} line1 - First line analysis result
 * @param {Object} line2 - Second line analysis result
 * @returns {boolean} True if lines are perpendicular
 */
function areLinesPerpendicular(line1, line2) {
    if (line1.type !== 'line' || line2.type !== 'line') return false;
    
    const angleDiff = Math.abs(line1.angle - line2.angle);
    const normalizedAngleDiff = Math.min(angleDiff, 180 - angleDiff);
    
    return Math.abs(normalizedAngleDiff - 90) <= 3; // Within 3 degrees of 90
}

/**
 * Analyzes selected objects on the canvas
 * @param {fabric.Canvas} canvas - Fabric canvas instance
 * @returns {Array} Array of geometric analysis results
 */
export function analyzeSelectedObjects(canvas) {
    const selectedObjects = canvas.getActiveObjects ? canvas.getActiveObjects() : [];
    const results = [];
    
    for (const obj of selectedObjects) {
        let analysis = null;
        
        if (obj.type === 'line') {
            analysis = analyzeLine(obj);
        } else if (obj.type === 'rect') {
            analysis = analyzeRectangle(obj);
        } else if (obj.type === 'triangle') {
            analysis = analyzeTriangle(obj);
        } else if (obj.type === 'polygon') {
            analysis = analyzePolygon(obj);
        } else if (obj.type === 'circle') {
            analysis = analyzeCircle(obj);
        } else if (obj.type === 'ellipse') {
            analysis = analyzeEllipse(obj);
        }
        
        if (analysis) {
            // Attach geometric data to the object
            obj.geometryData = analysis;
            results.push(analysis);
        }
    }
    
    return results;
}

/**
 * Analyzes all objects on the canvas
 * @param {fabric.Canvas} canvas - Fabric canvas instance
 * @returns {Array} Array of geometric analysis results
 */
export function analyzeAllObjects(canvas) {
    const allObjects = canvas.getObjects();
    const results = [];
    
    for (const obj of allObjects) {
        let analysis = null;
        
        if (obj.type === 'line') {
            analysis = analyzeLine(obj);
        } else if (obj.type === 'rect') {
            analysis = analyzeRectangle(obj);
        } else if (obj.type === 'triangle') {
            analysis = analyzeTriangle(obj);
        } else if (obj.type === 'polygon') {
            analysis = analyzePolygon(obj);
        } else if (obj.type === 'circle') {
            analysis = analyzeCircle(obj);
        } else if (obj.type === 'ellipse') {
            analysis = analyzeEllipse(obj);
        }
        
        if (analysis) {
            // Attach geometric data to the object
            obj.geometryData = analysis;
            results.push(analysis);
        }
    }
    
    return results;
}

/**
 * Finds intersection points between line objects
 * @param {Array} lines - Array of line objects
 * @returns {Array} Array of intersection points
 */
export function findIntersections(lines) {
    const intersections = [];
    
    for (let i = 0; i < lines.length; i++) {
        for (let j = i + 1; j < lines.length; j++) {
            if (lines[i].type === 'line' && lines[j].type === 'line') {
                const intersection = findLineIntersection(
                    { x1: lines[i].x1, y1: lines[i].y1, x2: lines[i].x2, y2: lines[i].y2 },
                    { x1: lines[j].x1, y1: lines[j].y1, x2: lines[j].x2, y2: lines[j].y2 }
                );
                
                if (intersection) {
                    intersections.push(intersection);
                }
            }
        }
    }
    
    return intersections;
}

/**
 * Creates a visual overlay for geometric measurements
 * @param {fabric.Canvas} canvas - Fabric canvas instance
 * @param {Array} objects - Array of objects to measure
 * @returns {Array} Array of overlay objects to add to canvas
 */
export function createMeasurementOverlays(canvas, objects) {
    const overlays = [];
    
    for (const obj of objects) {
        if (obj.type === 'line' && obj.geometryData) {
            // Create midpoint indicator
            const midpoint = obj.geometryData.midpoint;
            const midpointDot = new fabric.Circle({
                left: midpoint.x,
                top: midpoint.y,
                radius: 4,
                fill: '#ff0000',
                stroke: '#ffffff',
                strokeWidth: 1,
                selectable: false,
                evented: false,
                name: 'midpoint-indicator'
            });
            
            overlays.push(midpointDot);
            
            // Create length label
            const lengthLabel = new fabric.Text(`${obj.geometryData.length.toFixed(1)}px`, {
                left: midpoint.x + 10,
                top: midpoint.y - 10,
                fontSize: 12,
                fill: '#ffffff',
                backgroundColor: '#000000',
                padding: 4,
                selectable: false,
                evented: false,
                name: 'length-label'
            });
            
            overlays.push(lengthLabel);
        }
    }
    
    return overlays;
}

/**
 * Removes all measurement overlays from canvas
 * @param {fabric.Canvas} canvas - Fabric canvas instance
 */
export function removeMeasurementOverlays(canvas) {
    const objectsToRemove = canvas.getObjects().filter(obj => 
        obj.name === 'midpoint-indicator' || obj.name === 'length-label'
    );
    
    objectsToRemove.forEach(obj => canvas.remove(obj));
}
import * as fabric from 'fabric';
