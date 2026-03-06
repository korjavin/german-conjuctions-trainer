import { state } from './state.js';
import { dom } from './dom.js';
import {
    fetchTopicsAPI,
    createTopicAPI,
    deleteTopicAPI,
    updateTopicAPI,
    moveTopicAPI,
    fetchVersionsAPI,
    restoreVersionAPI,
    fetchLastGenerationDebugAPI,
    fetchLastRefinedPromptAPI,
    saveUserSettingsAPI,
} from './api.js';

let draggedTopicId = null;
let isMoveInProgress = false;

export async function loadTopics() {
    try {
        const data = await fetchTopicsAPI();
        state.topics = data.topics || [];

        renderTopicsList();

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

export function getTopicPath(topicId, allTopics = state.topics, visited = new Set()) {
    if (!topicId || visited.has(topicId)) return '';
    visited.add(topicId);

    const topic = allTopics.find(t => t.id === topicId);
    if (!topic) return '';

    if (!topic.parent_id) return topic.name;
    const parentPath = getTopicPath(topic.parent_id, allTopics, visited);
    return parentPath ? `${parentPath} / ${topic.name}` : topic.name;
}

function compareTopics(a, b, sortOrder) {
    switch (sortOrder) {
        case 'tree': {
            const aSort = Number.isFinite(a.sort_order) ? a.sort_order : 0;
            const bSort = Number.isFinite(b.sort_order) ? b.sort_order : 0;
            if (aSort !== bSort) return aSort - bSort;
            return a.name.localeCompare(b.name);
        }
        case 'name-asc':
            return a.name.localeCompare(b.name);
        case 'name-desc':
            return b.name.localeCompare(a.name);
        case 'date-newest':
            return new Date(b.created_at) - new Date(a.created_at);
        case 'date-oldest':
            return new Date(a.created_at) - new Date(b.created_at);
        default:
            return a.name.localeCompare(b.name);
    }
}

export function sortTopics(topics, sortOrder = state.topicSortOrder || 'tree') {
    const sorted = [...topics];
    sorted.sort((a, b) => compareTopics(a, b, sortOrder));
    return sorted;
}

function buildTopicTree(topics, sortOrder = state.topicSortOrder || 'tree') {
    const nodesById = new Map();

    topics.forEach(topic => {
        nodesById.set(topic.id, {
            ...topic,
            parent_id: topic.parent_id || '',
            children: []
        });
    });

    const roots = [];
    nodesById.forEach(node => {
        if (node.parent_id && node.parent_id !== node.id && nodesById.has(node.parent_id)) {
            nodesById.get(node.parent_id).children.push(node);
            return;
        }
        roots.push(node);
    });

    sortTreeNodes(roots, sortOrder);
    return { roots, nodesById };
}

function sortTreeNodes(nodes, sortOrder) {
    nodes.sort((a, b) => compareTopics(a, b, sortOrder));
    nodes.forEach(node => {
        if (node.children.length > 0) {
            sortTreeNodes(node.children, sortOrder);
        }
    });
}

function flattenTopicTree(roots, nodesById) {
    const flattened = [];
    const visited = new Set();

    const visitSiblings = (siblings, depth, parentId) => {
        siblings.forEach((node, indexInParent) => {
            visitNode(node, depth, parentId, indexInParent, siblings.length);
        });
    };

    const visitNode = (node, depth, parentId, indexInParent, totalSiblings) => {
        if (visited.has(node.id)) return;
        visited.add(node.id);

        flattened.push({
            topic: node,
            depth,
            parentId,
            indexInParent,
            totalSiblings,
        });

        if (node.children.length > 0) {
            visitSiblings(node.children, depth + 1, node.id);
        }
    };

    visitSiblings(roots, 0, '');
    nodesById.forEach(node => {
        if (!visited.has(node.id)) {
            visitNode(node, 0, node.parent_id || '', 0, 1);
        }
    });

    return flattened;
}

export function renderTopicsList() {
    dom.topicsList.innerHTML = '';

    if (state.topics.length === 0) {
        dom.topicsList.innerHTML = `<div class="p-4 text-gray-500 text-center">No topics available. Add one to get started.</div>`;
        return;
    }

    const { roots, nodesById } = buildTopicTree(state.topics, state.topicSortOrder || 'tree');
    const flattenedNodes = flattenTopicTree(roots, nodesById);

    flattenedNodes.forEach(({ topic, depth, parentId, indexInParent, totalSiblings }) => {
        const beforeZone = createSiblingDropZone(depth, parentId, indexInParent, nodesById);
        dom.topicsList.appendChild(beforeZone);

        const topicDiv = document.createElement('div');
        topicDiv.className = 'topic-list-item topic-tree-item flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 mb-2 rounded border border-gray-200';
        topicDiv.draggable = true;
        topicDiv.dataset.topicId = topic.id;
        topicDiv.style.marginLeft = `${depth * 20}px`;

        const hasChildren = topic.children.length > 0;
        const childBadge = hasChildren ? `<span class="text-xs text-gray-500 ml-2">(${topic.children.length})</span>` : '';

        topicDiv.innerHTML = `
            <div class="flex flex-col min-w-0">
                <div class="font-semibold topic-item-name flex items-center">
                    <span class="text-gray-400 mr-2 select-none">::</span>
                    <span class="truncate">${topic.name}</span>
                    ${childBadge}
                </div>
                <div class="topic-item-date">Created: ${new Date(topic.created_at).toLocaleDateString()}</div>
            </div>
            <div class="flex gap-2 mt-2 sm:mt-0">
                <button class="px-3 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 add-child-btn" data-topic-id="${topic.id}">Add child</button>
                <button class="px-3 py-1 bg-orange-100 text-orange-700 rounded hover:bg-orange-200 edit-topic-btn" data-topic-id="${topic.id}">Edit</button>
                <button class="px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 delete-topic-btn" data-topic-id="${topic.id}">Delete</button>
            </div>
        `;

        dom.topicsList.appendChild(topicDiv);

        const addChildBtn = topicDiv.querySelector('.add-child-btn');
        const editBtn = topicDiv.querySelector('.edit-topic-btn');
        const deleteBtn = topicDiv.querySelector('.delete-topic-btn');

        addChildBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showAddTopicForm(e.currentTarget.dataset.topicId);
        });

        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showPromptEditor(e.currentTarget.dataset.topicId);
        });

        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteTopic(e.currentTarget.dataset.topicId);
        });

        topicDiv.addEventListener('dragstart', (event) => {
            draggedTopicId = topic.id;
            topicDiv.classList.add('topic-dragging');
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', topic.id);
            }
        });

        topicDiv.addEventListener('dragend', () => {
            draggedTopicId = null;
            topicDiv.classList.remove('topic-dragging');
            clearDropHighlights();
        });

        attachDropHandlers(topicDiv, {
            targetParentId: topic.id,
            targetPosition: null,
            nodesById,
            isChildDrop: true,
        });

        if (indexInParent === totalSiblings - 1) {
            const afterZone = createSiblingDropZone(depth, parentId, totalSiblings, nodesById);
            dom.topicsList.appendChild(afterZone);
        }
    });
}

