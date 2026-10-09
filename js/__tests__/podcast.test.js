import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { formatDuration, describeEpisode, mergeEpisodes, formatWhen, showListen, generatePodcast, loadPodcastEpisodes, resetPodcastSession, loadPodcastFeed, regeneratePodcastFeed, initPodcast } from '../podcast.js';
import { initScope } from '../scope.js';
import { state } from '../state.js';
import { dom } from '../dom.js';
import * as api from '../api.js';
import { confirm, toast } from '../ui.js';

vi.mock('../api.js', () => ({
    generatePodcastAPI: vi.fn(),
    listPodcastEpisodesAPI: vi.fn(),
    getPodcastFeedAPI: vi.fn(),
    regeneratePodcastFeedAPI: vi.fn(),
    fetchTopicProgressAPI: vi.fn(),
    saveUserSettingsAPI: vi.fn(async () => {}),
}));

vi.mock('../session.js', () => ({ resetForNewSession: vi.fn() }));

vi.mock('../voice.js', () => ({
    handleVoiceToggle: vi.fn()
}));

const OLD = '2026-08-01T00:00:00Z';
const TOPICS = [
    { id: 'grammar', name: 'Grammar', parent_id: null, sort_order: 0, created_at: OLD },
    { id: 'topic1', name: 'Konjunktionen', parent_id: 'grammar', sort_order: 0, created_at: OLD },
    { id: 'child', name: 'Weil', parent_id: 'topic1', sort_order: 0, created_at: OLD },
    { id: 'grandchild', name: 'Weil 2', parent_id: 'child', sort_order: 0, created_at: OLD },
    { id: 'other', name: 'Other', parent_id: null, sort_order: 1, created_at: OLD },
];

const episode = {
    id: 'abc',
    url: '/api/podcast/abc.mp3',
    download_url: '/api/podcast/abc.mp3?download=podcast-konjunktionen-2026-09-25',
    topic_name: 'Konjunktionen',
    duration_seconds: 583,
    recall_repeats: 2,
    phrases: [
        { exercise_id: '1', english: 'I stay because it rains.', german: 'Ich bleibe, weil es regnet.', weak: true },
        { exercise_id: '2', english: 'She knows that I come.', german: 'Sie weiß, dass ich komme.', weak: false },
    ],
};

const src = () => dom.podcastAudio.getAttribute('src') || dom.podcastAudio.src;
const rows = () => dom.podcastEpisodeList.querySelectorAll('.gct-listen__row');

