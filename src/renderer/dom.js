export function byId(id) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Required UI element #${id} is missing`);
    return element;
}
