import { state, toggleTopicCollapse, isTopicCollapsed } from './state.js';
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

export function getFolderIcon() {
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="topic-icon-folder">
        <path d="M2 5.5C2 4.67157 2.67157 4 3.5 4H6.5L7.5 5H12.5C13.3284 5 14 5.67157 14 6.5V11.5C14 12.3284 13.3284 13 12.5 13H3.5C2.67157 13 2 12.3284 2 11.5V5.5Z" fill="#f59e0b" fill-opacity="0.2" stroke="#f59e0b" stroke-width="1.5"/>
        <path d="M2 5.5H14" stroke="#f59e0b" stroke-width="1.5"/>
    </svg>`;
}

export function getFileIcon() {
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="topic-icon-file">
        <path d="M3 2.5C3 1.67157 3.67157 1 4.5 1H9.5L13 4.5V13.5C13 14.3284 12.3284 15 11.5 15H4.5C3.67157 15 3 14.3284 3 13.5V2.5Z" fill="#6b7280" fill-opacity="0.1" stroke="#6b7280" stroke-width="1.5"/>
        <path d="M9 1V4.5H13" stroke="#6b7280" stroke-width="1.5" stroke-linejoin="round"/>
        <line x1="5" y1="6" x2="11" y2="6" stroke="#6b7280" stroke-width="1" stroke-linecap="round"/>
        <line x1="5" y1="9" x2="11" y2="9" stroke="#6b7280" stroke-width="1" stroke-linecap="round"/>
        <line x1="5" y1="12" x2="8" y2="12" stroke="#6b7280" stroke-width="1" stroke-linecap="round"/>
    </svg>`;
}

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

