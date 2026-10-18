/**
 * The Daily Web - Editor Dashboard Script (Student 4)
 * Article workflow for the editor (review / edit / approve / return / delete) and the
 * Impact Analytics chart: views over time with a marker for every approved update (Chart.js).
 */

document.addEventListener('DOMContentLoaded', () => {

    // ── Constants ───────────────────────────────────────────────────────────
    const TIMEZONE = 'Asia/Jerusalem';
    const HOUR_MS = 60 * 60 * 1000;
    const FOCUS_HOURS = 24; // hours shown on each side of an update in focus mode
    const SEARCH_DEBOUNCE_MS = 350;

    const STATUS_LABELS = {
        draft: 'In preparation',
        pending: 'Pending approval',
        published: 'Published',
        returned: 'Returned for corrections'
    };
    // Stage of an update to a published article (revisionStatus)
    const UPDATE_LABELS = {
        draft: 'update in preparation',
        pending: 'update pending',
        returned: 'update returned'
    };
    const COLORS = {
        views: '#0056b3',
        viewsFill: 'rgba(0, 86, 179, 0.12)',
        publish: '#2b8a3e',
        update: '#d9480f'
    };
    const TABS = ['all', 'published', 'pending', 'returned', 'draft'];

    // ── State ───────────────────────────────────────────────────────────────
    let currentTab = 'pending';
    let currentSearch = '';
    let currentPage = 1;
    let hasMore = false;
    let listRequestId = 0; // responses of outdated requests are ignored
    let counts = { all: 0, published: 0, pending: 0, returned: 0, draft: 0 };
    const rowData = new Map(); // article id -> summary shown in the table

    let reviewArticle = null; // article open in the review dialog
    let isEditing = false;

    let analyticsArticleId = null;
    let analyticsRange = '7d';
    let focusWindow = null; // { from, to, number, type, at } while zoomed around an approval
    let analyticsRequestId = 0;
    let currentPublications = [];
    let impactChart = null;
    let chartMarkers = []; // read by the marker-lines chart plugin
    let chartUnit = 'hour';

    // ── DOM Elements ────────────────────────────────────────────────────────
    const dashboardMessage = document.getElementById('dashboardMessage');

    const statusTabs = document.querySelectorAll('.status-tab');
    const editorSearch = document.getElementById('editorSearch');
    const articlesSummary = document.getElementById('articlesSummary');
    const articlesTableBody = document.getElementById('articlesTableBody');
    const articlesLoading = document.getElementById('articlesLoading');
    const articlesEmpty = document.getElementById('articlesEmpty');
    const loadMoreBtn = document.getElementById('loadMoreBtn');

    const reviewDialog = document.getElementById('reviewDialog');
    const reviewStatus = document.getElementById('reviewStatus');
    const reviewTitle = document.getElementById('reviewTitle');
    const reviewMeta = document.getElementById('reviewMeta');
    const reviewLoading = document.getElementById('reviewLoading');
    const reviewBody = document.getElementById('reviewBody');
    const reviewNotice = document.getElementById('reviewNotice');
    const reviewPrevNote = document.getElementById('reviewPrevNote');
    const reviewColumns = document.getElementById('reviewColumns');
    const liveColumn = document.getElementById('liveColumn');
    const liveTitle = document.getElementById('liveTitle');
    const liveContent = document.getElementById('liveContent');
    const draftColumn = document.getElementById('draftColumn');
    const draftHeadingText = document.getElementById('draftHeadingText');
    const changeBadges = document.getElementById('changeBadges');
    const draftTitle = document.getElementById('draftTitle');
    const draftContent = document.getElementById('draftContent');
    const editForm = document.getElementById('editForm');
    const editWarning = document.getElementById('editWarning');
    const editTitle = document.getElementById('editTitle');
    const editContent = document.getElementById('editContent');
    const noteBlock = document.getElementById('noteBlock');
    const editorNoteInput = document.getElementById('editorNoteInput');
    const reviewError = document.getElementById('reviewError');
    const previewLink = document.getElementById('previewLink');
    const reviewCloseBtn = document.getElementById('reviewCloseBtn');
    const deleteBtn = document.getElementById('deleteBtn');
    const editBtn = document.getElementById('editBtn');
    const cancelEditBtn = document.getElementById('cancelEditBtn');
    const saveEditBtn = document.getElementById('saveEditBtn');
    const returnBtn = document.getElementById('returnBtn');
    const approveBtn = document.getElementById('approveBtn');
    const reviewButtons = [deleteBtn, editBtn, cancelEditBtn, saveEditBtn, returnBtn, approveBtn];

    const analyticsPanel = document.getElementById('analyticsPanel');
    const topArticlesList = document.getElementById('topArticlesList');
    const analyticsPlaceholder = document.getElementById('analyticsPlaceholder');
    const analyticsContent = document.getElementById('analyticsContent');
    const analyticsTitle = document.getElementById('analyticsTitle');
    const analyticsMeta = document.getElementById('analyticsMeta');
    const rangeButtons = document.querySelectorAll('.range-btn');
    const kpiTotal = document.getElementById('kpiTotal');
    const kpiRange = document.getElementById('kpiRange');
    const kpiUpdates = document.getElementById('kpiUpdates');
    const kpiImpact = document.getElementById('kpiImpact');
    const focusBanner = document.getElementById('focusBanner');
    const focusText = document.getElementById('focusText');
    const focusBackBtn = document.getElementById('focusBackBtn');
    const chartCanvas = document.getElementById('impactChart');
    const analyticsLoading = document.getElementById('analyticsLoading');
    const impactTableBody = document.getElementById('impactTableBody');
    const resetStatsBtn = document.getElementById('resetStatsBtn');

    // ── Helpers ─────────────────────────────────────────────────────────────
    // Every value coming from the server is escaped before it goes into innerHTML
    function escapeHtml(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatNumber(value) {
        return Number(value || 0).toLocaleString('en-US');
    }

    function formatDateTime(value) {
        if (!value) return '';
        return new Date(value).toLocaleString('en-GB', {
            timeZone: TIMEZONE, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    }

    function formatHour(value) {
        return new Date(value).toLocaleTimeString('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit' });
    }

    // Label of a chart bucket: an hour (ISO date) or a day ("YYYY-MM-DD", already in the newsroom time zone)
    function formatBucketLabel(bucket, unit) {
        if (unit === 'hour') {
            return new Date(bucket).toLocaleString('en-GB', {
                timeZone: TIMEZONE, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
            });
        }
        return new Date(bucket + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
    }

    function formatChange(changePct) {
        if (changePct === null || changePct === undefined) return '&ndash;';
        const cssClass = changePct >= 0 ? 'impact-up' : 'impact-down';
        return `<span class="${cssClass}">${changePct > 0 ? '+' : ''}${changePct}%</span>`;
    }

    // Text of the workflow stage (a published article with an update in progress keeps being shown to readers)
    function stageText(article) {
        if (article.status === 'published' && article.revisionStatus) {
            return `Published · ${UPDATE_LABELS[article.revisionStatus]}`;
        }
        return STATUS_LABELS[article.status] || article.status;
    }

    function stageClass(article) {
        return `status-badge status-${article.revisionStatus || article.status}`;
    }

    let messageTimer = null;
    function showMessage(text, type = 'success') {
        dashboardMessage.textContent = text;
        dashboardMessage.className = `dashboard-message is-${type}`;
        dashboardMessage.hidden = false;
        clearTimeout(messageTimer);
        messageTimer = setTimeout(() => { dashboardMessage.hidden = true; }, 6000);
    }

    // JSON request to the server - throws an Error with the server's message on any failure
    async function apiRequest(url, { method = 'GET', body } = {}) {
        const response = await fetch(url, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : {},
            body: body ? JSON.stringify(body) : undefined
        });

        let data = null;
        try {
            data = await response.json();
        } catch (e) {
            data = null; // not a JSON response
        }

        if (response.status === 401) {
            window.location.href = '/auth/login'; // the session has ended
        }
        if (!response.ok || !data || !data.success) {
            throw new Error((data && data.message) || `Request failed (${response.status})`);
        }
        return data;
    }

    // ── Articles Table ──────────────────────────────────────────────────────
    function renderCounts() {
        document.querySelectorAll('[data-count-for]').forEach(el => {
            el.textContent = formatNumber(counts[el.dataset.countFor]);
        });
    }

    // Same rules as the server's tab filters
    function matchesTab(article, tab) {
        if (tab === 'all') return true;
        if (tab === 'published') return article.status === 'published';
        return article.status === tab || article.revisionStatus === tab;
    }

    // Keep the tab counters correct after an action, without reloading the list
    function adjustCounts(before, after) {
        TABS.forEach(tab => {
            if (before && matchesTab(before, tab)) counts[tab] -= 1;
            if (after && matchesTab(after, tab)) counts[tab] += 1;
        });
        renderCounts();
    }

    function renderArticleRow(article) {
        rowData.set(article._id, article);

        const isPublished = article.status === 'published';
        const isPending = article.stage === 'pending';
        const row = document.createElement('tr');
        row.dataset.id = article._id;

        row.innerHTML = `
            <td data-label="Article">
                <span class="row-title">${escapeHtml(article.title)}</span>
                ${article.updatesCount > 0
                    ? `<span class="flag">${article.updatesCount} approved update${article.updatesCount > 1 ? 's' : ''}</span>`
                    : ''}
            </td>
            <td data-label="Author">${escapeHtml(article.author)}</td>
            <td data-label="Category">${escapeHtml(article.category)}</td>
            <td data-label="Status"><span class="${escapeHtml(stageClass(article))}">${escapeHtml(stageText(article))}</span></td>
            <td data-label="Last change"><time datetime="${escapeHtml(article.updatedAt)}">${formatDateTime(article.updatedAt)}</time></td>
            <td data-label="Views">${isPublished ? formatNumber(article.viewsCount) : '&ndash;'}</td>
            <td class="row-actions">
                <button type="button" class="btn-table ${isPending ? 'btn-table-primary' : ''}" data-action="review">${isPending ? 'Review' : 'Open'}</button>
                <button type="button" class="btn-table" data-action="analytics" ${isPublished ? '' : 'disabled title="Available once the article is published"'}>Analytics</button>
                <button type="button" class="btn-table btn-table-danger" data-action="delete">Delete</button>
            </td>
        `;
        return row;
    }

    async function loadArticles(reset = false) {
        if (reset) {
            currentPage = 1;
            articlesTableBody.innerHTML = '';
            rowData.clear();
        }

        const requestId = ++listRequestId;
        articlesLoading.hidden = false;
        loadMoreBtn.hidden = true;
        articlesEmpty.hidden = true;

        try {
            const params = new URLSearchParams({ status: currentTab, page: currentPage });
            if (currentSearch) params.set('search', currentSearch);

            const data = await apiRequest('/api/editor/articles?' + params.toString());
            if (requestId !== listRequestId) return; // a newer request replaced this one

            counts = data.counts;
            renderCounts();

            const fragment = document.createDocumentFragment();
            data.articles.forEach(article => fragment.appendChild(renderArticleRow(article)));
            articlesTableBody.appendChild(fragment);

            hasMore = data.hasMore;
            loadMoreBtn.hidden = !hasMore;
            articlesEmpty.hidden = data.total > 0;
            articlesSummary.textContent = `${formatNumber(data.total)} article${data.total === 1 ? '' : 's'}`;
        } catch (err) {
            if (requestId !== listRequestId) return;
            console.error('Failed to load articles:', err);
            showMessage(err.message, 'error');
        } finally {
            if (requestId === listRequestId) articlesLoading.hidden = true;
        }
    }

    function removeRow(articleId) {
        const row = articlesTableBody.querySelector(`tr[data-id="${articleId}"]`);
        rowData.delete(articleId);
        if (row) row.remove();
        if (!articlesTableBody.children.length && !hasMore) articlesEmpty.hidden = false;
    }

    // Reflect a changed article in the table: replace its row, or remove it if it left the current tab
    function updateRow(before, after) {
        adjustCounts(before, after);
        const row = articlesTableBody.querySelector(`tr[data-id="${after._id}"]`);
        if (!row) return;

        if (matchesTab(after, currentTab)) {
            row.replaceWith(renderArticleRow(after));
        } else {
            removeRow(after._id);
        }
    }

    async function deleteArticle(article) {
        const confirmed = window.confirm(
            `Delete "${article.title}"?\n\nThis permanently removes the article, its comments and its view statistics.`
        );
        if (!confirmed) return false;

        try {
            const data = await apiRequest(`/api/articles/${article._id}`, { method: 'DELETE' });
            adjustCounts(article, null);
            removeRow(article._id);
            if (analyticsArticleId === article._id) clearAnalytics();
            loadTopArticles();
            showMessage(data.message);
            return true;
        } catch (err) {
            showMessage(err.message, 'error');
            return false;
        }
    }

    // ── Review Dialog ───────────────────────────────────────────────────────
    function showReviewError(message) {
        reviewError.textContent = message;
        reviewError.hidden = false;
    }

    function setReviewBusy(busy) {
        reviewButtons.forEach(btn => { btn.disabled = busy; });
        editorNoteInput.disabled = busy;
        if (busy) reviewError.hidden = true;
    }

    // Which actions are allowed depends on the workflow stage (same rules as the server's state machine)
    function updateReviewButtons() {
        const stage = reviewArticle ? reviewArticle.stage : null;
        const canDecide = !isEditing && stage === 'pending';

        approveBtn.hidden = !canDecide;
        returnBtn.hidden = !canDecide;
        noteBlock.hidden = !canDecide;
        editBtn.hidden = isEditing || !reviewArticle;
        deleteBtn.hidden = isEditing || !reviewArticle;
        saveEditBtn.hidden = !isEditing;
        cancelEditBtn.hidden = !isEditing;
    }

    function setEditing(editing) {
        isEditing = editing;
        reviewColumns.hidden = editing;
        editForm.hidden = !editing;
        updateReviewButtons();
    }

    async function openReview(articleId) {
        reviewArticle = null;
        setEditing(false);
        reviewStatus.className = 'status-badge';
        reviewStatus.textContent = '';
        reviewTitle.textContent = 'Review article';
        reviewMeta.textContent = '';
        reviewError.hidden = true;
        editorNoteInput.value = '';
        reviewBody.hidden = true;
        reviewLoading.hidden = false;
        if (!reviewDialog.open) reviewDialog.showModal();

        try {
            const data = await apiRequest(`/api/editor/articles/${articleId}`);
            reviewArticle = data.article;
            renderReview();
        } catch (err) {
            showReviewError(err.message);
        } finally {
            reviewLoading.hidden = true;
        }
    }

    function renderReview() {
        const article = reviewArticle;
        const isUpdate = article.status === 'published' && Boolean(article.revisionStatus);

        reviewStatus.className = stageClass(article);
        reviewStatus.textContent = stageText(article);
        reviewTitle.textContent = article.title;

        const meta = [`By ${article.author}`, article.category, `last change ${formatDateTime(article.updatedAt)}`];
        if (article.publishedAt) meta.push(`first published ${formatDateTime(article.publishedAt)}`);
        reviewMeta.textContent = meta.join(' · ');

        // Explain what the editor is looking at
        if (isUpdate) {
            reviewNotice.textContent = 'This is an update to a published article. Readers keep seeing the "Currently published" version until you approve the proposed update.';
        } else if (article.status === 'published') {
            reviewNotice.textContent = 'This article is live and has no update in progress.';
        } else {
            reviewNotice.textContent = 'This article has not been published yet.';
        }

        reviewPrevNote.hidden = !article.editorNote;
        if (article.editorNote) {
            reviewPrevNote.innerHTML = `<strong>Editor's note from the last review:</strong> ${escapeHtml(article.editorNote)}`;
        }

        // Live version vs the version waiting for approval.
        // Article bodies are HTML that is sanitized on save (the same HTML the article page renders).
        liveColumn.hidden = !article.live;
        if (article.live) {
            liveTitle.textContent = article.live.title;
            liveContent.innerHTML = article.live.content;
        }

        draftColumn.hidden = !article.draft;
        changeBadges.innerHTML = '';
        if (article.draft) {
            draftHeadingText.textContent = article.live ? 'Proposed update' : 'Submitted version';
            draftTitle.textContent = article.draft.title || '(untitled)';
            draftContent.innerHTML = article.draft.content || '<p class="field-hint">No content yet.</p>';
        }

        if (article.live && article.draft) {
            const changes = [];
            if (article.live.title !== article.draft.title) changes.push('Title changed');
            if (article.live.content !== article.draft.content) changes.push('Content changed');
            if (!changes.length) changes.push('No changes yet');
            changeBadges.innerHTML = changes.map(text => `<span class="change-badge">${text}</span>`).join(' ');
        }

        previewLink.href = `/article/${article._id}`;
        reviewBody.hidden = false;
        updateReviewButtons();
    }

    function startEditing() {
        // The editor works on the version waiting for approval, or on the live text if there is none
        const source = reviewArticle.draft || reviewArticle.live;
        editTitle.value = source.title || '';
        editContent.innerHTML = source.content || '';
        editWarning.textContent = reviewArticle.draft
            ? 'You are editing the version that waits for approval - readers will see it only after it is approved.'
            : 'This article has no update in progress - saving publishes your changes immediately and adds an update marker to its analytics.';
        reviewError.hidden = true;
        setEditing(true);
        editTitle.focus();
    }

    async function saveEdit() {
        const title = editTitle.value.trim();
        const content = editContent.innerHTML.trim();

        if (!title) {
            showReviewError('The title cannot be empty.');
            editTitle.focus();
            return;
        }
        if (!editContent.textContent.trim()) {
            showReviewError('The content cannot be empty.');
            editContent.focus();
            return;
        }

        const before = reviewArticle;
        setReviewBusy(true);
        try {
            const data = await apiRequest(`/api/editor/articles/${before._id}`, {
                method: 'PUT',
                body: { title, content }
            });
            reviewArticle = data.article;
            setEditing(false);
            renderReview();
            updateRow(before, data.article);
            showMessage(data.message);

            if (data.appliedTo === 'live') {
                loadTopArticles();
                if (analyticsArticleId === before._id) loadAnalytics();
            }
        } catch (err) {
            showReviewError(err.message);
        } finally {
            setReviewBusy(false);
        }
    }

    async function changeStatus(status, editorNote) {
        const before = reviewArticle;
        setReviewBusy(true);
        try {
            const data = await apiRequest(`/api/articles/${before._id}/status`, {
                method: 'PATCH',
                body: { status, editorNote }
            });
            updateRow(before, data.article);
            reviewDialog.close();
            showMessage(data.message);

            if (status === 'published') {
                loadTopArticles();
                if (analyticsArticleId === before._id) loadAnalytics();
            }
        } catch (err) {
            showReviewError(err.message);
        } finally {
            setReviewBusy(false);
        }
    }

    // ── Impact Analytics ────────────────────────────────────────────────────
    // Draws a dashed vertical line with a label at every approval (first publication / update)
    const markerLinesPlugin = {
        id: 'markerLines',
        afterDatasetsDraw(chart) {
            if (!chartMarkers.length) return;
            const { ctx, chartArea, scales } = chart;
            const labelsAtIndex = {};

            ctx.save();
            chartMarkers.forEach(marker => {
                const x = scales.x.getPixelForValue(marker.index);
                const color = marker.type === 'publish' ? COLORS.publish : COLORS.update;
                labelsAtIndex[marker.index] = (labelsAtIndex[marker.index] || 0) + 1;

                ctx.strokeStyle = color;
                ctx.lineWidth = 1.5;
                ctx.setLineDash([6, 4]);
                ctx.beginPath();
                ctx.moveTo(x, chartArea.top);
                ctx.lineTo(x, chartArea.bottom);
                ctx.stroke();

                // Label above the plot area (stacked downwards when several approvals share a bucket)
                const nearRightEdge = x > chartArea.right - 120;
                ctx.setLineDash([]);
                ctx.fillStyle = color;
                ctx.font = '600 11px "Segoe UI", Roboto, Arial, sans-serif';
                ctx.textAlign = nearRightEdge ? 'right' : 'left';
                ctx.fillText(markerLabel(marker), x + (nearRightEdge ? -5 : 5), chartArea.top - 8 + 13 * (labelsAtIndex[marker.index] - 1));
            });
            ctx.restore();
        }
    };

    function markerLabel(marker) {
        const name = marker.type === 'publish' ? 'Published' : `Update #${marker.number}`;
        return chartUnit === 'hour' ? `${name} · ${formatHour(marker.at)}` : name;
    }

    function renderChart(data) {
        if (typeof Chart === 'undefined') {
            showMessage('The chart library could not be loaded. Check the internet connection and reload the page.', 'error');
            return;
        }

        const labels = data.buckets.map(bucket => formatBucketLabel(bucket, data.unit));

        // Marker points sit on the views line, at the bucket of each approval
        const markerValues = data.views.map(() => null);
        const markerColors = data.views.map(() => COLORS.update);
        data.markers.forEach(marker => {
            markerValues[marker.index] = data.views[marker.index];
            if (marker.type === 'publish') markerColors[marker.index] = COLORS.publish;
        });

        chartMarkers = data.markers;
        chartUnit = data.unit;

        if (impactChart) impactChart.destroy();
        impactChart = new Chart(chartCanvas, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: data.unit === 'hour' ? 'Views per hour' : 'Views per day',
                        data: data.views,
                        borderColor: COLORS.views,
                        backgroundColor: COLORS.viewsFill,
                        fill: true,
                        tension: 0.25,
                        borderWidth: 2,
                        pointRadius: data.views.length > 60 ? 0 : 2,
                        pointHoverRadius: 4
                    },
                    {
                        label: 'Editor approved & published',
                        data: markerValues,
                        showLine: false,
                        pointStyle: 'triangle',
                        pointRadius: 8,
                        pointHoverRadius: 10,
                        pointBackgroundColor: markerColors,
                        pointBorderColor: markerColors,
                        borderColor: COLORS.update,
                        backgroundColor: COLORS.update
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 300 },
                layout: { padding: { top: 20 } }, // room for the marker labels
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { autoSkip: true, maxTicksLimit: 8, maxRotation: 0 }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { precision: 0 },
                        title: { display: true, text: 'Views' }
                    }
                },
                plugins: {
                    legend: { position: 'bottom', labels: { usePointStyle: true } },
                    tooltip: {
                        filter: item => item.datasetIndex === 0,
                        callbacks: {
                            afterBody: items => {
                                const index = items.length ? items[0].dataIndex : -1;
                                return chartMarkers
                                    .filter(marker => marker.index === index)
                                    .map(marker => `▲ ${marker.type === 'publish' ? 'Published' : `Update #${marker.number}`} at ${formatHour(marker.at)} by ${marker.editor}`);
                            }
                        }
                    }
                }
            },
            plugins: [markerLinesPlugin]
        });
    }

    function renderImpactTable(publications) {
        if (!publications.length) {
            impactTableBody.innerHTML = '<tr><td colspan="7" class="table-empty">This article has not been published yet.</td></tr>';
            return;
        }

        impactTableBody.innerHTML = publications.map(p => {
            const isUpdate = p.type === 'update';
            return `
                <tr>
                    <td data-label="Version">
                        <span class="marker-dot marker-${p.type}"></span>${isUpdate ? `Update #${p.number}` : 'First publication'}
                    </td>
                    <td data-label="Approved at">${formatDateTime(p.at)}</td>
                    <td data-label="Editor">${escapeHtml(p.editor)}</td>
                    <td data-label="Avg views/h before">${isUpdate && p.avgBefore !== null ? p.avgBefore : '&ndash;'}</td>
                    <td data-label="Avg views/h after">${isUpdate && p.avgAfter !== null ? p.avgAfter : '&ndash;'}</td>
                    <td data-label="Change">${isUpdate ? formatChange(p.changePct) : '&ndash;'}</td>
                    <td class="row-actions">
                        <button type="button" class="btn-table" data-focus="${p.number}">Focus</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function renderAnalytics(data) {
        analyticsTitle.textContent = data.article.title;

        const meta = [stageText(data.article)];
        if (data.article.publishedAt) meta.push(`first published ${formatDateTime(data.article.publishedAt)}`);
        meta.push(data.unit === 'hour' ? 'views per hour' : 'views per day');
        analyticsMeta.textContent = meta.join(' · ');

        // KPI tiles
        kpiTotal.textContent = formatNumber(data.totals.views);
        kpiRange.textContent = formatNumber(data.totals.viewsInRange);
        kpiUpdates.textContent = formatNumber(data.totals.updates);
        const lastUpdate = data.publications.filter(p => p.type === 'update').pop();
        kpiImpact.innerHTML = formatChange(lastUpdate ? lastUpdate.changePct : null);

        // Range buttons / focus banner
        rangeButtons.forEach(btn => {
            btn.classList.toggle('active', !focusWindow && btn.dataset.range === analyticsRange);
        });
        focusBanner.hidden = !focusWindow;
        if (focusWindow) {
            const name = focusWindow.type === 'publish' ? 'the first publication' : `update #${focusWindow.number}`;
            focusText.textContent = `Zoomed in on ${name}: ${FOCUS_HOURS} hours before and after ${formatDateTime(focusWindow.at)}.`;
        }

        currentPublications = data.publications;
        renderChart(data);
        renderImpactTable(data.publications);
    }

    async function loadAnalytics() {
        if (!analyticsArticleId) return;

        const requestId = ++analyticsRequestId;
        analyticsPlaceholder.hidden = true;
        analyticsContent.hidden = false;
        analyticsLoading.hidden = false;

        const params = new URLSearchParams();
        if (focusWindow) {
            params.set('from', focusWindow.from);
            params.set('to', focusWindow.to);
        } else {
            params.set('range', analyticsRange);
        }

        try {
            const data = await apiRequest(`/api/analytics/article/${analyticsArticleId}?${params.toString()}`);
            if (requestId !== analyticsRequestId) return;
            renderAnalytics(data);
        } catch (err) {
            if (requestId !== analyticsRequestId) return;
            console.error('Failed to load analytics:', err);
            showMessage(err.message, 'error');
        } finally {
            if (requestId === analyticsRequestId) analyticsLoading.hidden = true;
        }
    }

    function openAnalytics(articleId) {
        analyticsArticleId = articleId;
        focusWindow = null;
        highlightTopArticle();
        loadAnalytics();
        analyticsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function clearAnalytics() {
        analyticsArticleId = null;
        focusWindow = null;
        if (impactChart) {
            impactChart.destroy();
            impactChart = null;
        }
        analyticsContent.hidden = true;
        analyticsPlaceholder.hidden = false;
        highlightTopArticle();
    }

    function highlightTopArticle() {
        topArticlesList.querySelectorAll('.top-article-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.id === analyticsArticleId);
        });
    }

    async function loadTopArticles() {
        try {
            const data = await apiRequest('/api/analytics/top?range=7d&limit=10');
            if (!data.articles.length) {
                topArticlesList.innerHTML = '<li class="top-articles-empty">No views in the last 7 days.</li>';
                return;
            }
            topArticlesList.innerHTML = data.articles.map((article, i) => `
                <li>
                    <button type="button" class="top-article-btn" data-id="${escapeHtml(article._id)}">
                        <span class="top-rank">${i + 1}</span>
                        <span class="top-info">
                            <span class="top-title">${escapeHtml(article.title)}</span>
                            <span class="top-views">
                                ${formatNumber(article.views)} views${article.updates ? ` · ${article.updates} update${article.updates > 1 ? 's' : ''}` : ''}
                            </span>
                        </span>
                    </button>
                </li>
            `).join('');
            highlightTopArticle();
        } catch (err) {
            topArticlesList.innerHTML = `<li class="top-articles-empty">${escapeHtml(err.message)}</li>`;
        }
    }

    // ── Event Listeners ─────────────────────────────────────────────────────
    statusTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            if (tab.dataset.status === currentTab) return;
            currentTab = tab.dataset.status;
            statusTabs.forEach(t => {
                const isActive = t === tab;
                t.classList.toggle('active', isActive);
                t.setAttribute('aria-selected', String(isActive));
            });
            loadArticles(true);
        });
    });

    let searchTimer = null;
    editorSearch.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            const value = editorSearch.value.trim();
            if (value === currentSearch) return;
            currentSearch = value;
            loadArticles(true);
        }, SEARCH_DEBOUNCE_MS);
    });

    loadMoreBtn.addEventListener('click', () => {
        currentPage += 1;
        loadArticles(false);
    });

    // One listener for all row buttons (rows are re-rendered dynamically)
    articlesTableBody.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const articleId = button.closest('tr').dataset.id;
        const article = rowData.get(articleId);
        if (!article) return;

        if (button.dataset.action === 'review') openReview(articleId);
        else if (button.dataset.action === 'analytics') openAnalytics(articleId);
        else if (button.dataset.action === 'delete') deleteArticle(article);
    });

    // Review dialog actions
    reviewCloseBtn.addEventListener('click', () => reviewDialog.close());
    editBtn.addEventListener('click', startEditing);
    cancelEditBtn.addEventListener('click', () => {
        reviewError.hidden = true;
        setEditing(false);
    });
    saveEditBtn.addEventListener('click', saveEdit);
    approveBtn.addEventListener('click', () => changeStatus('published'));
    returnBtn.addEventListener('click', () => {
        const note = editorNoteInput.value.trim();
        if (!note) {
            showReviewError('Please write a note explaining which corrections are needed.');
            editorNoteInput.focus();
            return;
        }
        changeStatus('returned', note);
    });
    deleteBtn.addEventListener('click', async () => {
        const deleted = await deleteArticle(reviewArticle);
        if (deleted) reviewDialog.close();
    });

    // Escape key: ask before throwing away unsaved edits
    reviewDialog.addEventListener('cancel', (event) => {
        if (isEditing && !window.confirm('Discard your unsaved changes?')) {
            event.preventDefault();
        }
    });
    reviewDialog.addEventListener('close', () => {
        reviewArticle = null;
        setEditing(false);
    });

    // Analytics controls
    topArticlesList.addEventListener('click', (event) => {
        const button = event.target.closest('.top-article-btn');
        if (button) openAnalytics(button.dataset.id);
    });

    rangeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            analyticsRange = btn.dataset.range;
            focusWindow = null;
            loadAnalytics();
        });
    });

    // Zoom the chart to the hours around one approval (e.g. an update published at 14:00)
    impactTableBody.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-focus]');
        if (!button) return;
        const publication = currentPublications.find(p => String(p.number) === button.dataset.focus);
        if (!publication) return;

        const at = new Date(publication.at).getTime();
        focusWindow = {
            from: new Date(at - FOCUS_HOURS * HOUR_MS).toISOString(),
            to: new Date(at + FOCUS_HOURS * HOUR_MS).toISOString(),
            number: publication.number,
            type: publication.type,
            at: publication.at
        };
        loadAnalytics();
    });

    focusBackBtn.addEventListener('click', () => {
        focusWindow = null;
        loadAnalytics();
    });

    resetStatsBtn.addEventListener('click', async () => {
        if (!analyticsArticleId) return;
        if (!window.confirm('Reset all view statistics of this article? This cannot be undone.')) return;

        try {
            const data = await apiRequest(`/api/analytics/article/${analyticsArticleId}`, { method: 'DELETE' });
            const row = rowData.get(analyticsArticleId);
            if (row) updateRow(row, { ...row, viewsCount: 0 });
            showMessage(data.message);
            loadAnalytics();
            loadTopArticles();
        } catch (err) {
            showMessage(err.message, 'error');
        }
    });

    // ── Init ────────────────────────────────────────────────────────────────
    renderCounts();
    loadArticles(true);
    loadTopArticles();
});
