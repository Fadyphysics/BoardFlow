const path = require('path');

function closeRecognitionWorkers() {
    // No-op since MyScript SDK is no longer used
}

// Placeholder functions returning native recognition responses
function recognizeInk(strokes, root, mode) {
    return Promise.resolve({ 
        text: '', 
        alternatives: [], 
        engine: 'Native recognition', 
        error: 'Native recognition is coming soon. Your ink has been kept.' 
    });
}

const recognizeMath = (strokes, root) => recognizeInk(strokes, root, 'equations');
const recognizeText = (strokes, root) => recognizeInk(strokes, root, 'writing');
const recognizeSmart = (strokes, root) => recognizeInk(strokes, root, 'smart');

module.exports = { 
    recognizeMath, 
    recognizeText, 
    recognizeSmart, 
    closeRecognitionWorkers 
};
