import { describe, it, expect, beforeEach, vi } from 'vitest';
import { normalize, tokenize, levenshtein, matchCandidate, applyTokens, bestAlternative } from '../voice.js';
import { state } from '../state.js';
import { dom } from '../dom.js';

vi.mock('../audio.js', async (importOriginal) => ({
    ...(await importOriginal()),
    playWordAudio: vi.fn(),
    playSentenceAudio: vi.fn(),
    preloadExerciseWordAudio: vi.fn()
}));
vi.mock('../api.js', () => ({ toggleFavoriteAPI: vi.fn(), toggleHideExerciseAPI: vi.fn(), fetchExplainAPI: vi.fn() }));

describe('voice.js', () => {
    it('normalizes case, punctuation and digits', () => {
        expect(normalize('Wäre,')).toBe('wäre');
        expect(normalize('7')).toBe('sieben');
        expect(tokenize('Ich würde gern um 7 Uhr.')).toEqual(['ich', 'würde', 'gern', 'um', 'sieben', 'uhr']);
    });

    it('levenshtein and unambiguous fuzzy match', () => {
        expect(levenshtein('zuhause', 'zuhaus')).toBe(1);
        expect(levenshtein('die', 'das')).toBe(2);
        const c = [{ key: 'gern' }, { key: 'kern' }, { key: 'wäre' }];
        expect(matchCandidate('gern', c).key).toBe('gern');
        expect(matchCandidate('wären', c).key).toBe('wäre');
        expect(matchCandidate('fern', c)).toBeNull(); // gern/kern both dist 1 -> ambiguous
        expect(matchCandidate('in', [{ key: 'im' }])).toBeNull(); // too short to fuzzy-match
    });

    describe('applyTokens', () => {
        beforeEach(() => {
            state.isLocked = false;
            state.isAudioEnabled = false;
            state.userSentence = [];
            state.mistakes = 0;
            state.currentExerciseIndex = 0;
            state.exerciseIds = ['e1'];
            state.exerciseMistakes = {};
            state.exercisesWithMistakes = new Set();
            state.exercisePerformance = new Map();
            state.exercises = [{ correct_german_sentence: 'Das ist gut.' }];
            dom.scrambledWordsContainer.innerHTML = '';
            for (const w of ['gut', 'Das', 'ist']) {
                const b = document.createElement('button');
                b.className = 'btn-word';
                b.dataset.word = w;
                dom.scrambledWordsContainer.appendChild(b);
            }
        });

        it('collects spoken words in order, ignores noise, penalizes wrong bank words', () => {
            applyTokens(['das', 'blabla'], true);
            expect(state.userSentence).toEqual(['Das']);
            expect(state.mistakes).toBe(0);
            applyTokens(['gut'], true); // in bank, but not next -> mistake
            expect(state.mistakes).toBe(1);
            applyTokens(['gut'], false); // interim wrong guess -> no mistake
            expect(state.mistakes).toBe(1);
            applyTokens(['ist'], false); // interim right guess -> accepted
            expect(state.userSentence).toEqual(['Das', 'ist']);
        });

        it('reports applied indices and only penalizes single-word finals', () => {
            const first = applyTokens(['gut', 'das'], false); // interim: gut skipped, das clicked
            expect([...first]).toEqual([1]);
            const second = applyTokens(['gut', 'das'], true, first); // final phrase: gut still not punished
            expect([...second]).toEqual([]);
            expect(state.mistakes).toBe(0);
            applyTokens(['gut'], true); // single word: punished
            expect(state.mistakes).toBe(1);
        });

        it('picks the alternative that follows the expected order', () => {
            const alts = ['zum Termin', 'zu einem Termin', 'zu einen Termin'];
            expect(bestAlternative(alts, ['zu', 'einem', 'Termin', 'gehen'])).toBe('zu einem Termin');
            expect(bestAlternative(['Termin'], ['zu', 'einem', 'Termin'])).toBe('Termin');
        });

        it('skip command skips the exercise when the word is not in the bank', async () => {
            const exercise = await import('../exercise.js');
            const spy = vi.spyOn(exercise, 'handleSkipExercise').mockImplementation(() => {});
            applyTokens(['skip'], false); // interim: never act
            expect(spy).not.toHaveBeenCalled();
            applyTokens(['skip'], true);
            expect(spy).toHaveBeenCalledTimes(1);
            spy.mockRestore();
        });

        it('prefers the button whose raw word matches (Sie vs sie) and treats bank words as words, not commands', () => {
            state.exercises = [{ correct_german_sentence: 'Sie sagt, dass sie weiter macht.' }];
            dom.scrambledWordsContainer.innerHTML = '';
            for (const w of ['sie', 'Sie', 'weiter', 'sagt', 'dass', 'macht']) {
                const b = document.createElement('button');
                b.className = 'btn-word';
                b.dataset.word = w;
                dom.scrambledWordsContainer.appendChild(b);
            }
            applyTokens(['sie', 'sagt', 'dass', 'sie', 'weiter'], true);
            expect(state.mistakes).toBe(0);
            expect(state.userSentence.filter(w => /\w/.test(w))).toEqual(['Sie', 'sagt', 'dass', 'sie', 'weiter']);
        });
    });
});
