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
            dom.topicSearch.value = getTopicPath(currentTopic.id, state.topics);
        }

    } catch (error) {
        console.error('Error loading topics:', error);
        alert('Failed to load topics. Please refresh the page.');
    }
}

export function getTopicPath(topicId, allTopics = state.topics) {
    const topic = allTopics.find(t => t.id === topicId);
    if (!topic) return "";
    if (!topic.parent_id) return topic.name;
    return getTopicPath(topic.parent_id, allTopics) + " / " + topic.name;
}

export function sortTopics(topics) {
    const sorted = [...topics]; // Create a copy to avoid mutating original
    sorted.sort((a, b) => {
        if (a.sort_order !== b.sort_order) {
            return a.sort_order - b.sort_order;
        }
        return a.name.localeCompare(b.name);
    });
    return sorted;
}

function buildTopicTree(topics) {
    const map = new Map();
    const roots = [];

    // Initialize all nodes
    topics.forEach(topic => {
        map.set(topic.id, { ...topic, children: [] });
    });

    // Build the tree
    topics.forEach(topic => {
        const node = map.get(topic.id);
        if (topic.parent_id && map.has(topic.parent_id)) {
            map.get(topic.parent_id).children.push(node);
        } else {
            roots.push(node);
        }
    });

    return roots;
}

