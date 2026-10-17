/**
 * The Daily Web - Reporter Dashboard (Student 3)
 * Lists the logged-in reporter's articles via AJAX with status tabs,
 * title search, "Load more" pagination, and "Submit for approval" actions.
 */

document.addEventListener('DOMContentLoaded', () => {

    // ── Labels (the four article states from the spec) ──────────────────────
    const STATUS_LABELS = {
        draft: 'In Preparation',
        pending: 'Awaiting Approval',
        published: 'Published',
        returned: 'Returned for Corrections'
    };

    // State of an update to an already published article
    const REVISION_LABELS = {
        draft: 'Update in progress',
        pending: 'Update awaiting approval',
        returned: 'Update returned for corrections'
    };

    // ── State ───────────────────────────────────────────────────────────────
    let currentStatus = 'all';
    let currentSearch = '';
    let currentPage = 0;
    let isLoading = false;
    let latestRequest = 0; // responses of outdated searches are ignored
    let toastTimeout = null;

    // ── DOM Elements ────────────────────────────────────────────────────────
    const list = document.getElementById('reporterArticleList');
    const resultsText = document.getElementById('reporterResults');
    const emptyState = document.getElementById('reporterEmpty');
    const loadMoreBtn = document.getElementById('reporterLoadMore');
    const searchInput = document.getElementById('reporterSearch');
    const tabs = document.querySelectorAll('.status-tab');
    const toast = document.getElementById('reporterToast');

    // ── Helpers ─────────────────────────────────────────────────────────────
    function formatDate(dateStr) {
        return new Date(dateStr).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    async function readJson(res) {
        try {
            return await res.json();
        } catch (e) {
            return {};
        }
    }

    function createElement(tag, className, text) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined) el.textContent = text;
        return el;
    }

    function showToast(message, type) {
        clearTimeout(toastTimeout);
        toast.textContent = message;
        toast.className = `reporter-toast ${type}`;
        toast.hidden = false;
        toastTimeout = setTimeout(() => { toast.hidden = true; }, 6000);
    }

    // ── Render Single Article Row ───────────────────────────────────────────
    // Titles and notes are set with textContent (never innerHTML).
    function renderArticle(article) {
        const item = createElement('li', 'reporter-article');
        item.dataset.id = article._id;

        // Main info
        const main = createElement('div', 'reporter-article-main');

        const badges = createElement('div', 'reporter-article-badges');
        badges.appendChild(createElement('span', `status-badge status-${article.status}`, STATUS_LABELS[article.status] || article.status));
        if (article.status === 'published' && article.revisionStatus) {
            badges.appendChild(createElement('span', `status-badge revision revision-${article.revisionStatus}`, REVISION_LABELS[article.revisionStatus]));
        }
        if (article.category) {
            badges.appendChild(createElement('span', 'category-tag-small', article.category));
        }

        const title = createElement('h3', 'reporter-article-title');
        if (article.isEditable) {
            const link = createElement('a', '', article.title);
            link.href = `/reporter/articles/${article._id}/edit`;
            title.appendChild(link);
        } else {
            title.textContent = article.title;
        }

        const meta = createElement('p', 'reporter-article-meta', `Last updated ${formatDate(article.updatedAt)}`);

        main.append(badges, title, meta);

        if (article.editorNote) {
            const note = createElement('p', 'reporter-editor-note');
            note.append(createElement('strong', '', "Editor's note: "), document.createTextNode(article.editorNote));
            main.appendChild(note);
        }

        // Actions
        const actions = createElement('div', 'reporter-article-actions');

        if (article.isEditable) {
            const editLink = createElement('a', 'btn-secondary', 'Edit');
            editLink.href = `/reporter/articles/${article._id}/edit`;
            actions.appendChild(editLink);
        } else {
            actions.appendChild(createElement('span', 'locked-label', 'Locked while in review'));
        }

        if (article.canSubmit) {
            const submitBtn = createElement('button', 'btn-primary', 'Submit for Approval');
            submitBtn.type = 'button';
            submitBtn.addEventListener('click', () => submitArticle(article._id, submitBtn));
            actions.appendChild(submitBtn);
        }

        const viewLink = createElement('a', 'btn-link', article.status === 'published' ? 'View live' : 'Preview');
        viewLink.href = `/article/${article._id}`;
        viewLink.target = '_blank';
        viewLink.rel = 'noopener';
        actions.appendChild(viewLink);

        item.append(main, actions);
        return item;
    }

    function updateCounts(counts) {
        document.querySelectorAll('.tab-count').forEach((el) => {
            const value = counts[el.dataset.count];
            el.textContent = value !== undefined ? value : '';
        });
    }

    // ── Fetch Articles via AJAX ─────────────────────────────────────────────
    async function fetchArticles(isReset) {
        if (isLoading && !isReset) return;

        const requestId = ++latestRequest;
        isLoading = true;
        loadMoreBtn.disabled = true;
        if (isReset) {
            currentPage = 0;
            resultsText.textContent = 'Loading your articles...';
        }

        const params = new URLSearchParams({
            status: currentStatus,
            search: currentSearch,
            page: currentPage + 1
        });

        try {
            const res = await fetch(`/api/reporter/articles?${params.toString()}`);
            const data = await readJson(res);

            if (requestId !== latestRequest) return; // a newer request already started

            if (res.status === 401) {
                window.location.href = '/auth/login';
                return;
            }
            if (!res.ok || !data.success) {
                throw new Error(data.message || `HTTP error! status: ${res.status}`);
            }

            currentPage = data.page;
            if (isReset) list.replaceChildren();

            const fragment = document.createDocumentFragment();
            data.articles.forEach((article) => fragment.appendChild(renderArticle(article)));
            list.appendChild(fragment);

            updateCounts(data.counts);
            emptyState.hidden = data.total > 0;
            loadMoreBtn.hidden = !data.hasMore;
            resultsText.textContent = data.total > 0
                ? `Showing ${list.children.length} of ${data.total} articles`
                : '';
        } catch (error) {
            if (requestId !== latestRequest) return;
            console.error('Error loading articles:', error);
            resultsText.textContent = 'Could not load your articles. Please try again.';
        } finally {
            if (requestId === latestRequest) {
                isLoading = false;
                loadMoreBtn.disabled = false;
            }
        }
    }

    // ── Submit an Article for Approval ──────────────────────────────────────
    async function submitArticle(articleId, button) {
        button.disabled = true;
        try {
            const res = await fetch(`/api/articles/${articleId}/submit`, { method: 'PATCH' });
            const data = await readJson(res);
            if (!res.ok || !data.success) {
                throw new Error(data.message || 'Could not submit the article.');
            }
            showToast('Your article was submitted for editor approval.', 'success');
            fetchArticles(true);
        } catch (error) {
            showToast(error.message, 'error');
            button.disabled = false;
        }
    }

    // ── Filter Handlers ─────────────────────────────────────────────────────
    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            tabs.forEach((t) => {
                t.classList.remove('active');
                t.setAttribute('aria-selected', 'false');
            });
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');

            currentStatus = tab.dataset.status;
            fetchArticles(true);
        });
    });

    let searchDebounceTimeout = null;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchDebounceTimeout);
        searchDebounceTimeout = setTimeout(() => {
            currentSearch = searchInput.value.trim();
            fetchArticles(true);
        }, 350);
    });

    loadMoreBtn.addEventListener('click', () => fetchArticles(false));

    // ── Initialization ──────────────────────────────────────────────────────
    // "?submitted=1" comes from the editor after a successful submit; remove it
    // from the address bar so a refresh doesn't show the message again.
    if (new URLSearchParams(window.location.search).has('submitted')) {
        window.history.replaceState({}, '', window.location.pathname);
        toastTimeout = setTimeout(() => { toast.hidden = true; }, 6000);
    }

    fetchArticles(true);

});
