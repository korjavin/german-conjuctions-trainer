// Shared fetch wrapper with structured error parsing (used for exercises endpoint)
async function apiFetch(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) {
        let errorMessage = `${response.status} ${response.statusText}`;
        let errorCode = '';
        let retryable = false;

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const errorData = await response.json().catch(() => ({}));
            if (errorData?.error?.message) {
                errorMessage = errorData.error.message;
            }
            if (errorData?.error?.details) {
                errorMessage = `${errorMessage}\nDetails: ${errorData.error.details}`;
            }
            errorCode = errorData?.error?.code || '';
            retryable = Boolean(errorData?.error?.retryable);
        } else {
            const errorText = await response.text().catch(() => '');
            if (errorText) {
                errorMessage = errorText;
            }
        }

        const error = new Error(errorMessage);
        error.status = response.status;
        error.code = errorCode;
        error.retryable = retryable;
        throw error;
    }
    return response;
}

export async function fetchTTSFilePathAPI(text) {
    try {
        const response = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        if (!response.ok) {
            console.error('Failed to fetch audio:', response.statusText);
            return '';
        }
        const data = await response.json();
        return data.filePath || '';
    } catch (error) {
        console.error('Error generating audio:', error);
        return '';
    }
}

export async function fetchTopicsAPI() {
    const response = await fetch('/api/topics');
    if (!response.ok) throw new Error('Failed to load topics');
    return response.json();
}

export async function createTopicAPI(name, prompt, parentId = null, sortOrder = 0) {
    const response = await fetch('/api/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, prompt, parent_id: parentId, sort_order: sortOrder })
    });
    if (!response.ok) throw new Error('Failed to create topic');
    return response.json();
}

export async function deleteTopicAPI(topicId) {
    const response = await fetch(`/api/topics/${topicId}`, { method: 'DELETE' });
    if (!response.ok) {
        if (response.status === 409) {
            throw new Error('Topic has children and cannot be deleted.');
        }
        throw new Error('Failed to delete topic.');
    }
}

export async function updateTopicAPI(topicId, name, prompt, parentId = null, sortOrder = 0) {
    const response = await fetch(`/api/topics/${topicId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, prompt, parent_id: parentId, sort_order: sortOrder })
    });
    if (!response.ok) throw new Error('Failed to update prompt');
}

export async function moveTopicAPI(topicId, parentId, position = null) {
    const payload = { parent_id: parentId || '' };
    if (typeof position === 'number' && Number.isFinite(position)) {
        payload.position = position;
    }

    const response = await fetch(`/api/topics/${topicId}/move`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(errorText || 'Failed to move topic');
    }
    return response.json();
}

export async function fetchExercisesFromAPI(topicId) {
    const response = await apiFetch('/api/exercises', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic_id: topicId })
    });
    return response.json();
}

export async function toggleFavoriteAPI(exerciseId) {
    const response = await fetch('/api/exercises/favorite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exercise_id: exerciseId })
    });
    if (!response.ok) throw new Error('Failed to toggle favorite');
    return response.json();
}

export async function hideExerciseAPI(exerciseId) {
    const response = await fetch('/api/exercises/hide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exercise_id: exerciseId })
    });
    if (!response.ok) throw new Error('Failed to hide exercise');
}

export async function saveUserStatsAPI(data) {
    await fetch('/api/user/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
}

export async function saveExerciseCompletionsAPI(completions) {
    if (completions.length === 0) return;
    await fetch('/api/exercises/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completions })
    });
    console.log('Saved completion data for', completions.length, 'exercises');
}

export async function saveUserSettingsAPI(topicId) {
    await fetch('/api/user/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ last_topic_id: topicId })
    });
}

export async function checkAuthStatusAPI() {
    const response = await fetch('/api/auth/status');
    return response.json();
}

export async function checkIsAdminAPI() {
    const response = await fetch('/api/auth/is_admin');
    return response.json();
}

export async function loadUserStatsAPI() {
    const response = await fetch('/api/user/stats');
    return response.json();
}

export async function loadExerciseStatsAPI() {
    const response = await fetch('/api/user/exercisestats');
    if (!response.ok) throw Object.assign(new Error('Failed to fetch exercise stats'), { status: response.status });
    return response.json();
}

export async function fetchVersionsAPI(topicId) {
    const response = await fetch(`/api/versions/${topicId}`);
    if (!response.ok) throw new Error('Failed to load versions');
    return response.json();
}

export async function restoreVersionAPI(topicId, versionId) {
    const response = await fetch(`/api/versions/${topicId}/restore/${versionId}`, { method: 'POST' });
    if (!response.ok) throw new Error('Failed to restore version');
}

export async function loadExerciseHistoryAPI(topicId) {
    let url = '/api/exercises/history';
    if (topicId) url += `?topic_id=${topicId}`;
    const response = await fetch(url);
    if (!response.ok) throw Object.assign(new Error('Failed to fetch exercise history'), { status: response.status });
    return response.json();
}

export async function fetchLastGenerationDebugAPI() {
    const response = await fetch('/api/last-generation-debug');
    if (!response.ok) return null;
    return response.json();
}

export async function fetchLastRefinedPromptAPI() {
    const response = await fetch('/api/last-refined-prompt');
    if (!response.ok) throw new Error('Failed to fetch generation prompt details.');
    return response.json();
}
