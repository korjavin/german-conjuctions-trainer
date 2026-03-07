/**
 * Functional Tests for Topic Form Improvements
 *
 * These tests can be run in browser console by:
 * 1. Loading page
 * 2. Opening browser console
 * 3. Pasting this entire file
 *
 * Tests cover:
 * - Form validation with improved error messages
 * - Topic hierarchy preview in add/edit forms
 * - Recently used topics quick-select
 * - Loading states for create/update operations
 * - Confirmation dialogs for destructive operations
 * - Keyboard shortcuts (Ctrl+Enter to save, Escape to cancel)
 */

(function() {
    'use strict';

    const tests = [];
    let passed = 0;
    let failed = 0;

    function assert(condition, message) {
        if (condition) {
            console.log('✓', message);
            passed++;
        } else {
            console.error('✗', message);
            failed++;
        }
    }

    function assertEqual(actual, expected, message) {
        if (actual === expected) {
            console.log('✓', message, `(got: ${actual})`);
            passed++;
        } else {
            console.error('✗', message, `(expected: ${expected}, got: ${actual})`);
            failed++;
        }
    }

    // Test 1: Verify validateTopicName function exists
    tests.push(() => {
        const validateName = typeof window.validateTopicName === 'function' ? window.validateTopicName : null;
        assert(validateName !== null, 'validateTopicName function is available');
    });

    // Test 2: Verify validateTopicPrompt function exists
    tests.push(() => {
        const validatePrompt = typeof window.validateTopicPrompt === 'function' ? window.validateTopicPrompt : null;
        assert(validatePrompt !== null, 'validateTopicPrompt function is available');
    });

    // Test 3: Verify validateTopicName returns error for empty name
    tests.push(() => {
        const validateName = typeof window.validateTopicName === 'function' ? window.validateTopicName : null;
        if (!validateName) {
            console.log('  Skipping: validateTopicName not available');
            return;
        }

        const error = validateTopicName('');
        assert(error !== null, 'validateTopicName returns error for empty name');
        assert(error.includes('required'), 'Error message mentions "required"');
    });

    // Test 4: Verify validateTopicName accepts valid name
    tests.push(() => {
        const validateName = typeof window.validateTopicName === 'function' ? window.validateTopicName : null;
        if (!validateName) {
            console.log('  Skipping: validateTopicName not available');
            return;
        }

        const error = validateTopicName('Test Topic');
        assert(error === null, 'validateTopicName accepts valid name');
    });

    // Test 5: Verify validateTopicPrompt returns error for empty prompt
    tests.push(() => {
        const validatePrompt = typeof window.validateTopicPrompt === 'function' ? window.validateTopicPrompt : null;
        if (!validatePrompt) {
            console.log('  Skipping: validateTopicPrompt not available');
            return;
        }

        const error = validateTopicPrompt('');
        assert(error !== null, 'validateTopicPrompt returns error for empty prompt');
        assert(error.includes('required'), 'Error message mentions "required"');
    });

    // Test 6: Verify validateTopicPrompt returns error for short prompt
    tests.push(() => {
        const validatePrompt = typeof window.validateTopicPrompt === 'function' ? window.validateTopicPrompt : null;
        if (!validatePrompt) {
            console.log('  Skipping: validateTopicPrompt not available');
            return;
        }

        const error = validateTopicPrompt('short');
        assert(error !== null, 'validateTopicPrompt returns error for short prompt');
        assert(error.includes('characters'), 'Error message mentions character count');
    });

    // Test 7: Verify validateTopicPrompt accepts valid prompt
    tests.push(() => {
        const validatePrompt = typeof window.validateTopicPrompt === 'function' ? window.validateTopicPrompt : null;
        if (!validatePrompt) {
            console.log('  Skipping: validateTopicPrompt not available');
            return;
        }

        const error = validateTopicPrompt('This is a valid prompt with enough content.');
        assert(error === null, 'validateTopicPrompt accepts valid prompt');
    });

    // Test 8: Verify showFieldError function exists
    tests.push(() => {
        const showFieldError = typeof window.showFieldError === 'function' ? window.showFieldError : null;
        assert(showFieldError !== null, 'showFieldError function is available');
    });

    // Test 9: Verify clearFieldError function exists
    tests.push(() => {
        const clearFieldError = typeof window.clearFieldError === 'function' ? window.clearFieldError : null;
        assert(clearFieldError !== null, 'clearFieldError function is available');
    });

    // Test 10: Verify add topic form has error message elements
    tests.push(() => {
        const nameError = document.getElementById('new-topic-name-error');
        const promptError = document.getElementById('new-topic-prompt-error');
        assert(nameError !== null, 'Add topic form has name error element');
        assert(promptError !== null, 'Add topic form has prompt error element');
    });

    // Test 11: Verify edit topic form has error message element
    tests.push(() => {
        const promptError = document.getElementById('edit-topic-prompt-error');
        assert(promptError !== null, 'Edit topic form has prompt error element');
    });

    // Test 12: Verify add topic form has hierarchy preview
    tests.push(() => {
        const preview = document.getElementById('add-topic-hierarchy-preview');
        const path = document.getElementById('add-topic-preview-path');
        assert(preview !== null, 'Add topic form has hierarchy preview container');
        assert(path !== null, 'Add topic form has hierarchy preview path');
    });

    // Test 13: Verify edit topic form has hierarchy preview
    tests.push(() => {
        const preview = document.getElementById('edit-topic-hierarchy-preview');
        const path = document.getElementById('edit-topic-current-path');
        assert(preview !== null, 'Edit topic form has hierarchy preview container');
        assert(path !== null, 'Edit topic form has hierarchy preview path');
    });

    // Test 14: Verify add topic form has recently used topics section
    tests.push(() => {
        const recentlyUsed = document.getElementById('recently-used-topics');
        const container = document.getElementById('recent-topics-container');
        assert(recentlyUsed !== null, 'Add topic form has recently used topics section');
        assert(container !== null, 'Add topic form has recently used topics container');
    });

    // Test 15: Verify edit topic form has recently used topics section
    tests.push(() => {
        const recentlyUsed = document.getElementById('edit-recently-used-topics');
        const container = document.getElementById('edit-recent-topics-container');
        assert(recentlyUsed !== null, 'Edit topic form has recently used topics section');
        assert(container !== null, 'Edit topic form has recently used topics container');
    });

    // Test 16: Verify state has recentlyUsedTopics property
    tests.push(() => {
        const hasRecentlyUsed = typeof window.state !== 'undefined' && 'recentlyUsedTopics' in window.state;
        assert(hasRecentlyUsed, 'State object has recentlyUsedTopics property');
        if (hasRecentlyUsed) {
            console.log('  recentlyUsedTopics type:', window.state.recentlyUsedTopics.constructor.name);
        }
    });

    // Test 17: Verify state has isCreatingTopic property
    tests.push(() => {
        const hasCreatingState = typeof window.state !== 'undefined' && 'isCreatingTopic' in window.state;
        assert(hasCreatingState, 'State object has isCreatingTopic property');
    });

    // Test 18: Verify state has isUpdatingTopic property
    tests.push(() => {
        const hasUpdatingState = typeof window.state !== 'undefined' && 'isUpdatingTopic' in window.state;
        assert(hasUpdatingState, 'State object has isUpdatingTopic property');
    });

    // Test 19: Verify addRecentlyUsedTopic function exists
    tests.push(() => {
        const addRecentlyUsed = typeof window.addRecentlyUsedTopic === 'function' ? window.addRecentlyUsedTopic : null;
        assert(addRecentlyUsed !== null, 'addRecentlyUsedTopic function is available');
    });

    // Test 20: Verify renderRecentlyUsedTopics function exists
    tests.push(() => {
        const renderRecent = typeof window.renderRecentlyUsedTopics === 'function' ? window.renderRecentlyUsedTopics : null;
        assert(renderRecent !== null, 'renderRecentlyUsedTopics function is available');
    });

    // Test 21: Verify updateHierarchyPreview function exists
    tests.push(() => {
        const updatePreview = typeof window.updateHierarchyPreview === 'function' ? window.updateHierarchyPreview : null;
        assert(updatePreview !== null, 'updateHierarchyPreview function is available');
    });

    // Test 22: Verify setFormLoading function exists
    tests.push(() => {
        const setLoading = typeof window.setFormLoading === 'function' ? window.setFormLoading : null;
        assert(setLoading !== null, 'setFormLoading function is available');
    });

    // Test 23: Verify setupFormValidation function exists
    tests.push(() => {
        const setupValidation = typeof window.setupFormValidation === 'function' ? window.setupFormValidation : null;
        assert(setupValidation !== null, 'setupFormValidation function is available');
    });

    // Test 24: Verify setupFormKeyboardShortcuts function exists
    tests.push(() => {
        const setupShortcuts = typeof window.setupFormKeyboardShortcuts === 'function' ? window.setupFormKeyboardShortcuts : null;
        assert(setupShortcuts !== null, 'setupFormKeyboardShortcuts function is available');
    });

    // Test 25: Verify form has loading spinner in save button
    tests.push(() => {
        const saveTopicBtn = document.getElementById('save-topic-btn');
        const savePromptBtn = document.getElementById('save-prompt-btn');

        const hasAddSpinner = saveTopicBtn && saveTopicBtn.querySelector('.loading-spinner');
        const hasEditSpinner = savePromptBtn && savePromptBtn.querySelector('.loading-spinner');

        assert(hasAddSpinner, 'Add topic save button has loading spinner');
        assert(hasEditSpinner, 'Edit topic save button has loading spinner');
    });

    // Test 26: Verify clearFormErrors function exists
    tests.push(() => {
        const clearErrors = typeof window.clearFormErrors === 'function' ? window.clearFormErrors : null;
        assert(clearErrors !== null, 'clearFormErrors function is available');
    });

    // Test 27: Verify CSS for form error states exists
    tests.push(() => {
        const testElement = document.createElement('input');
        testElement.className = 'form-input-error';
        document.body.appendChild(testElement);

        const computedStyle = window.getComputedStyle(testElement);
        const hasErrorBorder = computedStyle.borderColor !== 'rgba(0, 0, 0, 0)' &&
            computedStyle.borderColor !== 'transparent' &&
            computedStyle.borderColor.includes('220') || // red color
            computedStyle.borderColor.includes('38');

        document.body.removeChild(testElement);

        assert(hasErrorBorder, 'Form error state has red border styling');
    });

    // Test 28: Verify CSS for form success states exists
    tests.push(() => {
        const testElement = document.createElement('input');
        testElement.className = 'form-input-success';
        document.body.appendChild(testElement);

        const computedStyle = window.getComputedStyle(testElement);
        const hasSuccessBorder = computedStyle.borderColor !== 'rgba(0, 0, 0, 0)' &&
            computedStyle.borderColor !== 'transparent' &&
            computedStyle.borderColor.includes('22') || // green color
            computedStyle.borderColor.includes('74') ||
            computedStyle.borderColor.includes('163');

        document.body.removeChild(testElement);

        assert(hasSuccessBorder, 'Form success state has green border styling');
    });

    // Test 29: Verify CSS for recently used topic badges exists
    tests.push(() => {
        const testElement = document.createElement('span');
        testElement.className = 'recent-topic-badge';
        document.body.appendChild(testElement);

        const computedStyle = window.getComputedStyle(testElement);
        const hasStyling = computedStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
            computedStyle.backgroundColor !== 'transparent';

        document.body.removeChild(testElement);

        assert(hasStyling, 'Recently used topic badge has styling applied');
    });

    // Test 30: Verify required field indicators exist
    tests.push(() => {
        const nameLabel = document.querySelector('#add-topic-form label[for="new-topic-name"]');
        const promptLabel = document.querySelector('#add-topic-form label[for="new-topic-prompt"]');

        const nameHasRequired = nameLabel && nameLabel.innerHTML.includes('class="text-red-500">*</span>');
        const promptHasRequired = promptLabel && promptLabel.innerHTML.includes('class="text-red-500">*</span>');

        assert(nameHasRequired, 'Topic name field has required indicator');
        assert(promptHasRequired, 'Prompt field has required indicator');
    });

    // Test 31: Verify keyboard shortcuts are documented in button labels
    tests.push(() => {
        const cancelAddBtn = document.getElementById('cancel-add-btn');
        const cancelEditBtn = document.getElementById('cancel-edit-btn');

        const addHasShortcut = cancelAddBtn && cancelAddBtn.textContent.includes('Esc');
        const editHasShortcut = cancelEditBtn && cancelEditBtn.textContent.includes('Esc');

        assert(addHasShortcut, 'Add topic cancel button shows Esc shortcut');
        assert(editHasShortcut, 'Edit topic cancel button shows Esc shortcut');
    });

    // Test 32: Test form labels are clear and descriptive
    tests.push(() => {
        const nameLabel = document.querySelector('#add-topic-form label[for="new-topic-name"]');
        const promptLabel = document.querySelector('#add-topic-form label[for="new-topic-prompt"]');
        const parentLabel = document.querySelector('#add-topic-form label[for="new-topic-parent"]');

        const nameClear = nameLabel && nameLabel.textContent.includes('Name');
        const promptClear = promptLabel && promptLabel.textContent.includes('Prompt');
        const parentClear = parentLabel && parentLabel.textContent.includes('Parent');

        assert(nameClear, 'Topic name label is clear and descriptive');
        assert(promptClear, 'Prompt label is clear and descriptive');
        assert(parentClear, 'Parent label is clear and descriptive');
    });

    // Test 33: Verify CSS for text-error exists
    tests.push(() => {
        const testElement = document.createElement('div');
        testElement.className = 'text-error';
        document.body.appendChild(testElement);

        const computedStyle = window.getComputedStyle(testElement);
        const hasErrorColor = computedStyle.color !== 'rgba(0, 0, 0, 0)' &&
            computedStyle.color !== 'transparent' &&
            (computedStyle.color.includes('220') || // red color
             computedStyle.color.includes('38'));

        document.body.removeChild(testElement);

        assert(hasErrorColor, 'text-error class has red color styling');
    });

    // Run all tests
    console.log('='.repeat(60));
    console.log('Running Topic Form Improvements Tests');
    console.log('='.repeat(60));

    tests.forEach((test, index) => {
        console.log(`\nTest ${index + 1}:`);
        try {
            test();
        } catch (error) {
            console.error('✗ Test failed with exception:', error.message);
            console.error('  Stack:', error.stack);
            failed++;
        }
    });

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('Test Summary');
    console.log('='.repeat(60));
    console.log('Passed:', passed);
    console.log('Failed:', failed);
    console.log('Total:', passed + failed);
    console.log('='.repeat(60));

    if (failed === 0) {
        console.log('\n✓ All tests passed!');
    } else {
        console.log('\n✗ Some tests failed. Please review output above.');
    }

    // Export test summary for programmatic access
    window.topicFormTestResults = {
        passed,
        failed,
        total: passed + failed,
        success: failed === 0
    };

    return {
        passed,
        failed,
        total: passed + failed,
        success: failed === 0
    };
})();
