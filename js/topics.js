import { state, toggleTopicCollapse, isTopicCollapsed, addRecentlyUsedTopic, removeRecentlyUsedTopic, saveTopicCollapseState } from './state.js';
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

// Form validation constants
const MAX_TOPIC_NAME_LENGTH = 200;
const MIN_PROMPT_LENGTH = 10;
const MAX_PROMPT_LENGTH = 10000;

// Performance optimization constants
const VIRTUAL_SCROLL_THRESHOLD = 100; // Enable virtual scrolling above this many topics
const VIRTUAL_SCROLL_ITEM_HEIGHT = 80; // Estimated height of each topic item in pixels
const SEARCH_DEBOUNCE_MS = 300; // Debounce delay for search input in milliseconds

// Debounce utility function
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Validation functions with improved error messages
export function validateTopicName(name, parentId = null) {
    if (!name || name.trim().length === 0) {
        return 'Topic name is required.';
    }
    if (name.length > MAX_TOPIC_NAME_LENGTH) {
        return `Topic name must be less than ${MAX_TOPIC_NAME_LENGTH} characters. Currently ${name.length} characters.`;
    }
    // Check for duplicate names at the same level (same parent)
    const normalizedName = name.trim();
    const normalizedParentId = parentId || null; // Treat empty string as null (root level)
    const duplicate = state.topics.find(t => {
        const topicParentId = t.parent_id || null;
        return t.name.toLowerCase() === normalizedName.toLowerCase() &&
               topicParentId === normalizedParentId &&
               t.id !== state.editingTopicId;
    });
    if (duplicate) {
        return 'A topic with this name already exists at this level. Please choose a different name.';
    }
    return null;
}

export function validateTopicPrompt(prompt) {
    if (!prompt || prompt.trim().length === 0) {
        return 'Prompt is required.';
    }
    if (prompt.trim().length < MIN_PROMPT_LENGTH) {
        return `Prompt must be at least ${MIN_PROMPT_LENGTH} characters. Currently ${prompt.trim().length} characters.`;
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
        return `Prompt must be less than ${MAX_PROMPT_LENGTH} characters. Currently ${prompt.length} characters.`;
    }
    return null;
}

// Form field error handling
export function showFieldError(fieldElement, errorElement, message) {
    fieldElement.classList.add('form-input-error');
    fieldElement.classList.remove('form-input-success');
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.classList.remove('hidden');
    }
}

export function clearFieldError(fieldElement, errorElement) {
    fieldElement.classList.remove('form-input-error');
    fieldElement.classList.add('form-input-success');
    if (errorElement) {
        errorElement.textContent = '';
        errorElement.classList.add('hidden');
    }
}

export function clearFormErrors(formType) {
    if (formType === 'add') {
        clearFieldError(dom.newTopicName, dom.newTopicNameError);
        clearFieldError(dom.newTopicPrompt, dom.newTopicPromptError);
        dom.newTopicName.classList.remove('form-input-success');
        dom.newTopicPrompt.classList.remove('form-input-success');
    } else if (formType === 'edit') {
        clearFieldError(dom.promptTextarea, dom.editTopicPromptError);
        dom.promptTextarea.classList.remove('form-input-success');
    }
}

// Recently used topics rendering
export function renderRecentlyUsedTopics(containerId, parentSelectId) {
    const container = document.getElementById(containerId);
    const parentSelect = document.getElementById(parentSelectId);

    if (!container || !parentSelect) return;

    container.innerHTML = '';

    if (state.recentlyUsedTopics.length === 0) {
        container.parentElement.classList.add('hidden');
        return;
    }

    container.parentElement.classList.remove('hidden');

    state.recentlyUsedTopics.forEach(recentTopic => {
        const badge = document.createElement('span');
        badge.className = 'recent-topic-badge';
        badge.textContent = recentTopic.name;
        badge.title = `Select ${recentTopic.name} as parent`;
        badge.addEventListener('click', () => {
            parentSelect.value = recentTopic.id;
            // Trigger change event
            parentSelect.dispatchEvent(new Event('change', { bubbles: true }));

            // Update active state
            container.querySelectorAll('.recent-topic-badge').forEach(b => b.classList.remove('active'));
            badge.classList.add('active');
        });

        container.appendChild(badge);
    });
}

// Update topic hierarchy preview
export function updateHierarchyPreview(parentSelect, previewElement, topicName = '') {
    if (!previewElement) return;

    const parentId = parentSelect.value;
    let previewPath = '';

    if (topicName) {
        if (parentId) {
            const parentPath = getTopicPath(parentId, state.topics);
            previewPath = `${parentPath} / ${topicName}`;
        } else {
            previewPath = topicName;
        }
        previewElement.textContent = previewPath || 'Root';
    } else {
        // For edit form, show current path
        previewElement.textContent = parentId
            ? getTopicPath(parentId, state.topics)
            : 'Root Topic';
    }
}

// Loading state handling
export function setFormLoading(formType, isLoading, button) {
    if (formType === 'add') {
        state.isCreatingTopic = isLoading;
    } else if (formType === 'edit') {
        state.isUpdatingTopic = isLoading;
    }

    if (button) {
        const spinner = button.querySelector('.loading-spinner');
        const textSpan = button.querySelector('span:not(.loading-spinner)');

        if (isLoading) {
            button.disabled = true;
            if (spinner) spinner.classList.remove('hidden');
            if (textSpan) textSpan.textContent = formType === 'add' ? 'Creating...' : 'Saving...';
        } else {
            button.disabled = false;
            if (spinner) spinner.classList.add('hidden');
            if (textSpan) textSpan.textContent = formType === 'add' ? 'Create Topic' : 'Save Changes';
        }
    }
}

// Guards to prevent re-adding form listeners on repeated form opens
const _formValidationSetup = { add: false, edit: false };
const _formKeyboardSetup = { add: false, edit: false };

// Real-time validation
export function setupFormValidation(formType) {
    if (_formValidationSetup[formType]) return;
    _formValidationSetup[formType] = true;
    if (formType === 'add') {
        dom.newTopicName.addEventListener('input', () => {
            const parentSelect = document.getElementById('new-topic-parent');
            const parentId = parentSelect && parentSelect.value ? parentSelect.value : null;
            const error = validateTopicName(dom.newTopicName.value, parentId);
            if (error) {
                showFieldError(dom.newTopicName, dom.newTopicNameError, error);
            } else if (dom.newTopicName.value.trim().length > 0) {
                clearFieldError(dom.newTopicName, dom.newTopicNameError);
            }
            updateHierarchyPreview(document.getElementById('new-topic-parent'), dom.addTopicPreviewPath, dom.newTopicName.value);
        });

        dom.newTopicPrompt.addEventListener('input', () => {
            const error = validateTopicPrompt(dom.newTopicPrompt.value);
            if (error) {
                showFieldError(dom.newTopicPrompt, dom.newTopicPromptError, error);
            } else if (dom.newTopicPrompt.value.trim().length >= MIN_PROMPT_LENGTH) {
                clearFieldError(dom.newTopicPrompt, dom.newTopicPromptError);
            }
        });
    } else if (formType === 'edit') {
        dom.promptTextarea.addEventListener('input', () => {
            const error = validateTopicPrompt(dom.promptTextarea.value);
            if (error) {
                showFieldError(dom.promptTextarea, dom.editTopicPromptError, error);
            } else if (dom.promptTextarea.value.trim().length >= MIN_PROMPT_LENGTH) {
                clearFieldError(dom.promptTextarea, dom.editTopicPromptError);
            }
        });
    }
}

