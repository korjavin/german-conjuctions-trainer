// Topic tree data (load, cache, tree building, archive) and the admin Manage > Topics tab:
// tree pane (rows, row ⋯ menu, drag-drop, keyboard) + editor pane (create / edit, prompt versions).
// Ported from docs/design/claude-design/ui_kits/app/ScreensManage.jsx; js/manage.js owns the tabs.
import { state, toggleTopicCollapse, isTopicCollapsed, addRecentlyUsedTopic, removeRecentlyUsedTopic, saveTopicCollapseState } from './state.js';
import { dom } from './dom.js';
import {
    fetchTopicsAPI,
    createTopicAPI,
    deleteTopicAPI,
    updateTopicAPI,
    moveTopicAPI,
    archiveTopicAPI,
    unarchiveTopicAPI,
    fetchVersionsAPI,
    restoreVersionAPI,
} from './api.js';
import { toast, confirm } from './ui.js';

// Form validation constants (the server enforces the same limits)
const MAX_TOPIC_NAME_LENGTH = 200;
const MIN_PROMPT_LENGTH = 10;
export const MAX_PROMPT_LENGTH = 10000;

const SEARCH_DEBOUNCE_MS = 300;
const NEW_DAYS = 14; // leaves created within this many days get the "new" dot
const ROW_INDENT = 18;

export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

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

// Field error under an input; message null/'' clears it.
export function setFieldError(input, errorEl, message) {
    input?.classList.toggle('gct-input--error', Boolean(message));
    if (!errorEl) return;
    errorEl.textContent = message || '';
    errorEl.hidden = !message;
}

const svg = (name, size = 16) => (typeof window.gctIconSvg === 'function' ? window.gctIconSvg(name, size) : '');
const pad = (n) => String(n).padStart(2, '0');

