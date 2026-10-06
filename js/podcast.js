// Podcast mode: builds a listen-only episode (MP3) for the selected topic
// subtree, to play in the browser or download for a phone's player.
import { state } from './state.js';
import { dom } from './dom.js';
import { generatePodcastAPI, getPodcastEpisodesAPI, getPodcastFeedAPI, regeneratePodcastFeedAPI } from './api.js';
import { getTopicPath } from './topics.js';
import { handleVoiceToggle } from './voice.js';

let episode = null; // episode in the player: server response + topicId
let isGenerating = false;
// Logged-in user's episodes still on the server, newest first.
let library = [];
// Bumped by every library request so a slow load cannot overwrite a newer one.
let libraryRequest = 0;

const FAVORITES_ONLY_KEY = 'podcastFavoritesOnly';

function loadFavoritesOnly() {
    try {
        return localStorage.getItem(FAVORITES_ONLY_KEY) === 'true';
    } catch (_) {
        return false;
    }
}

function saveFavoritesOnly(value) {
    try {
        localStorage.setItem(FAVORITES_ONLY_KEY, String(value));
    } catch (_) { /* private mode: the choice just isn't remembered */ }
}

export function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.round(totalSeconds || 0));
    const m = Math.floor(seconds / 60);
    const s = String(seconds % 60).padStart(2, '0');
    return `${m}:${s}`;
}

export function describeEpisode(data) {
    // Episodes saved before phrases were stored only know their count.
    const count = data.phrase_count ?? data.phrases.length;
    const parts = [`${count} phrases`, formatDuration(data.duration_seconds)];
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
    dom.podcastTranscript.classList.toggle('hidden', data.phrases.length === 0);
    renderPhraseList(data.phrases);
    dom.podcastResult.classList.remove('hidden');
}

// Puts an episode (just built or saved) into the player.
function showEpisode(data, topicId = data.topic_id) {
    episode = { topicId, data };
    renderEpisode(data);
    updateMediaSession(data);
    renderHeader();
    renderLibrary();
}

// Labels the player and the generate button for the selected topic. An
// episode for another topic stays playable but is labelled as such.
function renderHeader() {
    if (!episode) {
        dom.podcastResult.classList.add('hidden');
        dom.podcastGenerateBtn.textContent = 'Generate podcast';
    } else if (episode.topicId !== state.currentTopicId) {
        dom.podcastMeta.textContent = `Previous episode: ${episode.data.topic_name} · ${describeEpisode(episode.data)}`;
        dom.podcastGenerateBtn.textContent = 'Generate podcast for this topic';
    } else {
        dom.podcastMeta.textContent = describeEpisode(episode.data);
        dom.podcastGenerateBtn.textContent = 'Generate a new episode';
    }
}

function liveLibrary() {
    const now = Date.now();
    return library.filter((ep) => !ep.expires_at || new Date(ep.expires_at).getTime() > now);
}

function formatSavedAt(createdAt) {
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderLibrary() {
    const episodes = state.isLoggedIn ? liveLibrary() : [];
    dom.podcastLibrary.classList.toggle('hidden', episodes.length === 0);
    const items = episodes.map((ep) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'podcast-library-item';
        const inPlayer = episode?.data.id === ep.id;
        button.setAttribute('aria-current', String(inPlayer));

        const text = document.createElement('span');
        text.className = 'podcast-library-text';
        const name = document.createElement('span');
        name.className = 'podcast-library-name';
        name.textContent = ep.topic_name;
        const meta = document.createElement('span');
        meta.className = 'podcast-library-meta';
        meta.textContent = [formatSavedAt(ep.created_at), describeEpisode(ep)].filter(Boolean).join(' · ');
        text.append(name, meta);

        const action = document.createElement('span');
        action.className = 'podcast-library-action';
        action.textContent = inPlayer ? 'In player' : '▶ Play';
        button.append(text, action);
        button.addEventListener('click', () => playSavedEpisode(ep));
        li.appendChild(button);
        return li;
    });
    dom.podcastLibraryList.replaceChildren(...items);
}

function playSavedEpisode(ep) {
    if (episode?.data.id !== ep.id) showEpisode(ep);
    const playing = dom.podcastAudio.play?.();
    playing?.catch?.(() => { /* autoplay refused: the player is ready anyway */ });
}

// Loads the newest saved episode of the selected topic into the player, so
// the user does not have to build it again. Never interrupts playback.
function offerSavedEpisode() {
    if (isGenerating || !state.currentTopicId) return;
    if (episode && (episode.topicId === state.currentTopicId || !dom.podcastAudio.paused)) return;
    const saved = liveLibrary().find((ep) => ep.topic_id === state.currentTopicId);
    if (saved) showEpisode(saved);
}

