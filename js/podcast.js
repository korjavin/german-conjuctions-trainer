// Podcast mode: builds a listen-only episode (MP3) for the selected topic
// subtree, to play in the browser or download for a phone's player.
import { state } from './state.js';
import { dom } from './dom.js';
import { generatePodcastAPI, listPodcastEpisodesAPI, getPodcastFeedAPI, regeneratePodcastFeedAPI } from './api.js';
import { getTopicPath } from './topics.js';
import { handleVoiceToggle } from './voice.js';
import { confirm, toast } from './ui.js';

let current = null; // episode loaded in the player (server response)
let sessionEpisodes = []; // built in this page session, newest first
let listedEpisodes = []; // what the episode list shows now
let isGenerating = false;
// Bumped by every list load so a slow one cannot overwrite a newer list.
let listRequest = 0;

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

function phraseCount(data) {
    return data.phrase_count || data.phrases?.length || 0;
}

export function describeEpisode(data) {
    const parts = [`${phraseCount(data)} phrases`, formatDuration(data.duration_seconds)];
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
        album: `${phraseCount(data)} phrases`,
    });
}

// IDs of topicId and all its descendants, from the loaded topic tree.
function subtreeTopicIds(topicId) {
    const ids = new Set([topicId]);
    const queue = [topicId];
    while (queue.length) {
        const parent = queue.shift();
        for (const t of state.topics || []) {
            if (t.parent_id === parent && !ids.has(t.id)) {
                ids.add(t.id);
                queue.push(t.id);
            }
        }
    }
    return ids;
}

