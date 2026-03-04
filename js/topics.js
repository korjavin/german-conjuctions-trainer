import { state } from './state.js';
import { dom } from './dom.js';
import {
    fetchTopicsAPI,
    createTopicAPI,
    deleteTopicAPI,
    updateTopicAPI,
    fetchVersionsAPI,
    restoreVersionAPI,
    fetchLastGenerationDebugAPI,
    fetchLastRefinedPromptAPI,
    saveUserSettingsAPI,
} from './api.js';

export async function loadTopics() {
    try {
        const data = await fetchTopicsAPI();
        state.topics = data.topics || [];

        renderTopicsList();

        // Load selected topic from localStorage or use first available
        const savedTopicId = localStorage.getItem('selectedTopicId');
        if (savedTopicId && state.topics.find(t => t.id === savedTopicId)) {
            state.currentTopicId = savedTopicId;
        } else if (state.topics.length > 0) {
            state.currentTopicId = state.topics[0].id;
        }

        const currentTopic = state.topics.find(t => t.id === state.currentTopicId);
        if (currentTopic) {
            dom.topicSearch.value = currentTopic.name;
        }

    } catch (error) {
        console.error('Error loading topics:', error);
        alert('Failed to load topics. Please refresh the page.');
    }
}

export function sortTopics(topics, sortOrder) {
    const sorted = [...topics]; // Create a copy to avoid mutating original

    switch (sortOrder) {
        case 'name-asc':
            sorted.sort((a, b) => a.name.localeCompare(b.name));
            break;
        case 'name-desc':
            sorted.sort((a, b) => b.name.localeCompare(a.name));
            break;
        case 'date-newest':
            sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            break;
        case 'date-oldest':
            sorted.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
            break;
    }

    return sorted;
}

export function renderTopicsList() {
    dom.topicsList.innerHTML = '';

    // Apply sorting
    const sortedTopics = sortTopics(state.topics, state.topicSortOrder);

    sortedTopics.forEach(topic => {
        const topicDiv = document.createElement('div');
        topicDiv.className = 'flex justify-between items-center p-3 border rounded-md bg-gray-50';

        topicDiv.innerHTML = `
            <div>
                <div class="font-medium">${topic.name}</div>
                <div class="text-sm text-gray-500">Created: ${new Date(topic.created_at).toLocaleDateString()}</div>
            </div>
            <div class="flex space-x-2">
                <button class="edit-topic-btn text-blue-600 hover:text-blue-800 text-sm" data-topic-id="${topic.id}">Edit</button>
                <button class="delete-topic-btn text-red-600 hover:text-red-800 text-sm" data-topic-id="${topic.id}">Delete</button>
            </div>
        `;

        dom.topicsList.appendChild(topicDiv);
    });

    // Add event listeners for edit and delete buttons
    dom.topicsList.querySelectorAll('.edit-topic-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const topicId = e.target.dataset.topicId;
            showPromptEditor(topicId);
        });
    });

    dom.topicsList.querySelectorAll('.delete-topic-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const topicId = e.target.dataset.topicId;
            deleteTopic(topicId);
        });
    });
}

async function createTopic(name, prompt) {
    try {
        await createTopicAPI(name, prompt);
        await loadTopics(); // Refresh the topics list
        hideAddTopicForm();
    } catch (error) {
        console.error('Error creating topic:', error);
        alert('Failed to create topic. Please try again.');
    }
}

async function deleteTopic(topicId) {
    if (!confirm('Are you sure you want to delete this topic? This action cannot be undone.')) {
        return;
    }

    try {
        await deleteTopicAPI(topicId);

        // If this was the selected topic, clear selection
        if (state.currentTopicId === topicId) {
            state.currentTopicId = '';
            localStorage.removeItem('selectedTopicId');
        }

        await loadTopics(); // Refresh the topics list
    } catch (error) {
        console.error('Error deleting topic:', error);
        alert('Failed to delete topic. Please try again.');
    }
}

async function updateTopicPrompt(topicId, name, prompt) {
    try {
        await updateTopicAPI(topicId, name, prompt);
        await loadTopics(); // Refresh the topics list
        hidePromptEditor();
    } catch (error) {
        console.error('Error updating prompt:', error);
        alert('Failed to update prompt. Please try again.');
    }
}

export function showAddTopicForm() {
    dom.addTopicForm.classList.remove('hidden');
    dom.newTopicName.value = '';
    dom.newTopicPrompt.value = '';
    dom.newTopicName.focus();
}

export function hideAddTopicForm() {
    dom.addTopicForm.classList.add('hidden');
}

export function showPromptEditor(topicId) {
    const topic = state.topics.find(t => t.id === topicId);
    if (!topic) return;

    state.editingTopicId = topicId;
    dom.currentTopicName.textContent = topic.name;
    dom.promptTextarea.value = topic.prompt;
    dom.promptEditor.classList.remove('hidden');
    dom.versionHistory.classList.add('hidden');
}

export function hidePromptEditor() {
    dom.promptEditor.classList.add('hidden');
    state.editingTopicId = null;
}

