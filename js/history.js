import { state } from './state.js';
import { dom } from './dom.js';
import { loadExerciseHistoryAPI } from './api.js';

export async function showExerciseHistory() {
    if (!state.isLoggedIn) {
        alert("Please log in to view your exercise history.");
        return;
    }

    // Show modal and loading state
    dom.historyModal.showModal();
    dom.historyLoading.classList.remove('hidden');
    dom.historyEmpty.classList.add('hidden');
    dom.historyContent.classList.add('hidden');
    dom.historyPagination.classList.add('hidden');

    try {
        // Set topic name display
        if (state.currentTopicId) {
            const topic = state.topics.find(t => t.id === state.currentTopicId);
            dom.historyTopicName.textContent = topic ? topic.name : 'Selected Topic';
        } else {
            dom.historyTopicName.textContent = 'All Topics';
        }

        const data = await loadExerciseHistoryAPI(state.currentTopicId);
        state.historyData = data.history || [];
        state.historyPage = 1;

        // Reset filters when opening fresh history
        state.historyFilterReady = false;
        state.historyFilterFavorites = false;
        updateHistoryFilterUI();

        dom.historyLoading.classList.add('hidden');

        if (state.historyData.length === 0) {
            dom.historyEmpty.classList.remove('hidden');
            dom.historySummary.classList.add('hidden');
        } else {
            // Calculate summary statistics
            const readyCount = state.historyData.filter(item => item.ready_to_repeat).length;
            const totalAttempts = state.historyData.reduce((sum, item) => sum + item.total_attempts, 0);
            const totalSuccessful = state.historyData.reduce((sum, item) => sum + item.successful_attempts, 0);
            const successRate = totalAttempts > 0 ? Math.round((totalSuccessful / totalAttempts) * 100) : 0;

            // Update summary display
            dom.historyTotalCount.textContent = state.historyData.length;
            dom.historyReadyCount.textContent = readyCount;
            dom.historySuccessRate.textContent = successRate + '%';
            dom.historyTotalAttempts.textContent = totalAttempts;

            dom.historySummary.classList.remove('hidden');
            dom.historyContent.classList.remove('hidden');
            renderHistoryPage();
        }

    } catch (error) {
        console.error('Error fetching exercise history:', error);
        dom.historyLoading.classList.add('hidden');
        dom.historySummary.classList.add('hidden');
        if (error.status === 401) {
            alert("Your session has expired. Please log in again.");
            dom.historyModal.close();
            return;
        }
        alert('Could not load exercise history. Please try again later.');
    }
}

function getFilteredHistoryData() {
    return state.historyData.filter(item => {
        let matches = true;
        if (state.historyFilterReady) {
            matches = matches && item.ready_to_repeat;
        }
        if (state.historyFilterFavorites) {
            matches = matches && item.is_favorite;
        }
        return matches;
    });
}

export function renderHistoryPage() {
    const filteredData = getFilteredHistoryData();
    const start = (state.historyPage - 1) * state.historyItemsPerPage;
    const end = start + state.historyItemsPerPage;
    const pageData = filteredData.slice(start, end);
    const totalPages = Math.ceil(filteredData.length / state.historyItemsPerPage);

    // Render items
    dom.historyContent.innerHTML = '';

    if (filteredData.length === 0) {
        if (state.historyData.length > 0) {
            dom.historyContent.innerHTML = '<div class="text-center py-4 text-gray-500">No exercises match the selected filters.</div>';
        }
        dom.historyPagination.classList.add('hidden');
        return;
    }

    pageData.forEach(item => {
        const itemEl = createHistoryItem(item);
        dom.historyContent.appendChild(itemEl);
    });

    // Update pagination
    if (totalPages > 1) {
        dom.historyPagination.classList.remove('hidden');
        dom.historyPageInfo.textContent = `Page ${state.historyPage} of ${totalPages}`;
        dom.historyPrevBtn.disabled = state.historyPage === 1;
        dom.historyNextBtn.disabled = state.historyPage === totalPages;
    } else {
        dom.historyPagination.classList.add('hidden');
    }
}

function createHistoryItem(item) {
    const div = document.createElement('div');
    div.className = 'border rounded-lg p-4 bg-white hover:shadow-md transition-shadow';

    // Calculate time info
    const lastViewed = new Date(item.last_viewed);
    const daysAgo = Math.floor((Date.now() - lastViewed.getTime()) / (1000 * 60 * 60 * 24));
    const timeText = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo} days ago`;

    const template = document.getElementById('history-item-template');
    if (!template) {
        console.error("Missing template: history-item-template");
        return document.createElement('div');
    }
    const fragment = template.content.cloneNode(true);
    const container = fragment.querySelector('.history-item');

    // Success rate calculation
    const successRate = item.total_attempts > 0
        ? Math.round((item.successful_attempts / item.total_attempts) * 100)
        : 0;

    // Title and favorite icon
    const titleEl = container.querySelector('.history-item-title');
    if (item.is_favorite) {
        const svgHTML = `<span class="text-yellow-500 mr-2" title="Favorite">
            <svg class="w-5 h-5 inline" fill="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"></path>
            </svg>
        </span>`;
        titleEl.innerHTML = svgHTML + escapeHtml(item.german_sentence);
    } else {
        titleEl.textContent = item.german_sentence;
    }

    container.querySelector('.history-item-hint').textContent = item.english_hint;

    // Status Badge
    const statusContainer = container.querySelector('.history-item-status-container');
    if (item.ready_to_repeat) {
        statusContainer.innerHTML = '<span class="badge-success">Ready to Practice</span>';
    } else {
        const daysUntilReady = Math.ceil(item.next_review_days - ((Date.now() - lastViewed.getTime()) / (1000 * 60 * 60 * 24)));
        if (daysUntilReady > 0) {
            statusContainer.innerHTML = `<span class="badge-info">Ready in ${daysUntilReady}d</span>`;
        }
    }

    container.querySelector('.history-item-topic').textContent = item.topic_name;
    container.querySelector('.history-item-date').textContent = timeText;

    container.querySelector('.history-item-success').textContent = `✓ ${item.successful_attempts}`;
    container.querySelector('.history-item-failed').textContent = `✗ ${item.failed_attempts}`;
    container.querySelector('.history-item-hints').textContent = `💡 ${item.hints_used}`;
    container.querySelector('.history-item-total').textContent = `Σ ${item.total_attempts}`;

    const rateEl = container.querySelector('.history-item-rate');
    rateEl.textContent = `${successRate}%`;
    if (successRate >= 75) rateEl.style.color = '#16a34a'; // text-green-600
    else if (successRate >= 50) rateEl.style.color = '#ca8a04'; // text-yellow-600
    else rateEl.style.color = '#dc2626'; // text-red-600

    return container;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function updateHistoryFilterUI() {
    // Update Ready to Practice filter UI
    if (state.historyFilterReady) {
        dom.historyFilterReady.classList.add('filter-active-green');
    } else {
        dom.historyFilterReady.classList.remove('filter-active-green');
    }

    // Update Favorites filter UI
    const favoritesSvg = dom.historyFilterFavorites.querySelector('svg');
    if (state.historyFilterFavorites) {
        dom.historyFilterFavorites.classList.add('filter-active-yellow');
        favoritesSvg.setAttribute('fill', 'currentColor');
    } else {
        dom.historyFilterFavorites.classList.remove('filter-active-yellow');
        favoritesSvg.setAttribute('fill', 'none');
    }
}
