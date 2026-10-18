/**
 * The Daily Web - Article Editor with Background Autosave (Student 3)
 *
 * The reporter never has to click "Save":
 *  - Debounce: changes are saved 1.5s after the reporter stops typing, and at
 *    least every 10s while typing non-stop (max wait).
 *  - Save queue: only one save request runs at a time. Saves are chained one
 *    after the other, so an older request can never overwrite newer text.
 *  - Dirty check: nothing is sent if the fields didn't change since the last save.
 *  - Local backup: unsaved changes are also kept in localStorage. If the network
 *    or the browser fails, they are restored on the next visit (when newer than
 *    the server copy) and saved.
 *  - Leaving the page: pending changes are sent with fetch({ keepalive: true }),
 *    which lets the request finish even after the tab is closed.
 * The server copy is the source of truth, so work continues on any computer.
 */

document.addEventListener('DOMContentLoaded', () => {

    const form = document.getElementById('articleEditorForm');
    if (!form) return;

    // ── Settings ────────────────────────────────────────────────────────────
    const DEBOUNCE_MS = 1500;
    const MAX_WAIT_MS = 10000;
    const RETRY_DELAYS_MS = [5000, 15000, 30000];
    const MIN_TITLE_LENGTH = 3;
    const MIN_CONTENT_LENGTH = 20;

    // ── DOM Elements ────────────────────────────────────────────────────────
    const titleInput = document.getElementById('articleTitle');
    const categorySelect = document.getElementById('articleCategory');
    const imageInput = document.getElementById('articleImage');
    const contentInput = document.getElementById('articleContent');
    const fieldset = form.querySelector('.editor-fields');
    const saveStatus = document.getElementById('saveStatus');
    const editorMessage = document.getElementById('editorMessage');
    const submitBtn = document.getElementById('submitForApproval');
    const imagePreview = document.getElementById('imagePreview');
    const imageHint = document.getElementById('imageHint');
    const wordCount = document.getElementById('wordCount');
    const heading = document.getElementById('editorHeading');

    // ── State ───────────────────────────────────────────────────────────────
    let articleId = form.dataset.articleId || null; // null until the first save creates the article
    let canSubmit = form.dataset.canSubmit === 'true';
    let autosaveStopped = form.dataset.locked === 'true';
    let lastSavedSnapshot = JSON.stringify(readPayload()); // what the server has now
    let debounceTimer = null;
    let firstUnsavedChangeAt = null;
    let saveQueue = Promise.resolve(true);
    let retryTimer = null;
    let retryCount = 0;
    let lastSaveFailed = false;

    // ── Reading the Form ────────────────────────────────────────────────────
    function isValidImageUrl(value) {
        try {
            const url = new URL(value);
            return url.protocol === 'http:' || url.protocol === 'https:';
        } catch (e) {
            return false;
        }
    }

    // The data sent to the server. An image URL that is still being typed
    // (not a valid link yet) is left out, so the other fields keep saving.
    // Category and image are disabled (and not sent) for a published article -
    // only its title and text go through the update approval.
    function readPayload() {
        const payload = {
            title: titleInput.value,
            content: contentInput.value
        };
        if (!categorySelect.disabled) {
            payload.category = categorySelect.value;
        }
        const imageUrl = imageInput.value.trim();
        if (!imageInput.disabled && (!imageUrl || isValidImageUrl(imageUrl))) {
            payload.imageUrl = imageUrl;
        }
        return payload;
    }

    function hasUnsavedChanges() {
        return JSON.stringify(readPayload()) !== lastSavedSnapshot;
    }

    // ── UI Helpers ──────────────────────────────────────────────────────────
    function setSaveStatus(state, text) {
        saveStatus.dataset.state = state;
        saveStatus.textContent = text;
    }

    function formatTime(date) {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }

    function showMessage(text, type) {
        editorMessage.textContent = text;
        editorMessage.className = `editor-message ${type}`;
        editorMessage.hidden = false;
    }

    function hideMessage() {
        editorMessage.hidden = true;
        editorMessage.textContent = '';
    }

    function updateWordCount() {
        const words = contentInput.value.trim().split(/\s+/).filter(Boolean).length;
        wordCount.textContent = `${words} ${words === 1 ? 'word' : 'words'}`;
    }

    function updateImagePreview() {
        const url = imageInput.value.trim();
        const valid = url && isValidImageUrl(url);
        imageHint.hidden = !url || valid;
        if (valid) {
            imagePreview.querySelector('img').src = url;
            imagePreview.hidden = false;
        } else {
            imagePreview.hidden = true;
        }
    }

    imagePreview.querySelector('img').addEventListener('error', () => {
        imagePreview.hidden = true;
    });

    // ── Local Backup (localStorage) ─────────────────────────────────────────
    function backupKey() {
        return `dailyweb_article_backup_${articleId || 'new'}`;
    }

    function saveBackup() {
        try {
            localStorage.setItem(backupKey(), JSON.stringify({ fields: readPayload(), savedAt: Date.now() }));
        } catch (e) {
            // storage full or disabled - the server save still works
        }
    }

    function clearBackup(key = backupKey()) {
        try {
            localStorage.removeItem(key);
        } catch (e) {
            // ignore
        }
    }

    function readBackup() {
        try {
            const raw = localStorage.getItem(backupKey());
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    // If this device has changes that never reached the server (and they are
    // newer than the server copy), put them back in the form and save them.
    function restoreBackupIfNewer() {
        const backup = readBackup();
        if (!backup || !backup.fields) return;

        const serverSavedAt = form.dataset.updatedAt ? new Date(form.dataset.updatedAt).getTime() : 0;
        if (backup.savedAt <= serverSavedAt || JSON.stringify(backup.fields) === lastSavedSnapshot) {
            clearBackup();
            return;
        }

        titleInput.value = backup.fields.title || '';
        contentInput.value = backup.fields.content || '';
        if (backup.fields.category !== undefined && !categorySelect.disabled) categorySelect.value = backup.fields.category;
        if (backup.fields.imageUrl !== undefined && !imageInput.disabled) imageInput.value = backup.fields.imageUrl;

        showMessage('We restored changes from this device that had not been saved yet.', 'info');
        saveNow();
    }

    // ── Autosave ────────────────────────────────────────────────────────────
    function onFieldChange() {
        updateWordCount();
        updateImagePreview();
        if (autosaveStopped) return;

        if (!hasUnsavedChanges()) {
            if (!lastSaveFailed) setSaveStatus('saved', saveStatus.dataset.savedText || 'All changes saved');
            return;
        }

        saveBackup();
        setSaveStatus('dirty', 'Unsaved changes');

        // Wait for a pause in typing, but never longer than MAX_WAIT_MS since the first unsaved change
        if (!firstUnsavedChangeAt) firstUnsavedChangeAt = Date.now();
        const timeLeft = MAX_WAIT_MS - (Date.now() - firstUnsavedChangeAt);
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(saveNow, Math.max(0, Math.min(DEBOUNCE_MS, timeLeft)));
    }

    // Adds a save to the queue and returns a promise that resolves to true when
    // everything typed until now is stored on the server.
    function saveNow() {
        clearTimeout(debounceTimer);
        clearTimeout(retryTimer);
        saveQueue = saveQueue.then(performSave, performSave);
        return saveQueue;
    }

    async function performSave() {
        if (autosaveStopped) return false;

        const payload = readPayload();
        const snapshot = JSON.stringify(payload);
        if (snapshot === lastSavedSnapshot) return true;

        // Don't create an empty article
        const isEmpty = !payload.title.trim() && !payload.content.trim() && !payload.imageUrl;
        if (!articleId && isEmpty) return true;

        firstUnsavedChangeAt = null;
        setSaveStatus('saving', 'Saving...');

        try {
            const res = await fetch(articleId ? `/api/articles/${articleId}` : '/api/articles', {
                method: articleId ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: snapshot
            });
            const data = await readJson(res);

            if (res.status === 401) {
                stopAutosave('error', 'Session expired - please log in again. Your changes are kept on this device.');
                return false;
            }
            if (res.status === 409 || res.status === 403) {
                stopAutosave('locked', 'Not saved');
                lockEditor(data.message || 'This article can no longer be edited.');
                return false;
            }
            if (res.status === 400) {
                // Invalid input - the reporter needs to fix it; the next change saves again
                lastSaveFailed = true;
                setSaveStatus('error', 'Not saved');
                showMessage(data.message || 'Some fields are invalid.', 'error');
                return false;
            }
            if (!res.ok || !data.success) {
                throw new Error(data.message || `HTTP error! status: ${res.status}`);
            }

            // First save of a new article: we now have an id. Update the address
            // so refreshing the page keeps editing the same article.
            if (!articleId) {
                clearBackup(); // the "new article" backup is not needed anymore
                articleId = data.article._id;
                form.dataset.articleId = articleId;
                window.history.replaceState({}, '', `/reporter/articles/${articleId}/edit`);
                heading.textContent = 'Edit Article';
                document.title = 'Edit Article - The Daily Web';
            }

            lastSavedSnapshot = snapshot;
            lastSaveFailed = false;
            retryCount = 0;
            canSubmit = true; // there is now a saved change that can be submitted
            if (editorMessage.classList.contains('error')) hideMessage();

            const savedText = `All changes saved at ${formatTime(new Date(data.savedAt || Date.now()))}`;
            saveStatus.dataset.savedText = savedText;

            if (hasUnsavedChanges()) {
                // The reporter kept typing during the request - another save is already scheduled
                saveBackup();
                setSaveStatus('dirty', 'Unsaved changes');
            } else {
                clearBackup();
                setSaveStatus('saved', savedText);
            }
            return true;
        } catch (error) {
            // Network / server problem: the changes stay in localStorage and we retry later
            console.error('Autosave failed:', error);
            lastSaveFailed = true;
            setSaveStatus('error', 'Offline - changes are kept on this device. Retrying...');
            scheduleRetry();
            return false;
        }
    }

    function scheduleRetry() {
        clearTimeout(retryTimer);
        const delay = RETRY_DELAYS_MS[Math.min(retryCount, RETRY_DELAYS_MS.length - 1)];
        retryCount++;
        retryTimer = setTimeout(saveNow, delay);
    }

    function stopAutosave(state, text) {
        autosaveStopped = true;
        clearTimeout(debounceTimer);
        clearTimeout(retryTimer);
        setSaveStatus(state, text);
    }

    function lockEditor(message) {
        fieldset.disabled = true;
        if (submitBtn) submitBtn.hidden = true;
        showMessage(message, 'error');
    }

    async function readJson(res) {
        try {
            return await res.json();
        } catch (e) {
            return {};
        }
    }

    // ── Leaving the Page ────────────────────────────────────────────────────
    // keepalive lets the browser finish the request after the tab is closed.
    function flushOnLeave() {
        if (autosaveStopped || !articleId || !hasUnsavedChanges()) return;
        saveBackup();
        fetch(`/api/articles/${articleId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(readPayload()),
            keepalive: true
        }).catch(() => { /* the local backup will be restored next time */ });
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            flushOnLeave();
        } else if (!autosaveStopped && hasUnsavedChanges()) {
            // Back on the tab: save once more through the queue, so the newest text
            // is the last one written even if the keepalive request raced another save
            saveNow();
        }
    });
    window.addEventListener('pagehide', flushOnLeave);

    // Warn only if the last save failed (offline) - otherwise flushOnLeave takes care of it
    window.addEventListener('beforeunload', (e) => {
        if (!autosaveStopped && lastSaveFailed && hasUnsavedChanges()) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    window.addEventListener('online', () => {
        if (lastSaveFailed) saveNow();
    });

    // ── Submit for Approval ─────────────────────────────────────────────────
    function validateForSubmit() {
        if (titleInput.value.trim().length < MIN_TITLE_LENGTH) {
            return `Please write a title (at least ${MIN_TITLE_LENGTH} characters).`;
        }
        if (contentInput.value.trim().length < MIN_CONTENT_LENGTH) {
            return `The article text is too short (at least ${MIN_CONTENT_LENGTH} characters).`;
        }
        if (!imageInput.disabled && imageInput.value.trim() && !isValidImageUrl(imageInput.value.trim())) {
            return 'Please fix the image URL (it must start with http:// or https://) or leave it empty.';
        }
        return null;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!submitBtn || autosaveStopped) return;

        const problem = validateForSubmit();
        if (problem) {
            showMessage(problem, 'error');
            return;
        }

        submitBtn.disabled = true;
        hideMessage();

        // Make sure the latest text is on the server before submitting it
        const saved = await saveNow();
        if (!saved || hasUnsavedChanges()) {
            showMessage('Your latest changes could not be saved yet, so the article was not submitted. Please try again in a moment.', 'error');
            submitBtn.disabled = false;
            return;
        }

        if (!canSubmit) {
            showMessage('There are no new changes to submit. Edit the article first.', 'error');
            submitBtn.disabled = false;
            return;
        }

        try {
            // Shared status endpoint - the Article state machine checks that this
            // reporter may move the article (or its update) to "Pending approval"
            const res = await fetch(`/api/articles/${articleId}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'pending' })
            });
            const data = await readJson(res);
            if (!res.ok || !data.success) {
                throw new Error(data.message || 'Could not submit the article.');
            }
            clearBackup();
            autosaveStopped = true; // the article is now locked for review
            window.location.href = '/reporter-dashboard?submitted=1';
        } catch (error) {
            showMessage(error.message, 'error');
            submitBtn.disabled = false;
        }
    });

    // ── Initialization ──────────────────────────────────────────────────────
    updateWordCount();
    updateImagePreview();

    if (autosaveStopped) {
        setSaveStatus('locked', 'Read only - awaiting editor approval');
        clearBackup();
        return;
    }

    [titleInput, imageInput, contentInput].forEach((el) => el.addEventListener('input', onFieldChange));
    categorySelect.addEventListener('change', onFieldChange);

    setSaveStatus('idle', articleId ? 'All changes saved' : 'Start writing - your work is saved automatically');
    restoreBackupIfNewer();

});
