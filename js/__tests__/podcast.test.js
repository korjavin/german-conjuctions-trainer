import { describe, it, expect, beforeEach, vi } from 'vitest';
import { formatDuration, describeEpisode, openPodcastDialog, generatePodcast } from '../podcast.js';
import { state } from '../state.js';
import { dom } from '../dom.js';
import * as api from '../api.js';

vi.mock('../api.js', () => ({
    generatePodcastAPI: vi.fn()
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

        expect(api.generatePodcastAPI).toHaveBeenCalledWith('topic1');
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

    it('asks for a topic when none is selected', async () => {
        state.currentTopicId = '';
        await generatePodcast();
        expect(api.generatePodcastAPI).not.toHaveBeenCalled();
        expect(dom.podcastError.textContent).toBe('Please select a topic first.');
    });
});
