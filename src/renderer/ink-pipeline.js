/**
 * Ink Pipeline - Raw stroke normalization and metadata calculation
 * Provides a recognizer-agnostic foundation for ink processing
 */

import { sampleInkPath } from './recognition-input.js';

/**
 * Represents a normalized ink stroke with metadata
 * @typedef {Object} NormalizedStroke
 * @property {Array<{x: number, y: number}>} points - Array of stroke points
 * @property {{left: number, top: number, width: number, height: number}} bbox - Bounding box
 * @property {number} pathLength - Total length of the stroke path
 * @property {number} aspectRatio - Width/height ratio of the bounding box
 * @property {{x: number, y: number}} directionVector - Direction from start to end point
 * @property {number} curvature - Measure of how curved the stroke is
 * @property {number} pointDensity - Average distance between consecutive points
 * @property {number} timestamp - When the stroke was created
 * @property {number} duration - How long the stroke took to draw (if available)
 * @property {string} strokeId - Unique identifier for the stroke
 */

/**
 * Normalizes a raw Fabric.js path object into a standardized representation
 * @param {fabric.Object} fabricPath - Raw Fabric.js path object
 * @returns {NormalizedStroke|null} Normalized stroke data or null if invalid
 */
export function normalizeInkStroke(fabricPath, sampledPoints = sampleInkPath(fabricPath?.path)) {
    if (!fabricPath || !fabricPath.path) {
        return null;
    }

    const points = sampledPoints;
    
    if (points.length < 2) {
        return null; // Not enough points to form a meaningful stroke
    }

    // Calculate bounding box
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    
    const bbox = {
        left: minX,
        top: minY,
        width: maxX - minX,
        height: maxY - minY
    };

    // Calculate path length (sum of distances between consecutive points)
    let pathLength = 0;
    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        pathLength += Math.hypot(curr.x - prev.x, curr.y - prev.y);
    }

    // Calculate aspect ratio
    const aspectRatio = bbox.width > 0 ? bbox.height / bbox.width : 0;

    // Calculate direction vector (from first to last point)
    const directionVector = {
        x: points[points.length - 1].x - points[0].x,
        y: points[points.length - 1].y - points[0].y
    };

    // Calculate curvature (average change in direction)
    let totalCurvature = 0;
    if (points.length >= 3) {
        for (let i = 1; i < points.length - 1; i++) {
            const prev = points[i - 1];
            const curr = points[i];
            const next = points[i + 1];
            
            // Vector from prev to curr
            const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
            // Vector from curr to next
            const v2 = { x: next.x - curr.x, y: next.y - curr.y };
            
            // Calculate angle between vectors
            const dot = v1.x * v2.x + v1.y * v2.y;
            const det = v1.x * v2.y - v1.y * v2.x;
            const angle = Math.abs(Math.atan2(det, dot));
            
            totalCurvature += angle;
        }
    }
    const curvature = points.length >= 3 ? totalCurvature / (points.length - 2) : 0;

    // Calculate point density (average distance between consecutive points)
    const pointDensity = points.length > 1 ? pathLength / (points.length - 1) : 0;

    // Generate unique stroke ID
    const strokeId = `stroke_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create normalized stroke object
    return {
        points: points,
        bbox: bbox,
        pathLength: pathLength,
        aspectRatio: aspectRatio,
        directionVector: directionVector,
        curvature: curvature,
        pointDensity: pointDensity,
        timestamp: Date.now(),
        duration: fabricPath.boardflowDuration || 0, // If available from fabric path
        strokeId: strokeId
    };
}

/**
 * Groups strokes that were created within a short time threshold
 * @param {Array<NormalizedStroke>} strokes - Array of normalized strokes
 * @param {number} timeThreshold - Time threshold in milliseconds (default 500ms)
 * @returns {Array<Array<NormalizedStroke>>} Array of grouped strokes
 */
export function groupStrokesByTime(strokes, timeThreshold = 500) {
    if (!strokes || strokes.length === 0) {
        return [];
    }

    const grouped = [];
    let currentGroup = [strokes[0]];

    for (let i = 1; i < strokes.length; i++) {
        const currentStroke = strokes[i];
        const previousStroke = strokes[i - 1];

        // If the time difference is within the threshold, add to current group
        if (currentStroke.timestamp - previousStroke.timestamp <= timeThreshold) {
            currentGroup.push(currentStroke);
        } else {
            // Otherwise, start a new group
            grouped.push([...currentGroup]);
            currentGroup = [currentStroke];
        }
    }

    // Add the last group
    if (currentGroup.length > 0) {
        grouped.push(currentGroup);
    }

    return grouped;
}

/**
 * Normalizes points relative to stroke origin for scale-invariant recognition
 * @param {Array<{x: number, y: number}>} points - Original stroke points
 * @param {{left: number, top: number, width: number, height: number}} bbox - Bounding box
 * @returns {Array<{x: number, y: number}>} Normalized points relative to origin
 */
export function normalizePointsToOrigin(points, bbox) {
    if (!points || points.length === 0 || !bbox) {
        return [];
    }

    const offsetX = bbox.left;
    const offsetY = bbox.top;

    return points.map(point => ({
        x: point.x - offsetX,
        y: point.y - offsetY
    }));
}

/**
 * Calculates additional stroke metrics for advanced analysis
 * @param {NormalizedStroke} stroke - Normalized stroke
 * @returns {Object} Additional metrics
 */
export function calculateAdvancedMetrics(stroke) {
    if (!stroke || !stroke.points || stroke.points.length < 2) {
        return {};
    }

    const points = stroke.points;
    
    // Calculate velocity profile (speed at each point)
    const velocities = [];
    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const distance = Math.hypot(curr.x - prev.x, curr.y - prev.y);
        // Assuming equal time intervals between points for simplicity
        velocities.push(distance);
    }

    // Calculate acceleration profile
    const accelerations = [];
    for (let i = 1; i < velocities.length; i++) {
        const acc = velocities[i] - velocities[i - 1];
        accelerations.push(acc);
    }

    // Calculate bounding box center
    const centerX = stroke.bbox.left + stroke.bbox.width / 2;
    const centerY = stroke.bbox.top + stroke.bbox.height / 2;

    return {
        velocities: velocities,
        accelerations: accelerations,
        center: { x: centerX, y: centerY },
        // Compactness measure (ratio of area to perimeter squared)
        compactness: stroke.bbox.width * stroke.bbox.height / Math.pow(stroke.pathLength, 2) || 0,
        // Straightness measure (direct distance vs path length)
        straightness: stroke.pathLength > 0 ? 
            Math.hypot(stroke.directionVector.x, stroke.directionVector.y) / stroke.pathLength : 0
    };
}