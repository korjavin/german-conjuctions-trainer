// Listen (#/listen): the brand player, the scope's episodes and "New episode" (25 phrases from
// the scope subtree, to play here or download). Ported from docs/design/claude-design/ui_kits/app/ScreensMore.jsx
// ListenScreen + Player. The feed URL section lives in Me (#/me) and is driven from here too.
import { state } from './state.js';
import { dom } from './dom.js';
import { generatePodcastAPI, listPodcastEpisodesAPI, getPodcastFeedAPI, regeneratePodcastFeedAPI } from './api.js';
import { path, short } from './scope.js';
import { handleVoiceToggle } from './voice.js';
import { confirm, toast } from './ui.js';

let current = null; // episode loaded in the player (server response)
let sessionEpisodes = []; // built in this page session, newest first
let listedEpisodes = []; // what the episode list shows now
let isGenerating = false;
// Bumped by every list load so a slow one cannot overwrite a newer list.
let listRequest = 0;

const FAVORITES_ONLY_KEY = 'podcastFavoritesOnly';
const SPEEDS = [1, 1.25, 1.5, 0.75];
const GENERATE_LABEL = 'Generate 25 phrases';
const DAY_MS = 864e5;

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

const favoritesOn = () => dom.podcastFavoritesOnly.getAttribute('aria-checked') === 'true';
const setFavorites = (on) => dom.podcastFavoritesOnly.setAttribute('aria-checked', String(on));

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

