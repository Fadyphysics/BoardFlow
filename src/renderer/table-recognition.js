/**
 * Table Recognition Engine - Detects grid structures and converts them to structured table objects
 */

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
 * Calculates the distance between two points
 * @param {Object} p1 - Point {x, y}
 * @param {Object} p2 - Point {x, y}
 * @returns {number} Distance between points
 */
function distance(p1, p2) {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

/**
 * Checks if a line is approximately horizontal (within 10 degrees of horizontal)
 * @param {Object} stroke - Stroke object with start/end points
 * @returns {boolean} True if line is horizontal
 */
function isHorizontalLine(stroke) {
    const angle = lineAngle(stroke.start, stroke.end);
    return (angle < 10 || angle > 350) || (angle > 170 && angle < 190);
}

/**
 * Checks if a line is approximately vertical (within 10 degrees of vertical)
 * @param {Object} stroke - Stroke object with start/end points
 * @returns {boolean} True if line is vertical
 */
function isVerticalLine(stroke) {
    const angle = lineAngle(stroke.start, stroke.end);
    return (angle > 80 && angle < 100) || (angle > 260 && angle < 280);
}

/**
 * Detects if a collection of strokes form a grid-like structure
 * @param {Array} normalizedStrokes - Array of normalized strokes from ink-pipeline.js
 * @returns {Object|null} Grid detection result or null if no grid detected
 */
export function detectGridStructure(normalizedStrokes) {
    if (!normalizedStrokes || normalizedStrokes.length < 4) {
        return null; // Need at least 4 strokes to form a basic grid
    }
    
    // Separate horizontal and vertical lines
    const horizontalLines = [];
    const verticalLines = [];
    
    for (const stroke of normalizedStrokes) {
        if (!stroke.points || stroke.points.length < 2) continue;
        
        const start = stroke.points[0];
        const end = stroke.points[stroke.points.length - 1];
        
        const strokeObj = {
            start: start,
            end: end,
            bbox: stroke.bbox,
            pathLength: stroke.pathLength
        };
        
        if (isHorizontalLine(strokeObj)) {
            horizontalLines.push(strokeObj);
        } else if (isVerticalLine(strokeObj)) {
            verticalLines.push(strokeObj);
        }
    }
    
    // Sort lines by position to identify grid structure
    horizontalLines.sort((a, b) => a.start.y - b.start.y);
    verticalLines.sort((a, b) => a.start.x - b.start.x);
    
    // Check if we have enough lines to form a grid
    if (horizontalLines.length < 2 || verticalLines.length < 2) {
        return null;
    }
    
    // Calculate row and column boundaries
    const rowBoundaries = calculateBoundaries(horizontalLines);
    const colBoundaries = calculateBoundaries(verticalLines);
    
    if (rowBoundaries.length < 2 || colBoundaries.length < 2) {
        return null;
    }
    
    // Calculate grid properties
    const gridProperties = {
        rows: rowBoundaries.length - 1,
        cols: colBoundaries.length - 1,
        rowBoundaries: rowBoundaries,
        colBoundaries: colBoundaries,
        horizontalLines: horizontalLines,
        verticalLines: verticalLines,
        confidence: calculateGridConfidence(horizontalLines, verticalLines, rowBoundaries, colBoundaries)
    };
    
    return gridProperties;
}

/**
 * Calculates boundary positions for rows or columns based on line positions
 * @param {Array} lines - Array of line objects sorted by position
 * @returns {Array} Sorted array of boundary positions
 */
function calculateBoundaries(lines) {
    if (!lines || lines.length === 0) return [];
    
    // Get unique Y/X positions for horizontal/vertical lines
    const positions = lines.map(line => 
        isHorizontalLine(line) ? (line.start.y + line.end.y) / 2 : (line.start.x + line.end.x) / 2
    );
    
    // Remove duplicates by clustering nearby positions
    const clusteredPositions = [];
    const threshold = 15; // Threshold for considering positions as same
    
    for (const pos of positions) {
        const existing = clusteredPositions.find(clusterPos => Math.abs(clusterPos - pos) < threshold);
        if (!existing) {
            clusteredPositions.push(pos);
        }
    }
    
    return clusteredPositions.sort((a, b) => a - b);
}

/**
 * Calculates confidence for grid detection based on line alignment and structure
 * @param {Array} horizontalLines - Horizontal line objects
 * @param {Array} verticalLines - Vertical line objects
 * @param {Array} rowBoundaries - Row boundary positions
 * @param {Array} colBoundaries - Column boundary positions
 * @returns {number} Confidence value between 0 and 1
 */
function calculateGridConfidence(horizontalLines, verticalLines, rowBoundaries, colBoundaries) {
    // Start with a base confidence
    let confidence = 0.5;
    
    // Increase confidence for having good numbers of both horizontal and vertical lines
    const minExpectedLines = 3; // At least 2 rows + 1 separator, 2 cols + 1 separator
    const expectedHorizontals = rowBoundaries.length;
    const expectedVerticals = colBoundaries.length;
    
    if (horizontalLines.length >= expectedHorizontals * 0.7) {
        confidence += 0.2;
    }
    if (verticalLines.length >= expectedVerticals * 0.7) {
        confidence += 0.2;
    }
    
    // Increase confidence for good alignment
    const horizontalAlignment = calculateLineAlignment(horizontalLines);
    const verticalAlignment = calculateLineAlignment(verticalLines);
    
    confidence += (horizontalAlignment + verticalAlignment) * 0.15;
    
    // Cap confidence between 0 and 1
    return Math.min(1.0, Math.max(0.1, confidence));
}

/**
 * Calculates alignment quality of a set of lines
 * @param {Array} lines - Array of line objects
 * @returns {number} Alignment quality between 0 and 1
 */
function calculateLineAlignment(lines) {
    if (lines.length < 2) return 1.0;
    
    // For horizontal lines, check Y alignment; for vertical lines, check X alignment
    const isHoriz = isHorizontalLine(lines[0]);
    const positions = lines.map(line => 
        isHoriz ? (line.start.y + line.end.y) / 2 : (line.start.x + line.end.x) / 2
    );
    
    // Calculate standard deviation of positions
    const mean = positions.reduce((sum, pos) => sum + pos, 0) / positions.length;
    const variance = positions.reduce((sum, pos) => sum + Math.pow(pos - mean, 2), 0) / positions.length;
    const stdDev = Math.sqrt(variance);
    
    // Higher alignment = lower standard deviation
    // Normalize to 0-1 range (assuming max reasonable std dev is 20 pixels)
    return Math.max(0, 1 - (stdDev / 20));
}

/**
 * Creates a table object from grid properties
 * @param {Object} gridProperties - Grid detection result
 * @param {string} borderColor - Border color for table
 * @param {string} textColor - Text color for table cells
 * @returns {fabric.Group|null} Fabric group containing the table structure
 */
export function createTableObject(gridProperties, borderColor = '#ffffff', textColor = '#ffffff') {
    if (!gridProperties || gridProperties.confidence < 0.7) {
        return null;
    }
    
    const { rowBoundaries, colBoundaries, rows, cols } = gridProperties;
    const tableElements = [];
    
    // Create table borders and cell dividers
    for (let i = 0; i <= rows; i++) {
        // Horizontal lines
        const y = rowBoundaries[i];
        const x1 = Math.min(...colBoundaries);
        const x2 = Math.max(...colBoundaries);
        
        const hLine = new fabric.Line([x1, y, x2, y], {
            stroke: borderColor,
            strokeWidth: 1,
            selectable: false,
            evented: false
        });
        
        tableElements.push(hLine);
    }
    
    for (let j = 0; j <= cols; j++) {
        // Vertical lines
        const x = colBoundaries[j];
        const y1 = Math.min(...rowBoundaries);
        const y2 = Math.max(...rowBoundaries);
        
        const vLine = new fabric.Line([x, y1, x, y2], {
            stroke: borderColor,
            strokeWidth: 1,
            selectable: false,
            evented: false
        });
        
        tableElements.push(vLine);
    }
    
    // Create table group
    const tableGroup = new fabric.Group(tableElements, {
        selectable: true,
        evented: true,
        lockRotation: true
    });
    
    // Add metadata to the table object
    tableGroup.tableMetadata = {
        rows: rows,
        cols: cols,
        rowBoundaries: rowBoundaries,
        colBoundaries: colBoundaries,
        confidence: gridProperties.confidence
    };
    
    return tableGroup;
}

/**
 * Main function to recognize tables from normalized strokes
 * @param {Array} normalizedStrokes - Array of normalized strokes from ink-pipeline.js
 * @returns {Object|null} Recognition result with table object and properties
 */
export function recognizeTable(normalizedStrokes) {
    // Detect if strokes form a grid structure
    const gridProperties = detectGridStructure(normalizedStrokes);
    
    if (!gridProperties || gridProperties.confidence < 0.7) {
        return null;
    }
    
    // Create the table object
    const tableObject = createTableObject(gridProperties);
    
    return {
        type: 'table',
        confidence: gridProperties.confidence,
        rows: gridProperties.rows,
        cols: gridProperties.cols,
        rowBoundaries: gridProperties.rowBoundaries,
        colBoundaries: gridProperties.colBoundaries,
        horizontalLines: gridProperties.horizontalLines,
        verticalLines: gridProperties.verticalLines,
        tableObject: tableObject
    };
}
import * as fabric from 'fabric';
