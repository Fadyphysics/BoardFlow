import * as fabric from 'fabric';
import { evaluate } from 'mathjs';

/**
 * Evaluates a mathematical expression using MathJS
 * @param {string} expression - The mathematical expression to evaluate
 * @returns {Object} Result object with value and success status
 */
export function evaluateExpression(expression) {
    try {
        // Sanitize the expression to prevent unsafe evaluations
        const sanitizedExpression = sanitizeExpression(expression);
        
        // Evaluate the expression using MathJS
        const result = evaluate(sanitizedExpression);
        
        return {
            success: true,
            value: result,
            originalExpression: expression,
            evaluatedExpression: sanitizedExpression
        };
    } catch (error) {
        console.warn('MathJS evaluation error:', error.message);
        return {
            success: false,
            error: error.message,
            originalExpression: expression
        };
    }
}

/**
 * Sanitizes mathematical expressions to prevent unsafe operations
 * @param {string} expression - The expression to sanitize
 * @returns {string} Sanitized expression
 */
function sanitizeExpression(expression) {
    // Remove potentially dangerous functions or operations
    let sanitized = expression.replace(/\b(import|eval|require|process|global|constructor|__proto__|prototype)\b/gi, '');
    
    // Replace common math functions with safer equivalents if needed
    // In MathJS, these are generally safe to use
    return sanitized.trim();
}

/**
 * Determines if an expression contains an equality that can be evaluated
 * @param {string} expression - The expression to check
 * @returns {boolean} True if the expression can be evaluated for solution
 */
export function canEvaluateSolution(expression) {
    if (!expression) return false;
    
    // Check if it's an equation with an equals sign
    const hasEquals = expression.includes('=');
    
    // Check if it's a solvable expression (not just a function definition)
    if (hasEquals) {
        const parts = expression.split('=');
        if (parts.length === 2) {
            const leftSide = parts[0].trim();
            const rightSide = parts[1].trim();
            
            // Check if it's a simple equation like "2 + 2 = ?" or "x = 5 + 3"
            return leftSide && rightSide;
        }
    }
    
    // Check if it's a simple arithmetic expression
    return /[+\-*/^]/.test(expression) && !expression.includes('x') && !expression.includes('y');
}

/**
 * Generates a solution annotation for an evaluated expression
 * @param {Object} evalResult - The result from evaluateExpression
 * @param {Object} originalBBox - The bounding box of the original expression
 * @param {string} textColor - Text color for the solution
 * @returns {fabric.Text|null} Fabric text object for the solution
 */
export function createSolutionAnnotation(evalResult, originalBBox, textColor = '#ffffff') {
    if (!evalResult.success) {
        return null;
    }
    
    // Format the solution text
    let solutionText = '';
    
    if (typeof evalResult.value === 'number') {
        // Format numbers to reasonable precision
        solutionText = '= ' + parseFloat(evalResult.value.toFixed(6)).toString();
    } else {
        solutionText = '= ' + evalResult.value.toString();
    }
    
    // Calculate position for the solution annotation (below the original expression)
    const fontSize = Math.max(14, Math.min(originalBBox.height * 0.6, 24));
    
    const solutionObject = new fabric.Text(solutionText, {
        left: originalBBox.left + originalBBox.width + 10, // Place to the right of the original
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
        padding: 3,
        lockRotation: true
    });
    
    return solutionObject;
}

/**
 * Determines if an expression represents a function that can be plotted
 * @param {string} expression - The expression to check
 * @returns {Object|null} Function info object if it's plottable, null otherwise
 */
export function canPlotFunction(expression) {
    if (!expression) return null;
    
    // Check for function definitions like y = f(x), f(x) = ..., etc.
    const yEqualsRegex = /^y\s*=\s*(.+)$/i;
    const fOfXRegex = /^[fgh]\(\s*[xy]\s*\)\s*=\s*(.+)$/i;
    
    let matchedExpression = null;
    let variable = 'x';
    
    // Check for y = ... format
    let match = expression.match(yEqualsRegex);
    if (match) {
        matchedExpression = match[1].trim();
    } else {
        // Check for f(x) = ... format
        match = expression.match(fOfXRegex);
        if (match) {
            matchedExpression = match[1].trim();
        }
    }
    
    if (matchedExpression) {
        // Determine the independent variable
        if (expression.toLowerCase().includes('x')) {
            variable = 'x';
        } else if (expression.toLowerCase().includes('y')) {
            variable = 'y';
        }
        
        return {
            expression: matchedExpression,
            variable: variable,
            originalExpression: expression,
            type: 'function'
        };
    }
    
    return null;
}

/**
 * Creates a coordinate grid for function plotting
 * @param {number} left - Left position of the grid
 * @param {number} top - Top position of the grid
 * @param {number} width - Width of the grid
 * @param {number} height - Height of the grid
 * @param {string} textColor - Text color for the grid
 * @returns {fabric.Group} Fabric group containing the coordinate grid
 */