// Keyboard shortcuts for forms
export function setupFormKeyboardShortcuts(formType, saveAction, cancelAction) {
    if (_formKeyboardSetup[formType]) return;
    _formKeyboardSetup[formType] = true;
    const form = formType === 'add' ? dom.addTopicForm : dom.promptEditor;

    form.addEventListener('keydown', (e) => {
        // Enter to save (Ctrl+Enter or Cmd+Enter to prevent accidental submission)
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (!state.isCreatingTopic && !state.isUpdatingTopic) {
                saveAction();
            }
        }

        // Escape to cancel
        if (e.key === 'Escape') {
            e.preventDefault();
            cancelAction();
        }
    });
}

let draggedTopicId = null;
let isMoveInProgress = false;
let parentElement = null;
let dragGhostElement = null;
let virtualScrollHandler = null; // Store handler reference for proper cleanup

/**
 * Disables dragging on all topic items to prevent concurrent drag operations
 */
function disableDragging() {
    const topicItems = document.querySelectorAll('.topic-tree-item');
    topicItems.forEach(item => {
        item.draggable = false;
    });
}

/**
 * Enables dragging on all topic items
 */
function enableDragging() {
    const topicItems = document.querySelectorAll('.topic-tree-item');
    topicItems.forEach(item => {
        item.draggable = true;
    });
}

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

        try {
            const savedTopicId = localStorage.getItem('selectedTopicId');
            if (savedTopicId && state.topics.find(t => t.id === savedTopicId)) {
                state.currentTopicId = savedTopicId;
            } else if (state.topics.length > 0) {
                state.currentTopicId = state.topics[0].id;
            }
        } catch (error) {
            console.error('Failed to load selected topic ID:', error);
            if (state.topics.length > 0) {
                state.currentTopicId = state.topics[0].id;
            }
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

/**
 * Builds a hierarchical tree structure from a flat list of topics.
 * This is a core function that transforms the flat database structure into
 * a nested tree representation for rendering.
 *
 * @param {Array} topics - Flat array of topic objects from API
 * @param {string} sortOrder - Sort order for top-level topics ('tree', 'name-asc', etc.)
 * @returns {Object} Object containing { roots: Array, nodesById: Map }
 *   - roots: Array of top-level topic nodes (those with no parent)
 *   - nodesById: Map of all nodes by ID for efficient lookups
 *
 * Performance notes:
 * - Uses Map for O(1) node lookups instead of O(n) array searches
 * - Single pass to create all nodes, then single pass to build relationships
 * - Significantly faster than recursive approaches for large topic sets
 */
export function buildTopicTree(topics, sortOrder = state.topicSortOrder || 'tree') {
    const nodesById = new Map();

    // Pre-allocate and populate the map - more efficient than object spread
    for (let i = 0; i < topics.length; i++) {
        const topic = topics[i];
        const node = {
            id: topic.id,
            name: topic.name,
            prompt: topic.prompt,
            parent_id: topic.parent_id || '',
            sort_order: topic.sort_order,
            created_at: topic.created_at,
            children: []
        };
        nodesById.set(topic.id, node);
    }

    // Build tree structure - more efficient than forEach
    const roots = [];
    for (const node of nodesById.values()) {
        if (node.parent_id && node.parent_id !== node.id) {
            const parent = nodesById.get(node.parent_id);
            if (parent) {
                parent.children.push(node);
                continue;
            }
            // Log warning for orphaned node with invalid parent reference
            console.warn(`Topic "${node.name}" (${node.id}) has invalid parent reference "${node.parent_id}". Treating as root.`);
        }
        roots.push(node);
    }

    sortTreeNodes(roots, sortOrder);
    return { roots, nodesById };
}

function sortTreeNodes(nodes, sortOrder, isTopLevel = true) {
    // Only sort top-level topics by the chosen sort order; children always sort by sort_order
    if (isTopLevel && sortOrder !== 'tree') {
        nodes.sort((a, b) => compareTopics(a, b, sortOrder));
    } else {
        // For tree order at top level, or any level below top, sort by sort_order
        nodes.sort((a, b) => compareTopics(a, b, 'tree'));
    }

    // Recursively process children, always using tree order for nested levels
    nodes.forEach(node => {
        if (node.children.length > 0) {
            sortTreeNodes(node.children, sortOrder, false);
        }
    });
}

/**
 * Flattens a hierarchical tree structure into a linear array for rendering.
 * This is the core function that converts the tree back into a flat list
 * that can be rendered in the DOM, respecting collapse state and search results.
 *
 * @param {Array} roots - Array of top-level tree nodes
 * @param {Map} nodesById - Map of all nodes by ID
 * @param {Set} searchExpandedIds - Set of topic IDs that should be expanded due to search
 * @returns {Array} Flat array of { topic, depth, parentId, indexInParent, totalSiblings }
 *
 * Key behaviors:
 * - Skips children of collapsed topics (unless in searchExpandedIds)
 * - Uses stack-based iteration to avoid call stack limits on deep trees
 * - Handles orphaned nodes (topics with missing parent references)
 * - Maintains depth, parent, and sibling relationship information for rendering
 */
function flattenTopicTree(roots, nodesById, searchExpandedIds = new Set()) {
    const flattened = [];
    const visited = new Set();

    // Use stack-based iteration instead of recursion for better performance
    // This reduces call stack overhead and can handle deeper trees
    const stack = [];

    // Initialize stack with roots (in reverse order for correct processing)
    for (let i = roots.length - 1; i >= 0; i--) {
        stack.push({ node: roots[i], depth: 0, parentId: '', indexInParent: i, totalSiblings: roots.length });
    }

    while (stack.length > 0) {
        const { node, depth, parentId, indexInParent, totalSiblings } = stack.pop();

        if (visited.has(node.id)) continue;
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
            // Add children to stack (in reverse order for correct processing)
            for (let i = node.children.length - 1; i >= 0; i--) {
                stack.push({
                    node: node.children[i],
                    depth: depth + 1,
                    parentId: node.id,
                    indexInParent: i,
                    totalSiblings: node.children.length
                });
            }
        }
    }

    // Visit any orphaned nodes (nodes without parents that weren't in roots)
    for (const node of nodesById.values()) {
        if (!visited.has(node.id)) {
            flattened.push({
                topic: node,
                depth: 0,
                parentId: node.parent_id || '',
                indexInParent: 0,
                totalSiblings: 1,
            });
        }
    }

    return flattened;
}

