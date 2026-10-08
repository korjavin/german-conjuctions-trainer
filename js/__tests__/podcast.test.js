import { describe, it, expect, beforeEach, vi } from 'vitest';
import { formatDuration, describeEpisode, mergeEpisodes, openPodcastDialog, generatePodcast, loadPodcastEpisodes, resetPodcastSession, loadPodcastFeed, regeneratePodcastFeed } from '../podcast.js';
import { state } from '../state.js';
import { dom } from '../dom.js';
import * as api from '../api.js';

vi.mock('../api.js', () => ({
    generatePodcastAPI: vi.fn(),
    listPodcastEpisodesAPI: vi.fn(),
    getPodcastFeedAPI: vi.fn(),
    regeneratePodcastFeedAPI: vi.fn()
}));

vi.mock('../topics.js', () => ({
    getTopicPath: vi.fn((id) => (id === 'topic1' ? 'Grammar > Konjunktionen' : 'Other'))
}));

vi.mock('../voice.js', () => ({
    handleVoiceToggle: vi.fn()
}));

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

describe('podcast.js', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.currentTopicId = 'topic1';
        state.topics = [{ id: 'topic1', name: 'Konjunktionen' }];
        dom.podcastGenerateBtn.disabled = false;
        state.isLoggedIn = false;
        dom.podcastFavoritesOnly.checked = false;
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

    it('opens the dialog labelled with the current topic path', () => {
        openPodcastDialog();
        expect(dom.podcastTopicName.textContent).toBe('Grammar > Konjunktionen');
        expect(dom.podcastModal.showModal).toHaveBeenCalled();
    });

    it('renders the player, download link and phrase list', async () => {
        api.generatePodcastAPI.mockResolvedValueOnce(episode);
        await generatePodcast();

        expect(api.generatePodcastAPI).toHaveBeenCalledWith('topic1', false);
        expect(dom.podcastAudio.getAttribute('src') || dom.podcastAudio.src).toContain('/api/podcast/abc.mp3');
        expect(dom.podcastDownloadLink.getAttribute('href')).toBe(episode.download_url);
        expect(dom.podcastResult.classList.contains('hidden')).toBe(false);
        expect(dom.podcastTranscriptSummary.textContent).toBe('Phrases (2)');
        const items = dom.podcastPhraseList.querySelectorAll('li');
        expect(items).toHaveLength(2);
        expect(items[0].textContent).toContain('Ich bleibe, weil es regnet.');
        expect(items[0].querySelector('.podcast-phrase-weak')).not.toBeNull();
        expect(items[1].querySelector('.podcast-phrase-weak')).toBeNull();
        expect(dom.podcastGenerateBtn.disabled).toBe(false);
        expect(dom.podcastStatus.classList.contains('hidden')).toBe(true);
    });

    it('shows the server error and re-enables the button', async () => {
        api.generatePodcastAPI.mockRejectedValueOnce(new Error('Failed to synthesize podcast audio.'));
        await generatePodcast();

        expect(dom.podcastError.textContent).toBe('Failed to synthesize podcast audio.');
        expect(dom.podcastError.classList.contains('hidden')).toBe(false);
        expect(dom.podcastGenerateBtn.disabled).toBe(false);
    });

    it('hides the favorites option from guests and never sends it', async () => {
        dom.podcastFavoritesOnly.checked = true;
        openPodcastDialog();
        expect(dom.podcastFavoritesOption.classList.contains('hidden')).toBe(true);

        dom.podcastFavoritesOnly.checked = true;
        api.generatePodcastAPI.mockResolvedValueOnce(episode);
        await generatePodcast();
        expect(api.generatePodcastAPI).toHaveBeenCalledWith('topic1', false);
    });

    it('sends favorites_only for a logged-in user and restores the last choice', async () => {
        state.isLoggedIn = true;
        localStorage.setItem('podcastFavoritesOnly', 'true');
        openPodcastDialog();
        expect(dom.podcastFavoritesOption.classList.contains('hidden')).toBe(false);
        expect(dom.podcastFavoritesOnly.checked).toBe(true);

        api.generatePodcastAPI.mockRejectedValueOnce(new Error('No favorite phrases in this topic yet.'));
        await generatePodcast();
        expect(api.generatePodcastAPI).toHaveBeenCalledWith('topic1', true);
        expect(dom.podcastError.textContent).toBe('No favorite phrases in this topic yet.');
    });

    it('asks for a topic when none is selected', async () => {
        state.currentTopicId = '';
        await generatePodcast();
        expect(api.generatePodcastAPI).not.toHaveBeenCalled();
        expect(dom.podcastError.textContent).toBe('Please select a topic first.');
    });

    describe('episode list', () => {
        const ep = (id, topicId, createdAt, extra = {}) => ({
            ...episode, id, url: `/api/podcast/${id}.mp3`, topic_id: topicId, created_at: createdAt, ...extra,
        });

        beforeEach(() => {
            state.topics = [
                { id: 'topic1', name: 'Konjunktionen' },
                { id: 'child', name: 'Weil', parent_id: 'topic1' },
                { id: 'grandchild', name: 'Weil 2', parent_id: 'child' },
                { id: 'other', name: 'Other' },
            ];
        });

        it('keeps every episode built in the session instead of replacing the first', async () => {
            api.generatePodcastAPI.mockResolvedValueOnce(ep('first', 'topic1', '2026-10-08T10:00:00Z'));
            await generatePodcast();
            api.generatePodcastAPI.mockResolvedValueOnce(ep('second', 'topic1', '2026-10-08T11:00:00Z'));
            await generatePodcast();

            const items = dom.podcastEpisodeList.querySelectorAll('li');
            expect(items).toHaveLength(2);
            expect(dom.podcastEpisodes.classList.contains('hidden')).toBe(false);
            expect(dom.podcastEpisodesSummary.textContent).toBe('Your episodes (2)');
            // The newest is on top and loaded in the player.
            expect(items[0].querySelector('.podcast-episode-active')).not.toBeNull();
            expect(items[1].querySelector('.podcast-episode-active')).toBeNull();
            expect(dom.podcastAudio.getAttribute('src') || dom.podcastAudio.src).toContain('/api/podcast/second.mp3');

            // Picking the older one loads it into the player.
            items[1].querySelector('button').dispatchEvent(new Event('click'));
            expect(dom.podcastAudio.getAttribute('src') || dom.podcastAudio.src).toContain('/api/podcast/first.mp3');
            expect(dom.podcastEpisodeList.querySelectorAll('li')[1].querySelector('.podcast-episode-active')).not.toBeNull();
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
            const items = dom.podcastEpisodeList.querySelectorAll('li');
            expect(items).toHaveLength(1);
            expect(items[0].textContent).toContain('Konjunktionen');
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
            openPodcastDialog();
            await vi.waitFor(() => expect(dom.podcastEpisodeList.querySelectorAll('li')).toHaveLength(2));

            expect(api.listPodcastEpisodesAPI).toHaveBeenCalledWith('topic1');
            const items = dom.podcastEpisodeList.querySelectorAll('li');
            expect(items[0].textContent).toContain('Weil');
            expect(items[0].textContent).toContain('25 phrases');

            // An episode without a stored transcript hides the phrase list.
            items[0].querySelector('button').dispatchEvent(new Event('click'));
            expect(dom.podcastTranscript.classList.contains('hidden')).toBe(true);
            items[1].querySelector('button').dispatchEvent(new Event('click'));
            expect(dom.podcastTranscript.classList.contains('hidden')).toBe(false);
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

            const items = dom.podcastEpisodeList.querySelectorAll('li');
            expect(items).toHaveLength(2);
            expect(items[0].querySelector('.podcast-episode-active')).not.toBeNull();
            expect(dom.podcastAudio.getAttribute('src') || dom.podcastAudio.src).toContain('/api/podcast/fresh.mp3');
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
            window.confirm = vi.fn().mockReturnValueOnce(false);
            await regeneratePodcastFeed();
            expect(api.regeneratePodcastFeedAPI).not.toHaveBeenCalled();

            window.confirm.mockReturnValueOnce(true);
            api.regeneratePodcastFeedAPI.mockResolvedValueOnce({ feed_url: feedURL });
            await regeneratePodcastFeed();
            expect(dom.podcastFeedUrl.value).toBe(feedURL);
            expect(dom.podcastFeedRegenerateBtn.disabled).toBe(false);
        });

        it('keeps the regenerated URL when an older load finishes late', async () => {
            let finishLoad;
            api.getPodcastFeedAPI.mockReturnValueOnce(new Promise((resolve) => { finishLoad = resolve; }));
            const load = loadPodcastFeed();
            window.confirm = vi.fn().mockReturnValueOnce(true);
            api.regeneratePodcastFeedAPI.mockResolvedValueOnce({ feed_url: feedURL });
            await regeneratePodcastFeed();
            finishLoad({ feed_url: 'https://gct.example/podcast/feed/revoked.xml' });
            await load;
            expect(dom.podcastFeedUrl.value).toBe(feedURL);
        });
    });
});
