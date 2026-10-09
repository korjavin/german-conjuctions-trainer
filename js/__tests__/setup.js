import { vi } from 'vitest';

// Mock fetch globally
globalThis.fetch = vi.fn();

// js/ui.js feedback (toast/confirm) is mocked for every spec; ui.test.js loads the real module.
vi.mock('../ui.js', () => ({
  toast: vi.fn(),
  confirm: vi.fn(async () => null)
}));

// Mock localStorage globally
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: vi.fn(key => store[key] || null),
    setItem: vi.fn((key, value) => {
      store[key] = value.toString();
    }),
    removeItem: vi.fn(key => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    })
  };
})();
globalThis.localStorage = localStorageMock;

// Mock DOM factory helper for dom.js mock
vi.mock('../dom.js', () => {
  const createMockElement = (tag = 'div') => {
    const el = document.createElement(tag);
    // Add any specific jest-like mock methods if needed
    el.classList.add = vi.fn(el.classList.add.bind(el.classList));
    el.classList.remove = vi.fn(el.classList.remove.bind(el.classList));
    el.classList.toggle = vi.fn(el.classList.toggle.bind(el.classList));
    el.setAttribute = vi.fn(el.setAttribute.bind(el));
    el.removeAttribute = vi.fn(el.removeAttribute.bind(el));
    el.appendChild = vi.fn(el.appendChild.bind(el));
    el.removeChild = vi.fn(el.removeChild.bind(el));
    el.replaceChildren = vi.fn(el.replaceChildren.bind(el));
    el.addEventListener = vi.fn(el.addEventListener.bind(el));
    el.removeEventListener = vi.fn(el.removeEventListener.bind(el));

    // For input elements
    el.focus = vi.fn();
    el.blur = vi.fn();
    el.click = vi.fn();

    // Make innerHTML/textContent setters observable if needed by spying on the properties
    // For now, happy-dom's basic properties work fine, but if we need to spy on assignments:
    return el;
  };

  const createMockDialog = () => {
    const el = createMockElement('dialog');
    el.showModal = vi.fn();
    el.close = vi.fn();
    return el;
  };

  return {
    dom: {
      audioToggleBtn: createMockElement('button'),
      replayAudioBtn: createMockElement('button'),
      scrambledWordsContainer: createMockElement('div'),
      scrambledWordsHeader: createMockElement('div'),
      exerciseControls: createMockElement('div'),
      hintBtn: createMockElement('button'),
      skipExerciseBtn: createMockElement('button'),
      explainBtn: createMockElement('button'),
      explanationContainer: createMockElement('div'),
      explanationText: createMockElement('div'),
      toggleFavoriteBtn: createMockElement('button'),
      completionStatusIndicator: createMockElement('div'),
      nextReviewLabel: createMockElement('span'),
      practiceStatus: createMockElement('span'),
      answerArea: createMockElement('div'),
      exerciseContainer: createMockElement('div'),
      loadingSpinner: createMockElement('div'),
      exerciseContent: createMockElement('div'),
      generateBtn: createMockElement('button'),
      timer: createMockElement('span'),

      // Auth / header DOM
      loginBtn: createMockElement('button'),
      logoutBtn: createMockElement('button'),
      settingsBtn: createMockElement('button'),
      offlineCacheBtn: createMockElement('button'),
      offlineCacheStatus: createMockElement('span'),
      offlineCacheCount: createMockElement('div'),
      offlineCacheProgress: createMockElement('div'),
      offlineCacheProgressFill: createMockElement('div'),
      offlineCacheProgressText: createMockElement('span'),
      prefSound: createMockElement('button'),
      prefAutoplay: createMockElement('button'),
      prefVoice: createMockElement('button'),
      prefVoiceRow: createMockElement('div'),

      // Additional elements can be added here as needed by tests
      constructedSentenceEl: createMockElement('div'),
      answerPrompt: createMockElement('div'),

      // Podcast DOM
      podcastFavoritesOption: createMockElement('div'),
      podcastFavoritesOnly: createMockElement('button'),
      podcastGenerateBtn: createMockElement('button'),
      podcastGenerateLabel: createMockElement('span'),
      podcastEmptyGenerateBtn: createMockElement('button'),
      podcastEmpty: createMockElement('div'),
      podcastEmptyTitle: createMockElement('div'),
      podcastScopeRow: createMockElement('button'),
      podcastPlayer: createMockElement('div'),
      podcastPlayBtn: createMockElement('button'),
      podcastTitle: createMockElement('div'),
      podcastMeta: createMockElement('div'),
      podcastSpeedBtn: createMockElement('button'),
      podcastTrack: createMockElement('div'),
      podcastFill: createMockElement('div'),
      podcastKnob: createMockElement('div'),
      podcastTime: createMockElement('span'),
      podcastTotal: createMockElement('span'),
      podcastBackBtn: createMockElement('button'),
      podcastFwdBtn: createMockElement('button'),
      podcastAudio: createMockElement('audio'),
      podcastDownloadLink: createMockElement('a'),
      podcastTranscript: createMockElement('details'),
      podcastTranscriptSummary: createMockElement('summary'),
      podcastPhraseList: createMockElement('ol'),
      podcastEpisodesSummary: createMockElement('span'),
      podcastEpisodeList: createMockElement('div'),
      podcastFeedSection: createMockElement('div'),
      podcastFeedUrl: createMockElement('input'),
      podcastFeedCopyBtn: createMockElement('button'),
      podcastFeedRegenerateBtn: createMockElement('button'),
      podcastFeedError: createMockElement('div'),

      // js/ui.js hosts
      toastRoot: createMockElement('div'),
      confirmDialog: createMockDialog(),
    }
  };
});
