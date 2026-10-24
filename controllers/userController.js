const mongoose = require('mongoose');
const User = require('../models/User');
const Article = require('../models/Article');
const escapeRegex = require('../utils/escapeRegex');
const logger = require('../utils/logger');

const ROLES = ['guest', 'reporter', 'editor'];
const USERNAME_MAX = 50;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

function publicUser(user) {
    return {
        _id: user._id,
        username: user.username,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
    };
}

function validUsername(value) {
    return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= USERNAME_MAX;
}

function validPassword(value) {
    return typeof value === 'string' && value.length >= PASSWORD_MIN && value.length <= PASSWORD_MAX;
}

function validRole(value) {
    return ROLES.includes(value);
}

function invalidId(res) {
    return res.status(404).json({ success: false, message: 'User not found' });
}

// GET /api/users?search=
exports.listUsers = async (req, res) => {
    try {
        const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, USERNAME_MAX) : '';
        const filter = search ? { username: new RegExp(escapeRegex(search), 'i') } : {};
        const users = await User.find(filter)
            .select('username role createdAt updatedAt')
            .sort({ username: 1 })
            .lean();

        res.json({ success: true, users: users.map(publicUser) });
    } catch (err) {
        logger.error('Users list failed', { error: err.message });
        res.status(500).json({ success: false, message: 'Failed to load users' });
    }
};

// POST /api/users
exports.createUser = async (req, res) => {
    try {
        const { username, password, role } = req.body || {};
        if (!validUsername(username) || !validPassword(password) || !validRole(role)) {
            return res.status(400).json({
                success: false,
                message: `Provide a username (up to ${USERNAME_MAX} characters), a password (${PASSWORD_MIN}-${PASSWORD_MAX} characters), and a valid role.`
            });
        }

        const user = new User({ username: username.trim(), password, role });
        await user.save(); // The User pre-save hook hashes the password.

        logger.info('User created', { userId: String(user._id), username: user.username, role, editor: req.session.user.username });
        res.status(201).json({ success: true, user: publicUser(user) });
    } catch (err) {
        if (err && err.code === 11000) {
            return res.status(409).json({ success: false, message: 'That username is already in use' });
        }
        if (err.name === 'ValidationError') {
            return res.status(400).json({ success: false, message: err.message });
        }
        logger.error('User creation failed', { error: err.message });
        res.status(500).json({ success: false, message: 'Failed to create user' });
    }
};

// PUT /api/users/:id
exports.updateUser = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return invalidId(res);

        const { username, password, role } = req.body || {};
        if (username === undefined && password === undefined && role === undefined) {
            return res.status(400).json({ success: false, message: 'Nothing to update' });
        }
        if (username !== undefined && !validUsername(username)) {
            return res.status(400).json({ success: false, message: `Username must be text up to ${USERNAME_MAX} characters` });
        }
        if (password !== undefined && !validPassword(password)) {
            return res.status(400).json({ success: false, message: `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters` });
        }
        if (role !== undefined && !validRole(role)) {
            return res.status(400).json({ success: false, message: 'Invalid role' });
        }

        const user = await User.findById(req.params.id);
        if (!user) return invalidId(res);

        if (username !== undefined) user.username = username.trim();
        if (role !== undefined) user.role = role;
        if (password !== undefined) user.password = password;
        // Do not use findByIdAndUpdate here: save() runs the password hashing hook.
        await user.save();

        logger.info('User updated', { userId: String(user._id), username: user.username, editor: req.session.user.username });
        res.json({ success: true, user: publicUser(user) });
    } catch (err) {
        if (err && err.code === 11000) {
            return res.status(409).json({ success: false, message: 'That username is already in use' });
        }
        if (err.name === 'ValidationError') {
            return res.status(400).json({ success: false, message: err.message });
        }
        logger.error('User update failed', { userId: req.params.id, error: err.message });
        res.status(500).json({ success: false, message: 'Failed to update user' });
    }
};

// DELETE /api/users/:id
exports.deleteUser = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return invalidId(res);
        if (String(req.params.id) === String(req.session.user.id)) {
            return res.status(400).json({ success: false, message: 'You cannot delete your own account' });
        }

        const user = await User.findById(req.params.id).select('username');
        if (!user) return invalidId(res);

        // Preserve article authorship and avoid dangling `author` references.
        const authoredArticles = await Article.exists({ author: user._id });
        if (authoredArticles) {
            return res.status(409).json({ success: false, message: 'Cannot delete a user who still owns articles' });
        }

        await user.deleteOne();
        logger.info('User deleted', { userId: String(user._id), username: user.username, editor: req.session.user.username });
        res.json({ success: true, message: 'User deleted' });
    } catch (err) {
        logger.error('User deletion failed', { userId: req.params.id, error: err.message });
        res.status(500).json({ success: false, message: 'Failed to delete user' });
    }
};
