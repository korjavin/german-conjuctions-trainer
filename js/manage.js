// Manage (#/manage, admin only): tabs Topics / Observability / Database / CLI access.
// Ported from docs/design/claude-design/ui_kits/app/ScreensManage.jsx. The Topics tab lives in js/topics.js.
// The router guards the route; every admin API is adminOnly server-side as well.
import { state } from './state.js';
import { dom } from './dom.js';
import { currentRoute } from './router.js';
import { toast } from './ui.js';
import { fetchDatabaseStatsAPI, createCLITokenAPI, fetchLastGenerationDebugAPI, fetchLastRefinedPromptAPI } from './api.js';
import { loadTopics, initTopicsManager, setExerciseCounts, focusTopicsSearch, fmtDateTime } from './topics.js';

const NO_PROMPT = 'No generation prompt has been recorded yet. Generate some exercises first.';
let tab = 'topics';

export function selectTab(name) {
    tab = name;
    document.querySelectorAll('[data-manage-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.manageTab === name)));
    document.querySelectorAll('[data-manage-panel]').forEach((p) => { p.hidden = p.dataset.managePanel !== name; });
    if (name !== 'cli') clearToken();
    if (name === 'obs') loadObservability();
    if (name === 'db') loadDatabaseStats();
}

// The CLI token is a one-time reveal: gone once you leave the tab or the screen.
function clearToken() {
    if (!dom.cliTokenResult) return;
    dom.cliTokenResult.hidden = true;
    dom.cliTokenValue.value = '';
    dom.cliTokenError.hidden = true;
    dom.cliTokenError.textContent = '';
}

export async function loadObservability() {
    dom.obsCaption.textContent = 'Last refined prompt';
    dom.obsPrompt.textContent = 'Loading…';
    let text = NO_PROMPT;
    try {
        const debug = await fetchLastGenerationDebugAPI();
        if (debug) {
            const at = Date.parse(debug.generated_at);
            if (at > Date.parse('2000-01-01')) dom.obsCaption.textContent = `Last refined prompt · ${fmtDateTime(at)}`;
            const summary = [
                `Batch: ${debug.batch_id || 'n/a'}`,
                `Model: ${debug.model_name || 'n/a'}`,
                `Refinement: ${debug.refinement_used ? 'used' : 'fallback/base prompt'}`,
                `Provider retries: ${debug.provider_retry_count || 0}`,
                `Quality retries: ${debug.quality_gate_retry_count || 0}`,
                `Conjunction targets: ${(debug.profile?.conjunction_set || []).join(', ') || 'none'}`,
                `Quality issues: ${(debug.quality_gate_failures || []).length}`,
            ].join('\n');
            text = `${debug.prompt || NO_PROMPT}\n\n---\n${summary}`;
        } else {
            text = (await fetchLastRefinedPromptAPI()).last_refined_prompt || NO_PROMPT;
        }
    } catch (error) {
        console.error('Error fetching last refined prompt:', error);
    }
    dom.obsPrompt.textContent = text;
}

const mb = (n) => `${(Number(n) || 0).toFixed(1)} MB`;

export async function loadDatabaseStats() {
    dom.dbStatsError.hidden = true;
    let stats;
    try {
        stats = await fetchDatabaseStatsAPI();
    } catch (error) {
        console.error('Error loading database stats:', error);
        dom.dbStatsError.textContent = 'Failed to load database statistics.';
        dom.dbStatsError.hidden = false;
        return;
    }
    dom.dbStatTopics.textContent = (stats.total_topics || 0).toLocaleString();
    dom.dbStatExercises.textContent = (stats.total_exercises || 0).toLocaleString();
    dom.dbStatDbSize.textContent = mb(stats.database_size_mb);
    dom.dbStatAudioCache.textContent = mb(stats.audio_cache_size_mb);
    dom.dbStatAudioFiles.textContent = `${(stats.audio_cache_file_count || 0).toLocaleString()} files`;

    const perTopic = stats.exercises_per_topic || [];
    setExerciseCounts(perTopic); // editor meta "N exercises generated", delete confirm
    dom.dbStatsPerTopic.replaceChildren(...perTopic.map((t) => {
        const row = document.createElement('div');
        row.className = 'gct-manage__vrow';
        const name = document.createElement('span');
        name.className = 'gct-manage__grow gct-manage__vnote';
        name.textContent = t.topic_name;
        name.title = t.topic_name;
        const count = document.createElement('span');
        count.className = 'gct-manage__count';
        count.textContent = t.count.toLocaleString();
        row.append(name, count);
        return row;
    }));
    if (perTopic.length === 0) dom.dbStatsPerTopic.textContent = 'No topics found.';
}

async function generateToken() {
    clearToken();
    dom.cliTokenGenerateBtn.disabled = true;
    try {
        const label = dom.cliTokenLabel.value.trim() || 'cli';
        const result = await createCLITokenAPI(label);
        if (tab !== 'cli' || currentRoute() !== 'manage') return; // left meanwhile: keep the reveal one-time
        dom.cliTokenValue.value = result.token || '';
        dom.cliTokenResult.hidden = false;
        dom.cliTokenValue.focus();
        dom.cliTokenValue.select();
        toast({ icon: 'terminal', text: 'Token created · copy it now' });
    } catch (error) {
        dom.cliTokenError.textContent = error.message || 'Failed to mint CLI token.';
        dom.cliTokenError.hidden = false;
    } finally {
        dom.cliTokenGenerateBtn.disabled = false;
    }
}

async function copyToken() {
    const value = dom.cliTokenValue.value;
    if (!value) return;
    try {
        await navigator.clipboard.writeText(value);
        toast({ tone: 'success', text: 'Token copied' });
    } catch {
        // Clipboard API can fail (e.g. insecure context): select it for a manual copy.
        dom.cliTokenValue.focus();
        dom.cliTokenValue.select();
        toast({ text: 'Copy failed — the token is selected, copy it by hand' });
    }
}

export function initManage() {
    if (!dom.cliTokenGenerateBtn) return;
    initTopicsManager();
    document.querySelectorAll('[data-manage-tab]').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.manageTab)));
    dom.cliTokenGenerateBtn.addEventListener('click', generateToken);
    dom.cliTokenCopyBtn.addEventListener('click', copyToken);

    window.addEventListener('routechange', ({ detail: { route } }) => {
        if (route !== 'manage') {
            clearToken();
            return;
        }
        if (!state.isAdmin) return;
        loadTopics(); // fresh tree on every visit
        loadDatabaseStats(); // also feeds the editor's exercise counts
        if (tab === 'obs') loadObservability();
    });

    // Ctrl/Cmd+F inside Manage focuses the tree search instead of the browser's find.
    document.addEventListener('keydown', (e) => {
        if (currentRoute() !== 'manage' || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'f') return;
        e.preventDefault();
        if (tab !== 'topics') selectTab('topics');
        focusTopicsSearch();
    });
}
