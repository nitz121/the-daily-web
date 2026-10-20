/**
 * The Daily Web - Article Comments (Student 3)
 * Loads the article's comments via AJAX, posts new comments without reloading
 * the page (the new comment is added at the top of the list), shows the server's
 * rate-limit message with a countdown, and lets editors edit / delete comments.
 */

document.addEventListener('DOMContentLoaded', () => {

    const section = document.getElementById('comments');
    if (!section) return;

    // ── Settings & State ────────────────────────────────────────────────────
    const articleId = section.dataset.articleId;
    const canModerate = section.dataset.canModerate === 'true';
    const PAGE_SIZE = 20;
    const MAX_LENGTH = 1000;

    let currentPage = 0;
    let totalComments = 0;
    let isLoading = false;
    let cooldownTimer = null;

    // New comments shift the server pages by one, so "Load more" may return
    // a comment we already show. We remember rendered ids to skip duplicates.
    const renderedIds = new Set();

    // ── DOM Elements ────────────────────────────────────────────────────────
    const form = document.getElementById('add-comment-form');
    const authorInput = document.getElementById('comment-author');
    const contentInput = document.getElementById('comment-content');
    const charCount = document.getElementById('comment-char-count');
    const formMessage = document.getElementById('comment-form-message');
    const submitBtn = form ? form.querySelector('button[type="submit"]') : null;
    const list = document.getElementById('comments-list');
    const statusText = document.getElementById('comments-status');
    const countBadge = document.getElementById('comments-count');
    const loadMoreBtn = document.getElementById('load-more-comments');

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

    // Parse a JSON response safely (a server error page may not be JSON)
    async function readJson(res) {
        try {
            return await res.json();
        } catch (e) {
            return {};
        }
    }

    function makeButton(label, className) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = className;
        btn.textContent = label;
        return btn;
    }

    function updateCount() {
        countBadge.textContent = totalComments > 0 ? `(${totalComments})` : '';
        statusText.hidden = totalComments > 0;
        if (totalComments === 0) {
            statusText.textContent = 'No comments yet. Be the first to share your thoughts!';
        }
    }

    function showFormMessage(text, type) {
        formMessage.textContent = text;
        formMessage.className = `comment-form-message ${type}`;
        formMessage.hidden = false;
    }

    function hideFormMessage() {
        formMessage.hidden = true;
        formMessage.textContent = '';
    }

    function updateCharCount() {
        charCount.textContent = `${contentInput.value.length}/${MAX_LENGTH}`;
    }

    // ── Render Single Comment ───────────────────────────────────────────────
    // User text is always set with textContent (never innerHTML) to prevent XSS.
    function renderComment(comment) {
        const item = document.createElement('li');
        item.className = 'comment-item';
        item.dataset.id = comment._id;

        const header = document.createElement('div');
        header.className = 'comment-header';

        const author = document.createElement('strong');
        author.className = 'comment-author';
        author.textContent = comment.authorName || 'Guest';

        const time = document.createElement('time');
        time.className = 'comment-date';
        time.dateTime = comment.createdAt;
        time.textContent = formatDate(comment.createdAt);

        header.append(author, time);

        const body = document.createElement('p');
        body.className = 'comment-body';
        body.textContent = comment.content;

        item.append(header, body);

        if (canModerate) {
            item.appendChild(renderModerationActions(item, body));
        }

        return item;
    }

    // ── Load Comments (paginated) ───────────────────────────────────────────
    async function loadComments() {
        if (isLoading) return;
        isLoading = true;
        loadMoreBtn.disabled = true;

        try {
            const res = await fetch(`/api/articles/${articleId}/comments?page=${currentPage + 1}&limit=${PAGE_SIZE}`);
            const data = await readJson(res);
            if (!res.ok || !data.success) {
                throw new Error(data.message || `HTTP error! status: ${res.status}`);
            }

            currentPage = data.page;
            totalComments = data.total;

            const fragment = document.createDocumentFragment();
            data.comments.forEach(comment => {
                if (renderedIds.has(comment._id)) return;
                renderedIds.add(comment._id);
                fragment.appendChild(renderComment(comment));
            });
            list.appendChild(fragment);

            loadMoreBtn.hidden = !data.hasMore;
            updateCount();
        } catch (error) {
            console.error('Error loading comments:', error);
            statusText.hidden = false;
            statusText.textContent = 'Could not load comments. Please try refreshing the page.';
        } finally {
            isLoading = false;
            loadMoreBtn.disabled = false;
        }
    }

    // ── Rate Limit Countdown ────────────────────────────────────────────────
    function startCooldown(seconds) {
        clearInterval(cooldownTimer);
        let remaining = seconds;
        submitBtn.disabled = true;

        const tick = () => {
            if (remaining <= 0) {
                clearInterval(cooldownTimer);
                submitBtn.disabled = false;
                submitBtn.textContent = 'Post Comment';
                hideFormMessage();
                return;
            }
            submitBtn.textContent = `Wait ${remaining}s`;
            remaining--;
        };

        tick();
        cooldownTimer = setInterval(tick, 1000);
    }

    // ── Post a New Comment ──────────────────────────────────────────────────
    async function submitComment(e) {
        e.preventDefault();

        const content = contentInput.value.trim();
        if (!content) {
            showFormMessage('Please write a comment before posting.', 'error');
            contentInput.focus();
            return;
        }
        if (content.length > MAX_LENGTH) {
            showFormMessage(`Comment is too long (max ${MAX_LENGTH} characters).`, 'error');
            return;
        }

        submitBtn.disabled = true;
        hideFormMessage();

        try {
            const res = await fetch(`/api/articles/${articleId}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, authorName: authorInput.value.trim() })
            });
            const data = await readJson(res);

            // Blocked by the server's rate limiter (max 3 comments per minute)
            if (res.status === 429) {
                showFormMessage(data.message || 'Too many comments. Please wait a minute.', 'error');
                startCooldown(data.retryAfter || 60);
                return;
            }

            if (!res.ok || !data.success) {
                showFormMessage(data.message || 'Could not post your comment.', 'error');
                submitBtn.disabled = false;
                return;
            }

            // Add only the new comment to the top of the list (no reload of the list)
            renderedIds.add(data.comment._id);
            const item = renderComment(data.comment);
            item.classList.add('comment-new');
            list.prepend(item);

            totalComments++;
            updateCount();

            contentInput.value = '';
            updateCharCount();
            showFormMessage('Your comment was posted.', 'success');
            submitBtn.disabled = false;
        } catch (error) {
            console.error('Error posting comment:', error);
            showFormMessage('Network error - your comment was not posted. Please try again.', 'error');
            submitBtn.disabled = false;
        }
    }

    // ── Editor Moderation (the server checks the editor role as well) ───────
    function renderModerationActions(item, body) {
        const actions = document.createElement('div');
        actions.className = 'comment-actions';

        const editBtn = makeButton('Edit', 'btn-comment-action');
        const deleteBtn = makeButton('Delete', 'btn-comment-action danger');

        editBtn.addEventListener('click', () => startEdit(item, body, actions));
        deleteBtn.addEventListener('click', () => deleteComment(item));

        actions.append(editBtn, deleteBtn);
        return actions;
    }

    function startEdit(item, body, actions) {
        const editor = document.createElement('textarea');
        editor.className = 'comment-edit-input';
        editor.maxLength = MAX_LENGTH;
        editor.value = body.textContent;

        const saveBtn = makeButton('Save', 'btn-comment-action');
        const cancelBtn = makeButton('Cancel', 'btn-comment-action');
        const editActions = document.createElement('div');
        editActions.className = 'comment-actions';
        editActions.append(saveBtn, cancelBtn);

        body.hidden = true;
        actions.hidden = true;
        item.append(editor, editActions);
        editor.focus();

        const closeEditor = () => {
            editor.remove();
            editActions.remove();
            body.hidden = false;
            actions.hidden = false;
        };

        cancelBtn.addEventListener('click', closeEditor);

        saveBtn.addEventListener('click', async () => {
            const content = editor.value.trim();
            if (!content) {
                alert('Comment cannot be empty.');
                return;
            }

            saveBtn.disabled = true;
            try {
                const res = await fetch(`/api/comments/${item.dataset.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content })
                });
                const data = await readJson(res);
                if (!res.ok || !data.success) {
                    throw new Error(data.message || 'Could not update the comment.');
                }
                body.textContent = data.comment.content;
                closeEditor();
            } catch (error) {
                alert(error.message);
                saveBtn.disabled = false;
            }
        });
    }

    async function deleteComment(item) {
        if (!confirm('Delete this comment? This cannot be undone.')) return;

        try {
            const res = await fetch(`/api/comments/${item.dataset.id}`, { method: 'DELETE' });
            const data = await readJson(res);
            if (!res.ok || !data.success) {
                throw new Error(data.message || 'Could not delete the comment.');
            }
            item.remove();
            totalComments--;
            updateCount();
        } catch (error) {
            alert(error.message);
        }
    }

    // ── Initialization ──────────────────────────────────────────────────────
    if (form) {
        form.addEventListener('submit', submitComment);
        contentInput.addEventListener('input', updateCharCount);
    }
    loadMoreBtn.addEventListener('click', loadComments);
    loadComments();

});