describe('podcast.js', () => {
    beforeAll(() => {
        initScope();
        initPodcast();
        state.topics = TOPICS;
        window.dispatchEvent(new Event('topicschange')); // builds the scope tree for names and paths
    });

    beforeEach(() => {
        vi.clearAllMocks();
        state.currentTopicId = 'topic1';
        state.topics = TOPICS;
        state.isLoggedIn = false;
        dom.podcastGenerateBtn.disabled = false;
        dom.podcastFavoritesOnly.setAttribute('aria-checked', 'false');
        dom.podcastAudio.pause();
        localStorage.clear();
        resetPodcastSession();
        api.listPodcastEpisodesAPI.mockResolvedValue({ episodes: [] });
    });

    it('formats durations as m:ss', () => {
        expect(formatDuration(0)).toBe('0:00');
        expect(formatDuration(65)).toBe('1:05');
        expect(formatDuration(583)).toBe('9:43');
    });

    it('describes an episode with phrase count, length and repeats', () => {
        expect(describeEpisode(episode)).toBe('2 phrases · 9:43 · 2 tricky phrases repeated');
        expect(describeEpisode({ ...episode, recall_repeats: 0 })).toBe('2 phrases · 9:43');
    });

    it('formats when an episode was made relative to today', () => {
        const now = new Date(2026, 9, 9, 15, 0);
        expect(formatWhen(new Date(2026, 9, 9, 7, 50).toISOString(), now)).toMatch(/^Today, 0?7:50$/);
        expect(formatWhen(new Date(2026, 9, 8, 11, 18).toISOString(), now)).toMatch(/^Yesterday, 11:18$/);
        expect(formatWhen(new Date(2026, 9, 6, 13, 43).toISOString(), now)).toMatch(/^6 Oct, 13:43$/);
        expect(formatWhen('', now)).toBe('');
    });

    it('shows the scope in the New episode card and an empty state when nothing is listed', () => {
        showListen();
        expect(dom.podcastScopeRow.textContent).toContain('Konjunktionen');
        expect(dom.podcastScopeRow.textContent).toContain('Grammar › Konjunktionen · includes sub-topics');
        expect(dom.podcastEmptyTitle.textContent).toBe('Nothing to play for Konjunktionen');
        expect(dom.podcastEmpty.hidden).toBe(false);
        expect(dom.podcastPlayer.hidden).toBe(true);
        expect(dom.podcastEpisodesSummary.textContent).toBe('Episodes · 0');

        state.currentTopicId = '';
        showListen();
        expect(dom.podcastScopeRow.textContent).toContain('All topics');
        expect(dom.podcastScopeRow.textContent).toContain('A mix from every track');
    });

    it('loads a generated episode into the player, selected, with download link and transcript', async () => {
        api.generatePodcastAPI.mockResolvedValueOnce(episode);
        await generatePodcast();

        expect(api.generatePodcastAPI).toHaveBeenCalledWith('topic1', false);
        expect(src()).toContain('/api/podcast/abc.mp3');
        expect(dom.podcastDownloadLink.getAttribute('href')).toBe(episode.download_url);
        expect(dom.podcastPlayer.hidden).toBe(false);
        expect(dom.podcastEmpty.hidden).toBe(true);
        expect(dom.podcastTitle.textContent).toBe('Konjunktionen');
        expect(dom.podcastMeta.textContent).toBe('2 phrases');
        expect(dom.podcastTotal.textContent).toBe('9:43');
        expect(dom.podcastTranscriptSummary.textContent).toBe('Transcript · 2');
        const items = dom.podcastPhraseList.querySelectorAll('li');
        expect(items).toHaveLength(2);
        expect(items[0].textContent).toContain('Ich bleibe, weil es regnet.');
        expect(items[0].querySelector('.gct-listen__weak')).not.toBeNull();
        expect(items[1].querySelector('.gct-listen__weak')).toBeNull();
        expect(rows()[0].classList.contains('is-current')).toBe(true);
        expect(rows()[0].textContent).toContain('New');
        expect(toast).toHaveBeenCalledWith({ tone: 'success', text: 'Episode ready · 2 phrases' });
        expect(dom.podcastGenerateBtn.disabled).toBe(false);
        expect(dom.podcastGenerateLabel.textContent).toBe('Generate 25 phrases');
    });

    it('shows the busy label while generating', async () => {
        let finish;
        api.generatePodcastAPI.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
        const run = generatePodcast();
        expect(dom.podcastGenerateBtn.disabled).toBe(true);
        expect(dom.podcastEmptyGenerateBtn.disabled).toBe(true);
        expect(dom.podcastGenerateLabel.textContent).toBe('Generating · about 40 s');
        finish(episode);
        await run;
        expect(dom.podcastEmptyGenerateBtn.disabled).toBe(false);
    });

    it('toasts the server error and re-enables the button', async () => {
        api.generatePodcastAPI.mockRejectedValueOnce(new Error('Failed to synthesize podcast audio.'));
        await generatePodcast();

        expect(toast).toHaveBeenCalledWith({ tone: 'danger', text: 'Failed to synthesize podcast audio.' });
        expect(dom.podcastGenerateBtn.disabled).toBe(false);
    });

    it('hides the favorites option from guests and never sends it', async () => {
        dom.podcastFavoritesOnly.setAttribute('aria-checked', 'true');
        showListen();
        expect(dom.podcastFavoritesOption.hidden).toBe(true);

        dom.podcastFavoritesOnly.setAttribute('aria-checked', 'true');
        api.generatePodcastAPI.mockResolvedValueOnce(episode);
        await generatePodcast();
        expect(api.generatePodcastAPI).toHaveBeenCalledWith('topic1', false);
    });

    it('sends favorites_only for a logged-in user and remembers the switch', async () => {
        state.isLoggedIn = true;
        localStorage.setItem('podcastFavoritesOnly', 'true');
        showListen();
        expect(dom.podcastFavoritesOption.hidden).toBe(false);
        expect(dom.podcastFavoritesOnly.getAttribute('aria-checked')).toBe('true');

        api.generatePodcastAPI.mockRejectedValueOnce(new Error('No favorite phrases in this topic yet.'));
        await generatePodcast();
        expect(api.generatePodcastAPI).toHaveBeenCalledWith('topic1', true);

        dom.podcastFavoritesOnly.dispatchEvent(new Event('click'));
        expect(dom.podcastFavoritesOnly.getAttribute('aria-checked')).toBe('false');
        expect(localStorage.getItem('podcastFavoritesOnly')).toBe('false');
    });

    it('builds and lists episodes for the All topics scope (empty topic id)', async () => {
        state.currentTopicId = '';
        state.isLoggedIn = true;
        api.generatePodcastAPI.mockResolvedValueOnce({ ...episode, id: 'all', topic_id: '' });
        await generatePodcast();
        expect(api.generatePodcastAPI).toHaveBeenCalledWith('', false);

        api.listPodcastEpisodesAPI.mockResolvedValueOnce({ episodes: [{ ...episode, id: 'stored', topic_id: 'topic1', created_at: '2026-10-01T10:00:00Z' }] });
        showListen();
        await vi.waitFor(() => expect(rows()).toHaveLength(2));
        expect(api.listPodcastEpisodesAPI).toHaveBeenCalledWith('');
    });

    describe('player controls', () => {
        beforeEach(async () => {
            api.generatePodcastAPI.mockResolvedValueOnce(episode);
            await generatePodcast();
        });

        it('cycles the speed 1 → 1.25 → 1.5 → 0.75 → 1', () => {
            const seen = [];
            for (let i = 0; i < 4; i++) {
                dom.podcastSpeedBtn.dispatchEvent(new Event('click'));
                seen.push(dom.podcastSpeedBtn.textContent);
            }
            expect(seen).toEqual(['1.25×', '1.5×', '0.75×', '1×']);
            expect(dom.podcastAudio.playbackRate).toBe(1);
        });

        it('skips ±10 s within the episode', () => {
            dom.podcastAudio.currentTime = 5;
            dom.podcastBackBtn.dispatchEvent(new Event('click'));
            expect(dom.podcastAudio.currentTime).toBe(0);
            dom.podcastFwdBtn.dispatchEvent(new Event('click'));
            expect(dom.podcastAudio.currentTime).toBe(10);
            expect(dom.podcastTime.textContent).toBe('0:10');
        });
    });

    describe('episode list', () => {
        const ep = (id, topicId, createdAt, extra = {}) => ({
            ...episode, id, url: `/api/podcast/${id}.mp3`, topic_id: topicId, created_at: createdAt, ...extra,
        });

        it('keeps every episode built in the session; clicking a row loads it', async () => {
            api.generatePodcastAPI.mockResolvedValueOnce(ep('first', 'topic1', '2026-10-08T10:00:00Z'));
            await generatePodcast();
            api.generatePodcastAPI.mockResolvedValueOnce(ep('second', 'topic1', '2026-10-08T11:00:00Z'));
            await generatePodcast();

            expect(rows()).toHaveLength(2);
            expect(dom.podcastEpisodesSummary.textContent).toBe('Episodes · 2');
            // The newest is on top and loaded in the player.
            expect(rows()[0].classList.contains('is-current')).toBe(true);
            expect(rows()[1].classList.contains('is-current')).toBe(false);
            expect(src()).toContain('/api/podcast/second.mp3');

            rows()[1].dispatchEvent(new Event('click'));
            expect(src()).toContain('/api/podcast/first.mp3');
            expect(rows()[1].classList.contains('is-current')).toBe(true);
        });

        it('shows guests the session episodes of the topic and its subtopics only', async () => {
            state.currentTopicId = 'grandchild';
            api.generatePodcastAPI.mockResolvedValueOnce(ep('deep', 'grandchild', '2026-10-08T10:00:00Z'));
            await generatePodcast();
            state.currentTopicId = 'other';
            api.generatePodcastAPI.mockResolvedValueOnce(ep('elsewhere', 'other', '2026-10-08T11:00:00Z'));
            await generatePodcast();

            state.currentTopicId = 'topic1';
            await loadPodcastEpisodes();
            expect(rows()).toHaveLength(1);
            expect(rows()[0].textContent).toContain('Konjunktionen');
            // The scope's first episode replaces the paused one from another scope.
            expect(src()).toContain('/api/podcast/deep.mp3');
            expect(api.listPodcastEpisodesAPI).not.toHaveBeenCalled();
        });

        it('loads stored episodes of the subtree for a logged-in user', async () => {
            state.isLoggedIn = true;
            api.listPodcastEpisodesAPI.mockResolvedValueOnce({
                episodes: [
                    ep('stored-new', 'child', '2026-10-07T10:00:00Z', { topic_name: 'Weil', phrases: [], phrase_count: 25 }),
                    ep('stored-old', 'topic1', '2026-10-01T10:00:00Z'),
                ],
            });
            showListen();
            await vi.waitFor(() => expect(rows()).toHaveLength(2));

            expect(api.listPodcastEpisodesAPI).toHaveBeenCalledWith('topic1');
            expect(rows()[0].textContent).toContain('Weil');
            expect(rows()[0].textContent).toContain('25 phrases');
            // The newest listed episode is selected; it has no stored transcript.
            expect(src()).toContain('/api/podcast/stored-new.mp3');
            expect(dom.podcastTranscript.hidden).toBe(true);
            rows()[1].dispatchEvent(new Event('click'));
            expect(dom.podcastTranscript.hidden).toBe(false);
        });

        it('shows the empty state when the new scope has no episodes', async () => {
            api.generatePodcastAPI.mockResolvedValueOnce(ep('one', 'topic1', '2026-10-08T10:00:00Z'));
            await generatePodcast();
            state.currentTopicId = 'other';
            await loadPodcastEpisodes();
            expect(rows()).toHaveLength(0);
            expect(dom.podcastEpisodeList.textContent).toContain('No episodes for this topic yet.');
            expect(dom.podcastEmpty.hidden).toBe(false);
            expect(dom.podcastPlayer.hidden).toBe(true);
        });

        it('does not drop a just-built episode when an older list load finishes late', async () => {
            state.isLoggedIn = true;
            let finishLoad;
            api.listPodcastEpisodesAPI.mockReturnValueOnce(new Promise((resolve) => { finishLoad = resolve; }));
            const load = loadPodcastEpisodes();
            api.generatePodcastAPI.mockResolvedValueOnce(ep('fresh', 'topic1', '2026-10-08T12:00:00Z'));
            await generatePodcast();
            finishLoad({ episodes: [ep('stored', 'topic1', '2026-10-01T10:00:00Z')] });
            await load;

            expect(rows()).toHaveLength(2);
            expect(rows()[0].classList.contains('is-current')).toBe(true);
            expect(src()).toContain('/api/podcast/fresh.mp3');
        });

        it('merges lists by id, newest first', () => {
            const merged = mergeEpisodes(
                [ep('a', 't', '2026-10-01T00:00:00Z'), ep('b', 't', '2026-10-03T00:00:00Z')],
                [ep('b', 't', '2026-10-03T00:00:00Z'), ep('c', 't', '2026-10-02T00:00:00Z')],
            );
            expect(merged.map((e) => e.id)).toEqual(['b', 'c', 'a']);
        });
    });

    describe('RSS feed', () => {
        const feedURL = 'https://gct.example/podcast/feed/0123456789abcdef0123456789abcdef.xml';

        beforeEach(() => {
            state.isLoggedIn = true;
            dom.podcastFeedUrl.value = '';
            dom.podcastFeedRegenerateBtn.disabled = false;
        });

        it('shows the feed URL for a logged-in user', async () => {
            api.getPodcastFeedAPI.mockResolvedValueOnce({ feed_url: feedURL });
            await loadPodcastFeed();
            expect(dom.podcastFeedUrl.value).toBe(feedURL);
            expect(dom.podcastFeedError.classList.contains('hidden')).toBe(true);
        });

        it('does not ask the server for guests', async () => {
            state.isLoggedIn = false;
            await loadPodcastFeed();
            expect(api.getPodcastFeedAPI).not.toHaveBeenCalled();
        });

        it('shows the error when the feed is unavailable', async () => {
            api.getPodcastFeedAPI.mockRejectedValueOnce(new Error('The podcast feed is not configured on this server (PUBLIC_BASE_URL).'));
            await loadPodcastFeed();
            expect(dom.podcastFeedError.textContent).toContain('not configured');
            expect(dom.podcastFeedError.classList.contains('hidden')).toBe(false);
        });

        it('regenerates only after confirmation', async () => {
            confirm.mockResolvedValueOnce(null);
            await regeneratePodcastFeed();
            expect(api.regeneratePodcastFeedAPI).not.toHaveBeenCalled();

            confirm.mockResolvedValueOnce('regenerate');
            api.regeneratePodcastFeedAPI.mockResolvedValueOnce({ feed_url: feedURL });
            await regeneratePodcastFeed();
            expect(dom.podcastFeedUrl.value).toBe(feedURL);
            expect(dom.podcastFeedRegenerateBtn.disabled).toBe(false);
        });

        it('keeps the regenerated URL when an older load finishes late', async () => {
            let finishLoad;
            api.getPodcastFeedAPI.mockReturnValueOnce(new Promise((resolve) => { finishLoad = resolve; }));
            const load = loadPodcastFeed();
            confirm.mockResolvedValueOnce('regenerate');
            api.regeneratePodcastFeedAPI.mockResolvedValueOnce({ feed_url: feedURL });
            await regeneratePodcastFeed();
            finishLoad({ feed_url: 'https://gct.example/podcast/feed/revoked.xml' });
            await load;
            expect(dom.podcastFeedUrl.value).toBe(feedURL);
        });
    });
});