// Virtual scrolling helper functions
function calculateVisibleRange(containerHeight, scrollTop) {
    const visibleStart = Math.floor(scrollTop / VIRTUAL_SCROLL_ITEM_HEIGHT);
    const visibleEnd = Math.ceil((scrollTop + containerHeight) / VIRTUAL_SCROLL_ITEM_HEIGHT);

    // Add buffer for smoother scrolling (render extra items above and below viewport)
    const buffer = 3;
    return {
        startIndex: Math.max(0, visibleStart - buffer),
        endIndex: visibleEnd + buffer
    };
}

function setupVirtualScroll() {
    // Remove existing scroll event listener if any to prevent memory leak
    if (virtualScrollHandler) {
        dom.topicsList.removeEventListener('scroll', virtualScrollHandler);
    }

    // Add scroll event listener for virtual scrolling
    virtualScrollHandler = function() {
        if (!state.virtualScrollEnabled) return;

        const scrollTop = dom.topicsList.scrollTop;
        const containerHeight = dom.topicsList.clientHeight;

        const { startIndex, endIndex } = calculateVisibleRange(containerHeight, scrollTop);

        // Only re-render if the visible range has changed
        if (startIndex !== state.virtualScrollStartIndex || endIndex !== state.virtualScrollEndIndex) {
            state.virtualScrollStartIndex = startIndex;
            state.virtualScrollEndIndex = endIndex;
            renderVirtualScrollItems();
        }
    };

    dom.topicsList.addEventListener('scroll', virtualScrollHandler);
}

function renderVirtualScrollItems() {
    // Clear current items but keep the container
    const container = dom.topicsList;
    container.innerHTML = '';

    // Validate that flattenedTopicNodes exists and is a valid array
    if (!state.flattenedTopicNodes || !Array.isArray(state.flattenedTopicNodes) || state.flattenedTopicNodes.length === 0) {
        console.error('Invalid flattenedTopicNodes state:', state.flattenedTopicNodes);
        return;
    }

    // Only render items in the visible range
    const start = state.virtualScrollStartIndex;
    const end = Math.min(state.virtualScrollEndIndex, state.flattenedTopicNodes.length);

    // Use DocumentFragment for better performance when adding multiple nodes
    const fragment = document.createDocumentFragment();

    for (let i = start; i < end; i++) {
        const nodeData = state.flattenedTopicNodes[i];
        if (!nodeData) continue;

        // Add drop zone before each item (for sibling reordering).
        // Allocate the top 12px of each slot for the drop zone; item fills the remainder.
        const DROP_ZONE_HEIGHT = 12;
        const beforeZone = createSiblingDropZone(nodeData.depth, nodeData.parentId, nodeData.indexInParent, state.nodesById);
        beforeZone.style.position = 'absolute';
        beforeZone.style.top = `${i * VIRTUAL_SCROLL_ITEM_HEIGHT}px`;
        beforeZone.style.left = '0';
        beforeZone.style.width = '100%';
        // Use CSS default height (0.75rem ≈ 12px); do not override to full slot height
        fragment.appendChild(beforeZone);

        const item = createTopicItem(nodeData.topic, nodeData.depth, nodeData.parentId,
                                     nodeData.indexInParent, nodeData.totalSiblings, state.nodesById);
        // Position item below the drop zone within the same slot
        item.style.position = 'absolute';
        item.style.top = `${i * VIRTUAL_SCROLL_ITEM_HEIGHT + DROP_ZONE_HEIGHT}px`;
        item.style.left = '0';
        item.style.width = '100%';
        item.style.height = `${VIRTUAL_SCROLL_ITEM_HEIGHT - DROP_ZONE_HEIGHT}px`;
        fragment.appendChild(item);
    }

    container.appendChild(fragment);

    // Set container height to accommodate all items (for scroll bar)
    const totalHeight = state.flattenedTopicNodes.length * VIRTUAL_SCROLL_ITEM_HEIGHT;
    container.style.height = `${totalHeight}px`;
    container.style.position = 'relative';
}

function createTopicItem(topic, depth, parentId, indexInParent, totalSiblings, nodesById) {
    // Create a single topic item element
    // This is extracted from renderTopicsList to avoid code duplication
    // nodesById is passed as a parameter to avoid rebuilding the tree on every call

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

    // Accessibility: Add ARIA attributes (mirrors renderAllTopics)
    topicDiv.setAttribute('role', 'treeitem');
    topicDiv.setAttribute('tabindex', '0');
    if (hasChildren) {
        topicDiv.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
    }
    topicDiv.setAttribute('aria-level', depth + 1);
    topicDiv.setAttribute('aria-selected', 'false');
    topicDiv.setAttribute('aria-label', `${topic.name}${hasChildren ? `, ${isCollapsed ? 'collapsed' : 'expanded'} with ${topic.children.length} children` : ''}`);
    topicDiv.setAttribute('aria-describedby', `topic-date-${topic.id}`);

    const displayName = state.topicsSearchQuery
        ? highlightText(escapeHtml(topic.name), state.topicsSearchQuery)
        : escapeHtml(topic.name);

    topicDiv.innerHTML = `
        <div class="flex flex-col min-w-0">
            <div class="font-semibold topic-item-name flex items-center">
                ${hasChildren ? `<button class="topic-collapse-btn ${chevronClass} mr-2 p-1 hover:bg-gray-200 rounded" data-topic-id="${topic.id}" aria-label="${isCollapsed ? 'Expand' : 'Collapse'} ${escapeHtml(topic.name)}" aria-expanded="${isCollapsed ? 'false' : 'true'}">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M4 6H8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        <path d="M6 4V8" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="${chevronClass === 'chevron-right' ? '' : 'hidden'}"/>
                    </svg>
                </button>` : '<span class="w-6 mr-2" aria-hidden="true"></span>'}
                <span class="topic-icon mr-2" data-topic-id="${topic.id}" aria-hidden="true">
                    ${hasChildren ? getFolderIcon() : getFileIcon()}
                </span>
                <span class="text-gray-400 mr-2 select-none" aria-hidden="true">::</span>
                <span class="truncate">${displayName}</span>
                ${childBadge}
            </div>
            <div class="topic-item-date">Created: ${new Date(topic.created_at).toLocaleDateString()}</div>
        </div>
        <div class="flex gap-2 mt-2 sm:mt-0" role="toolbar" aria-label="Topic actions">
            <button class="px-3 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 add-child-btn" data-topic-id="${topic.id}" aria-label="Add child topic to ${escapeHtml(topic.name)}">Add child</button>
            <button class="px-3 py-1 bg-orange-100 text-orange-700 rounded hover:bg-orange-200 edit-topic-btn" data-topic-id="${topic.id}" aria-label="Edit topic ${escapeHtml(topic.name)}">Edit</button>
            <button class="px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 delete-topic-btn" data-topic-id="${topic.id}" aria-label="Delete topic ${escapeHtml(topic.name)}">Delete</button>
        </div>
    `;

    // Add tree lines for visual hierarchy
    if (depth > 0) {
        const treeLinesContainer = createTreeLines(depth, indexInParent, totalSiblings);
        topicDiv.insertBefore(treeLinesContainer, topicDiv.firstChild);
    }

    // Add event handlers
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

    // Accessibility: Add keyboard navigation handler
    topicDiv.addEventListener('keydown', handleTopicKeyboard);

    // Accessibility: Handle focus events to update aria-selected
    topicDiv.addEventListener('focus', () => {
        getVisibleTopicItems().forEach(item => {
            item.setAttribute('aria-selected', 'false');
        });
        topicDiv.setAttribute('aria-selected', 'true');
    });

    topicDiv.addEventListener('blur', () => {
        topicDiv.setAttribute('aria-selected', 'false');
    });

    // Drag and drop handlers - use module-level variables
    topicDiv.addEventListener('dragstart', (event) => {
        draggedTopicId = topic.id;
        topicDiv.classList.add('topic-dragging');

        dragGhostElement = createDragGhost(topicDiv);
        updateDragGhostPosition(event);

        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', topic.id);
            const emptyImg = new Image();
            emptyImg.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
            event.dataTransfer.setDragImage(emptyImg, 0, 0);
        }
    });

    topicDiv.addEventListener('dragend', () => {
        draggedTopicId = null;
        topicDiv.classList.remove('topic-dragging');
        clearDropHighlights();
        removeDragGhost();
    });

    attachDropHandlers(topicDiv, {
        targetParentId: topic.id,
        targetPosition: null,
        nodesById,
        isChildDrop: true,
    });

    return topicDiv;
}

