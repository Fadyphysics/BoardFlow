// Only accept whole, disjoint source strokes. Partial/ambiguous ranges keep ink.
function itemIdsIn(value, ids = new Set()) {
    if (Array.isArray(value)) value.forEach(item => itemIdsIn(item, ids));
    else if (value && typeof value === 'object') {
        if (value.type === 'stroke' && typeof value.id === 'string') ids.add(value.id);
        Object.keys(value).forEach(key => { if (key !== 'id') itemIdsIn(value[key], ids); });
    }
    return ids;
}
function mixedBlocks(jiix, strokeCount, sourceItemIds = []) {
    const document = JSON.parse(jiix);
    const blocks = [];
    const claimed = new Set();
    const itemIndex = new Map(sourceItemIds.map((id, index) => [id, index]));
    // The Interactive Ink export may emit a Text parent around a Math child.
    // Prefer Math so each native stroke is owned once by its most specific block.
    const elements = [...(document.elements || [])].sort((a, b) => (a.type === 'Math' ? -1 : 0) - (b.type === 'Math' ? -1 : 0));
    for (const element of elements) {
        if (!['Text', 'Math'].includes(element.type)) continue;
        const indices = new Set();
        let valid = Array.isArray(element.range) && element.range.length > 0;
        for (const range of element.range || []) {
            const from = range.from?.stroke, to = range.to?.stroke;
            if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to >= strokeCount
                || Object.keys(range.from).some(k => k !== 'stroke') || Object.keys(range.to).some(k => k !== 'stroke')) { valid = false; break; }
            for (let i = from; i <= to; i++) indices.add(i);
        }
        if (!valid && itemIndex.size) {
            itemIdsIn(element).forEach(id => { if (itemIndex.has(id)) indices.add(itemIndex.get(id)); });
            valid = indices.size > 0;
        }
        if (!valid) return [];
        if ([...indices].some(i => claimed.has(i))) {
            // JIIX from Interactive Ink can include a Text parent around an
            // already-claimed Math child. Keep the more specific child.
            if (itemIndex.size) continue;
            return [];
        }
        indices.forEach(i => claimed.add(i));
        blocks.push({ mode: element.type === 'Math' ? 'equations' : 'writing', indices: [...indices].sort((a,b) => a-b) });
    }
    return blocks.sort((a, b) => a.indices[0] - b.indices[0]);
}
module.exports = { mixedBlocks, itemIdsIn };
