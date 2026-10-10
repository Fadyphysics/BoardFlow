/**
 * Host environment detection utilities for BoardFlow
 */

/**
 * Checks if running in Electron environment
 * @returns {boolean} True if running in Electron
 */
export function isElectron() {
    return typeof window !== 'undefined' && 
           typeof window.boardFlowDesktop !== 'undefined';
}

/**
 * Checks if running in Capacitor environment
 * @returns {boolean} True if running in Capacitor
 */
export function isCapacitor() {
    return typeof window !== 'undefined' && 
           typeof window.Capacitor !== 'undefined';
}

/**
 * Checks if running in standard web browser environment
 * @returns {boolean} True if running in standard web browser
 */
export function isWeb() {
    return !isElectron() && !isCapacitor();
}