/**
 * Finds topics matching a search query and determines which parent topics
 * should be expanded to show the matching results.
 *
 * @param {string} searchQuery - The search text to match (case-insensitive)
 * @param {Map} nodesById - Map of all topic nodes by ID
 * @returns {Object} Object containing { matchingIds: Set, expandedIds: Set }
 *   - matchingIds: Set of topic IDs that match the search query
 *   - expandedIds: Set of parent topic IDs that should be expanded
 *
 * Key behavior:
 * - Case-insensitive text matching on topic names
 * - Auto-expands all parent topics of matching results
 * - This ensures users can see matching topics even if they're deep in the tree
 * - Uses a simple includes() check for flexibility (partial matches)
 */
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
    try {
        const escaped = escapeRegExp(searchQuery);
        const regex = new RegExp(`(${escaped})`, 'gi');
        return text.replace(regex, '<mark class="search-highlight">$1</mark>');
    } catch (error) {
        // If regex construction fails, return text without highlighting
        console.warn('Failed to highlight search text:', error);
        return text;
    }
}

function escapeRegExp(string) {
    // Escape all regex special characters to prevent RegExp constructor errors
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
        return text.replace(regex, '<mark class="search-highlight">$1</mark>');
    } catch (error) {
        // If regex construction fails, return text without highlighting
        console.warn('Failed to highlight search text:', error);
        return text;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Creates visual tree line connectors to show parent-child relationships.
 * These lines make it easy to understand the hierarchical structure at any depth.
 *
 * @param {number} depth - The depth level of the topic (0 = root, 1 = child, etc.)
 * @param {number} indexInParent - The index of this topic among its siblings
 * @param {number} totalSiblings - The total number of siblings this topic has
 * @returns {HTMLElement} Container div with tree line elements
 *
 * Visual structure:
 * - For each depth level above the topic, a vertical line is drawn
 * - At the final depth (direct parent), a horizontal line connects to the topic
 * - Lines are positioned using absolute positioning based on depth * 20px
 * - This creates a visual "folder tree" effect like file explorers
 *
 * Note: This is currently a simple implementation. In a full implementation,
 * you would need to track whether siblings above the current topic continue
 * their vertical lines down to avoid gaps in the tree visualization.
 */
function createTreeLines(depth, indexInParent, totalSiblings) {
    const container = document.createElement('div');
    container.className = 'tree-lines-container';

    const isLastChild = indexInParent === totalSiblings - 1;

    // For each depth level, add appropriate tree lines
    for (let i = 0; i < depth; i++) {
        if (i === depth - 1) {
            // Last level - add vertical connector from parent
            const connector = document.createElement('div');
            connector.className = 'tree-line-vertical';
            connector.style.left = `${(i * 20) + 10}px`;
            connector.style.top = '0';
            // Only draw vertical line below if not the last child
            connector.style.height = isLastChild ? '50%' : '100%';
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
            // Higher levels - add vertical line
            // Note: For proper tree visualization at higher levels, we would need ancestor sibling info
            // For now, we draw vertical lines at all higher levels but with reduced visual weight
            const verticalLine = document.createElement('div');
            verticalLine.className = 'tree-line-vertical';
            verticalLine.style.left = `${(i * 20) + 10}px`;
            verticalLine.style.top = '0';
            verticalLine.style.height = '100%';
            verticalLine.style.width = '1px';
            verticalLine.style.opacity = '0.3'; // Reduced opacity to reduce visual clutter
            container.appendChild(verticalLine);
        }
    }

    return container;
}

function createDragGhost(sourceElement) {
    const ghost = sourceElement.cloneNode(true);
    ghost.className = 'topic-drag-ghost topic-list-item';
    ghost.style.width = `${sourceElement.offsetWidth}px`;
    ghost.style.height = `${sourceElement.offsetHeight}px`;

    // Remove any interactive elements from the ghost
    ghost.querySelectorAll('button').forEach(btn => {
        btn.style.pointerEvents = 'none';
    });

    document.body.appendChild(ghost);
    return ghost;
}

function updateDragGhostPosition(event) {
    if (!dragGhostElement) return;

    const ghostX = event.clientX - (dragGhostElement.offsetWidth / 2);
    const ghostY = event.clientY - (dragGhostElement.offsetHeight / 2);

    dragGhostElement.style.left = `${ghostX}px`;
    dragGhostElement.style.top = `${ghostY}px`;
}

function removeDragGhost() {
    if (dragGhostElement) {
        dragGhostElement.remove();
        dragGhostElement = null;
    }
}

// Accessibility: Announcer for screen reader messages
function announceToScreenReader(message) {
    // Create or get existing live region
    let announcer = document.getElementById('a11y-announcer');
    if (!announcer) {
        announcer = document.createElement('div');
        announcer.id = 'a11y-announcer';
        announcer.setAttribute('aria-live', 'polite');
        announcer.setAttribute('aria-atomic', 'true');
        announcer.className = 'sr-only';
        document.body.appendChild(announcer);
    }
    announcer.textContent = message;
}

// Accessibility: Get all visible topic items in order
function getVisibleTopicItems() {
    return Array.from(dom.topicsList.querySelectorAll('[data-topic-id]'));
}

/**
 * Handles keyboard navigation for the topic tree.
 * Provides comprehensive keyboard control for users who prefer not to use a mouse
 * or who use assistive technologies.
 *
 * Keyboard shortcuts:
 * - Arrow Up/Down: Navigate to previous/next visible topic
 * - Arrow Right: Move to next visible topic (alternative to Down)
 * - Arrow Left: Move to previous visible topic (alternative to Up)
 * - Home: Jump to first visible topic in the tree
 * - End: Jump to last visible topic in the tree
 * - Enter or Space: Toggle expand/collapse for topics with children
 * - Escape: Exit keyboard navigation and remove focus from tree
 *
 * @param {KeyboardEvent} event - The keyboard event to handle
 */
function handleTopicKeyboard(event) {
    const topicItem = event.currentTarget;
    const allItems = getVisibleTopicItems();
    const currentIndex = allItems.indexOf(topicItem);

    switch (event.key) {
        case 'ArrowDown':
            event.preventDefault();
            if (currentIndex < allItems.length - 1) {
                allItems[currentIndex + 1].focus();
            }
            break;

        case 'ArrowUp':
            event.preventDefault();
            if (currentIndex > 0) {
                allItems[currentIndex - 1].focus();
            }
            break;

        case 'ArrowRight': {
            // ARIA tree pattern: expand collapsed node, or move to first child if expanded
            event.preventDefault();
            const collapseBtn = topicItem.querySelector('.topic-collapse-btn');
            if (collapseBtn) {
                const isExpanded = collapseBtn.getAttribute('aria-expanded') === 'true';
                if (!isExpanded) {
                    collapseBtn.click();
                } else if (currentIndex < allItems.length - 1) {
                    allItems[currentIndex + 1].focus();
                }
            }
            break;
        }

        case 'ArrowLeft': {
            // ARIA tree pattern: collapse expanded node, or move focus to parent if collapsed/leaf
            event.preventDefault();
            const collapseBtnLeft = topicItem.querySelector('.topic-collapse-btn');
            if (collapseBtnLeft) {
                const isExpanded = collapseBtnLeft.getAttribute('aria-expanded') === 'true';
                if (isExpanded) {
                    collapseBtnLeft.click();
                    break;
                }
            }
            // Node is collapsed or is a leaf: move focus to parent treeitem
            const currentLevel = parseInt(topicItem.getAttribute('aria-level') || '1', 10);
            if (currentLevel > 1) {
                // Walk backwards through visible items to find the nearest ancestor at level - 1
                for (let i = currentIndex - 1; i >= 0; i--) {
                    const candidate = allItems[i];
                    const candidateLevel = parseInt(candidate.getAttribute('aria-level') || '1', 10);
                    if (candidateLevel < currentLevel) {
                        candidate.focus();
                        break;
                    }
                }
            }
            break;
        }

        case 'Home':
            event.preventDefault();
            if (allItems.length > 0) {
                allItems[0].focus();
            }
            break;

        case 'End':
            event.preventDefault();
            if (allItems.length > 0) {
                allItems[allItems.length - 1].focus();
            }
            break;

        case 'Enter':
        case ' ': {
            // Toggle expand/collapse on Enter or Space for topics with children
            event.preventDefault();
            const collapseBtn = topicItem.querySelector('.topic-collapse-btn');
            if (collapseBtn) {
                collapseBtn.click();
            }
            break;
        }

        case 'Escape':
            // Exit tree navigation
            event.preventDefault();
            topicItem.blur();
            break;
    }
}

/**
 * Main rendering function for the topic tree.
 * This function orchestrates the entire rendering process, handling:
 * - Tree building from flat data
 * - Search filtering and highlighting
 * - Collapse state management
 * - Virtual scrolling for large trees
 * - ARIA accessibility attributes
 *
 * Rendering flow:
 * 1. Clear existing tree
 * 2. Build hierarchical tree structure
 * 3. Apply search filter if active (auto-expand parents of matches)
 * 4. Flatten tree respecting collapse state
 * 5. Choose rendering strategy (virtual scroll vs. full render)
 * 6. Render topic items with all features (tree lines, icons, actions)
 *
 * State dependencies:
 * - state.topics: Array of all topic objects
 * - state.topicsSearchQuery: Current search filter text
 * - state.topicSortOrder: Sort order for top-level topics
 * - state.flattenedTopicNodes: Cached flattened tree (for virtual scroll)
 */
export function renderTopicsList() {
    dom.topicsList.innerHTML = '';
    // Add ARIA role="tree" to the container
    dom.topicsList.setAttribute('role', 'tree');
    dom.topicsList.setAttribute('aria-label', 'Topic tree');
    dom.topicsList.setAttribute('aria-multiselectable', 'false');

    if (state.topics.length === 0) {
        dom.topicsList.innerHTML = `<div class="p-4 text-gray-500 text-center" role="status">No topics available. Add one to get started.</div>`;
        return;
    }

    const { roots, nodesById } = buildTopicTree(state.topics, state.topicSortOrder || 'tree');
    state.nodesById = nodesById;

    let flattenedNodes;
    let searchExpandedIds = new Set();

    if (state.topicsSearchQuery) {
        // Capture current collapsed state before search starts (only on first search render)
        if (!state.preSearchCollapsedTopicIds) {
            state.preSearchCollapsedTopicIds = new Set(state.collapsedTopicIds);
        }

        const { matchingIds, expandedIds } = findMatchingTopics(state.topicsSearchQuery, nodesById);
        state.topicsMatchingIds = matchingIds;
        state.searchExpandedTopicIds = expandedIds;
        searchExpandedIds = expandedIds;
        flattenedNodes = flattenTopicTree(roots, nodesById, searchExpandedIds);
        // Filter to only show matching topics and their parents
        flattenedNodes = flattenedNodes.filter(({ topic }) => {
            return matchingIds.has(topic.id) || expandedIds.has(topic.id);
        });
    } else {
        state.topicsMatchingIds.clear();
        // Restore the original collapsed state from before search started
        // Merge manual changes made during search with pre-search state
        if (state.preSearchCollapsedTopicIds) {
            // Start with pre-search state
            const mergedCollapsedIds = new Set(state.preSearchCollapsedTopicIds);
            // Preserve manual changes: if topic was manually collapsed during search, keep it collapsed
            // (if topic is in current collapsed state but not in searchExpandedIds, it was manually collapsed)
            for (const topicId of state.collapsedTopicIds) {
                if (!state.searchExpandedTopicIds.has(topicId)) {
                    // Topic was manually collapsed during search (not auto-expanded)
                    mergedCollapsedIds.add(topicId);
                }
            }
            state.collapsedTopicIds = mergedCollapsedIds;
            state.searchExpandedTopicIds.clear();
            state.preSearchCollapsedTopicIds = undefined;
            saveTopicCollapseState();
        }
        flattenedNodes = flattenTopicTree(roots, nodesById);
    }

    if (flattenedNodes.length === 0 && state.topicsSearchQuery) {
        dom.topicsList.innerHTML = `<div class="p-4 text-gray-500 text-center">No topics found matching "${escapeHtml(state.topicsSearchQuery)}".</div>`;
        return;
    }

    // Cache flattened nodes for virtual scrolling
    state.flattenedTopicNodes = flattenedNodes;

    // Check if virtual scrolling should be enabled (use filtered/flattened count, not total topics)
    const shouldUseVirtualScroll = flattenedNodes.length >= VIRTUAL_SCROLL_THRESHOLD;

    if (shouldUseVirtualScroll) {
        // Enable virtual scrolling mode
        state.virtualScrollEnabled = true;
        dom.topicsList.classList.add('virtual-scroll-enabled');

        // Setup scroll handler if not already set up
        if (!dom.topicsList.hasAttribute('data-virtual-scroll-setup')) {
            setupVirtualScroll();
            dom.topicsList.setAttribute('data-virtual-scroll-setup', 'true');
        }

        // Reset scroll position and render initial visible items
        dom.topicsList.scrollTop = 0;
        state.virtualScrollStartIndex = 0;

        // Calculate initial visible range
        const containerHeight = dom.topicsList.clientHeight || 600;
        const { endIndex } = calculateVisibleRange(containerHeight, 0);
        state.virtualScrollEndIndex = endIndex;

        // Render initial visible items
        renderVirtualScrollItems();

    } else {
        // Disable virtual scrolling mode and render all items
        state.virtualScrollEnabled = false;
        dom.topicsList.classList.remove('virtual-scroll-enabled');
        // Remove scroll event listener to prevent memory leak
        if (virtualScrollHandler) {
            dom.topicsList.removeEventListener('scroll', virtualScrollHandler);
            virtualScrollHandler = null;
        }
        dom.topicsList.removeAttribute('data-virtual-scroll-setup');
        renderAllTopics(flattenedNodes, nodesById);
    }
}

function renderAllTopics(flattenedNodes, nodesById) {
    flattenedNodes.forEach(({ topic, depth, parentId, indexInParent, totalSiblings }) => {
        const beforeZone = createSiblingDropZone(depth, parentId, indexInParent, nodesById);
        dom.topicsList.appendChild(beforeZone);

        const topicDiv = document.createElement('div');
        topicDiv.className = 'topic-list-item topic-tree-item flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 mb-2 rounded border border-gray-200';
        topicDiv.draggable = true;
        topicDiv.dataset.topicId = topic.id;
        topicDiv.style.marginLeft = `${depth * 20}px`;

        // Calculate child status before using it for ARIA attributes
        const hasChildren = topic.children.length > 0;
        const isCollapsed = hasChildren && isTopicCollapsed(topic.id);

        // Accessibility: Add ARIA attributes
        topicDiv.setAttribute('role', 'treeitem');
        topicDiv.setAttribute('tabindex', '0');
        if (hasChildren) {
            topicDiv.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
        }
        topicDiv.setAttribute('aria-level', depth + 1);
        topicDiv.setAttribute('aria-selected', 'false');
        topicDiv.setAttribute('aria-label', `${topic.name}${hasChildren ? `, ${isCollapsed ? 'collapsed' : 'expanded'} with ${topic.children.length} children` : ''}`);
        topicDiv.setAttribute('aria-describedby', `topic-date-${topic.id}`);
        const chevronDirection = isCollapsed ? 'right' : 'down';
        const chevronClass = isCollapsed ? 'chevron-right' : 'chevron-down';
        const childBadge = hasChildren ? `<span class="text-xs text-gray-500 ml-2">(${topic.children.length})</span>` : '';

        const displayName = state.topicsSearchQuery
            ? highlightText(escapeHtml(topic.name), state.topicsSearchQuery)
            : escapeHtml(topic.name);

        topicDiv.innerHTML = `
            <div class="flex flex-col min-w-0">
                <div class="font-semibold topic-item-name flex items-center">
                    ${hasChildren ? `<button class="topic-collapse-btn ${chevronClass} mr-2 p-1 hover:bg-gray-200 rounded" data-topic-id="${topic.id}" aria-label="${isCollapsed ? 'Expand' : 'Collapse'} ${escapeHtml(topic.name)}" aria-expanded="${isCollapsed ? 'false' : 'true'}">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="M4 6H8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                            <path d="M6 4V8" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="${chevronClass === 'chevron-right' ? '' : 'hidden'}"/>
                        </svg>
                    </button>` : '<span class="w-6 mr-2" aria-hidden="true"></span>'}
                    <span class="topic-icon mr-2" data-topic-id="${topic.id}" aria-hidden="true">
                        ${hasChildren ? getFolderIcon() : getFileIcon()}
                    </span>
                    <span class="text-gray-400 mr-2 select-none" aria-hidden="true">::</span>
                    <span class="truncate">${displayName}</span>
                    ${childBadge}
                </div>
                <div class="topic-item-date" id="topic-date-${topic.id}" aria-hidden="true">Created: ${new Date(topic.created_at).toLocaleDateString()}</div>
            </div>
            <div class="flex gap-2 mt-2 sm:mt-0" role="toolbar" aria-label="Topic actions">
                <button class="px-3 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 add-child-btn" data-topic-id="${topic.id}" aria-label="Add child topic to ${escapeHtml(topic.name)}">Add child</button>
                <button class="px-3 py-1 bg-orange-100 text-orange-700 rounded hover:bg-orange-200 edit-topic-btn" data-topic-id="${topic.id}" aria-label="Edit topic ${escapeHtml(topic.name)}">Edit</button>
                <button class="px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 delete-topic-btn" data-topic-id="${topic.id}" aria-label="Delete topic ${escapeHtml(topic.name)}">Delete</button>
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
                // Accessibility: Announce the action to screen readers
                const isNowCollapsed = isTopicCollapsed(topic.id);
                announceToScreenReader(`${topic.name} ${isNowCollapsed ? 'collapsed' : 'expanded'}`);
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

        // Accessibility: Add keyboard navigation handler
        topicDiv.addEventListener('keydown', handleTopicKeyboard);

        // Accessibility: Handle focus events to update aria-selected
        topicDiv.addEventListener('focus', () => {
            getVisibleTopicItems().forEach(item => {
                item.setAttribute('aria-selected', 'false');
            });
            topicDiv.setAttribute('aria-selected', 'true');
        });

        topicDiv.addEventListener('blur', () => {
            topicDiv.setAttribute('aria-selected', 'false');
        });

        topicDiv.addEventListener('dragstart', (event) => {
            draggedTopicId = topic.id;
            topicDiv.classList.add('topic-dragging');

            // Create ghost element
            dragGhostElement = createDragGhost(topicDiv);
            updateDragGhostPosition(event);

            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', topic.id);
                // Use a transparent image to hide default drag image
                const emptyImg = new Image();
                emptyImg.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                event.dataTransfer.setDragImage(emptyImg, 0, 0);
            }
        });

        topicDiv.addEventListener('dragend', () => {
            draggedTopicId = null;
            topicDiv.classList.remove('topic-dragging');
            clearDropHighlights();
            removeDragGhost();
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

/**
 * Attaches drag-and-drop event handlers to a drop zone element.
 * This function enables users to drag topics to reorder them or make them children of other topics.
 *
 * @param {HTMLElement} element - The element to attach handlers to (drop zone or topic item)
 * @param {Object} options - Configuration for the drop behavior
 * @param {string|null} options.targetParentId - ID of topic to make dragged topic a child of (null for root level)
 * @param {number|null} options.targetPosition - Position index for sibling reordering (null for child drops)
 * @param {Map} options.nodesById - Map of all topic nodes for cycle detection
 * @param {boolean} options.isChildDrop - True if dropping as child, false if reordering siblings
 *
 * Visual feedback:
 * - .topic-drop-active: Highlights the active drop zone
 * - .parent-drop-highlight: Highlights parent topic when dropping as child
 * - .sibling-drop-highlight: Highlights sibling when reordering
 * - .topic-drop-complete: Animation class after successful drop
 *
 * Error handling:
 * - Prevents dropping a topic into itself or its descendants (cycle detection)
 * - Shows alert if operation would create invalid tree structure
 */
function attachDropHandlers(element, options) {
    const { targetParentId, targetPosition, nodesById, isChildDrop } = options;
    let parentElement = null;

    element.addEventListener('dragover', (event) => {
        if (!draggedTopicId || isMoveInProgress) return;
        event.preventDefault();
        updateDragGhostPosition(event);
    });

    element.addEventListener('dragenter', (event) => {
        if (!draggedTopicId || isMoveInProgress) return;
        event.preventDefault();
        event.stopPropagation();

        // Clear previous highlights
        clearDropHighlights();

        // Highlight drop zone
        element.classList.add('topic-drop-active');

        // Highlight parent topic for child drops
        if (isChildDrop && targetParentId) {
            parentElement = element.closest('[data-topic-id]');
            if (parentElement && parentElement.dataset.topicId === targetParentId) {
                parentElement.classList.add('parent-drop-highlight');
            }
        } else if (!isChildDrop && element.classList.contains('topic-tree-item')) {
            // Highlight sibling being reordered
            element.classList.add('sibling-drop-highlight');
        }
    });

    element.addEventListener('dragleave', (event) => {
        if (!draggedTopicId || isMoveInProgress) return;

        // Only remove if we're leaving the element itself, not a child
        const rect = element.getBoundingClientRect();
        const x = event.clientX;
        const y = event.clientY;

        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
            element.classList.remove('topic-drop-active');
            if (parentElement) {
                parentElement.classList.remove('parent-drop-highlight');
                parentElement = null;
            }
            element.classList.remove('sibling-drop-highlight');
        }
    });

    element.addEventListener('drop', async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const dropTarget = element.closest('[data-topic-id]') || element;

        // Clear all highlights
        clearDropHighlights();
        if (parentElement) {
            parentElement.classList.remove('parent-drop-highlight');
            parentElement = null;
        }

        if (!draggedTopicId || isMoveInProgress) return;
        if (draggedTopicId === targetParentId && isChildDrop) return;
        if (targetParentId && wouldCreateCycle(nodesById, draggedTopicId, targetParentId)) {
            alert('Cannot move a topic into itself or one of its descendants.');
            return;
        }

        // Disable dragging to prevent concurrent operations
        isMoveInProgress = true;
        disableDragging();
        try {
            await moveTopic(draggedTopicId, targetParentId || null, targetPosition);

            // Add drop animation to the target element
            if (dropTarget && dropTarget.classList.contains('topic-tree-item')) {
                dropTarget.classList.add('topic-drop-complete');
                setTimeout(() => {
                    dropTarget.classList.remove('topic-drop-complete');
                }, 400);
            }
        } finally {
            isMoveInProgress = false;
            enableDragging();
        }
    });
}

/**
 * Detects if moving a topic would create a cycle in the tree structure.
 * A cycle occurs when a topic becomes a descendant of itself, which would
 * create an infinite loop when traversing the tree.
 *
 * @param {Map} nodesById - Map of all topic nodes by ID
 * @param {string} draggedId - ID of the topic being dragged
 * @param {string} targetParentId - ID of the topic being dropped onto (potential new parent)
 * @returns {boolean} True if creating a cycle (invalid operation), false otherwise
 *
 * Examples of cycles:
 * - Dragging Topic A onto Topic B where B is a child of A
 * - Dragging Topic A onto Topic C where C is a descendant of A
 *
 * This function traverses up the tree from the targetParentId checking if
 * we ever encounter the draggedId. If we do, moving the topic there would
 * create a cycle.
 */
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
    dom.topicsList.querySelectorAll('.parent-drop-highlight').forEach(el => {
        el.classList.remove('parent-drop-highlight');
    });
    dom.topicsList.querySelectorAll('.sibling-drop-highlight').forEach(el => {
        el.classList.remove('sibling-drop-highlight');
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
        const result = await createTopicAPI(name, prompt, parentId, sortOrder);

        // Add to recently used topics
        if (result && result.id) {
            addRecentlyUsedTopic(result.id, name);
        }

        await loadTopics();
        hideAddTopicForm();
    } catch (error) {
        console.error('Error creating topic:', error);

        // Show more specific error message
        let errorMessage = 'Failed to create topic.';
        if (error.message) {
            if (error.message.includes('duplicate') || error.message.includes('already exists')) {
                errorMessage = 'A topic with this name already exists.';
            } else if (error.message.includes('validation')) {
                errorMessage = error.message;
            } else {
                errorMessage = `Failed to create topic: ${error.message}`;
            }
        }
        alert(errorMessage);
    } finally {
        setFormLoading('add', false, dom.saveTopicBtn);
    }
}

async function deleteTopic(topicId) {
    const topic = state.topics.find(t => t.id === topicId);
    if (!topic) {
        alert('Topic not found. Please refresh and try again.');
        return;
    }

    // Count children
    const childCount = state.topics.filter(t => t.parent_id === topicId).length;

    // Build confirmation message
    let message = `Are you sure you want to delete the topic "${topic.name}"?`;
    if (childCount > 0) {
        message += `\n\nThis topic has ${childCount} child topic${childCount > 1 ? 's' : ''}. You must delete child topics first before deleting this one.`;
    }
    message += '\n\nThis action cannot be undone.';

    if (!confirm(message)) {
        return;
    }

    try {
        await deleteTopicAPI(topicId);

        if (state.currentTopicId === topicId) {
            state.currentTopicId = '';
            localStorage.removeItem('selectedTopicId');
        }

        // Remove from recently used topics
        removeRecentlyUsedTopic(topicId);

        await loadTopics();
    } catch (error) {
        console.error('Error deleting topic:', error);

        // Show more specific error message
        let errorMessage = 'Failed to delete topic.';
        if (error.message) {
            if (error.message.includes('has children') || error.message.includes('cannot be deleted')) {
                errorMessage = 'Cannot delete this topic because it has child topics. Please delete child topics first.';
            } else {
                errorMessage = `Failed to delete topic: ${error.message}`;
            }
        }
        alert(errorMessage);
    }
}

async function updateTopicDetails(topicId, name, prompt, parentId, sortOrder) {
    try {
        await updateTopicAPI(topicId, name, prompt, parentId, sortOrder);

        // Add to recently used topics
        const topic = state.topics.find(t => t.id === topicId);
        if (topic) {
            addRecentlyUsedTopic(topicId, name);
        }

        await loadTopics();
        hidePromptEditor();
    } catch (error) {
        console.error('Error updating topic:', error);

        // Show more specific error message
        let errorMessage = 'Failed to update topic.';
        if (error.message) {
            if (error.message.includes('duplicate') || error.message.includes('already exists')) {
                errorMessage = 'A topic with this name already exists.';
            } else if (error.message.includes('validation')) {
                errorMessage = error.message;
            } else {
                errorMessage = `Failed to update topic: ${error.message}`;
            }
        }
        alert(errorMessage);
    } finally {
        setFormLoading('edit', false, dom.savePromptBtn);
    }
}

async function moveTopic(topicId, parentId, position = null) {
    try {
        // Validate position bounds
        if (typeof position === 'number' && Number.isFinite(position) && position >= 0) {
            // Calculate maximum valid position for the target parent
            let maxPosition = 0;
            if (parentId) {
                const parentNode = state.nodesById.get(parentId);
                if (parentNode && parentNode.children) {
                    maxPosition = parentNode.children.length;
                }
            } else {
                // Root level - count topics with no parent
                maxPosition = state.topics.filter(t => !t.parent_id).length;
            }

            // Position should be at most maxPosition (append at end)
            if (position > maxPosition) {
                throw new Error(`Position ${position} is out of bounds. Maximum valid position is ${maxPosition}.`);
            }
        }

        await moveTopicAPI(topicId, parentId, position);
        await loadTopics();
    } catch (error) {
        console.error('Error moving topic:', error);
        // Refresh topics to ensure frontend state reflects actual database state
        await loadTopics();
        alert(`Failed to move topic. ${error.message || ''}`.trim());
    }
}

export function showAddTopicForm(parentId = null) {
    dom.addTopicForm.classList.remove('hidden');
    dom.newTopicName.value = '';
    dom.newTopicPrompt.value = '';

    // Clear previous errors and success states
    clearFormErrors('add');
    dom.addTopicHierarchyPreview.classList.add('hidden');

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

        // Add change listener for hierarchy preview (clone to remove previous listeners)
        const freshParentSelect = parentSelect.cloneNode(true);
        parentSelect.parentNode.replaceChild(freshParentSelect, parentSelect);
        freshParentSelect.value = parentId || '';
        freshParentSelect.addEventListener('change', () => {
            updateHierarchyPreview(freshParentSelect, dom.addTopicPreviewPath, dom.newTopicName.value.trim());
            if (dom.newTopicName.value.trim()) {
                dom.addTopicHierarchyPreview.classList.remove('hidden');
            }
        });
    }

    // Render recently used topics
    renderRecentlyUsedTopics('recent-topics-container', 'new-topic-parent');

    // Setup real-time validation
    setupFormValidation('add');

    // Setup keyboard shortcuts
    setupFormKeyboardShortcuts('add', saveTopic, hideAddTopicForm);

    dom.newTopicName.focus();
}

export function hideAddTopicForm() {
    dom.addTopicForm.classList.add('hidden');
    clearFormErrors('add');
    dom.addTopicHierarchyPreview.classList.add('hidden');
}

export function showPromptEditor(topicId) {
    const topic = state.topics.find(t => t.id === topicId);
    if (!topic) return;

    state.editingTopicId = topicId;
    dom.currentTopicName.textContent = topic.name;
    dom.promptTextarea.value = topic.prompt;

    // Clear previous errors and success states
    clearFormErrors('edit');

    // Show current hierarchy
    if (topic.parent_id) {
        const currentPath = getTopicPath(topic.parent_id, state.topics);
        dom.editTopicCurrentPath.textContent = `${currentPath} / ${topic.name}`;
    } else {
        dom.editTopicCurrentPath.textContent = topic.name;
    }

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

        // Add change listener for hierarchy preview (clone to remove previous listeners)
        const freshEditParentSelect = editParentSelect.cloneNode(true);
        editParentSelect.parentNode.replaceChild(freshEditParentSelect, editParentSelect);
        freshEditParentSelect.addEventListener('change', () => {
            const newParentId = freshEditParentSelect.value;
            if (newParentId) {
                const parentPath = getTopicPath(newParentId, state.topics);
                dom.editTopicCurrentPath.textContent = `${parentPath} / ${topic.name}`;
            } else {
                dom.editTopicCurrentPath.textContent = topic.name;
            }
        });
    }

    // Render recently used topics
    renderRecentlyUsedTopics('edit-recent-topics-container', 'edit-topic-parent');

    // Setup real-time validation
    setupFormValidation('edit');

    // Setup keyboard shortcuts
    setupFormKeyboardShortcuts('edit', savePrompt, hidePromptEditor);

    dom.promptEditor.classList.remove('hidden');
    dom.versionHistory.classList.add('hidden');
}

export function hidePromptEditor() {
    dom.promptEditor.classList.add('hidden');
    state.editingTopicId = null;
    clearFormErrors('edit');
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
    const topic = state.topics.find(t => t.id === topicId);
    const topicName = topic ? topic.name : 'Unknown Topic';

    const message = `Are you sure you want to restore this version for "${topicName}"?\n\nThis will create a new version with the restored content. The current version will be preserved in history.`;

    if (!confirm(message)) {
        return;
    }

    try {
        await restoreVersionAPI(topicId, versionId);
        await loadTopics();
        dom.versionHistory.classList.add('hidden');
        alert('Version restored successfully! A new version has been created.');
    } catch (error) {
        console.error('Error restoring version:', error);

        // Show more specific error message
        let errorMessage = 'Failed to restore version.';
        if (error.message) {
            errorMessage = `Failed to restore version: ${error.message}`;
        }
        alert(errorMessage);
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
    try {
        localStorage.setItem('selectedTopicId', topicId);
    } catch (error) {
        console.error('Failed to save selected topic ID:', error);
    }
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

    // Validate name
    const nameError = validateTopicName(name, parentId);
    if (nameError) {
        showFieldError(dom.newTopicName, dom.newTopicNameError, nameError);
        dom.newTopicName.focus();
        return;
    }

    // Validate prompt
    const promptError = validateTopicPrompt(prompt);
    if (promptError) {
        showFieldError(dom.newTopicPrompt, dom.newTopicPromptError, promptError);
        dom.newTopicPrompt.focus();
        return;
    }

    const sortOrder = getNextSortOrder(parentId);

    // Set loading state
    setFormLoading('add', true, dom.saveTopicBtn);

    createTopic(name, prompt, parentId, sortOrder);
}

export function savePrompt() {
    const prompt = dom.promptTextarea.value.trim();
    const name = dom.currentTopicName.textContent.trim();

    // Validate prompt
    const promptError = validateTopicPrompt(prompt);
    if (promptError) {
        showFieldError(dom.promptTextarea, dom.editTopicPromptError, promptError);
        dom.promptTextarea.focus();
        return;
    }

    const editParentSelect = document.getElementById('edit-topic-parent');
    const parentId = editParentSelect && editParentSelect.value ? editParentSelect.value : null;

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

    // Set loading state
    setFormLoading('edit', true, dom.savePromptBtn);

    updateTopicDetails(state.editingTopicId, name, prompt, parentId, sortOrder);
}

// Global dragover listener to update ghost position
document.addEventListener('dragover', (event) => {
    if (dragGhostElement) {
        updateDragGhostPosition(event);
    }
});

// Global dragend cleanup (in case drag ends unexpectedly)
document.addEventListener('dragend', () => {
    removeDragGhost();
    clearDropHighlights();
});
