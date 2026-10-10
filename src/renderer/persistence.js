export const SUBJECT_STORE = 'boardflow-subjects';
export const ACTIVE_SUBJECT_STORE = 'boardflow-active-subject';
const APP_FOLDER_KEY = '__boardflow_app_workspace__';

const DATABASE_NAME = 'boardflow-library';
const DATABASE_VERSION = 4;

export function loadPreference(key) {
    try {
        return localStorage.getItem(key);
    } catch (error) {
        console.error(`Unable to read preference ${key}`, error);
        return null;
    }
}

export function savePreference(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (error) {
        console.error(`Unable to save preference ${key}`, error);
    }
}

export function readSubjects() {
    try {
        const value = JSON.parse(localStorage.getItem(SUBJECT_STORE) || '[]');
        return Array.isArray(value) ? value : [];
    } catch (error) {
        console.error('Unable to read subjects', error);
        return [];
    }
}

export function writeSubjects(subjects) {
    localStorage.setItem(SUBJECT_STORE, JSON.stringify(subjects));
}

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
            for (const storeName of ['books', 'folders', 'checkpoint', 'versions']) {
                if (!request.result.objectStoreNames.contains(storeName)) {
                    request.result.createObjectStore(storeName);
                }
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function requestFromStore(storeName, mode, operation) {
    const database = await openDatabase();
    try {
        return await new Promise((resolve, reject) => {
            const transaction = database.transaction(storeName, mode);
            const request = operation(transaction.objectStore(storeName));
            let result = null;
            request.onsuccess = () => { result = request.result ?? null; };
            request.onerror = () => reject(request.error || new Error(`IndexedDB ${storeName} request failed`));
            transaction.oncomplete = () => resolve(result);
            transaction.onabort = () => reject(
                transaction.error || request.error || new Error(`IndexedDB ${storeName} transaction aborted`)
            );
            transaction.onerror = () => reject(
                transaction.error || request.error || new Error(`IndexedDB ${storeName} transaction failed`)
            );
        });
    } finally {
        database.close();
    }
}

export function putCheckpoint(key, checkpoint) {
    return requestFromStore('checkpoint', 'readwrite', store => store.put(checkpoint, key));
}

export function getCheckpoint(key) {
    return requestFromStore('checkpoint', 'readonly', store => store.get(key));
}

export function putVersion(key, version) {
    return requestFromStore('versions', 'readwrite', store => store.put(version, key));
}

export function getAllVersions() {
    return requestFromStore('versions', 'readonly', store => store.getAll());
}

export function deleteVersion(key) {
    return requestFromStore('versions', 'readwrite', store => store.delete(key));
}

export function putSubjectFolder(id, handle) {
    return requestFromStore('folders', 'readwrite', store => store.put(handle, id));
}

export function getSubjectFolder(id) {
    return requestFromStore('folders', 'readonly', store => store.get(id));
}

export function putAppFolder(handle) {
    return requestFromStore('folders', 'readwrite', store => store.put(handle, APP_FOLDER_KEY));
}

export function getAppFolder() {
    return requestFromStore('folders', 'readonly', store => store.get(APP_FOLDER_KEY));
}
