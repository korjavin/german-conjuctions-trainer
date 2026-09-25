// Podcast mode: builds a listen-only episode (MP3) for the selected topic
// subtree, to play in the browser or download for a phone's player.
import { state } from './state.js';
import { dom } from './dom.js';
import { generatePodcastAPI } from './api.js';
import { getTopicPath } from './topics.js';
import { handleVoiceToggle } from './voice.js';

let episode = null; // last built episode: server response + topicId
let isGenerating = false;

export function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.round(totalSeconds || 0));
    const m = Math.floor(seconds / 60);
    const s = String(seconds % 60).padStart(2, '0');
    return `${m}:${s}`;
}

export function describeEpisode(data) {
    const parts = [`${data.phrases.length} phrases`, formatDuration(data.duration_seconds)];
    if (data.recall_repeats > 0) {
        parts.push(`${data.recall_repeats} tricky ${data.recall_repeats === 1 ? 'phrase' : 'phrases'} repeated`);
    }
    return parts.join(' · ');
}

function currentTopicLabel() {
    if (!state.currentTopicId) return '';
    return getTopicPath(state.currentTopicId, state.topics) || '';
}

function setStatus(message) {
    dom.podcastStatus.classList.toggle('hidden', !message);
    dom.podcastStatusText.textContent = message || '';
}

function setError(message) {
    dom.podcastError.classList.toggle('hidden', !message);
    dom.podcastError.textContent = message || '';
}

function renderPhraseList(phrases) {
    const items = phrases.map((phrase) => {
        const li = document.createElement('li');
        const de = document.createElement('div');
        de.className = 'podcast-phrase-de';
        de.textContent = phrase.german;
        if (phrase.weak) {
            const badge = document.createElement('span');
            badge.className = 'podcast-phrase-weak';
            badge.textContent = '×2';
            badge.title = 'You often make mistakes here, so it is recalled twice';
            de.appendChild(badge);
        }
        const en = document.createElement('div');
        en.className = 'podcast-phrase-en';
        en.textContent = phrase.english;
        li.append(de, en);
        return li;
    });
    dom.podcastPhraseList.replaceChildren(...items);
}

function updateMediaSession(data) {
    if (!('mediaSession' in navigator) || typeof window.MediaMetadata !== 'function') return;
    navigator.mediaSession.metadata = new window.MediaMetadata({
        title: `Podcast: ${data.topic_name}`,
        artist: 'German Trainer',
        album: `${data.phrases.length} phrases`,
    });
}

function renderEpisode(data) {
    dom.podcastAudio.src = data.url;
    dom.podcastDownloadLink.href = data.download_url;
    dom.podcastMeta.textContent = describeEpisode(data);
    dom.podcastTranscriptSummary.textContent = `Phrases (${data.phrases.length})`;
    renderPhraseList(data.phrases);
    dom.podcastResult.classList.remove('hidden');
    dom.podcastGenerateBtn.textContent = 'Generate a new episode';
}

export function openPodcastDialog() {
    dom.podcastTopicName.textContent = currentTopicLabel() || 'No topic selected';
    // An episode built for another topic stays playable but is labelled as such.
    const stale = episode && episode.topicId !== state.currentTopicId;
    if (!episode) {
        dom.podcastResult.classList.add('hidden');
        dom.podcastGenerateBtn.textContent = 'Generate podcast';
    } else if (stale) {
        dom.podcastMeta.textContent = `Previous episode: ${episode.data.topic_name} · ${describeEpisode(episode.data)}`;
        dom.podcastGenerateBtn.textContent = 'Generate podcast for this topic';
    }
    if (!isGenerating) setError('');
    dom.podcastModal.showModal();
}

export async function generatePodcast() {
    if (isGenerating) return;
    if (!state.currentTopicId) {
        setError('Please select a topic first.');
        return;
    }
    if (navigator.onLine === false) {
        setError('You are offline. Podcasts are built on the server — try again when connected.');
        return;
    }

    isGenerating = true;
    const topicId = state.currentTopicId;
    dom.podcastGenerateBtn.disabled = true;
    setError('');
    const started = Date.now();
    const tick = () => {
        const elapsed = Math.round((Date.now() - started) / 1000);
        setStatus(`Building your episode… ${elapsed}s (new phrases can take a minute or two)`);
    };
    tick();
    const timer = setInterval(tick, 1000);

    try {
        const data = await generatePodcastAPI(topicId);
        episode = { topicId, data };
        renderEpisode(data);
        updateMediaSession(data);
    } catch (error) {
        console.error('Podcast generation failed:', error);
        setError(error.message || 'Failed to build the podcast.');
    } finally {
        clearInterval(timer);
        setStatus('');
        dom.podcastGenerateBtn.disabled = false;
        isGenerating = false;
    }
}

export function initPodcast() {
    if (!dom.podcastBtn) return;
    dom.podcastBtn.addEventListener('click', openPodcastDialog);
    dom.podcastCloseBtn.addEventListener('click', () => dom.podcastModal.close());
    dom.podcastGenerateBtn.addEventListener('click', generatePodcast);
    // The episode's own German would be heard as spoken answers.
    dom.podcastAudio.addEventListener('play', () => {
        if (state.voiceActive) handleVoiceToggle();
    });
    // Closing the dialog keeps the episode playing, like a background player.
}
