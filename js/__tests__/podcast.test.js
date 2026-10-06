import { describe, it, expect, beforeEach, vi } from 'vitest';
import { formatDuration, describeEpisode, openPodcastDialog, generatePodcast, loadPodcastLibrary, loadPodcastFeed, regeneratePodcastFeed } from '../podcast.js';
import { state } from '../state.js';
import { dom } from '../dom.js';
import * as api from '../api.js';

vi.mock('../api.js', () => ({
    generatePodcastAPI: vi.fn(),
    getPodcastEpisodesAPI: vi.fn(),
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

    it('counts phrases of a saved episode that has no transcript', () => {
        expect(describeEpisode({ ...episode, phrases: [], phrase_count: 25, recall_repeats: 0 })).toBe('25 phrases · 9:43');
    });

    describe('saved episodes', () => {
        const future = new Date(Date.now() + 86400000).toISOString();
        const saved = (id, topicId, extra = {}) => ({
            ...episode,
            id,
            url: `/api/podcast/${id}.mp3`,
            download_url: `/api/podcast/${id}.mp3?download=podcast-${id}`,
            topic_id: topicId,
            topic_name: `Topic ${topicId}`,
            created_at: '2026-10-05T09:30:00Z',
            expires_at: future,
            phrase_count: episode.phrases.length,
            ...extra,
        });
        const libraryItems = () => [...dom.podcastLibraryList.querySelectorAll('.podcast-library-item')];

        beforeEach(() => {
            state.isLoggedIn = true;
            Object.defineProperty(dom.podcastAudio, 'paused', { value: true, configurable: true });
            dom.podcastAudio.play = vi.fn(() => Promise.resolve());
        });

        it('puts the newest saved episode of the topic in the player when the dialog opens', async () => {
            state.currentTopicId = 'saved-a';
            api.getPodcastEpisodesAPI.mockResolvedValueOnce({
                episodes: [saved('a2', 'saved-a'), saved('b1', 'saved-b'), saved('a1', 'saved-a')],
            });
            openPodcastDialog();
            await vi.waitFor(() => expect(libraryItems()).toHaveLength(3));

            expect(dom.podcastAudio.getAttribute('src') || dom.podcastAudio.src).toContain('/api/podcast/a2.mp3');
            expect(dom.podcastDownloadLink.getAttribute('href')).toBe('/api/podcast/a2.mp3?download=podcast-a2');
            expect(dom.podcastResult.classList.contains('hidden')).toBe(false);
            expect(dom.podcastGenerateBtn.textContent).toBe('Generate a new episode');
            expect(api.generatePodcastAPI).not.toHaveBeenCalled();
            expect(dom.podcastAudio.play).not.toHaveBeenCalled();

            expect(dom.podcastLibrary.classList.contains('hidden')).toBe(false);
            const items = libraryItems();
            expect(items).toHaveLength(3);
            expect(items[0].getAttribute('aria-current')).toBe('true');
            expect(items[0].textContent).toContain('Topic saved-a');
            expect(items[1].getAttribute('aria-current')).toBe('false');
        });

        it('plays a saved episode picked from the list', async () => {
            state.currentTopicId = 'saved-a';
            api.getPodcastEpisodesAPI.mockResolvedValue({ episodes: [saved('a2', 'saved-a'), saved('b1', 'saved-b')] });
            await loadPodcastLibrary();

            libraryItems()[1].click();
            expect(dom.podcastAudio.getAttribute('src') || dom.podcastAudio.src).toContain('/api/podcast/b1.mp3');
            expect(dom.podcastAudio.play).toHaveBeenCalled();
            expect(dom.podcastMeta.textContent).toContain('Previous episode: Topic saved-b');
            expect(dom.podcastGenerateBtn.textContent).toBe('Generate podcast for this topic');
            expect(libraryItems()[1].getAttribute('aria-current')).toBe('true');
            api.getPodcastEpisodesAPI.mockReset();
        });

        it('does not interrupt an episode that is playing', async () => {
            state.currentTopicId = 'saved-a';
            api.getPodcastEpisodesAPI.mockResolvedValueOnce({ episodes: [saved('c1', 'saved-c')] });
            await loadPodcastLibrary();
            libraryItems()[0].click();
            Object.defineProperty(dom.podcastAudio, 'paused', { value: false, configurable: true });

            state.currentTopicId = 'saved-d';
            api.getPodcastEpisodesAPI.mockResolvedValueOnce({ episodes: [saved('d1', 'saved-d'), saved('c1', 'saved-c')] });
            await loadPodcastLibrary();
            expect(dom.podcastAudio.getAttribute('src') || dom.podcastAudio.src).toContain('/api/podcast/c1.mp3');
            expect(libraryItems()).toHaveLength(2);
        });

        it('hides the transcript of an episode saved without phrases and skips expired ones', async () => {
            state.currentTopicId = 'saved-e';
            api.getPodcastEpisodesAPI.mockResolvedValueOnce({
                episodes: [
                    saved('e2', 'saved-e', { expires_at: new Date(Date.now() - 1000).toISOString() }),
                    saved('e1', 'saved-e', { phrases: [], phrase_count: 25 }),
                ],
            });
            await loadPodcastLibrary();
            expect(dom.podcastAudio.getAttribute('src') || dom.podcastAudio.src).toContain('/api/podcast/e1.mp3');
            expect(dom.podcastTranscript.classList.contains('hidden')).toBe(true);
            expect(dom.podcastMeta.textContent).toContain('25 phrases');
            expect(libraryItems()).toHaveLength(1);
        });

        it('adds a freshly built episode to the top of the list', async () => {
            state.currentTopicId = 'saved-f';
            api.getPodcastEpisodesAPI.mockResolvedValueOnce({ episodes: [saved('f1', 'saved-f')] });
            await loadPodcastLibrary();
            api.generatePodcastAPI.mockResolvedValueOnce(saved('f2', 'saved-f'));
            await generatePodcast();

            const items = libraryItems();
            expect(items).toHaveLength(2);
            expect(items[0].getAttribute('aria-current')).toBe('true');
            expect(dom.podcastAudio.getAttribute('src') || dom.podcastAudio.src).toContain('/api/podcast/f2.mp3');
            expect(dom.podcastTranscript.classList.contains('hidden')).toBe(false);
        });

        it('shows no list to guests and does not ask the server', async () => {
            state.isLoggedIn = false;
            openPodcastDialog();
            await loadPodcastLibrary();
            expect(api.getPodcastEpisodesAPI).not.toHaveBeenCalled();
            expect(dom.podcastLibrary.classList.contains('hidden')).toBe(true);
            expect(libraryItems()).toHaveLength(0);
        });
    });

    it('asks for a topic when none is selected', async () => {
        state.currentTopicId = '';
        await generatePodcast();
        expect(api.generatePodcastAPI).not.toHaveBeenCalled();
        expect(dom.podcastError.textContent).toBe('Please select a topic first.');
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