// DD.MM.YYYY
export function fmtDate(value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

// DD.MM.YYYY HH:MM
export function fmtDateTime(value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const TOPICS_CACHE_KEY = 'topicsCacheV1';

// Fixed ID of the archive root (pkg/storage ArchiveTopicID). The archive is an
// ordinary root topic in the Manage tree, but it and everything under it are
// left out of the practice topic picker.
export const ARCHIVE_TOPIC_ID = 'archive';

export function isArchiveRoot(topic) {
    return Boolean(topic) && (topic.is_archive === true || topic.id === ARCHIVE_TOPIC_ID);
}

// IDs of the archive root and all of its descendants.
export function getArchivedTopicIds(topics = state.topics) {
    const archived = new Set();
    const root = topics.find(isArchiveRoot);
    if (!root) return archived;
    const stack = [root.id];
    while (stack.length > 0) {
        const id = stack.pop();
        if (archived.has(id)) continue;
        archived.add(id);
        for (const t of topics) {
            if (t.parent_id === id) stack.push(t.id);
        }
    }
    return archived;
}

// Topics offered for practice: everything outside the archive.
export function getPracticeTopics(topics = state.topics) {
    const archived = getArchivedTopicIds(topics);
    return archived.size === 0 ? topics : topics.filter(t => !archived.has(t.id));
}

function cacheTopicsPayload(data) {
    try {
        localStorage.setItem(TOPICS_CACHE_KEY, JSON.stringify(data));
    } catch (error) {
        console.error('Failed to cache topics:', error);
    }
}

function readCachedTopicsPayload() {
    try {
        const raw = localStorage.getItem(TOPICS_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && Array.isArray(parsed.topics) ? parsed : null;
    } catch (error) {
        console.error('Failed to read cached topics:', error);
        return null;
    }
}

export async function loadTopics() {
    let data;
    try {
        data = await fetchTopicsAPI();
        cacheTopicsPayload(data);
    } catch (error) {
        console.error('Error loading topics:', error);
        // Offline / server down: the last good topic tree keeps the UI usable.
        data = readCachedTopicsPayload();
        if (!data) {
            toast({ tone: 'danger', text: 'Failed to load topics. Please refresh the page.' });
            return;
        }
    }

    try {
        state.topics = data.topics || [];

        renderTopicsList();
        // An edited topic that vanished closes the editor; otherwise refresh its chrome, keep unsaved fields.
        const edited = editor?.mode === 'edit' ? findTopic(editor.id) : null;
        if (editor?.mode === 'edit' && !edited) closeEditor();
        else {
            if (edited) {
                // Archive/restore/drag moved it on the server: follow that parent, else keep the user's pick.
                const serverParent = edited.parent_id || '';
                const parent = serverParent !== editor.parentId ? serverParent : dom.topicParentSelect.value;
                editor.parentId = serverParent;
                renderParentOptions(parent);
                renderRecentParents();
            }
            renderEditorChrome();
        }
        // js/scope.js rebuilds the scope tree and drops a scope that vanished or was archived.
        window.dispatchEvent(new Event('topicschange'));
    } catch (error) {
        console.error('Error rendering topics:', error);
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
 * Builds a hierarchical tree from the flat topic list.
 * @returns {{ roots: Array, nodesById: Map }} roots sorted by sortOrder (children always in
 *   tree order); orphans become roots; the archive root is always last.
 */
export function buildTopicTree(topics, sortOrder = state.topicSortOrder || 'tree') {
    const nodesById = new Map();

    for (let i = 0; i < topics.length; i++) {
        const topic = topics[i];
        nodesById.set(topic.id, {
            id: topic.id,
            name: topic.name,
            prompt: topic.prompt,
            parent_id: topic.parent_id || '',
            sort_order: topic.sort_order,
            created_at: topic.created_at,
            is_archive: isArchiveRoot(topic),
            children: []
        });
    }

    const roots = [];
    for (const node of nodesById.values()) {
        if (node.parent_id && node.parent_id !== node.id) {
            const parent = nodesById.get(node.parent_id);
            if (parent) {
                parent.children.push(node);
                continue;
            }
            console.warn(`Topic "${node.name}" (${node.id}) has invalid parent reference "${node.parent_id}". Treating as root.`);
        }
        roots.push(node);
    }

    sortTreeNodes(roots, sortOrder);
    // The archive is always the last root, whatever the sort order.
    const archiveIndex = roots.findIndex(node => node.is_archive);
    if (archiveIndex !== -1 && archiveIndex !== roots.length - 1) {
        roots.push(roots.splice(archiveIndex, 1)[0]);
    }
    return { roots, nodesById };
}

function sortTreeNodes(nodes, sortOrder, isTopLevel = true) {
    // Only top-level topics follow the chosen sort order; children always sort by sort_order
    nodes.sort((a, b) => compareTopics(a, b, isTopLevel ? sortOrder : 'tree'));
    nodes.forEach(node => {
        if (node.children.length > 0) sortTreeNodes(node.children, sortOrder, false);
    });
}

// Visible rows in order: skips children of collapsed topics unless search expanded them.
function flattenTopicTree(roots, searchExpandedIds = new Set()) {
    const flattened = [];
    const visited = new Set();
    const stack = [];
    for (let i = roots.length - 1; i >= 0; i--) {
        stack.push({ node: roots[i], depth: 0, parentId: '', indexInParent: i, totalSiblings: roots.length });
    }

    while (stack.length > 0) {
        const entry = stack.pop();
        const { node, depth } = entry;
        if (visited.has(node.id)) continue;
        visited.add(node.id);

        const expanded = node.children.length > 0 &&
            (!isTopicCollapsed(node.id) || searchExpandedIds.has(node.id));
        flattened.push({ ...entry, topic: node, expanded });

        if (expanded) {
            for (let i = node.children.length - 1; i >= 0; i--) {
                stack.push({ node: node.children[i], depth: depth + 1, parentId: node.id, indexInParent: i, totalSiblings: node.children.length });
            }
        }
    }
    return flattened;
}

// True when parentId is inside the archive below its first level: such topics
// travel with their archived ancestor and get neither Archive nor Restore.
function parentIsArchived(parentId, nodesById) {
    let cursor = parentId;
    const visited = new Set();
    while (cursor && !visited.has(cursor)) {
        if (cursor === ARCHIVE_TOPIC_ID) return true;
        visited.add(cursor);
        cursor = nodesById.get(cursor)?.parent_id;
    }
    return false;
}

/**
 * Row ⋯ menu entries for a topic: [action, icon, label]. The archive root has none;
 * a direct child of the archive gets Restore; deeper archived topics get neither.
 */
export function rowActions(topicId, nodesById = state.nodesById) {
    const node = nodesById.get(topicId);
    if (!node || node.is_archive) return [];
    const actions = [['add', 'plus', 'Add child'], ['rename', 'pencil', 'Rename']];
    if (node.parent_id === ARCHIVE_TOPIC_ID) actions.push(['unarchive', 'archive', 'Restore']);
    else if (!parentIsArchived(node.parent_id, nodesById)) actions.push(['archive', 'archive', 'Archive']);
    actions.push(['delete', 'trash', 'Delete']);
    return actions;
}

// Drag-drop and the 48px rows are desktop-pointer vs touch (README: drag-drop desktop-only).
const isTouch = () => Boolean(window.matchMedia?.('(max-width: 759px), (pointer: coarse)')?.matches);

function createTopicItem({ topic, depth, parentId, expanded }, archivedIds, touch) {
    const isArchive = topic.is_archive;
    const isFolder = topic.children.length > 0;
    const archived = archivedIds.has(topic.id);
    const selected = editor?.mode === 'edit' && editor.id === topic.id;
    const actions = rowActions(topic.id);
    const isNew = !isFolder && !archived && Date.parse(topic.created_at) >= Date.now() - NEW_DAYS * 864e5;

    const row = document.createElement('div');
    row.className = 'gct-tree-row gct-manage__row' + (isFolder ? ' is-folder' : '') +
        (archived ? ' is-archived' : '') + (selected ? ' is-selected' : '');
    row.dataset.topicId = topic.id;
    row.style.paddingLeft = `${8 + depth * ROW_INDENT}px`;
    // The archive root stays put; everything else (archived topics included) can be dragged.
    row.draggable = !touch && !isArchive;
    row.setAttribute('role', 'treeitem');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-level', depth + 1);
    row.setAttribute('aria-selected', String(selected));
    if (isFolder) row.setAttribute('aria-expanded', String(expanded));

    const name = escapeHtml(topic.name);
    const displayName = highlightText(topic.name, state.topicsSearchQuery);
    let guides = '';
    for (let k = 0; k < depth; k++) guides += `<span class="gct-manage__guide" style="left:${17 + k * ROW_INDENT}px"></span>`;

    row.innerHTML = `${guides}
        <span class="gct-grip" aria-hidden="true">${isArchive ? '' : svg('grip', 14)}</span>
        <span class="gct-manage__chev" aria-hidden="true">${isFolder ? svg(expanded ? 'chevron-down' : 'chevron-right', 16) : ''}</span>
        <span class="gct-manage__icon${isFolder && !archived ? ' is-folder' : ''}" aria-hidden="true">${svg(isArchive ? 'archive' : isFolder ? 'folder' : 'leaf', 16)}</span>
        <span class="gct-manage__name" title="${name}">${displayName}</span>
        ${isNew ? '<span class="gct-manage__new" title="New"></span>' : ''}
        ${isFolder ? `<span class="gct-manage__count">${topic.children.length}</span>` : ''}
        ${actions.length ? `<button type="button" class="gct-row-more" tabindex="-1" aria-label="Actions for ${name}" aria-haspopup="menu" aria-expanded="false">${svg('more', 16)}</button>` : ''}`;

    row.querySelector('.gct-manage__chev').addEventListener('click', (e) => {
        if (!isFolder) return;
        e.stopPropagation();
        toggleRow(topic.id);
    });
    row.querySelector('.gct-row-more')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openMenu(row, topic.id);
    });
    // Touch (push navigation): a folder tap only expands it; its editor is one ⋯ > Rename away.
    row.addEventListener('click', () => {
        if (isFolder) toggleRow(topic.id);
        if (!isArchive && !(touch && isFolder)) openEditor(topic.id);
    });
    row.addEventListener('keydown', handleTopicKeyboard);

    if (row.draggable) {
        row.addEventListener('dragstart', (event) => {
            draggedTopicId = topic.id;
            row.classList.add('topic-dragging');
            dom.topicsList.classList.add('is-dragging');
            dragGhostElement = createDragGhost(row);
            updateDragGhostPosition(event);
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', topic.id);
                const emptyImg = new Image();
                emptyImg.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                event.dataTransfer.setDragImage(emptyImg, 0, 0);
            }
        });
        row.addEventListener('dragend', endDrag);
    }
    if (!touch) attachDropHandlers(row, { targetParentId: topic.id, targetPosition: null, isChildDrop: true });

    return row;
}

function toggleRow(topicId) {
    toggleTopicCollapse(topicId);
    announceToScreenReader(`${findTopic(topicId)?.name || ''} ${isTopicCollapsed(topicId) ? 'collapsed' : 'expanded'}`);
    renderTopicsList();
}

function findTopic(id) {
    return state.topics.find(t => t.id === id);
}

function rowEl(id) {
    return [...(dom.topicsList?.querySelectorAll('[role="treeitem"]') || [])].find(el => el.dataset.topicId === id) || null;
}

// Search: matching ids plus every ancestor of a match (expanded so the match shows).
function findMatchingTopics(searchQuery, nodesById) {
    const matchingIds = new Set();
    const lowerQuery = searchQuery.trim().toLowerCase();
    nodesById.forEach((node) => {
        if (node.name.toLowerCase().includes(lowerQuery)) matchingIds.add(node.id);
    });

    const expandedIds = new Set();
    matchingIds.forEach((id) => {
        let current = nodesById.get(id);
        while (current && current.parent_id && !expandedIds.has(current.parent_id)) {
            expandedIds.add(current.parent_id);
            current = nodesById.get(current.parent_id);
        }
    });
    return { matchingIds, expandedIds };
}

// Takes the RAW text: split on the match first, then escape each piece, so the query never lands inside an entity.
function highlightText(text, searchQuery) {
    if (!searchQuery) return escapeHtml(text);
    return String(text ?? '').split(new RegExp(`(${escapeRegExp(searchQuery)})`, 'gi'))
        .map((part, i) => (i % 2 ? `<mark class="search-highlight">${escapeHtml(part)}</mark>` : escapeHtml(part)))
        .join('');
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Escapes quotes too: names also go into attribute values.
export function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// Accessibility: Announcer for screen reader messages
function announceToScreenReader(message) {
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

function getVisibleTopicItems() {
    return Array.from(dom.topicsList.querySelectorAll('[role="treeitem"]'));
}

/**
 * Tree keyboard navigation (ARIA tree pattern):
 * Up/Down move · Right expands or goes to the first child · Left collapses or goes to the parent ·
 * Home/End · Enter opens the topic in the editor · Space toggles a folder · Escape leaves the tree.
 */
function handleTopicKeyboard(event) {
    const topicItem = event.currentTarget;
    if (event.target !== topicItem) return; // keys typed in the row menu are not tree navigation
    const allItems = getVisibleTopicItems();
    const currentIndex = allItems.indexOf(topicItem);
    const id = topicItem.dataset.topicId;
    const expanded = topicItem.getAttribute('aria-expanded');
    const toggleAndRefocus = () => {
        toggleRow(id);
        rowEl(id)?.focus();
    };

    switch (event.key) {
        case 'ArrowDown':
            event.preventDefault();
            allItems[currentIndex + 1]?.focus();
            break;
        case 'ArrowUp':
            event.preventDefault();
            if (currentIndex > 0) allItems[currentIndex - 1].focus();
            break;
        case 'ArrowRight':
            event.preventDefault();
            if (expanded === 'false') toggleAndRefocus();
            else if (expanded === 'true') allItems[currentIndex + 1]?.focus();
            break;
        case 'ArrowLeft': {
            event.preventDefault();
            if (expanded === 'true') {
                toggleAndRefocus();
                break;
            }
            const level = parseInt(topicItem.getAttribute('aria-level') || '1', 10);
            for (let i = currentIndex - 1; i >= 0 && level > 1; i--) {
                if (parseInt(allItems[i].getAttribute('aria-level') || '1', 10) < level) {
                    allItems[i].focus();
                    break;
                }
            }
            break;
        }
        case 'Home':
            event.preventDefault();
            allItems[0]?.focus();
            break;
        case 'End':
            event.preventDefault();
            allItems[allItems.length - 1]?.focus();
            break;
        case 'Enter':
            event.preventDefault();
            if (findTopic(id) && !isArchiveRoot(findTopic(id))) {
                openEditor(id);
                rowEl(id)?.focus();
            } else if (expanded) {
                toggleAndRefocus();
            }
            break;
        case ' ':
            event.preventDefault();
            if (expanded) toggleAndRefocus();
            break;
        case 'Escape':
            event.preventDefault();
            topicItem.blur();
            break;
    }
}

// --- Row ⋯ menu ---

let menuEl = null;

function closeMenu({ refocus = false } = {}) {
    if (!menuEl?.isConnected) return;
    const row = menuEl.parentElement;
    const btn = row?.querySelector('.gct-row-more');
    btn?.setAttribute('aria-expanded', 'false');
    menuEl.remove();
    if (refocus) row?.focus();
}

function openMenu(row, topicId) {
    const wasOpenHere = menuEl?.parentElement === row;
    closeMenu();
    if (wasOpenHere) return;
    if (!menuEl) {
        menuEl = document.createElement('div');
        menuEl.className = 'gct-card gct-manage__menu';
        menuEl.setAttribute('role', 'menu');
        menuEl.addEventListener('click', (e) => e.stopPropagation());
        menuEl.addEventListener('keydown', (e) => {
            const items = [...menuEl.querySelectorAll('button')];
            const i = items.indexOf(document.activeElement);
            if (e.key === 'Escape') { e.preventDefault(); closeMenu({ refocus: true }); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
        });
    }
    menuEl.replaceChildren(...rowActions(topicId).map(([action, icon, label]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.dataset.action = action;
        b.innerHTML = svg(icon, 16);
        b.append(label);
        b.addEventListener('click', () => {
            closeMenu();
            runRowAction(action, topicId);
        });
        return b;
    }));
    row.append(menuEl);
    row.querySelector('.gct-row-more')?.setAttribute('aria-expanded', 'true');
    menuEl.querySelector('button')?.focus();
}

document.addEventListener('click', () => closeMenu());

export function runRowAction(action, topicId) {
    if (action === 'add') openCreate(topicId);
    else if (action === 'rename') openEditor(topicId, { focusName: true });
    else if (action === 'archive') archiveTopic(topicId);
    else if (action === 'unarchive') unarchiveTopic(topicId);
    else if (action === 'delete') deleteTopic(topicId);
}

// --- Tree render ---

export function renderTopicsList() {
    if (!dom.topicsList) return;
    dom.topicsList.innerHTML = '';
    dom.topicsList.setAttribute('role', 'tree');
    dom.topicsList.setAttribute('aria-label', 'Topic tree');
    const touch = isTouch();
    dom.manageTree?.classList.toggle('gct-tree--touch', touch);

    const { roots, nodesById } = buildTopicTree(state.topics, state.topicSortOrder || 'tree');
    state.nodesById = nodesById;

    if (state.topics.length === 0) {
        dom.topicsList.innerHTML = '<div class="gct-manage__empty" role="status">No topics yet. Add one with +.</div>';
        return;
    }

    let flattenedNodes;
    if (state.topicsSearchQuery) {
        // Capture current collapsed state before search starts (only on first search render)
        if (!state.preSearchCollapsedTopicIds) {
            state.preSearchCollapsedTopicIds = new Set(state.collapsedTopicIds);
        }

        const { matchingIds, expandedIds } = findMatchingTopics(state.topicsSearchQuery, nodesById);
        state.topicsMatchingIds = matchingIds;
        state.searchExpandedTopicIds = expandedIds;

        // Respect manual collapse/expand overrides during search
        const searchExpandedIds = new Set(expandedIds);
        for (const id of state.searchManualCollapsedTopicIds) searchExpandedIds.delete(id);

        flattenedNodes = flattenTopicTree(roots, searchExpandedIds)
            .filter(({ topic }) => matchingIds.has(topic.id) || expandedIds.has(topic.id));
    } else {
        state.topicsMatchingIds.clear();
        // Search ended: restore the pre-search collapse state, keeping manual changes made during search.
        if (state.preSearchCollapsedTopicIds) {
            const mergedCollapsedIds = new Set(state.preSearchCollapsedTopicIds);
            for (const topicId of state.searchExpandedTopicIds) {
                if (!state.preSearchCollapsedTopicIds.has(topicId)) mergedCollapsedIds.delete(topicId);
            }
            for (const topicId of state.searchManualCollapsedTopicIds) mergedCollapsedIds.add(topicId);
            for (const topicId of state.searchManualExpandedTopicIds) mergedCollapsedIds.delete(topicId);

            state.collapsedTopicIds = mergedCollapsedIds;
            state.searchExpandedTopicIds.clear();
            state.searchManualExpandedTopicIds.clear();
            state.searchManualCollapsedTopicIds.clear();
            state.preSearchCollapsedTopicIds = undefined;
            saveTopicCollapseState();
        }
        flattenedNodes = flattenTopicTree(roots);
    }

    if (flattenedNodes.length === 0) {
        dom.topicsList.innerHTML = `<div class="gct-manage__empty" role="status">No topics match "${escapeHtml(state.topicsSearchQuery)}".</div>`;
        return;
    }

    // ponytail: no virtual scroll — a few hundred DOM rows render fine.
    const archivedIds = getArchivedTopicIds();
    for (const entry of flattenedNodes) {
        const { depth, parentId, indexInParent, totalSiblings } = entry;
        if (!touch) dom.topicsList.appendChild(createSiblingDropZone(depth, parentId, indexInParent));
        dom.topicsList.appendChild(createTopicItem(entry, archivedIds, touch));
        if (!touch && indexInParent === totalSiblings - 1) {
            dom.topicsList.appendChild(createSiblingDropZone(depth, parentId, totalSiblings));
        }
    }
}

// --- Drag and drop (desktop only) ---

let draggedTopicId = null;
let isMoveInProgress = false;
let dragGhostElement = null;

function createSiblingDropZone(depth, targetParentId, targetPosition) {
    const zone = document.createElement('div');
    zone.className = 'topic-gap-drop-zone';
    zone.style.marginLeft = `${8 + depth * ROW_INDENT}px`;
    attachDropHandlers(zone, { targetParentId, targetPosition, isChildDrop: false });
    return zone;
}

function createDragGhost(sourceElement) {
    const ghost = sourceElement.cloneNode(true);
    ghost.className = 'topic-drag-ghost gct-manage__row';
    ghost.style.width = `${sourceElement.offsetWidth}px`;
    document.body.appendChild(ghost);
    return ghost;
}

function updateDragGhostPosition(event) {
    if (!dragGhostElement) return;
    dragGhostElement.style.left = `${event.clientX - dragGhostElement.offsetWidth / 2}px`;
    dragGhostElement.style.top = `${event.clientY - dragGhostElement.offsetHeight / 2}px`;
}

function removeDragGhost() {
    dragGhostElement?.remove();
    dragGhostElement = null;
}

function endDrag() {
    draggedTopicId = null;
    dom.topicsList?.classList.remove('is-dragging');
    dom.topicsList?.querySelectorAll('.topic-dragging').forEach(el => el.classList.remove('topic-dragging'));
    clearDropHighlights();
    removeDragGhost();
}

/**
 * Drop target: a row (isChildDrop — the dragged topic becomes its child) or a gap between rows
 * (reorder at targetPosition under targetParentId). Refuses drops that would create a cycle.
 */
function attachDropHandlers(element, { targetParentId, targetPosition, isChildDrop }) {
    element.addEventListener('dragover', (event) => {
        if (!draggedTopicId || isMoveInProgress) return;
        event.preventDefault();
        updateDragGhostPosition(event);
    });

    element.addEventListener('dragenter', (event) => {
        if (!draggedTopicId || isMoveInProgress) return;
        event.preventDefault();
        event.stopPropagation();
        clearDropHighlights();
        element.classList.add(isChildDrop ? 'parent-drop-highlight' : 'topic-drop-active');
    });

    element.addEventListener('dragleave', (event) => {
        if (!draggedTopicId || isMoveInProgress) return;
        // Only clear when leaving the element itself, not one of its children
        const rect = element.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
            element.classList.remove('topic-drop-active', 'parent-drop-highlight');
        }
    });

    element.addEventListener('drop', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        clearDropHighlights();

        const dragged = draggedTopicId;
        if (!dragged || isMoveInProgress) return;
        if (dragged === targetParentId && isChildDrop) return;
        if (targetParentId && wouldCreateCycle(state.nodesById, dragged, targetParentId)) {
            toast({ tone: 'danger', text: 'A topic cannot move into itself or one of its descendants. Drop it on another topic.' });
            return;
        }

        isMoveInProgress = true;
        try {
            await moveTopic(dragged, targetParentId || null, targetPosition);
        } finally {
            isMoveInProgress = false;
        }
    });
}

// True when targetParentId is draggedId or one of its descendants (or the chain loops).
function wouldCreateCycle(nodesById, draggedId, targetParentId) {
    let cursor = targetParentId;
    const visited = new Set();
    while (cursor) {
        if (cursor === draggedId || visited.has(cursor)) return true;
        visited.add(cursor);
        cursor = nodesById.get(cursor)?.parent_id;
    }
    return false;
}

function clearDropHighlights() {
    dom.topicsList?.querySelectorAll('.topic-drop-active, .parent-drop-highlight').forEach(el => {
        el.classList.remove('topic-drop-active', 'parent-drop-highlight');
    });
}

// Global dragover keeps the ghost under the pointer between drop targets.
document.addEventListener('dragover', (event) => {
    if (dragGhostElement) updateDragGhostPosition(event);
});
// Global dragend cleanup (in case the drag ends outside the tree)
document.addEventListener('dragend', endDrag);

// --- Topic API actions ---

function getNextSortOrder(parentId) {
    const normalizedParentId = parentId || null;
    let maxSortOrder = -1;
    for (const topic of state.topics) {
        if ((topic.parent_id || null) !== normalizedParentId) continue;
        const sortValue = Number.isFinite(topic.sort_order) ? topic.sort_order : 0;
        if (sortValue > maxSortOrder) maxSortOrder = sortValue;
    }
    return maxSortOrder + 1;
}

function apiErrorText(error, verb) {
    const message = error?.message || '';
    if (message.includes('duplicate') || message.includes('already exists')) return 'A topic with this name already exists at this level.';
    return message ? `Failed to ${verb} topic: ${message}` : `Failed to ${verb} topic.`;
}

async function deleteTopic(topicId) {
    const topic = findTopic(topicId);
    if (!topic) {
        toast({ tone: 'danger', text: 'Topic not found. Please refresh and try again.' });
        return;
    }
    const n = exerciseCounts.get(topicId) || 0;
    const canArchive = rowActions(topicId).some(([action]) => action === 'archive');
    const choice = await confirm({
        title: 'Delete this topic?',
        body: `Its prompt, version history and ${n} practice record${n === 1 ? '' : 's'} are removed.` +
            (canArchive ? ' Archive instead if you might need it again.' : ''),
        actions: [
            { label: 'Delete topic', kind: 'danger', value: 'delete' },
            canArchive && { label: 'Archive instead', kind: 'secondary', value: 'archive' },
            { label: 'Cancel', kind: 'ghost' },
        ].filter(Boolean),
    });
    if (choice === 'archive') return archiveTopic(topicId);
    if (choice !== 'delete') return;

    try {
        await deleteTopicAPI(topicId);
        removeRecentlyUsedTopic(topicId);
        if (editor?.id === topicId) closeEditor();
        await loadTopics();
        toast({ text: 'Topic deleted' });
    } catch (error) {
        console.error('Error deleting topic:', error);
        toast({
            tone: 'danger',
            text: error.status === 409 ? 'Delete its sub-topics first, or archive it.' : apiErrorText(error, 'delete'),
        });
    }
}

async function archiveTopic(topicId) {
    const topic = findTopic(topicId);
    if (!topic) {
        toast({ tone: 'danger', text: 'Topic not found. Please refresh and try again.' });
        return;
    }
    try {
        await archiveTopicAPI(topicId);
        // loadTopics -> topicschange: js/scope.js moves the scope off the archived subtree.
        await loadTopics();
        toast({ icon: 'archive', text: 'Moved to Archive' });
    } catch (error) {
        console.error('Error archiving topic:', error);
        await loadTopics();
        toast({ tone: 'danger', text: `Failed to archive topic. ${error.message || ''}`.trim() });
    }
}

async function unarchiveTopic(topicId) {
    const topic = findTopic(topicId);
    if (!topic) {
        toast({ tone: 'danger', text: 'Topic not found. Please refresh and try again.' });
        return;
    }
    try {
        await unarchiveTopicAPI(topicId);
        await loadTopics();
        toast({ tone: 'success', text: 'Restored from Archive' });
    } catch (error) {
        console.error('Error restoring topic:', error);
        await loadTopics();
        toast({ tone: 'danger', text: `Failed to restore topic. ${error.message || ''}`.trim() });
    }
}

async function moveTopic(topicId, parentId, position = null) {
    try {
        if (typeof position === 'number' && Number.isFinite(position) && position >= 0) {
            const maxPosition = parentId
                ? (state.nodesById.get(parentId)?.children.length || 0)
                : state.topics.filter(t => !t.parent_id).length;
            if (position > maxPosition) {
                throw new Error(`Position ${position} is out of bounds. Maximum valid position is ${maxPosition}.`);
            }
        }
        await moveTopicAPI(topicId, parentId, position);
        // Show the moved topic: expand its new parent.
        if (parentId && state.collapsedTopicIds.delete(parentId)) saveTopicCollapseState();
        await loadTopics();
    } catch (error) {
        console.error('Error moving topic:', error);
        // Refresh topics to ensure frontend state reflects actual database state
        await loadTopics();
        toast({ tone: 'danger', text: `Failed to move topic. ${error.message || ''}`.trim() });
    }
}

// --- Editor pane ---

// null | { mode: 'edit', id } | { mode: 'create', parentId }
let editor = null;
let saving = false;
let exerciseCounts = new Map(); // topic id -> generated exercises (GET /api/db/stats, js/manage.js)

export function setExerciseCounts(perTopic = []) {
    exerciseCounts = new Map(perTopic.map(t => [t.topic_id, t.count]));
    renderEditorChrome();
}

function fillEditor(name, parentId, prompt) {
    dom.topicNameInput.value = name;
    dom.promptTextarea.value = prompt;
    setFieldError(dom.topicNameInput, dom.topicNameError, null);
    setFieldError(dom.promptTextarea, dom.promptError, null);
    renderParentOptions(parentId);
    updatePromptCounter();
}

// Parent select: (Root) + every topic except the edited one and its descendants (no cycles).
function renderParentOptions(parentId) {
    const select = dom.topicParentSelect;
    const selfId = editor?.mode === 'edit' ? editor.id : null;
    const root = new Option('(Root topic)', '');
    const options = state.topics
        .filter(t => !selfId || !wouldCreateCycle(state.nodesById, selfId, t.id))
        .map(t => new Option(getTopicPath(t.id), t.id))
        .sort((a, b) => a.text.localeCompare(b.text));
    select.replaceChildren(root, ...options);
    select.value = parentId || '';
}

function renderRecentParents() {
    const selfId = editor?.mode === 'edit' ? editor.id : null;
    // Same rule as the select: no self, no descendants (a badge without an option would pick Root).
    const recent = state.recentlyUsedTopics
        .filter(r => findTopic(r.id) && (!selfId || !wouldCreateCycle(state.nodesById, selfId, r.id)))
        .slice(0, 4);
    dom.recentlyUsedTopics.hidden = recent.length === 0;
    dom.recentTopicsContainer.replaceChildren(...recent.map(r => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'gct-badge gct-badge--neutral';
        b.textContent = r.name.split(' — ')[0];
        b.title = `Use ${r.name} as parent`;
        b.addEventListener('click', () => {
            dom.topicParentSelect.value = r.id;
            renderEditorChrome();
        });
        return b;
    }));
}

function updatePromptCounter() {
    dom.promptCounter.textContent = `${dom.promptTextarea.value.length} / ${MAX_PROMPT_LENGTH}`;
}

function renderCrumbs(ids) {
    const parts = ids.map(id => findTopic(id)).filter(Boolean);
    dom.topicEditorCrumbs.replaceChildren();
    parts.forEach((t, i) => {
        if (i) dom.topicEditorCrumbs.insertAdjacentHTML('beforeend', svg('chevron-right', 14));
        const span = document.createElement('span');
        span.textContent = t.name.split(' — ')[0];
        dom.topicEditorCrumbs.append(span);
    });
}

function ancestorIds(id) {
    const out = [];
    for (let t = findTopic(id); t && !out.includes(t.id); t = findTopic(t.parent_id)) out.unshift(t.id);
    return out;
}

// Everything around the fields: selection, crumbs, title, meta, header actions, mobile push state.
function renderEditorChrome() {
    if (!dom.topicEditor) return;
    const open = Boolean(editor);
    dom.topicEditor.hidden = !open;
    dom.topicEditorEmpty.hidden = open;
    dom.manageTopics?.classList.toggle('is-editing', open);
    dom.topicsList?.querySelectorAll('[role="treeitem"]').forEach(row => {
        const on = editor?.mode === 'edit' && row.dataset.topicId === editor.id;
        row.classList.toggle('is-selected', on);
        row.setAttribute('aria-selected', String(on));
    });
    if (!open) return;

    const parentId = dom.topicParentSelect.value || null;
    if (editor.mode === 'create') {
        renderCrumbs(parentId ? ancestorIds(parentId) : []);
        dom.topicEditorTitle.textContent = 'New topic';
        dom.topicEditorMeta.textContent = parentId ? `Inside ${findTopic(parentId)?.name || ''}` : 'Root topic';
        dom.topicEditorArchive.hidden = true;
        dom.topicEditorDelete.hidden = true;
        dom.versionsSection.hidden = true;
    } else {
        const topic = findTopic(editor.id);
        if (!topic) return;
        renderCrumbs(parentId ? ancestorIds(parentId) : []);
        dom.topicEditorTitle.textContent = topic.name;
        const n = exerciseCounts.get(topic.id) || 0;
        dom.topicEditorMeta.textContent = `Created ${fmtDate(topic.created_at)} · ${n} exercise${n === 1 ? '' : 's'} generated`;
        const actions = rowActions(topic.id).map(([a]) => a);
        const archiveAction = actions.includes('archive') ? 'archive' : actions.includes('unarchive') ? 'unarchive' : null;
        dom.topicEditorArchive.hidden = !archiveAction;
        dom.topicEditorArchive.dataset.action = archiveAction || '';
        const label = archiveAction === 'unarchive' ? 'Restore from Archive' : 'Archive';
        dom.topicEditorArchive.setAttribute('aria-label', label);
        dom.topicEditorArchive.title = label;
        dom.topicEditorDelete.hidden = !actions.includes('delete');
    }
    renderRecentParents();
}

export function openEditor(topicId, { focusName = false } = {}) {
    const topic = findTopic(topicId);
    if (!topic || isArchiveRoot(topic) || !dom.topicEditor) return;
    editor = { mode: 'edit', id: topicId, parentId: topic.parent_id || '' };
    state.editingTopicId = topicId;
    fillEditor(topic.name, topic.parent_id || '', topic.prompt || '');
    renderEditorChrome();
    loadVersions(topicId);
    if (isTouch()) window.scrollTo?.(0, 0); // the editor replaces the tree
    if (focusName) {
        dom.topicNameInput.focus();
        dom.topicNameInput.select();
    }
}

export function openCreate(parentId = null) {
    if (!dom.topicEditor) return;
    editor = { mode: 'create', parentId: parentId || null };
    state.editingTopicId = null;
    fillEditor('', parentId || '', '');
    renderEditorChrome();
    dom.topicNameInput.focus();
}

export function closeEditor() {
    editor = null;
    state.editingTopicId = null;
    renderEditorChrome();
}

function discardEditor() {
    if (editor?.mode === 'edit') openEditor(editor.id);
    else closeEditor();
}

async function saveEditor() {
    if (!editor || saving) return;
    const name = dom.topicNameInput.value.trim();
    const prompt = dom.promptTextarea.value.trim();
    const parentId = dom.topicParentSelect.value || null;

    const nameError = validateTopicName(name, parentId);
    const promptError = validateTopicPrompt(prompt);
    setFieldError(dom.topicNameInput, dom.topicNameError, nameError);
    setFieldError(dom.promptTextarea, dom.promptError, promptError);
    if (nameError || promptError) {
        (nameError ? dom.topicNameInput : dom.promptTextarea).focus();
        return;
    }

    saving = true;
    dom.savePromptBtn.disabled = true;
    const current = editor;
    try {
        if (current.mode === 'create') {
            const result = await createTopicAPI(name, prompt, parentId, getNextSortOrder(parentId));
            if (result?.id) addRecentlyUsedTopic(result.id, name);
            if (parentId && state.collapsedTopicIds.delete(parentId)) saveTopicCollapseState();
            await loadTopics();
            if (result?.id) openEditor(result.id);
            else closeEditor();
            toast({ tone: 'success', text: 'Topic created' });
        } else {
            const existing = findTopic(current.id);
            if (!existing) {
                toast({ tone: 'danger', text: 'Topic not found. Please refresh and try again.' });
                return;
            }
            // A new parent appends the topic at the end of its new siblings.
            const sortOrder = (existing.parent_id || null) === parentId
                ? (Number.isFinite(existing.sort_order) ? existing.sort_order : 0)
                : getNextSortOrder(parentId);
            await updateTopicAPI(current.id, name, prompt, parentId, sortOrder);
            addRecentlyUsedTopic(current.id, name);
            await loadTopics();
            if (editor === current) openEditor(current.id);
            toast({ tone: 'success', text: 'Saved' });
        }
    } catch (error) {
        console.error('Error saving topic:', error);
        toast({ tone: 'danger', text: apiErrorText(error, current.mode === 'create' ? 'create' : 'update') });
    } finally {
        saving = false;
        dom.savePromptBtn.disabled = false;
    }
}

// Prompt versions, newest first: the newest is Current, older ones can be restored.
async function loadVersions(topicId) {
    dom.versionsSection.hidden = true;
    dom.versionsList.replaceChildren();
    let versions;
    try {
        versions = (await fetchVersionsAPI(topicId)).versions || [];
    } catch (error) {
        console.error('Error loading version history:', error);
        return;
    }
    if (editor?.mode !== 'edit' || editor.id !== topicId) return; // the user moved on
    versions.sort((a, b) => b.version - a.version);
    dom.versionsList.replaceChildren(...versions.map((v, i) => {
        const row = document.createElement('div');
        row.className = 'gct-manage__vrow';
        const note = (v.prompt || '').trim().split('\n')[0] || fmtDate(v.created_at);
        row.innerHTML = `<span class="gct-manage__vnum">v${v.version}</span>
            <div class="gct-manage__grow"><div class="gct-manage__vnote" title="${escapeHtml(note)}">${escapeHtml(note)}</div>
            <div class="gct-manage__small">${fmtDateTime(v.created_at)}</div></div>`;
        if (i === 0) {
            row.insertAdjacentHTML('beforeend', '<span class="gct-badge gct-badge--info">Current</span>');
        } else {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'gct-btn gct-btn--ghost gct-btn--sm';
            btn.innerHTML = svg('retry', 16);
            btn.append('Restore');
            btn.addEventListener('click', () => restoreVersion(topicId, v));
            row.append(btn);
        }
        return row;
    }));
    dom.versionsSection.hidden = versions.length === 0;
}

async function restoreVersion(topicId, version) {
    const choice = await confirm({
        title: `Restore v${version.version}?`,
        body: 'Its prompt becomes the current one. The current prompt stays in the version history.',
        actions: [{ label: 'Restore', kind: 'primary', value: 'restore' }, { label: 'Cancel', kind: 'ghost' }],
    });
    if (choice !== 'restore') return;
    try {
        await restoreVersionAPI(topicId, version.id);
        await loadTopics();
        if (editor?.mode === 'edit' && editor.id === topicId) openEditor(topicId);
        toast({ tone: 'success', text: `Restored v${version.version} into the editor` });
    } catch (error) {
        console.error('Error restoring version:', error);
        toast({ tone: 'danger', text: `Failed to restore version. ${error.message || ''}`.trim() });
    }
}

export function focusTopicsSearch() {
    if (isTouch() && editor) closeEditor(); // mobile: the tree is behind the pushed editor
    dom.topicsSearchInput?.focus();
    dom.topicsSearchInput?.select();
}

// Wires the Manage > Topics toolbar and editor once (js/manage.js).
export function initTopicsManager() {
    if (!dom.topicEditor) return;
    dom.topicSort.value = state.topicSortOrder || 'tree';
    dom.topicSort.addEventListener('change', (e) => {
        state.topicSortOrder = e.target.value;
        try {
            localStorage.setItem('topicSortOrder', state.topicSortOrder);
        } catch (error) {
            console.error('Failed to save topic sort order:', error);
        }
        renderTopicsList();
    });

    const runSearch = () => {
        state.topicsSearchQuery = dom.topicsSearchInput.value.trim();
        renderTopicsList();
    };
    dom.topicsSearchInput.addEventListener('input', debounce(runSearch, SEARCH_DEBOUNCE_MS));
    dom.topicsSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && dom.topicsSearchInput.value) {
            e.preventDefault();
            dom.topicsSearchInput.value = '';
            runSearch();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            getVisibleTopicItems()[0]?.focus();
        }
    });

    dom.addTopicBtn.addEventListener('click', () => openCreate(null));
    dom.topicEditorBack.addEventListener('click', closeEditor);
    dom.discardBtn.addEventListener('click', discardEditor);
    dom.topicEditorDelete.addEventListener('click', () => editor?.mode === 'edit' && deleteTopic(editor.id));
    dom.topicEditorArchive.addEventListener('click', () => {
        const action = dom.topicEditorArchive.dataset.action;
        if (editor?.mode === 'edit' && action) runRowAction(action, editor.id);
    });
    dom.topicParentSelect.addEventListener('change', renderEditorChrome);

    dom.topicNameInput.addEventListener('input', () => {
        setFieldError(dom.topicNameInput, dom.topicNameError, validateTopicName(dom.topicNameInput.value, dom.topicParentSelect.value || null));
    });
    dom.promptTextarea.addEventListener('input', () => {
        updatePromptCounter();
        setFieldError(dom.promptTextarea, dom.promptError, validateTopicPrompt(dom.promptTextarea.value));
    });

    dom.topicEditor.addEventListener('submit', (e) => {
        e.preventDefault();
        saveEditor();
    });
    dom.topicEditor.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            saveEditor();
        } else if (e.target.tagName === 'INPUT') {
            e.preventDefault(); // plain Enter in Name must not submit; Ctrl Enter saves
        }
    });
}
