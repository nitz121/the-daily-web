/**
 * The Daily Web - User Administration in the Editor Dashboard (Student 4)
 * UI for the editor-only Users API (Student 1): list / search, create,
 * change username, role or password, and delete users.
 * Every rule is enforced by the server as well (role check, validation,
 * no self-delete, no deleting a user who still owns articles).
 */

document.addEventListener('DOMContentLoaded', () => {

    const panel = document.getElementById('usersPanel');
    if (!panel) return;

    // ── Constants ───────────────────────────────────────────────────────────
    const ROLE_LABELS = { reporter: 'Reporter', editor: 'Editor', guest: 'Guest' };
    const USERNAME_MAX = 50;
    const PASSWORD_MIN = 8;
    const PASSWORD_MAX = 128;
    const SEARCH_DEBOUNCE_MS = 350;
    const currentUserId = panel.dataset.currentUserId;

    // ── State ───────────────────────────────────────────────────────────────
    let currentSearch = '';
    let listRequestId = 0; // responses of outdated searches are ignored
    const users = new Map(); // user id -> user as last saved on the server

    // ── DOM Elements ────────────────────────────────────────────────────────
    const usersMessage = document.getElementById('usersMessage');
    const usersSummary = document.getElementById('usersSummary');
    const newUserForm = document.getElementById('newUserForm');
    const newUsername = document.getElementById('newUsername');
    const newPassword = document.getElementById('newPassword');
    const newRole = document.getElementById('newRole');
    const createUserBtn = document.getElementById('createUserBtn');
    const userSearch = document.getElementById('userSearch');
    const usersTableBody = document.getElementById('usersTableBody');
    const usersLoading = document.getElementById('usersLoading');
    const usersEmpty = document.getElementById('usersEmpty');

    // ── Helpers ─────────────────────────────────────────────────────────────
    function escapeHtml(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatDate(value) {
        if (!value) return '';
        return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    let messageTimer = null;
    function showMessage(text, type = 'success') {
        usersMessage.textContent = text;
        usersMessage.className = `dashboard-message users-message is-${type}`;
        usersMessage.hidden = false;
        clearTimeout(messageTimer);
        messageTimer = setTimeout(() => { usersMessage.hidden = true; }, 6000);
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

    // Same limits as the server - returns an error message or null
    function validateUsername(value) {
        const name = value.trim();
        if (!name) return 'Please enter a username.';
        if (name.length > USERNAME_MAX) return `The username is limited to ${USERNAME_MAX} characters.`;
        return null;
    }

    function validatePassword(value) {
        if (value.length < PASSWORD_MIN || value.length > PASSWORD_MAX) {
            return `The password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters.`;
        }
        return null;
    }

    function roleOptions(selected) {
        return Object.keys(ROLE_LABELS)
            .map(role => `<option value="${role}" ${role === selected ? 'selected' : ''}>${ROLE_LABELS[role]}</option>`)
            .join('');
    }

    // ── Users Table ─────────────────────────────────────────────────────────
    // Every row is an inline form: username, role and an optional new password.
    // "Save" is enabled only when something changed.
    function renderUserRow(user) {
        users.set(user._id, user);
        const isSelf = String(user._id) === String(currentUserId);

        const row = document.createElement('tr');
        row.dataset.id = user._id;
        row.innerHTML = `
            <td data-label="Username">
                <input type="text" class="form-input user-field" data-field="username" maxlength="${USERNAME_MAX}"
                       value="${escapeHtml(user.username)}" aria-label="Username">
                ${isSelf ? '<span class="flag">You</span>' : ''}
            </td>
            <td data-label="Role">
                <select class="form-input user-field" data-field="role" aria-label="Role"
                        ${isSelf ? 'disabled title="You cannot change your own role"' : ''}>
                    ${roleOptions(user.role)}
                </select>
            </td>
            <td data-label="New password">
                <input type="password" class="form-input user-field" data-field="password" maxlength="${PASSWORD_MAX}"
                       placeholder="Leave empty to keep" autocomplete="new-password" aria-label="New password">
            </td>
            <td data-label="Created"><time datetime="${escapeHtml(user.createdAt)}">${formatDate(user.createdAt)}</time></td>
            <td class="row-actions">
                <button type="button" class="btn-table btn-table-primary" data-action="save" disabled>Save</button>
                ${isSelf ? '' : '<button type="button" class="btn-table btn-table-danger" data-action="delete">Delete</button>'}
            </td>
        `;
        return row;
    }

    // The fields of a row that differ from the saved user
    function readChanges(row) {
        const saved = users.get(row.dataset.id);
        const username = row.querySelector('[data-field="username"]').value;
        const role = row.querySelector('[data-field="role"]').value;
        const password = row.querySelector('[data-field="password"]').value;

        const changes = {};
        if (username.trim() !== saved.username) changes.username = username;
        if (role !== saved.role) changes.role = role;
        if (password) changes.password = password;
        return changes;
    }

    function updateSummary() {
        const count = usersTableBody.children.length;
        usersSummary.textContent = `${count} user${count === 1 ? '' : 's'}`;
        usersEmpty.hidden = count > 0;
    }

    async function loadUsers() {
        const requestId = ++listRequestId;
        usersLoading.hidden = false;
        usersEmpty.hidden = true;

        try {
            const params = new URLSearchParams();
            if (currentSearch) params.set('search', currentSearch);

            const data = await apiRequest('/api/users?' + params.toString());
            if (requestId !== listRequestId) return; // a newer search replaced this one

            users.clear();
            usersTableBody.replaceChildren(...data.users.map(renderUserRow));
            updateSummary();
        } catch (err) {
            if (requestId !== listRequestId) return;
            console.error('Failed to load users:', err);
            showMessage(err.message, 'error');
        } finally {
            if (requestId === listRequestId) usersLoading.hidden = true;
        }
    }

    // ── Create ──────────────────────────────────────────────────────────────
    async function createUser(event) {
        event.preventDefault();

        const problem = validateUsername(newUsername.value) || validatePassword(newPassword.value);
        if (problem) {
            showMessage(problem, 'error');
            return;
        }

        createUserBtn.disabled = true;
        try {
            const data = await apiRequest('/api/users', {
                method: 'POST',
                body: { username: newUsername.value.trim(), password: newPassword.value, role: newRole.value }
            });
            newUserForm.reset();
            showMessage(`User "${data.user.username}" was created.`);
            loadUsers(); // keeps the list sorted and filtered by the current search
        } catch (err) {
            showMessage(err.message, 'error'); // e.g. 409 "That username is already in use"
        } finally {
            createUserBtn.disabled = false;
        }
    }

    // ── Update ──────────────────────────────────────────────────────────────
    async function saveUser(row, button) {
        const changes = readChanges(row);
        if (!Object.keys(changes).length) return;

        const problem = (changes.username !== undefined && validateUsername(changes.username))
            || (changes.password !== undefined && validatePassword(changes.password));
        if (problem) {
            showMessage(problem, 'error');
            return;
        }

        button.disabled = true;
        try {
            const data = await apiRequest(`/api/users/${row.dataset.id}`, { method: 'PUT', body: changes });
            row.replaceWith(renderUserRow(data.user));
            const what = changes.password ? 'details and password were' : 'details were';
            showMessage(`${data.user.username}'s ${what} updated.`);
        } catch (err) {
            showMessage(err.message, 'error');
            button.disabled = false;
        }
    }

    // ── Delete ──────────────────────────────────────────────────────────────
    async function deleteUser(row, button) {
        const user = users.get(row.dataset.id);
        if (!window.confirm(`Delete the user "${user.username}"? This cannot be undone.`)) return;

        button.disabled = true;
        try {
            await apiRequest(`/api/users/${user._id}`, { method: 'DELETE' });
            users.delete(user._id);
            row.remove();
            updateSummary();
            showMessage(`User "${user.username}" was deleted.`);
        } catch (err) {
            // e.g. 409 "Cannot delete a user who still owns articles"
            showMessage(err.message, 'error');
            button.disabled = false;
        }
    }

    // ── Event Listeners ─────────────────────────────────────────────────────
    newUserForm.addEventListener('submit', createUser);

    let searchTimer = null;
    userSearch.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            const value = userSearch.value.trim();
            if (value === currentSearch) return;
            currentSearch = value;
            loadUsers();
        }, SEARCH_DEBOUNCE_MS);
    });

    // One listener for all rows (rows are re-rendered dynamically)
    usersTableBody.addEventListener('input', (event) => {
        const row = event.target.closest('tr');
        if (!row || !event.target.classList.contains('user-field')) return;
        row.querySelector('[data-action="save"]').disabled = !Object.keys(readChanges(row)).length;
    });

    usersTableBody.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const row = button.closest('tr');

        if (button.dataset.action === 'save') saveUser(row, button);
        else if (button.dataset.action === 'delete') deleteUser(row, button);
    });

    // Enter in a row's field saves that row
    usersTableBody.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || !event.target.classList.contains('user-field')) return;
        event.preventDefault();
        const row = event.target.closest('tr');
        const saveBtn = row.querySelector('[data-action="save"]');
        if (!saveBtn.disabled) saveUser(row, saveBtn);
    });

    // ── Init ────────────────────────────────────────────────────────────────
    loadUsers();
});