export function renderTopicsList() {
    dom.topicsList.innerHTML = '';

    if (state.topics.length === 0) {
        dom.topicsList.innerHTML = `<div class="p-4 text-gray-500 text-center">No topics available. Add one to get started.</div>`;
        return;
    }

    const tree = buildTopicTree(state.topics);

    function renderNode(node, depth) {
        const div = document.createElement('div');
        div.className = 'topic-list-item flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 mb-2 rounded border border-gray-200';
        div.style.marginLeft = `${depth * 20}px`;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'font-semibold topic-item-name';
        nameSpan.textContent = node.name;

        const infoDiv = document.createElement('div');
        infoDiv.className = 'flex flex-col';
        infoDiv.appendChild(nameSpan);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'flex gap-2 mt-2 sm:mt-0';

        const addChildBtn = document.createElement('button');
        addChildBtn.className = 'px-3 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 add-child-btn';
        addChildBtn.textContent = 'Add child';
        addChildBtn.dataset.topicId = node.id;
        addChildBtn.addEventListener('click', () => {
            showAddTopicForm(node.id);
        });

        const editBtn = document.createElement('button');
        editBtn.className = 'px-3 py-1 bg-orange-100 text-orange-700 rounded hover:bg-orange-200 edit-topic-btn';
        editBtn.textContent = 'Edit';
        editBtn.dataset.topicId = node.id;
        editBtn.addEventListener('click', () => {
            showPromptEditor(node.id);
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 delete-topic-btn';
        deleteBtn.textContent = 'Delete';
        deleteBtn.dataset.topicId = node.id;
        deleteBtn.addEventListener('click', () => {
            deleteTopic(node.id);
        });

        actionsDiv.appendChild(addChildBtn);
        actionsDiv.appendChild(editBtn);
        actionsDiv.appendChild(deleteBtn);

        div.appendChild(infoDiv);
        div.appendChild(actionsDiv);

        dom.topicsList.appendChild(div);

        if (node.children && node.children.length > 0) {
            const sortedChildren = sortTopics(node.children);
            sortedChildren.forEach(child => renderNode(child, depth + 1));
        }
    }

    const sortedRoots = sortTopics(tree);
    sortedRoots.forEach(rootNode => renderNode(rootNode, 0));
}

async function createTopic(name, prompt, parentId = null, sortOrder = 0) {
    try {
        await createTopicAPI(name, prompt, parentId, sortOrder);
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
        alert(error.message || 'Failed to delete topic. Please try again.');
    }
}

async function updateTopicDetails(topicId, name, prompt, parentId, sortOrder) {
    try {
        await updateTopicAPI(topicId, name, prompt, parentId, sortOrder);
        await loadTopics(); // Refresh the topics list
        hidePromptEditor();
    } catch (error) {
        console.error('Error updating topic:', error);
        alert('Failed to update topic. Please try again.');
    }
}

export function showAddTopicForm(parentId = null) {
    dom.addTopicForm.classList.remove('hidden');
    dom.newTopicName.value = '';
    dom.newTopicPrompt.value = '';

    // Check if the dropdown exists in dom.js, if not create/use it
    const parentSelect = document.getElementById('new-topic-parent');
    if (parentSelect) {
        parentSelect.innerHTML = '<option value="">(Root Topic)</option>';
        state.topics.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = getTopicPath(t.id, state.topics);
            parentSelect.appendChild(opt);
        });
        if (parentId) {
            parentSelect.value = parentId;
        } else {
            parentSelect.value = "";
        }
    }

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

    const editParentSelect = document.getElementById('edit-topic-parent');
    if (editParentSelect) {
        editParentSelect.innerHTML = '<option value="">(Root Topic)</option>';
        state.topics.forEach(t => {
            // Cannot be parent of itself or its children, but for UI simplicity we will just list all and server handles cycle rejection, or just exclude self.
            if (t.id === topicId) return;
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = getTopicPath(t.id, state.topics);
            editParentSelect.appendChild(opt);
        });
        if (topic.parent_id) {
            editParentSelect.value = topic.parent_id;
        } else {
            editParentSelect.value = "";
        }
    }

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
            versionDiv.className = 'topic-list-item flex justify-between items-center p-3';

            versionDiv.innerHTML = `
                <div>
                    <div class="topic-item-name">Version ${version.version}</div>
                    <div class="topic-item-date">${new Date(version.created_at).toLocaleString()}</div>
                </div>
                <button class="restore-version-btn text-link"
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
        dom.lastRefinedPromptModal.showModal();

    } catch (error) {
        console.error('Error fetching last refined prompt:', error);
        alert('Could not fetch the last refined prompt. Please try generating some exercises first.');
    }
}

export function renderTopicDropdown(topicsToRender) {
    dom.topicDropdown.innerHTML = '';
    if (topicsToRender.length === 0) {
        dom.topicDropdown.innerHTML = `<div class="p-2 text-gray-500">No topics found.</div>`;
        return;
    }
    topicsToRender.forEach(topic => {
        const item = document.createElement('div');
        item.className = 'topic-item';
        const fullPath = getTopicPath(topic.id, state.topics);
        item.textContent = fullPath;
        item.dataset.topicId = topic.id;
        item.addEventListener('click', () => {
            selectTopic(topic.id, fullPath);
        });
        dom.topicDropdown.appendChild(item);
    });
}

export function selectTopic(topicId, fullPath) {
    state.currentTopicId = topicId;
    localStorage.setItem('selectedTopicId', topicId);
    dom.topicSearch.value = fullPath;
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

    let parentId = null;
    const parentSelect = document.getElementById('new-topic-parent');
    if (parentSelect && parentSelect.value) {
        parentId = parentSelect.value;
    }

    if (!name || !prompt) {
        alert('Please provide both a name and a prompt.');
        return;
    }

    createTopic(name, prompt, parentId, 0);
}

export function savePrompt() {
    const prompt = dom.promptTextarea.value.trim();
    const name = dom.currentTopicName.textContent.trim();

    let parentId = null;
    const editParentSelect = document.getElementById('edit-topic-parent');
    if (editParentSelect && editParentSelect.value) {
        parentId = editParentSelect.value;
    }

    if (!prompt) {
        alert('Prompt cannot be empty.');
        return;
    }

    // Preserve existing sort order if available
    const existingTopic = state.topics.find(t => t.id === state.editingTopicId);
    const sortOrder = existingTopic ? existingTopic.sort_order : 0;

    updateTopicDetails(state.editingTopicId, name, prompt, parentId, sortOrder);
}