export function buildTopicTree(topics, sortOrder = state.topicSortOrder || 'tree') {
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

function sortTreeNodes(nodes, sortOrder, isTopLevel = true) {
    // Only sort top-level topics - nested children maintain tree order
    if (isTopLevel && sortOrder !== 'tree') {
        nodes.sort((a, b) => compareTopics(a, b, sortOrder));
    } else if (sortOrder === 'tree') {
        // For tree order, sort by sort_order at all levels
        nodes.sort((a, b) => compareTopics(a, b, sortOrder));
    }

    // Recursively process children (but don't sort them unless it's tree order)
    nodes.forEach(node => {
        if (node.children.length > 0) {
            sortTreeNodes(node.children, sortOrder, false);
        }
    });
}

function flattenTopicTree(roots, nodesById, searchExpandedIds = new Set()) {
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

        // Only visit children if this topic is not collapsed
        // During search, topics with matching descendants are automatically expanded
        const shouldShowChildren = node.children.length > 0 &&
            (!isTopicCollapsed(node.id) || searchExpandedIds.has(node.id));
        if (shouldShowChildren) {
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

function findMatchingTopics(searchQuery, nodesById) {
    const matchingIds = new Set();
    const lowerQuery = searchQuery.toLowerCase();

    nodesById.forEach((node) => {
        if (node.name.toLowerCase().includes(lowerQuery)) {
            matchingIds.add(node.id);
        }
    });

    // Also expand parents of matching topics
    const expandedIds = new Set();
    matchingIds.forEach((id) => {
        let current = nodesById.get(id);
        while (current && current.parent_id) {
            const parentId = current.parent_id;
            expandedIds.add(parentId);
            current = nodesById.get(parentId);
        }
    });

    return { matchingIds, expandedIds };
}

function highlightText(text, searchQuery) {
    if (!searchQuery) return text;
    const regex = new RegExp(`(${escapeRegExp(searchQuery)})`, 'gi');
    return text.replace(regex, '<mark class="search-highlight">$1</mark>');
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function createTreeLines(depth, indexInParent, totalSiblings) {
    const container = document.createElement('div');
    container.className = 'tree-lines-container';

    // For each depth level, add appropriate tree lines
    for (let i = 0; i < depth; i++) {
        const isLastChild = indexInParent === totalSiblings - 1;
        const isFirstChild = indexInParent === 0;

        if (i === depth - 1) {
            // Last level - add horizontal connector from parent to this item
            const connector = document.createElement('div');
            connector.className = 'tree-line-vertical';
            connector.style.left = `${(i * 20) + 10}px`;
            connector.style.top = '0';
            connector.style.height = '100%';
            connector.style.width = '1px';
            container.appendChild(connector);

            // Add horizontal line from vertical line to item
            const horizontalLine = document.createElement('div');
            horizontalLine.className = 'tree-line-vertical';
            horizontalLine.style.left = `${(i * 20) + 10}px`;
            horizontalLine.style.top = '50%';
            horizontalLine.style.width = '15px';
            horizontalLine.style.height = '1px';
            horizontalLine.style.borderTop = '1px solid #d1d5db';
            horizontalLine.style.borderLeft = 'none';
            container.appendChild(horizontalLine);
        } else {
            // Higher levels - add vertical line only
            const verticalLine = document.createElement('div');
            verticalLine.className = 'tree-line-vertical';
            verticalLine.style.left = `${(i * 20) + 10}px`;
            verticalLine.style.top = '0';
            verticalLine.style.height = '100%';
            container.appendChild(verticalLine);
        }
    }

    return container;
}

export function renderTopicsList() {
    dom.topicsList.innerHTML = '';

    if (state.topics.length === 0) {
        dom.topicsList.innerHTML = `<div class="p-4 text-gray-500 text-center">No topics available. Add one to get started.</div>`;
        return;
    }

    const { roots, nodesById } = buildTopicTree(state.topics, state.topicSortOrder || 'tree');

    let flattenedNodes;
    let searchExpandedIds = new Set();

    if (state.topicsSearchQuery) {
        const { matchingIds, expandedIds } = findMatchingTopics(state.topicsSearchQuery, nodesById);
        state.topicsMatchingIds = matchingIds;
        searchExpandedIds = expandedIds;
        flattenedNodes = flattenTopicTree(roots, nodesById, searchExpandedIds);
        // Filter to only show matching topics and their parents
        flattenedNodes = flattenedNodes.filter(({ topic }) => {
            return matchingIds.has(topic.id) || expandedIds.has(topic.id);
        });
    } else {
        state.topicsMatchingIds.clear();
        flattenedNodes = flattenTopicTree(roots, nodesById);
    }

    if (flattenedNodes.length === 0 && state.topicsSearchQuery) {
        dom.topicsList.innerHTML = `<div class="p-4 text-gray-500 text-center">No topics found matching "${escapeHtml(state.topicsSearchQuery)}".</div>`;
        return;
    }

    flattenedNodes.forEach(({ topic, depth, parentId, indexInParent, totalSiblings }) => {
        const beforeZone = createSiblingDropZone(depth, parentId, indexInParent, nodesById);
        dom.topicsList.appendChild(beforeZone);

        const topicDiv = document.createElement('div');
        topicDiv.className = 'topic-list-item topic-tree-item flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 mb-2 rounded border border-gray-200';
        topicDiv.draggable = true;
        topicDiv.dataset.topicId = topic.id;
        topicDiv.style.marginLeft = `${depth * 20}px`;

        const hasChildren = topic.children.length > 0;
        const isCollapsed = hasChildren && isTopicCollapsed(topic.id);
        const chevronDirection = isCollapsed ? 'right' : 'down';
        const chevronClass = isCollapsed ? 'chevron-right' : 'chevron-down';
        const childBadge = hasChildren ? `<span class="text-xs text-gray-500 ml-2">(${topic.children.length})</span>` : '';

        const displayName = state.topicsSearchQuery
            ? highlightText(escapeHtml(topic.name), state.topicsSearchQuery)
            : escapeHtml(topic.name);

        topicDiv.innerHTML = `
            <div class="flex flex-col min-w-0">
                <div class="font-semibold topic-item-name flex items-center">
                    ${hasChildren ? `<button class="topic-collapse-btn ${chevronClass} mr-2 p-1 hover:bg-gray-200 rounded" data-topic-id="${topic.id}" aria-label="${isCollapsed ? 'Expand' : 'Collapse'} topic">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M4 6H8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                            <path d="M6 4V8" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="${chevronClass === 'chevron-right' ? '' : 'hidden'}"/>
                        </svg>
                    </button>` : '<span class="w-6 mr-2"></span>'}
                    <span class="topic-icon mr-2" data-topic-id="${topic.id}">
                        ${hasChildren ? getFolderIcon() : getFileIcon()}
                    </span>
                    <span class="text-gray-400 mr-2 select-none">::</span>
                    <span class="truncate">${displayName}</span>
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

        // Add tree lines for visual hierarchy (after innerHTML so it's not overwritten)
        if (depth > 0) {
            const treeLinesContainer = createTreeLines(depth, indexInParent, totalSiblings);
            topicDiv.insertBefore(treeLinesContainer, topicDiv.firstChild);
        }

        dom.topicsList.appendChild(topicDiv);

        // Add collapse button click handler
        const collapseBtn = topicDiv.querySelector('.topic-collapse-btn');
        if (collapseBtn) {
            collapseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleTopicCollapse(topic.id);
                renderTopicsList();
            });
        }

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
