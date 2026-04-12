import { vi } from 'vitest';

// Mock fetch globally
globalThis.fetch = vi.fn();

// Mock alert globally
globalThis.alert = vi.fn();

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
      audioToggleIcon: createMockElement('span'),
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
      favoriteBtnText: createMockElement('span'),
      completionStatusIndicator: createMockElement('div'),
      loadingSpinner: createMockElement('div'),
      exerciseContent: createMockElement('div'),
      generateBtn: createMockElement('button'),
      timer: createMockElement('span'),

      // History DOM
      historyModal: createMockDialog(),
      historyLoading: createMockElement('div'),
      historyEmpty: createMockElement('div'),
      historyContent: createMockElement('div'),
      historyPagination: createMockElement('div'),
      historyTopicName: createMockElement('span'),
      historySummary: createMockElement('div'),
      historyTotalCount: createMockElement('span'),
      historyReadyCount: createMockElement('span'),
      historyTrainedCount: createMockElement('span'),
      historySuccessRate: createMockElement('span'),
      historyTotalAttempts: createMockElement('span'),
      historyPageInfo: createMockElement('span'),
      historyPrevBtn: createMockElement('button'),
      historyNextBtn: createMockElement('button'),
      historyFilterReady: createMockElement('button'),
      historyFilterReadyCount: createMockElement('span'),
      historyFilterFavorites: createMockElement('button'),
      historyFilterFavoritesCount: createMockElement('span'),
      historyFilterTrained: createMockElement('button'),
      historyFilterTrainedCount: createMockElement('span'),
      historyFilterIgnored: createMockElement('button'),
      historyFilterIgnoredCount: createMockElement('span'),
      historyControlsContainer: createMockElement('div'),
      historyReviewChart: createMockElement('div'),
      historyReviewChartBars: createMockElement('div'),
      historySortTiming: createMockElement('button'),
      historySortErrors: createMockElement('button'),
      historySortDate: createMockElement('button'),

      // Additional elements can be added here as needed by tests
      constructedSentenceEl: createMockElement('div'),
      answerPrompt: createMockElement('div'),
    }
  };
});
