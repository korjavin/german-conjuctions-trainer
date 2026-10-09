// Me / Settings screen (#/me): practice preference switches.
// Offline cache (offline.js) and the podcast feed (podcast.js) wire their own controls.
import { state, showLocalStorageError } from './state.js';
import { dom } from './dom.js';
import { setAudioEnabled } from './audio.js';
import { handleVoiceToggle } from './voice.js';

const voiceSupported = () => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

function savePref(key, value) {
    state[key] = value;
    try {
        localStorage.setItem(key, String(value));
    } catch (error) {
        console.error(`Failed to save ${key}:`, error);
        showLocalStorageError('practice preferences');
    }
}

// switch element -> [read, write]; 'audioEnabled' stays owned by audio.js.
const prefs = () => [
    [dom.prefSound, () => state.isAudioEnabled, setAudioEnabled],
    [dom.prefAutoplay, () => state.autoplaySentence, (v) => savePref('autoplaySentence', v)],
    [dom.prefVoice, () => state.voiceAutostart, (v) => savePref('voiceAutostart', v)],
];

export function renderMe() {
    for (const [el, read] of prefs()) el?.setAttribute('aria-checked', String(read()));
    if (dom.prefVoiceRow) dom.prefVoiceRow.hidden = !voiceSupported();
}

export function initMe() {
    for (const [el, read, write] of prefs()) {
        el?.addEventListener('click', () => {
            write(!read());
            renderMe();
        });
    }
    window.addEventListener('routechange', ({ detail: { route } }) => {
        if (route === 'me') renderMe();
        // "Start with voice input": practice opens with the mic on.
        if (route === 'practice' && state.voiceAutostart && !state.voiceActive && voiceSupported()) handleVoiceToggle();
    });
    renderMe();
}