// Fetches the logged-in user's saved episodes; called when the dialog opens.
export async function loadPodcastLibrary() {
    const request = ++libraryRequest;
    if (!state.isLoggedIn) {
        library = [];
        renderLibrary();
        return;
    }
    try {
        const data = await getPodcastEpisodesAPI();
        if (request !== libraryRequest) return;
        library = data.episodes || [];
    } catch (error) {
        // Building still works; the list just stays as it was.
        console.error('Failed to load saved podcast episodes:', error);
        return;
    }
    renderLibrary();
    offerSavedEpisode();
}

export function openPodcastDialog() {
    dom.podcastTopicName.textContent = currentTopicLabel() || 'No topic selected';
    renderHeader();
    // Show what we already know right away; the fresh list follows.
    renderLibrary();
    offerSavedEpisode();
    loadPodcastLibrary();
    // Favorites are per user, so guests don't get the option.
    dom.podcastFavoritesOption.classList.toggle('hidden', !state.isLoggedIn);
    dom.podcastFavoritesOnly.checked = state.isLoggedIn && loadFavoritesOnly();
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
    const favoritesOnly = state.isLoggedIn && dom.podcastFavoritesOnly.checked;
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
        const data = await generatePodcastAPI(topicId, favoritesOnly);
        if (state.isLoggedIn) {
            library = [data, ...library.filter((ep) => ep.id !== data.id)];
        }
        showEpisode(data, topicId);
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

// --- Private RSS feed (Settings) ---

function setFeedError(message) {
    dom.podcastFeedError.classList.toggle('hidden', !message);
    dom.podcastFeedError.textContent = message || '';
}

// Bumped by every feed request so a slow load cannot overwrite the URL a
// later regenerate returned (the old one is already revoked).
let feedRequest = 0;

// Fills the Settings feed field; called when Settings opens for a logged-in user.
export async function loadPodcastFeed() {
    if (!state.isLoggedIn || !dom.podcastFeedUrl) return;
    const request = ++feedRequest;
    setFeedError('');
    try {
        const data = await getPodcastFeedAPI();
        if (request !== feedRequest) return;
        dom.podcastFeedUrl.value = data.feed_url || '';
    } catch (error) {
        if (request !== feedRequest) return;
        dom.podcastFeedUrl.value = '';
        setFeedError(error.message || 'Failed to load the podcast feed.');
    }
}

export async function copyPodcastFeed() {
    const value = dom.podcastFeedUrl.value;
    if (!value) return;
    try {
        await navigator.clipboard.writeText(value);
        dom.podcastFeedCopyBtn.textContent = 'Copied!';
        setTimeout(() => { dom.podcastFeedCopyBtn.textContent = 'Copy'; }, 1500);
    } catch (_) {
        // Clipboard API can fail (insecure context): let the user copy by hand.
        dom.podcastFeedUrl.focus();
        dom.podcastFeedUrl.select();
    }
}

export async function regeneratePodcastFeed() {
    if (!window.confirm('Create a new feed URL? The current URL stops working, and your podcast app must be re-subscribed with the new one.')) return;
    feedRequest++;
    dom.podcastFeedRegenerateBtn.disabled = true;
    setFeedError('');
    try {
        const data = await regeneratePodcastFeedAPI();
        feedRequest++; // loads started meanwhile may have read the old token
        dom.podcastFeedUrl.value = data.feed_url || '';
    } catch (error) {
        setFeedError(error.message || 'Failed to regenerate the podcast feed.');
    } finally {
        dom.podcastFeedRegenerateBtn.disabled = false;
    }
}

export function initPodcast() {
    dom.podcastFeedCopyBtn?.addEventListener('click', copyPodcastFeed);
    dom.podcastFeedRegenerateBtn?.addEventListener('click', regeneratePodcastFeed);
    if (!dom.podcastBtn) return;
    dom.podcastBtn.addEventListener('click', openPodcastDialog);
    dom.podcastCloseBtn.addEventListener('click', () => dom.podcastModal.close());
    dom.podcastGenerateBtn.addEventListener('click', generatePodcast);
    dom.podcastFavoritesOnly.addEventListener('change', () => saveFavoritesOnly(dom.podcastFavoritesOnly.checked));
    // The episode's own German would be heard as spoken answers.
    dom.podcastAudio.addEventListener('play', () => {
        if (state.voiceActive) handleVoiceToggle();
    });
    // Closing the dialog keeps the episode playing, like a background player.
}
