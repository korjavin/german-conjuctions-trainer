import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
    isPunctuation,
    preloadExerciseWordAudio,
    updateAudioToggleUI,
    setAudioEnabled,
    handleAudioToggle,
    handleReplayAudio,
    playSentenceAudio,
    playWordAudio
} from '../audio.js';
import { state } from '../state.js';
import { dom } from '../dom.js';
import * as api from '../api.js';

vi.mock('../api.js', () => ({
    fetchTTSFilePathAPI: vi.fn()
}));

describe('audio.js', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        globalThis.localStorage.clear();
        state.isAudioEnabled = true;
        state.wordAudioCache = {};
        state.wordAudioInflight = new Map();
        state.activeAudio = null;
        state.lastAudioUrl = '';
        state.lastAudioText = '';

        // Setup simple HTMLMediaElement mock
        globalThis.Audio = vi.fn().mockImplementation(function() {
            this.play = vi.fn().mockResolvedValue(undefined);
            this.pause = vi.fn();
            this.currentTime = 0;
            this.addEventListener = vi.fn((event, cb) => {
                if (event === 'ended' || event === 'error') {
                    this[`on${event}`] = cb;
                }
            });
        });
    });

    afterEach(() => {
        delete globalThis.Audio;
    });

    describe('isPunctuation', () => {
        it('returns true for punctuation tokens', () => {
            expect(isPunctuation('.')).toBe(true);
            expect(isPunctuation(',')).toBe(true);
            expect(isPunctuation('?!')).toBe(true);
            expect(isPunctuation(' - ')).toBe(true);
            expect(isPunctuation('"')).toBe(true);
            expect(isPunctuation(' ')).toBe(true); // Technically not just punctuation, but considered as not a word part
        });

        it('returns false for word tokens', () => {
            expect(isPunctuation('word')).toBe(false);
            expect(isPunctuation('Test')).toBe(false);
            expect(isPunctuation('123')).toBe(false);
            expect(isPunctuation('äöüß')).toBe(false); // Unicode letters
            expect(isPunctuation('word.')).toBe(false); // Contains letter
            expect(isPunctuation('A')).toBe(false);
        });

        it('returns false for edge cases with numbers/letters', () => {
            expect(isPunctuation('50%')).toBe(false); // Number
            expect(isPunctuation('a,')).toBe(false); // Letter
        });
    });

    describe('audio caching and preloading', () => {
        it('normalizes and caches words via preloadExerciseWordAudio', async () => {
            api.fetchTTSFilePathAPI.mockResolvedValue('/audio/test.mp3'); // Need multiple resolutions

            const exercise = {
                correct_german_sentence: ' Das  ist ein Test. '
            };

            // This triggers caching internally
            preloadExerciseWordAudio(exercise);

            // Wait for internal async loops to finish
            await new Promise(r => setTimeout(r, 50));

            // 'Das', 'ist', 'ein', 'Test'
            expect(api.fetchTTSFilePathAPI).toHaveBeenCalledTimes(4);
            expect(state.wordAudioCache['Das']).toMatchObject({ filePath: '/audio/test.mp3' });
            expect(state.wordAudioCache['ist']).toBeDefined();
            expect(state.wordAudioCache['ein']).toBeDefined();
            expect(state.wordAudioCache['Test']).toBeDefined();

            // Should not cache punctuation
            expect(state.wordAudioCache['.']).toBeUndefined();
            expect(state.wordAudioCache[' ']).toBeUndefined();
        });

        it('evicts oldest entries when exceeding max cache size (2000)', async () => {
            // Fill cache with 2000 items
            const mockDateNow = vi.spyOn(Date, 'now');

            for (let i = 0; i < 2000; i++) {
                mockDateNow.mockReturnValue(1000 + i);
                state.wordAudioCache[`word${i}`] = {
                    filePath: `/audio/word${i}.mp3`,
                    updatedAt: Date.now()
                };
            }

            api.fetchTTSFilePathAPI.mockResolvedValueOnce('/audio/new.mp3');
            mockDateNow.mockReturnValue(5000);

            // Trigger an update via preload which adds a new word
            preloadExerciseWordAudio({ correct_german_sentence: 'newWord' });
            await new Promise(r => setTimeout(r, 10));

            // Cache should still only be 2000 items max
            const keys = Object.keys(state.wordAudioCache);
            expect(keys.length).toBe(2000);

            // Oldest word ('word0') should be gone
            expect(state.wordAudioCache['word0']).toBeUndefined();
            // New word should be present
            expect(state.wordAudioCache['newWord']).toBeDefined();

            mockDateNow.mockRestore();
        });
    });

    describe('UI updates', () => {
        it('updateAudioToggleUI reflects enabled state', () => {
            state.isAudioEnabled = true;
            updateAudioToggleUI();

            expect(dom.audioToggleIcon.textContent).toBe('🔊');
            expect(dom.audioToggleBtn.getAttribute('title')).toBe('Sound: on');
            expect(dom.audioToggleBtn.classList.remove).toHaveBeenCalledWith('is-audio-off');
            expect(dom.replayAudioBtn.disabled).toBe(false);

            state.isAudioEnabled = false;
            updateAudioToggleUI();

            expect(dom.audioToggleIcon.textContent).toBe('🔇');
            expect(dom.audioToggleBtn.getAttribute('title')).toBe('Sound: off');
            expect(dom.audioToggleBtn.classList.add).toHaveBeenCalledWith('is-audio-off');
            expect(dom.replayAudioBtn.disabled).toBe(true);
        });

        it('setAudioEnabled updates state, local storage and UI', () => {
            setAudioEnabled(false);
            expect(state.isAudioEnabled).toBe(false);
            expect(globalThis.localStorage.setItem).toHaveBeenCalledWith('audioEnabled', 'false');
            expect(dom.audioToggleBtn.classList.add).toHaveBeenCalledWith('is-audio-off');

            setAudioEnabled(true);
            expect(state.isAudioEnabled).toBe(true);
            expect(globalThis.localStorage.setItem).toHaveBeenCalledWith('audioEnabled', 'true');
        });

        it('handleAudioToggle toggles state', () => {
            state.isAudioEnabled = true;
            handleAudioToggle();
            expect(state.isAudioEnabled).toBe(false);

            handleAudioToggle();
            expect(state.isAudioEnabled).toBe(true);
        });
    });

    describe('playSentenceAudio and handleReplayAudio', () => {
        it('fetches and plays TTS if not provided, updates lastAudioUrl', async () => {
            api.fetchTTSFilePathAPI.mockResolvedValueOnce('/generated.mp3');

            await playSentenceAudio('', 'This is a test');

            expect(api.fetchTTSFilePathAPI).toHaveBeenCalledWith('This is a test');
            expect(state.lastAudioUrl).toBe('/generated.mp3');
            expect(globalThis.Audio).toHaveBeenCalledWith('/generated.mp3');
        });

        it('replays last audio', () => {
            state.lastAudioUrl = '/last.mp3';
            state.lastAudioText = 'Last text';
            state.isAudioEnabled = true;

            handleReplayAudio();

            expect(globalThis.Audio).toHaveBeenCalledWith('/last.mp3');
        });
    });
});
