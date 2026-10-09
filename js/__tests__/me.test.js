import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initMe } from '../me.js';
import { formatAge } from '../offline.js';
import { state } from '../state.js';
import { dom } from '../dom.js';
import { setAudioEnabled } from '../audio.js';
import { handleVoiceToggle } from '../voice.js';

vi.mock('../audio.js', () => ({ setAudioEnabled: vi.fn((v) => { state.isAudioEnabled = v; }), preloadExerciseWordAudio: vi.fn() }));
vi.mock('../voice.js', () => ({ handleVoiceToggle: vi.fn() }));
vi.mock('../api.js', () => ({ fetchExercisesFromAPI: vi.fn(), saveUserStatsAPI: vi.fn(), saveExerciseCompletionsAPI: vi.fn() }));

const click = (el) => el.dispatchEvent(new Event('click'));
const go = (route) => window.dispatchEvent(new CustomEvent('routechange', { detail: { route, params: {} } }));

describe('me.js', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        state.autoplaySentence = true;
        state.voiceAutostart = false;
        state.voiceActive = false;
    });

    it('switches persist and reflect state', () => {
        initMe();
        click(dom.prefAutoplay);
        expect(state.autoplaySentence).toBe(false);
        expect(localStorage.getItem('autoplaySentence')).toBe('false');
        expect(dom.prefAutoplay.getAttribute('aria-checked')).toBe('false');

        state.isAudioEnabled = true;
        click(dom.prefSound);
        expect(setAudioEnabled).toHaveBeenCalledWith(false);
        expect(dom.prefSound.getAttribute('aria-checked')).toBe('false');
    });

    it('starts voice on practice only when the pref is on and supported', () => {
        window.SpeechRecognition = function () {};
        go('practice');
        expect(handleVoiceToggle).not.toHaveBeenCalled();
        state.voiceAutostart = true;
        go('practice'); // re-render of the same screen: no autostart
        expect(handleVoiceToggle).not.toHaveBeenCalled();
        go('today');
        go('practice');
        expect(handleVoiceToggle).toHaveBeenCalledTimes(1);
        delete window.SpeechRecognition;
    });

    it('formats the offline cache age', () => {
        const now = Date.UTC(2026, 9, 9, 12);
        expect(formatAge(now - 30e3, now)).toBe('just now');
        expect(formatAge(now - 5 * 60e3, now)).toBe('5 min ago');
        expect(formatAge(now - 2 * 3600e3, now)).toBe('2 h ago');
        expect(formatAge(now - 3 * 86400e3, now)).toBe('3 days ago');
    });
});