// Merges episode lists by id, newest first.
export function mergeEpisodes(...lists) {
    const byId = new Map();
    for (const list of lists) {
        for (const ep of list) {
            if (!byId.has(ep.id)) byId.set(ep.id, ep);
        }
    }
    return [...byId.values()].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

function formatCreated(createdAt) {
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function renderEpisodeList() {
    const items = listedEpisodes.map((ep) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'podcast-episode';
        if (current && current.id === ep.id) {
            btn.classList.add('podcast-episode-active');
            btn.setAttribute('aria-current', 'true');
        }
        const title = document.createElement('span');
        title.className = 'podcast-episode-title';
        title.textContent = ep.topic_name;
        const meta = document.createElement('span');
        meta.className = 'podcast-episode-meta';
        meta.textContent = [formatCreated(ep.created_at), describeEpisode(ep)].filter(Boolean).join(' · ');
        btn.append(title, meta);
        btn.addEventListener('click', () => selectEpisode(ep, { play: true }));
        li.appendChild(btn);
        return li;
    });
    dom.podcastEpisodeList.replaceChildren(...items);
    dom.podcastEpisodesSummary.textContent = `Your episodes (${listedEpisodes.length})`;
    dom.podcastEpisodes.classList.toggle('hidden', listedEpisodes.length === 0);
    dom.podcastGenerateBtn.textContent = listedEpisodes.length || current ? 'Generate a new episode' : 'Generate podcast';
}

function renderEpisode(data) {
    dom.podcastAudio.src = data.url;
    dom.podcastDownloadLink.href = data.download_url;
    dom.podcastMeta.textContent = describeEpisode(data);
    const phrases = data.phrases || [];
    dom.podcastTranscriptSummary.textContent = `Phrases (${phrases.length})`;
    dom.podcastTranscript.classList.toggle('hidden', phrases.length === 0);
    renderPhraseList(phrases);
    dom.podcastResult.classList.remove('hidden');
}

// Loads an episode into the player; play starts it (a click is a user gesture).
function selectEpisode(data, { play = false } = {}) {
    current = data;
    renderEpisode(data);
    updateMediaSession(data);
    renderEpisodeList();
    if (play) {
        dom.podcastAudio.play?.()?.catch?.(() => { /* autoplay refused: the controls still work */ });
    }
}

// Lists every episode of the current topic and its subtopics: the user's
// stored ones (logged in) plus the ones built in this page session.
export async function loadPodcastEpisodes() {
    const topicId = state.currentTopicId;
    const request = ++listRequest;
    const subtree = topicId ? subtreeTopicIds(topicId) : new Set();
    const local = sessionEpisodes.filter((ep) => subtree.has(ep.topic_id));
    listedEpisodes = local;
    renderEpisodeList();
    if (!topicId || !state.isLoggedIn || navigator.onLine === false) return;
    try {
        const data = await listPodcastEpisodesAPI(topicId);
        if (request !== listRequest) return;
        listedEpisodes = mergeEpisodes(data.episodes || [], sessionEpisodes.filter((ep) => subtree.has(ep.topic_id)));
        renderEpisodeList();
    } catch (error) {
        console.error('Failed to load podcast episodes:', error);
    }
}

export function openPodcastDialog() {
    dom.podcastTopicName.textContent = currentTopicLabel() || 'No topic selected';
    // An episode of another topic stays playable but is labelled as such.
    if (!current) {
        dom.podcastResult.classList.add('hidden');
    } else if (state.currentTopicId && !subtreeTopicIds(state.currentTopicId).has(current.topic_id)) {
        dom.podcastMeta.textContent = `Previous episode: ${current.topic_name} · ${describeEpisode(current)}`;
    } else {
        dom.podcastMeta.textContent = describeEpisode(current);
    }
    // Favorites are per user, so guests don't get the option.
    dom.podcastFavoritesOption.classList.toggle('hidden', !state.isLoggedIn);
    dom.podcastFavoritesOnly.checked = state.isLoggedIn && loadFavoritesOnly();
    if (!isGenerating) setError('');
    loadPodcastEpisodes();
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
        // Older servers don't echo these back.
        const ep = { topic_id: topicId, created_at: new Date().toISOString(), ...data };
        sessionEpisodes = mergeEpisodes([ep], sessionEpisodes);
        if (state.currentTopicId && subtreeTopicIds(state.currentTopicId).has(ep.topic_id)) {
            listedEpisodes = mergeEpisodes([ep], listedEpisodes);
        }
        selectEpisode(ep);
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

// Test hook: forget the episodes of this page session.
export function resetPodcastSession() {
    current = null;
    sessionEpisodes = [];
    listedEpisodes = [];
    listRequest++;
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
        toast({ icon: 'copy', text: 'Feed URL copied' });
    } catch (_) {
        // Clipboard API can fail (insecure context): let the user copy by hand.
        dom.podcastFeedUrl.focus();
        dom.podcastFeedUrl.select();
    }
}

export async function regeneratePodcastFeed() {
    const choice = await confirm({
        title: 'Make a new feed URL?',
        body: 'The old URL stops working. You will need to add the new one to your podcast app.',
        actions: [{ label: 'Make new URL', kind: 'danger', value: 'regenerate' }, { label: 'Cancel', kind: 'ghost' }],
    });
    if (choice !== 'regenerate') return;
    feedRequest++;
    dom.podcastFeedRegenerateBtn.disabled = true;
    setFeedError('');
    try {
        const data = await regeneratePodcastFeedAPI();
        feedRequest++; // loads started meanwhile may have read the old token
        dom.podcastFeedUrl.value = data.feed_url || '';
        toast({ text: 'New feed URL ready' });
    } catch (error) {
        setFeedError(error.message || 'Failed to regenerate the podcast feed.');
    } finally {
        dom.podcastFeedRegenerateBtn.disabled = false;
    }
}

export function initPodcast() {
    dom.podcastFeedCopyBtn?.addEventListener('click', copyPodcastFeed);
    dom.podcastFeedRegenerateBtn?.addEventListener('click', regeneratePodcastFeed);
    dom.podcastGenerateBtn.addEventListener('click', generatePodcast);
    dom.podcastFavoritesOnly.addEventListener('change', () => saveFavoritesOnly(dom.podcastFavoritesOnly.checked));
    // The episode's own German would be heard as spoken answers.
    dom.podcastAudio.addEventListener('play', () => {
        if (state.voiceActive) handleVoiceToggle();
    });
    // Leaving #/listen keeps the episode playing, like a background player.
}
