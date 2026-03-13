import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    handleWordClick,
    handleHintClick,
    handleKeyPress,
    updateFavoriteButtonState,
    getHotkey,
    addPunctuationIfNeeded,
    renderExercise
} from '../exercise.js';
import { state } from '../state.js';
import { dom } from '../dom.js';

vi.mock('../audio.js', () => ({
    isPunctuation: vi.fn(t => /^[^\p{L}\p{N}]+$/u.test(t)),
    playWordAudio: vi.fn(),
    playSentenceAudio: vi.fn(),
    preloadExerciseWordAudio: vi.fn()
}));

vi.mock('../api.js', () => ({
    toggleFavoriteAPI: vi.fn(),
    hideExerciseAPI: vi.fn(),
    fetchExplainAPI: vi.fn()
}));

describe('exercise.js', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Reset state
        state.isLocked = false;
        state.userSentence = [];
        state.mistakes = 0;
        state.hintsUsed = 0;
        state.currentExerciseIndex = 0;
        state.exercises = [{
            correct_german_sentence: 'Das ist ein Test.',
            scrambled_german: ['Test', 'ein', 'Das', 'ist']
        }];
        state.exerciseIds = ['ex1'];
        state.exercisePerformance = new Map([['ex1', { hints: 0, mistakes: 0 }]]);
        state.exerciseMistakes = {};
        state.exercisesWithHints = new Set();
        state.exercisesWithMistakes = new Set();

        // Reset mock DOM classes
        dom.completionStatusIndicator.innerHTML = '';
        dom.exerciseControls.classList.remove('hidden');
        dom.hintBtn.classList.remove('hidden');
        dom.skipExerciseBtn.classList.remove('hidden');
        dom.scrambledWordsContainer.classList.remove('hidden');
    });

    describe('getHotkey', () => {
        it('returns 1-9 for indices 0-8', () => {
            expect(getHotkey(0)).toBe('1');
            expect(getHotkey(8)).toBe('9');
        });

        it('returns a,b,c for index 9,10,11', () => {
            expect(getHotkey(9)).toBe('a');
            expect(getHotkey(10)).toBe('b');
            expect(getHotkey(11)).toBe('c');
        });

        it('returns z for index 34', () => {
            // 97 (a) + 34 - 9 = 122 (z)
            expect(getHotkey(34)).toBe('z');
        });
    });

    describe('addPunctuationIfNeeded', () => {
        it('auto-prepends leading punctuation from correct sentence', () => {
            const exercise = { correct_german_sentence: '¿Hola!' };
            const userSentence = [];

            addPunctuationIfNeeded(exercise, userSentence);

            expect(userSentence).toEqual(['¿']);
        });

        it('stops at the first word', () => {
            const exercise = { correct_german_sentence: 'Das ist' };
            const userSentence = [];

            addPunctuationIfNeeded(exercise, userSentence);

            expect(userSentence).toEqual([]);
        });

        it('adds internal punctuation when reaching it', () => {
            const exercise = { correct_german_sentence: 'Ja, das stimmt.' };
            const userSentence = ['Ja'];

            addPunctuationIfNeeded(exercise, userSentence);

            expect(userSentence).toEqual(['Ja', ',']);
        });
    });

    describe('handleWordClick (checkAnswer logic)', () => {
        it('records mistake for incorrect word', async () => {
            const wordBtn = document.createElement('button');
            wordBtn.textContent = 'Test';
            wordBtn.dataset.word = 'Test'; // Wrong word, should be 'Das'

            // Provide a mock button explicitly to `handleWordClick` passing the `event` structure
            // Or since `handleWordClick` expects an element with `.dataset.word`, we can wrap it:
            // The signature of handleWordClick is `export async function handleWordClick(button)`
            // Wait, looking at the code, `handleWordClick` signature is `export async function handleWordClick(button)`.

            wordBtn.classList.add = vi.fn();
            wordBtn.classList.remove = vi.fn();

            // Setup DOM elements for the incorrect feedback mechanism
            const collectedWord = document.createElement('button');
            collectedWord.classList.add('btn-word', 'word-collected');
            dom.scrambledWordsContainer.appendChild(collectedWord);

            // `handleWordClick(word, button)`
            await handleWordClick('Test', wordBtn);

            expect(state.mistakes).toBe(1);
            expect(state.exercisesWithMistakes.has(0)).toBe(true);
            // Verify mistake string
            const mistakesSet = state.exerciseMistakes['ex1'];
            const mistakeArray = Array.from(mistakesSet);
            expect(mistakeArray[0]).toContain('Tried to use "Test"');

            // Clean up
            dom.scrambledWordsContainer.replaceChildren();
        });

        it('adds to userSentence for correct word', async () => {
            const wordBtn = document.createElement('button');
            wordBtn.textContent = 'Das';
            wordBtn.dataset.word = 'Das';
            wordBtn.style = {};

            // Add initial punctuation manually since our checkAnswer will expect it
            // 'Das' is the first word.
            // We must mock button classList completely due to JSDOM / vi.mock limits sometimes
            wordBtn.classList.add = vi.fn();
            wordBtn.classList.remove = vi.fn();

            // `handleWordClick(word, button)`
            await handleWordClick('Das', wordBtn);

            expect(state.userSentence).toContain('Das');
            expect(wordBtn.classList.add).toHaveBeenCalledWith('word-collected');
            expect(state.mistakes).toBe(0);
        });
    });

    describe('handleHintClick', () => {
        it('marks exercise in hintsUsed and reveals first word', () => {
            // Set up DOM to have buttons for the words
            const btnDas = document.createElement('button');
            btnDas.dataset.word = 'Das';
            btnDas.classList.add('btn-word');

            const btnIst = document.createElement('button');
            btnIst.dataset.word = 'ist';
            btnIst.classList.add('btn-word');

            dom.scrambledWordsContainer.appendChild(btnDas);
            dom.scrambledWordsContainer.appendChild(btnIst);

            handleHintClick();

            expect(state.hintsUsed).toBe(1);
            expect(state.exercisesWithHints.has(0)).toBe(true);
            expect(state.exercisePerformance.get('ex1').hints).toBe(1);
            expect(btnDas.classList.contains('hint-word')).toBe(true);

            dom.scrambledWordsContainer.replaceChildren();
        });
    });

    describe('handleKeyPress', () => {
        it('maps key to button click', () => {
            const btn = document.createElement('button');
            btn.dataset.hotkey = '1';
            btn.classList.add('btn-word');
            btn.click = vi.fn();

            dom.scrambledWordsContainer.appendChild(btn);

            handleKeyPress({ key: '1' });

            expect(btn.click).toHaveBeenCalled();

            dom.scrambledWordsContainer.replaceChildren();
        });
    });

    describe('updateFavoriteButtonState', () => {
        it('sets correct text/class on the dom mock when true', () => {
            // Need to mock SVG element for this
            dom.toggleFavoriteBtn.innerHTML = '<svg></svg>';
            const svg = dom.toggleFavoriteBtn.querySelector('svg');
            svg.setAttribute = vi.fn();

            updateFavoriteButtonState(true);

            expect(dom.favoriteBtnText.textContent).toBe('Remove from Favorites');
            expect(dom.toggleFavoriteBtn.classList.add).toHaveBeenCalledWith('btn-primary');
            expect(dom.toggleFavoriteBtn.classList.add).toHaveBeenCalledWith('filter-active-yellow');
            expect(dom.toggleFavoriteBtn.classList.remove).toHaveBeenCalledWith('btn-secondary');
            expect(svg.setAttribute).toHaveBeenCalledWith('fill', 'currentColor');
        });

        it('sets correct text/class on the dom mock when false', () => {
            dom.toggleFavoriteBtn.innerHTML = '<svg></svg>';
            const svg = dom.toggleFavoriteBtn.querySelector('svg');
            svg.setAttribute = vi.fn();

            updateFavoriteButtonState(false);

            expect(dom.favoriteBtnText.textContent).toBe('Add to Favorites');
            expect(dom.toggleFavoriteBtn.classList.add).toHaveBeenCalledWith('btn-secondary');
            expect(dom.toggleFavoriteBtn.classList.remove).toHaveBeenCalledWith('btn-primary');
            expect(dom.toggleFavoriteBtn.classList.remove).toHaveBeenCalledWith('filter-active-yellow');
            expect(svg.setAttribute).toHaveBeenCalledWith('fill', 'none');
        });
    });

    describe('word tokenization regex', () => {
        it('correctly tokenizes words and punctuation', () => {
            const regex = /[\p{L}\p{N}']+|[^\s\p{L}\p{N}]/gu;
            const sentence = "Nein, das ist nicht wahr!";
            const tokens = sentence.match(regex) || [];

            expect(tokens).toEqual(['Nein', ',', 'das', 'ist', 'nicht', 'wahr', '!']);
        });
    });

    describe('renderExercise', () => {
        beforeEach(() => {
            dom.exerciseContent = document.createElement('div');
            dom.emptyStateContainer = document.createElement('div');
            dom.exerciseCounter = document.createElement('div');
            dom.englishHintEl = document.createElement('div');
            dom.scrambledWordsContainer = document.createElement('div');
            dom.constructedSentenceEl = document.createElement('div');
            dom.correctSentenceDisplay = document.createElement('div');
            dom.explanationContainer = document.createElement('div');
            dom.explainBtn = document.createElement('button');
            dom.answerPrompt = document.createElement('div');
            dom.exerciseTopicLabel = document.createElement('span');

            // setup mocks for these
            dom.exerciseTopicLabel.classList.add = vi.fn();
            dom.exerciseTopicLabel.classList.remove = vi.fn();
        });

        it('hides topic label when exercise topic matches current topic', () => {
            state.exercises = [{
                correct_german_sentence: 'S1',
                english_hint: 'H1',
                topic_id: 'topic-A'
            }];
            state.currentExerciseIndex = 0;
            state.currentTopicId = 'topic-A';
            state.topics = [{ id: 'topic-A', name: 'Parent Topic' }];

            renderExercise();

            expect(dom.exerciseTopicLabel.textContent).toBe('');
            expect(dom.exerciseTopicLabel.classList.add).toHaveBeenCalledWith('invisible');
        });

        it('shows topic label with name when exercise topic differs from current topic', () => {
            state.exercises = [{
                correct_german_sentence: 'S1',
                english_hint: 'H1',
                topic_id: 'topic-B'
            }];
            state.currentExerciseIndex = 0;
            state.currentTopicId = 'topic-A';
            state.topics = [
                { id: 'topic-A', name: 'Parent Topic' },
                { id: 'topic-B', name: 'Child Topic' }
            ];

            renderExercise();

            expect(dom.exerciseTopicLabel.textContent).toBe('Child Topic');
            expect(dom.exerciseTopicLabel.classList.remove).toHaveBeenCalledWith('invisible');
        });

        it('hides topic label if topic_id is undefined', () => {
            state.exercises = [{
                correct_german_sentence: 'S1',
                english_hint: 'H1'
            }];
            state.currentExerciseIndex = 0;
            state.currentTopicId = 'topic-A';

            renderExercise();

            expect(dom.exerciseTopicLabel.textContent).toBe('');
            expect(dom.exerciseTopicLabel.classList.add).toHaveBeenCalledWith('invisible');
        });
    });
});
