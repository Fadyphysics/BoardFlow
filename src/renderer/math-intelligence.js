import { byId } from './dom.js';

const MIN_DATA_POINTS = 3;

export function parseEquation(text) {
    const normalized = String(text || '')
        .replace(/[−–]/g, '-')
        .replace(/[×·]/g, '*')
        .replace(/²/g, '^2')
        .trim();
    const match = normalized.match(/^(?:y|f\s*\(\s*x\s*\))\s*=\s*(.+)$/i);
    if (!match || !/[xX]/.test(match[1])) return null;
    return { label: normalized, expression: match[1].trim() };
}

export function parseDataTable(text) {
    const rows = String(text || '').split(/[\n;]+/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => line.split(/[\t,| ]+/).map(Number).filter(Number.isFinite))
        .filter(row => row.length);

    const pairs = rows.filter(row => row.length >= 2).map(row => [row[0], row[1]]);
    if (pairs.length >= MIN_DATA_POINTS) {
        return { pairs, values: pairs.map(pair => pair[1]), recommendedChart: 'scatter' };
    }

    const values = rows.filter(row => row.length === 1).map(row => row[0]);
    if (values.length < MIN_DATA_POINTS) return null;
    const uniqueRatio = new Set(values).size / values.length;
    return { pairs: [], values, recommendedChart: values.length >= 8 && uniqueRatio > 0.5 ? 'hist' : 'bar' };
}

function payloadFromObject(object) {
    if (!object || object.isFile) return null;
    if (object.boardflowKind === 'data-table' && object.boardflowPayload) {
        return {
            kind: 'statistics',
            key: `statistics:${object.boardflowId || object.__uid || object.text || 'table'}`,
            title: 'Turn this table into a chart?',
            message: 'The values are ready for a visual comparison.',
            ...object.boardflowPayload
        };
    }
    if (object.boardflowKind === 'equation' && object.boardflowPayload) {
        return {
            kind: 'equation',
            key: `equation:${object.boardflowId || object.__uid || object.text || 'formula'}`,
            title: 'Build a graph from this equation?',
            message: 'Open the graph builder with this expression already loaded.',
            ...object.boardflowPayload
        };
    }
    if (object.type !== 'i-text' && object.type !== 'textbox') return null;

    const equation = parseEquation(object.text);
    if (equation) {
        return {
            kind: 'equation',
            key: `equation-text:${equation.label}`,
            title: 'Graph the equation?',
            message: `${equation.label} can be explored visually.`,
            ...equation
        };
    }

    const data = parseDataTable(object.text);
    if (!data) return null;
    return {
        kind: 'statistics',
        key: `statistics-text:${object.text}`,
        title: 'Visualize these values?',
        message: data.pairs.length ? 'These coordinate pairs are suited to a scatter plot.' : 'Smart Math found a numerical data series.',
        ...data
    };
}

export function createMathIntelligence({ canvas, onAction }) {
    const suggestion = byId('mathSuggestion');
    const title = byId('mathSuggestionTitle');
    const text = byId('mathSuggestionText');
    const action = byId('mathSuggestionAction');
    const dismiss = byId('mathSuggestionDismiss');
    const dismissed = new Set();
    let active = null;
    let timer = null;

    function hide() {
        suggestion.classList.add('hidden');
        active = null;
    }

    function offer(candidate) {
        if (!candidate || dismissed.has(candidate.key)) return;
        active = candidate;
        title.textContent = candidate.title;
        text.textContent = candidate.message;
        action.textContent = candidate.kind === 'statistics' ? 'Preview chart' : 'Open graph';
        suggestion.classList.remove('hidden');
    }

    function analyze(object) {
        clearTimeout(timer);
        timer = setTimeout(() => offer(payloadFromObject(object)), 180);
    }

    action.onclick = async () => {
        const selected = active;
        hide();
        if (selected) await onAction(selected);
    };
    dismiss.onclick = () => {
        if (active) dismissed.add(active.key);
        hide();
    };

    canvas.on('object:added', event => analyze(event.target));
    canvas.on('text:changed', event => analyze(event.target));
    canvas.on('selection:created', event => analyze(event.selected?.[0]));
    canvas.on('selection:updated', event => analyze(event.selected?.[0]));

    return { analyze, hide, offer };
}