function createSiblingDropZone(depth, targetParentId, targetPosition, nodesById) {
    const zone = document.createElement('div');
    zone.className = 'topic-gap-drop-zone';
    zone.style.marginLeft = `${depth * 20}px`;
    attachDropHandlers(zone, {
        targetParentId,
        targetPosition,
        nodesById,
        isChildDrop: false,
    });
    return zone;
}

function attachDropHandlers(element, options) {
    const { targetParentId, targetPosition, nodesById, isChildDrop } = options;

    element.addEventListener('dragover', (event) => {
        if (!draggedTopicId || isMoveInProgress) return;
        event.preventDefault();
    });

    element.addEventListener('dragenter', (event) => {
        if (!draggedTopicId || isMoveInProgress) return;
        event.preventDefault();
        element.classList.add('topic-drop-active');
    });

    element.addEventListener('dragleave', () => {
        element.classList.remove('topic-drop-active');
    });

    element.addEventListener('drop', async (event) => {
        event.preventDefault();
        element.classList.remove('topic-drop-active');

        if (!draggedTopicId || isMoveInProgress) return;
        if (draggedTopicId === targetParentId && isChildDrop) return;
        if (targetParentId && wouldCreateCycle(nodesById, draggedTopicId, targetParentId)) {
            alert('Cannot move a topic into itself or one of its descendants.');
            return;
        }

        isMoveInProgress = true;
        try {
            await moveTopic(draggedTopicId, targetParentId || null, targetPosition);
        } finally {
            isMoveInProgress = false;
        }
    });
}

