// Offline support: exercise stash, completion queue and the
// "Update offline cache" flow. Storage is plain localStorage (same pattern as
// state.js) — every read is try/catch-wrapped with a safe fallback.
import { state, showLocalStorageError } from './state.js';
import { dom } from './dom.js';
import { fetchExercisesFromAPI, saveUserStatsAPI, saveExerciseCompletionsAPI } from './api.js';
import { preloadExerciseWordAudio } from './audio.js';

export const OFFLINE_STASH_KEY = 'offlineStashV1';
export const OFFLINE_QUEUE_KEY = 'offlineQueueV1';

const MAX_STASHED_EXERCISES = 100;
const PER_TOPIC_STASH_LIMIT = 25;

// Server-side session size (internal/app/exercises.go returns at most 10).
export const SESSION_SIZE = 10;

function newBatchId() {
    // crypto.randomUUID needs a secure context; fall back to a good-enough id.
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    return `b-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// flattenExercise turns an /api/exercises row into the shape the exercise
// renderer expects. Shared by the live fetch path and the offline stash so
// both produce identical objects.
export function flattenExercise(row) {
    return {
        ...row.exercise_json,
        id: row.id,
        audio_file_path: row.audio_file_path,
        is_favorite: row.is_favorite || false,
        topic_id: row.topic_id,
        repetition_counter: row.repetition_counter || 0,
    };
}

// --- Stash -----------------------------------------------------------------

export function readStash() {
    try {
        const raw = localStorage.getItem(OFFLINE_STASH_KEY);
        if (!raw) return { updatedAt: 0, exercises: [] };
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.exercises)) return { updatedAt: 0, exercises: [] };
        return {
            updatedAt: Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : 0,
            exercises: parsed.exercises.filter((ex) => ex && typeof ex === 'object'),
        };
    } catch (error) {
        console.error('Failed to read offline stash:', error);
        return { updatedAt: 0, exercises: [] };
    }
}

export function writeStash(exercises, updatedAt = Date.now()) {
    try {
        localStorage.setItem(OFFLINE_STASH_KEY, JSON.stringify({ updatedAt, exercises }));
        return true;
    } catch (error) {
        console.error('Failed to write offline stash:', error);
        showLocalStorageError('offline exercise cache');
        return false;
    }
}

// takeStashedExercises pops up to `count` exercises off the stash, preferring
// the requested topic, and persists the remainder.
export function takeStashedExercises(count = SESSION_SIZE, topicId = '') {
    const stash = readStash();
    if (stash.exercises.length === 0) return [];

    const preferred = topicId ? stash.exercises.filter((ex) => ex.topic_id === topicId) : [];
    const pool = preferred.length > 0 ? preferred : stash.exercises;
    const taken = pool.slice(0, count);
    const takenIds = new Set(taken.map((ex) => ex.id));

    writeStash(stash.exercises.filter((ex) => !takenIds.has(ex.id)), stash.updatedAt);
    return taken;
}

// --- Completion queue ------------------------------------------------------

export function readQueue() {
    try {
        const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((b) => b && typeof b === 'object' && b.id) : [];
    } catch (error) {
        console.error('Failed to read offline queue:', error);
        return [];
    }
}

function writeQueue(batches) {
    try {
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(batches));
    } catch (error) {
        console.error('Failed to write offline queue:', error);
        showLocalStorageError('offline results queue');
    }
}

export function enqueueBatch(batch) {
    const queue = readQueue();
    queue.push(batch);
    writeQueue(queue);
}

export function makeBatch(stats, completions) {
    return { id: newBatchId(), stats: stats || null, completions: completions || [] };
}

// sendBatch posts a batch's payloads. On partial success it clears the part
// that landed (so a retry can't double-count the stats aggregate) and returns
// false. Returns true only when the whole batch is delivered.
export async function sendBatch(batch) {
    if (batch.stats) {
        try {
            await saveUserStatsAPI(batch.stats);
            batch.stats = null;
        } catch (error) {
            console.error('Failed to save user stats:', error);
            return false;
        }
    }

    if (batch.completions && batch.completions.length > 0) {
        try {
            // client_batch_id lets the server dedupe replays of this batch.
            await saveExerciseCompletionsAPI(batch.completions, batch.id);
        } catch (error) {
            console.error('Failed to save exercise completions:', error);
            return false;
        }
    }

    return true;
}

// flushOfflineQueue drains queued batches. Entries are removed only on a
// fully successful send; anything else stays for the next attempt.
let flushInFlight = null;

export async function flushOfflineQueue() {
    if (navigator.onLine === false) return;
    // init() and the "online" event can fire together; overlapping flushes
    // would send the same batch twice.
    if (flushInFlight) return flushInFlight;
    flushInFlight = drainQueue().finally(() => { flushInFlight = null; });
    return flushInFlight;
}

async function drainQueue() {
    const queue = readQueue();
    if (queue.length === 0) return;

    const remaining = [];
    let stopped = false;
    for (const batch of queue) {
        if (stopped) {
            remaining.push(batch);
            continue;
        }
        const ok = await sendBatch(batch);
        if (!ok) {
            remaining.push(batch);
            stopped = true; // still offline / server unhappy — don't hammer it
        }
    }
    writeQueue(remaining);
}

// --- "Update offline cache" flow -------------------------------------------

function setStatus(text) {
    if (!dom.offlineCacheStatus) return;
    dom.offlineCacheStatus.textContent = text;
    dom.offlineCacheStatus.classList.toggle('hidden', !text);
}

// renderOfflineCacheStatus shows the stored stash summary (count + timestamp).
export function renderOfflineCacheStatus() {
    const stash = readStash();
    if (stash.exercises.length === 0 || !stash.updatedAt) {
        setStatus('');
        return;
    }
    setStatus(`${stash.exercises.length} offline · ${new Date(stash.updatedAt).toLocaleString()}`);
}

async function fetchForStash(topicId, extraOptions) {
    try {
        const data = await fetchExercisesFromAPI(topicId, extraOptions);
        return (data.exercises || []).map(flattenExercise);
    } catch (error) {
        console.error('Offline cache: failed to fetch exercises for topic', topicId, error);
        return [];
    }
}

export async function updateOfflineCache() {
    if (dom.offlineCacheBtn) dom.offlineCacheBtn.disabled = true;

    try {
        setStatus('Syncing results…');
        await flushOfflineQueue();

        setStatus('Fetching exercises…');
        const byId = new Map();

        if (state.currentTopicId) {
            for (const ex of await fetchForStash(state.currentTopicId, {})) {
                byId.set(ex.id, ex);
            }
        }

        for (const topic of state.recentlyUsedTopics) {
            if (byId.size >= MAX_STASHED_EXERCISES) break;
            if (topic.id === state.currentTopicId) continue;
            const fetched = await fetchForStash(topic.id, { limit: PER_TOPIC_STASH_LIMIT, skip_generation: true });
            for (const ex of fetched) {
                byId.set(ex.id, ex);
            }
        }

        const exercises = [...byId.values()].slice(0, MAX_STASHED_EXERCISES);
        writeStash(exercises);

        // Warm audio: the sentence file goes straight into the SW cache, the
        // per-word files land in wordAudioCacheV1 + SW cache via TTS.
        let done = 0;
        for (const exercise of exercises) {
            if (exercise.audio_file_path) {
                try {
                    await fetch(exercise.audio_file_path);
                } catch (error) {
                    // Best effort — a missing audio file never aborts the run.
                }
            }
            try {
                await preloadExerciseWordAudio(exercise);
            } catch (error) {
                // Same: per-word TTS failures are non-fatal.
            }
            done++;
            setStatus(`${done}/${exercises.length}…`);
        }

        renderOfflineCacheStatus();
    } finally {
        if (dom.offlineCacheBtn) dom.offlineCacheBtn.disabled = false;
    }
}