function createCoordinateGrid(left, top, width, height, textColor = '#ffffff') {
    const gridElements = [];
    const step = Math.max(20, Math.min(width, height) / 10); // Dynamic step size
    
    // Create X and Y axes
    const xAxis = new fabric.Line([left, top + height/2, left + width, top + height/2], {
        stroke: textColor,
        strokeWidth: 1,
        strokeDashArray: [2, 2]
    });
    
    const yAxis = new fabric.Line([left + width/2, top, left + width/2, top + height], {
        stroke: textColor,
        strokeWidth: 1,
        strokeDashArray: [2, 2]
    });
    
    gridElements.push(xAxis, yAxis);
    
    // Add grid lines
    for (let x = left; x <= left + width; x += step) {
        const gridLine = new fabric.Line([x, top, x, top + height], {
            stroke: textColor,
            strokeWidth: 0.5,
            opacity: 0.3
        });
        gridElements.push(gridLine);
    }
    
    for (let y = top; y <= top + height; y += step) {
        const gridLine = new fabric.Line([left, y, left + width, y], {
            stroke: textColor,
            strokeWidth: 0.5,
            opacity: 0.3
        });
        gridElements.push(gridLine);
    }
    
    // Add axis labels
    const originLabel = new fabric.Text('0', {
        left: left + width/2 + 5,
        top: top + height/2 + 5,
        fontSize: 12,
        fill: textColor
    });
    
    gridElements.push(originLabel);
    
    return new fabric.Group(gridElements, {
        left: left,
        top: top,
        selectable: true,
        evented: true
    });
}

/**
 * Plots a mathematical function on the canvas
 * @param {Object} functionInfo - Information about the function to plot
 * @param {Object} originalBBox - The bounding box of the original expression
 * @param {string} textColor - Text color for the plot
 * @returns {fabric.Group|null} Fabric group containing the function plot
 */
export function plotFunction(functionInfo, originalBBox, textColor = '#ffffff') {
    try {
        const { expression, variable } = functionInfo;
        
        // Create a coordinate grid
        const gridWidth = 300;
        const gridHeight = 200;
        const gridLeft = originalBBox.left + originalBBox.width + 20;
        const gridTop = originalBBox.top;
        
        const gridGroup = createCoordinateGrid(gridLeft, gridTop, gridWidth, gridHeight, textColor);
        
        // Define the range for plotting
        const xMin = -10;
        const xMax = 10;
        const numPoints = 200;
        
        // Create points for the function curve
        const points = [];
        const deltaX = (xMax - xMin) / numPoints;
        
        for (let i = 0; i <= numPoints; i++) {
            const x = xMin + i * deltaX;
            
            try {
                // Substitute the variable in the expression with the current x value
                const exprWithX = expression.replace(new RegExp(variable, 'g'), `(${x})`);
                const y = evaluate(exprWithX);
                
                // Scale the coordinates to fit the grid
                const scaledX = gridLeft + gridWidth/2 + (x * gridWidth/20); // Scale x to grid width
                const scaledY = gridTop + gridHeight/2 - (y * gridHeight/20); // Scale y to grid height (inverted)
                
                points.push({ x: scaledX, y: scaledY });
            } catch (evalError) {
                // Skip points that cause evaluation errors (e.g., division by zero)
                continue;
            }
        }
        
        // Create the function curve
        if (points.length > 1) {
            const curvePoints = points.map(point => [point.x, point.y]);
            const curve = new fabric.Polyline(curvePoints, {
                stroke: '#00ff00', // Green color for the function curve
                strokeWidth: 2,
                fill: '',
                strokeDashArray: null,
                selectable: true,
                evented: true
            });
            
            // Add the curve to the grid group
            gridGroup.addWithUpdate(curve);
        }
        
        // Add the function label
        const label = new fabric.Text(`y = ${expression}`, {
            left: gridLeft,
            top: gridTop + gridHeight + 10,
            fontSize: 14,
            fill: textColor
        });
        
        gridGroup.addWithUpdate(label);
        
        return gridGroup;
    } catch (error) {
        console.warn('Function plotting error:', error.message);
        return null;
    }
}

/**
 * Processes an equation to determine if it can be evaluated or plotted
 * @param {string} expression - The equation expression
 * @param {Object} originalBBox - The bounding box of the original expression
 * @returns {Object} Processed result with evaluation and/or plot if applicable
 */
export function processEquation(expression, originalBBox) {
    const result = {
        hasEvaluation: false,
        hasPlot: false,
        evaluationResult: null,
        plotResult: null,
        solutionAnnotation: null,
        plotObject: null
    };
    
    // Check if the expression can be evaluated
    if (canEvaluateSolution(expression)) {
        const evalResult = evaluateExpression(expression.split('=')[1] || expression); // Evaluate right side if it's an equation
        
        if (evalResult.success) {
            result.hasEvaluation = true;
            result.evaluationResult = evalResult;
            result.solutionAnnotation = createSolutionAnnotation(evalResult, originalBBox);
        }
    }
    
    // Check if the expression can be plotted as a function
    const functionInfo = canPlotFunction(expression);
    if (functionInfo) {
        result.hasPlot = true;
        result.plotResult = functionInfo;
        result.plotObject = plotFunction(functionInfo, originalBBox);
    }
    
    return result;
}