function wouldCreateCycle(nodesById, draggedId, targetParentId) {
    let cursor = targetParentId;
    const visited = new Set();

    while (cursor) {
        if (cursor === draggedId) {
            return true;
        }
        if (visited.has(cursor)) {
            return true;
        }
        visited.add(cursor);

        const cursorNode = nodesById.get(cursor);
        if (!cursorNode || !cursorNode.parent_id) {
            return false;
        }
        cursor = cursorNode.parent_id;
    }

    return false;
}

function clearDropHighlights() {
    dom.topicsList.querySelectorAll('.topic-drop-active').forEach(el => {
        el.classList.remove('topic-drop-active');
    });
}

function getNextSortOrder(parentId) {
    const normalizedParentId = parentId || null;
    const siblings = state.topics.filter(topic => {
        const topicParentId = topic.parent_id || null;
        return topicParentId === normalizedParentId;
    });

    if (siblings.length === 0) {
        return 0;
    }

    let maxSortOrder = -1;
    siblings.forEach(topic => {
        const sortValue = Number.isFinite(topic.sort_order) ? topic.sort_order : 0;
        if (sortValue > maxSortOrder) {
            maxSortOrder = sortValue;
        }
    });

    return maxSortOrder + 1;
}

async function createTopic(name, prompt, parentId = null, sortOrder = 0) {
    try {
        await createTopicAPI(name, prompt, parentId, sortOrder);
        await loadTopics();
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

        if (state.currentTopicId === topicId) {
            state.currentTopicId = '';
            localStorage.removeItem('selectedTopicId');
        }

        await loadTopics();
    } catch (error) {
        console.error('Error deleting topic:', error);
        alert(error.message || 'Failed to delete topic. Please try again.');
    }
}

async function updateTopicDetails(topicId, name, prompt, parentId, sortOrder) {
    try {
        await updateTopicAPI(topicId, name, prompt, parentId, sortOrder);
        await loadTopics();
        hidePromptEditor();
    } catch (error) {
        console.error('Error updating topic:', error);
        alert('Failed to update topic. Please try again.');
    }
}

async function moveTopic(topicId, parentId, position = null) {
    try {
        await moveTopicAPI(topicId, parentId, position);
        await loadTopics();
    } catch (error) {
        console.error('Error moving topic:', error);
        alert(`Failed to move topic. ${error.message || ''}`.trim());
    }
}

export function showAddTopicForm(parentId = null) {
    dom.addTopicForm.classList.remove('hidden');
    dom.newTopicName.value = '';
    dom.newTopicPrompt.value = '';

    const parentSelect = document.getElementById('new-topic-parent');
    if (parentSelect) {
        parentSelect.innerHTML = '<option value="">(Root Topic)</option>';
        state.topics.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = getTopicPath(t.id, state.topics);
            parentSelect.appendChild(opt);
        });
        parentSelect.value = parentId || '';
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
            if (t.id === topicId) return;
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = getTopicPath(t.id, state.topics);
            editParentSelect.appendChild(opt);
        });
        editParentSelect.value = topic.parent_id || '';
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
        await loadTopics();
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

    const parentSelect = document.getElementById('new-topic-parent');
    const parentId = parentSelect && parentSelect.value ? parentSelect.value : null;

    if (!name || !prompt) {
        alert('Please provide both a name and a prompt.');
        return;
    }

    const sortOrder = getNextSortOrder(parentId);
    createTopic(name, prompt, parentId, sortOrder);
}

export function savePrompt() {
    const prompt = dom.promptTextarea.value.trim();
    const name = dom.currentTopicName.textContent.trim();

    const editParentSelect = document.getElementById('edit-topic-parent');
    const parentId = editParentSelect && editParentSelect.value ? editParentSelect.value : null;

    if (!prompt) {
        alert('Prompt cannot be empty.');
        return;
    }

    const existingTopic = state.topics.find(t => t.id === state.editingTopicId);
    if (!existingTopic) {
        alert('Topic not found. Please refresh and try again.');
        return;
    }

    let sortOrder = Number.isFinite(existingTopic.sort_order) ? existingTopic.sort_order : 0;
    const existingParentId = existingTopic.parent_id || null;
    if (existingParentId !== parentId) {
        sortOrder = getNextSortOrder(parentId);
    }

    updateTopicDetails(state.editingTopicId, name, prompt, parentId, sortOrder);
}