export async function showVersionHistory(topicId) {
    try {
        const data = await fetchVersionsAPI(topicId);
        const versions = data.versions || [];

        const topic = state.topics.find(t => t.id === topicId);
        dom.versionTopicName.textContent = topic ? topic.name : 'Unknown Topic';

        dom.versionsList.innerHTML = '';

        versions.reverse().forEach(version => {
            const versionDiv = document.createElement('div');
            versionDiv.className = 'flex justify-between items-center p-2 border rounded text-sm';

            versionDiv.innerHTML = `
                <div>
                    <div class="font-medium">Version ${version.version}</div>
                    <div class="text-gray-500">${new Date(version.created_at).toLocaleString()}</div>
                </div>
                <button class="restore-version-btn text-blue-600 hover:text-blue-800"
                        data-topic-id="${topicId}" data-version-id="${version.id}">
                    Restore
                </button>
            `;

            dom.versionsList.appendChild(versionDiv);
        });

        // Add event listeners for restore buttons
        dom.versionsList.querySelectorAll('.restore-version-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const tId = e.target.dataset.topicId;
                const vId = e.target.dataset.versionId;
                await restoreVersion(tId, vId);
            });
        });

        dom.promptEditor.classList.add('hidden');
        dom.versionHistory.classList.remove('hidden');

    } catch (error) {
        console.error('Error loading version history:', error);
        alert('Failed to load version history.');
    }
}

async function restoreVersion(topicId, versionId) {
    if (!confirm('Are you sure you want to restore this version? This will create a new version with this content.')) {
        return;
    }

    try {
        await restoreVersionAPI(topicId, versionId);
        await loadTopics(); // Refresh topics
        dom.versionHistory.classList.add('hidden');
        alert('Version restored successfully!');
    } catch (error) {
        console.error('Error restoring version:', error);
        alert('Failed to restore version.');
    }
}

export async function showLastRefinedPrompt() {
    try {
        let promptText = 'No generation prompt has been recorded yet.';

        const debugData = await fetchLastGenerationDebugAPI();
        if (debugData) {
            const conjunctions = (debugData.profile?.conjunction_set || []).join(', ') || 'none';
            const qualityFailures = (debugData.quality_gate_failures || []).length;
            const debugSummary = [
                `Batch: ${debugData.batch_id || 'n/a'}`,
                `Model: ${debugData.model_name || 'n/a'}`,
                `Refinement: ${debugData.refinement_used ? 'used' : 'fallback/base prompt'}`,
                `Provider retries: ${debugData.provider_retry_count || 0}`,
                `Quality retries: ${debugData.quality_gate_retry_count || 0}`,
                `Conjunction targets: ${conjunctions}`,
                `Quality issues: ${qualityFailures}`
            ].join('\n');

            promptText = (debugData.prompt || promptText) + `\n\n---\n${debugSummary}`;
        } else {
            const legacyData = await fetchLastRefinedPromptAPI();
            promptText = legacyData.last_refined_prompt || promptText;
        }

        dom.lastRefinedPromptContent.textContent = promptText;
        dom.lastRefinedPromptModal.classList.remove('hidden');

    } catch (error) {
        console.error('Error fetching last refined prompt:', error);
        alert('Could not fetch the last refined prompt. Please try generating some exercises first.');
    }
}

export function renderTopicDropdown(topics) {
    dom.topicDropdown.innerHTML = '';
    if (topics.length === 0) {
        dom.topicDropdown.innerHTML = `<div class="p-2 text-gray-500">No topics found.</div>`;
        return;
    }
    topics.forEach(topic => {
        const item = document.createElement('div');
        item.className = 'topic-item';
        item.textContent = topic.name;
        item.dataset.topicId = topic.id;
        item.addEventListener('click', () => {
            selectTopic(topic.id, topic.name);
        });
        dom.topicDropdown.appendChild(item);
    });
}

export function selectTopic(topicId, topicName) {
    state.currentTopicId = topicId;
    localStorage.setItem('selectedTopicId', topicId);
    dom.topicSearch.value = topicName;
    dom.topicDropdown.classList.add('hidden');
    if (state.isLoggedIn) {
        saveUserSettingsAPI(state.currentTopicId).catch(err => {
            console.error('Error saving user settings:', err);
        });
    }
}

export function positionDropdown() {
    const searchRect = dom.topicSearch.getBoundingClientRect();
    dom.topicDropdown.style.left = searchRect.left + 'px';
    dom.topicDropdown.style.top = (searchRect.bottom + 4) + 'px';
    dom.topicDropdown.style.width = searchRect.width + 'px';
}

export function saveTopic() {
    const name = dom.newTopicName.value.trim();
    const prompt = dom.newTopicPrompt.value.trim();

    if (!name || !prompt) {
        alert('Please provide both a name and a prompt.');
        return;
    }

    createTopic(name, prompt);
}

export function savePrompt() {
    const prompt = dom.promptTextarea.value.trim();
    const name = dom.currentTopicName.textContent.trim();

    if (!prompt) {
        alert('Prompt cannot be empty.');
        return;
    }

    updateTopicPrompt(state.editingTopicId, name, prompt);
}
