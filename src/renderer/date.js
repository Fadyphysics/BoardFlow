export function updateDateLabel(elements, now = new Date()) {
    const day = now.getDate();
    const suffix = day % 10 === 1 && day % 100 !== 11
        ? 'st'
        : day % 10 === 2 && day % 100 !== 12
            ? 'nd'
            : day % 10 === 3 && day % 100 !== 13
                ? 'rd'
                : 'th';

    elements.month.textContent = now.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    elements.day.textContent = day;
    elements.ordinal.textContent = suffix;
    elements.year.textContent = now.getFullYear();
}