const svg = (name, size = 20) => (typeof window.gctIconSvg === 'function' ? window.gctIconSvg(name, size) : '');

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function renderPhraseList(phrases) {
    const items = phrases.map((phrase) => {
        const li = el('li');
        const de = el('div', 'gct-listen__de', phrase.german);
        if (phrase.weak) {
            const badge = el('span', 'gct-listen__weak', '×2');
            badge.title = 'You often make mistakes here, so it is recalled twice';
            de.appendChild(badge);
        }
        li.append(de, el('div', 'gct-listen__en', phrase.english));
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

// Predicate: is a topic id inside topicId's subtree? '' (All topics) matches everything.
function inScopeFn(topicId) {
    if (!topicId) return () => true;
    const ids = subtreeTopicIds(topicId);
    return (id) => ids.has(id);
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

// "Today, 07:50" / "Yesterday, 11:18" / "6 Oct, 13:43".
export function formatWhen(createdAt, now = new Date()) {
    const date = new Date(createdAt);
    if (!createdAt || Number.isNaN(date.getTime())) return '';
    const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
    const day = days === 0 ? 'Today' : days === 1 ? 'Yesterday'
        : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return `${day}, ${time}`;
}

const isNew = (ep, now = Date.now()) => now - Date.parse(ep.created_at) < DAY_MS;

function renderEpisodeList() {
    const rows = listedEpisodes.map((ep) => {
        const on = Boolean(current && current.id === ep.id);
        const row = el('button', 'gct-listen__row' + (on ? ' is-current' : ''));
        row.type = 'button';
        if (on) row.setAttribute('aria-current', 'true');
        const icon = el('span', 'gct-listen__row-icon');
        icon.innerHTML = svg(on ? 'sound' : 'play', 18);
        const text = el('span', 'gct-listen__grow');
        text.append(
            el('span', 'gct-listen__row-title', ep.topic_name),
            el('span', 'gct-listen__row-meta', [formatWhen(ep.created_at), `${phraseCount(ep)} phrases`, formatDuration(ep.duration_seconds)].filter(Boolean).join(' · ')),
        );
        row.append(icon, text);
        if (isNew(ep)) {
            const badge = el('span', 'gct-badge gct-badge--info');
            badge.append(el('span', 'gct-badge__dot'), 'New');
            row.append(badge);
        }
        row.addEventListener('click', () => selectEpisode(ep, { play: true }));
        return row;
    });
    if (!rows.length) rows.push(el('div', 'gct-listen__none', 'No episodes for this topic yet.'));
    dom.podcastEpisodeList.replaceChildren(...rows);
    dom.podcastEpisodesSummary.textContent = `Episodes · ${listedEpisodes.length}`;
}

// --- player ---

function totalSeconds() {
    const d = dom.podcastAudio.duration;
    return Number.isFinite(d) && d > 0 ? d : current?.duration_seconds || 0;
}

function renderProgress() {
    const total = totalSeconds();
    const now = dom.podcastAudio.currentTime || 0;
    const pct = total ? Math.min(100, (now / total) * 100) : 0;
    dom.podcastFill.style.width = `${pct}%`;
    dom.podcastKnob.style.left = `${pct}%`;
    dom.podcastTime.textContent = formatDuration(now);
    dom.podcastTotal.textContent = formatDuration(total);
    dom.podcastTrack.setAttribute('aria-valuemax', String(Math.round(total)));
    dom.podcastTrack.setAttribute('aria-valuenow', String(Math.round(now)));
    dom.podcastTrack.setAttribute('aria-valuetext', `${formatDuration(now)} of ${formatDuration(total)}`);
}

function renderPlayState() {
    const playing = !dom.podcastAudio.paused;
    dom.podcastPlayBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    dom.podcastPlayBtn.innerHTML = svg(playing ? 'pause' : 'play', 26);
}

function seek(seconds) {
    const total = totalSeconds();
    dom.podcastAudio.currentTime = Math.max(0, total ? Math.min(total, seconds) : seconds);
    renderProgress();
}

function seekToPointer(e) {
    const rect = dom.podcastTrack.getBoundingClientRect();
    if (!rect.width) return;
    seek(((e.clientX - rect.left) / rect.width) * totalSeconds());
}

function setSpeed(speed) {
    // defaultPlaybackRate survives loading another episode; playbackRate applies now.
    dom.podcastAudio.defaultPlaybackRate = speed;
    dom.podcastAudio.playbackRate = speed;
    dom.podcastSpeedBtn.textContent = `${speed}×`;
}

function renderEpisode(data) {
    dom.podcastAudio.src = data.url;
    dom.podcastDownloadLink.href = data.download_url;
    dom.podcastTitle.textContent = data.topic_name || 'Episode';
    // ponytail: no per-phrase timings in the episode JSON, so no "Phrase i of N · Listen/Recall" line yet.
    dom.podcastMeta.textContent = `${phraseCount(data)} phrases`;
    const phrases = data.phrases || [];
    dom.podcastTranscriptSummary.textContent = `Transcript · ${phrases.length}`;
    dom.podcastTranscript.hidden = phrases.length === 0;
    renderPhraseList(phrases);
    renderProgress();
    renderPlayState();
}

function showPlayer(on) {
    dom.podcastPlayer.hidden = !on;
    dom.podcastEmpty.hidden = on;
    dom.podcastTranscript.hidden = !on || !current?.phrases?.length;
}

// Loads an episode into the player; play starts it (a click is a user gesture).
function selectEpisode(data, { play = false } = {}) {
    if (current?.id !== data.id) {
        current = data;
        renderEpisode(data);
        updateMediaSession(data);
    }
    showPlayer(true);
    renderEpisodeList();
    if (play) {
        dom.podcastAudio.play?.()?.catch?.(() => { /* autoplay refused: the play button still works */ });
    }
}

// The list changed: keep the loaded episode while it plays or is still listed, else load the newest one.
// pending = the stored list is still loading, so the loaded episode stays until it arrives.
function syncSelection(pending = false) {
    const playing = current && !dom.podcastAudio.paused;
    if (playing || (pending && current) || (current && listedEpisodes.some((ep) => ep.id === current.id))) {
        showPlayer(true);
        renderEpisodeList();
    } else if (listedEpisodes.length) {
        selectEpisode(listedEpisodes[0]);
    } else {
        showPlayer(false);
        renderEpisodeList();
    }
}

// --- scope + generate ---

function renderScope() {
    const p = path(state.currentTopicId);
    const node = p[p.length - 1];
    const icon = el('span', 'gct-listen__scope-icon');
    icon.innerHTML = svg(node?.kind === 'leaf' ? 'leaf' : 'folder', 18);
    const text = el('span', 'gct-listen__grow');
    const sub = node
        ? p.map((n) => short(n.name)).join(' › ') + (node.kind === 'folder' ? ' · includes sub-topics' : '')
        : 'A mix from every track';
    text.append(el('span', 'gct-listen__scope-name', node ? node.name : 'All topics'), el('span', 'gct-listen__scope-sub', sub));
    dom.podcastScopeRow.replaceChildren(icon, text, el('span', 'gct-listen__change', 'Change'));
    dom.podcastEmptyTitle.textContent = `Nothing to play for ${node ? short(node.name) : 'All topics'}`;
}

function setGenerating(busy) {
    isGenerating = busy;
    for (const btn of [dom.podcastGenerateBtn, dom.podcastEmptyGenerateBtn]) btn.disabled = busy;
    const icon = dom.podcastGenerateBtn.querySelector('.gct-listen__gen-icon');
    if (icon) icon.innerHTML = svg(busy ? 'refresh' : 'plus', 18);
    dom.podcastGenerateLabel.textContent = busy ? 'Generating · about 40 s' : GENERATE_LABEL;
}

// Lists every episode of the current topic and its subtopics: the user's
// stored ones (logged in) plus the ones built in this page session.
export async function loadPodcastEpisodes() {
    const topicId = state.currentTopicId; // '' = All topics
    const request = ++listRequest;
    const inScope = inScopeFn(topicId);
    listedEpisodes = sessionEpisodes.filter((ep) => inScope(ep.topic_id));
    const willLoad = state.isLoggedIn && navigator.onLine !== false;
    syncSelection(willLoad);
    if (!willLoad) return;
    try {
        const data = await listPodcastEpisodesAPI(topicId);
        if (request !== listRequest) return;
        listedEpisodes = mergeEpisodes(data.episodes || [], sessionEpisodes.filter((ep) => inScope(ep.topic_id)));
        syncSelection();
    } catch (error) {
        console.error('Failed to load podcast episodes:', error);
    }
}

// Shows #/listen for the current scope (also re-run by scope.js when the scope changes).
export function showListen() {
    renderScope();
    // Favorites are per user, so guests don't get the option.
    dom.podcastFavoritesOption.hidden = !state.isLoggedIn;
    setFavorites(state.isLoggedIn && loadFavoritesOnly());
    loadPodcastEpisodes();
}

export async function generatePodcast() {
    if (isGenerating) return;
    if (navigator.onLine === false) {
        toast({ tone: 'danger', text: 'You are offline. Episodes are built on the server — try again when connected.' });
        return;
    }

    const topicId = state.currentTopicId;
    const favoritesOnly = state.isLoggedIn && favoritesOn();
    setGenerating(true);
    try {
        const data = await generatePodcastAPI(topicId, favoritesOnly);
        // Older servers don't echo these back.
        const ep = { topic_id: topicId, created_at: new Date().toISOString(), ...data };
        sessionEpisodes = mergeEpisodes([ep], sessionEpisodes);
        if (inScopeFn(state.currentTopicId)(ep.topic_id)) {
            listedEpisodes = mergeEpisodes([ep], listedEpisodes);
        }
        selectEpisode(ep);
        toast({ tone: 'success', text: `Episode ready · ${phraseCount(ep)} phrases` });
    } catch (error) {
        console.error('Podcast generation failed:', error);
        toast({ tone: 'danger', text: error.message || 'Failed to build the episode.' });
    } finally {
        setGenerating(false);
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
    dom.podcastEmptyGenerateBtn.addEventListener('click', generatePodcast);
    dom.podcastFavoritesOnly.addEventListener('click', () => {
        setFavorites(!favoritesOn());
        saveFavoritesOnly(favoritesOn());
    });
    // The tree may load after #/listen first rendered: names and paths come from it.
    window.addEventListener('topicschange', renderScope);

    const audio = dom.podcastAudio;
    // The episode's own German would be heard as spoken answers.
    audio.addEventListener('play', () => {
        if (state.voiceActive) handleVoiceToggle();
    });
    for (const ev of ['play', 'pause', 'ended']) audio.addEventListener(ev, renderPlayState);
    for (const ev of ['timeupdate', 'loadedmetadata', 'durationchange']) audio.addEventListener(ev, renderProgress);
    dom.podcastPlayBtn.addEventListener('click', () => {
        if (audio.paused) audio.play?.()?.catch?.(() => {});
        else audio.pause();
    });
    dom.podcastSpeedBtn.addEventListener('click', () => {
        setSpeed(SPEEDS[(SPEEDS.indexOf(audio.playbackRate) + 1) % SPEEDS.length]);
    });
    dom.podcastBackBtn.addEventListener('click', () => seek(audio.currentTime - 10));
    dom.podcastFwdBtn.addEventListener('click', () => seek(audio.currentTime + 10));
    // Scrubber: click or drag seeks; arrow keys step 5 s.
    const track = dom.podcastTrack;
    track.addEventListener('pointerdown', (e) => {
        track.setPointerCapture?.(e.pointerId);
        seekToPointer(e);
    });
    track.addEventListener('pointermove', (e) => {
        if (track.hasPointerCapture?.(e.pointerId)) seekToPointer(e);
    });
    track.addEventListener('keydown', (e) => {
        const step = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5 }[e.key];
        if (step == null) return;
        e.preventDefault();
        e.stopPropagation(); // keep arrows away from the practice shortcuts
        seek(audio.currentTime + step);
    });
    // Leaving #/listen keeps the episode playing, like a background player.
}
