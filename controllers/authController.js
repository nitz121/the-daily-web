const User = require('../models/User');
const logger = require('../utils/logger');

exports.getLogin = (req, res) => {
    if (req.session.user) {
        return res.redirect('/');
    }
    res.render('login', { error: null });
};

exports.postLogin = async (req, res) => {
    const { username, password } = req.body;

    // `express.urlencoded({ extended: true })` accepts nested form fields. Reject
    // objects such as `username[$ne]=...` before they can become MongoDB filters.
    if (typeof username !== 'string' || typeof password !== 'string') {
        logger.warn('Failed login: invalid credentials format', { ip: req.ip });
        return res.status(400).render('login', { error: 'Invalid username or password' });
    }
    
    try {
        const user = await User.findOne({ username });
        if (!user) {
            logger.warn('Failed login: unknown username', { username, ip: req.ip });
            return res.render('login', { error: 'Invalid username or password' });
        }

        const isMatch = await user.matchPassword(password);
        if (!isMatch) {
            logger.warn('Failed login: incorrect password', { username, ip: req.ip });
            return res.render('login', { error: 'Invalid username or password' });
        }

        // Save session
        req.session.user = {
            id: user._id,
            username: user.username,
            role: user.role
        };

        // Redirect based on role
        let target = '/';
        if (user.role === 'reporter') {
            target = '/reporter-dashboard'; // Student 3
        } else if (user.role === 'editor') {
            target = '/editor-dashboard'; // Student 4 will build this
        }

        // Wait until the session is written to MongoDB before redirecting.
        // Otherwise the browser may request the next page before the session
        // exists in the store and the user is sent back to the login page.
        req.session.save((err) => {
            if (err) {
                logger.error('Session save failed after login', { username, error: err.message });
                return res.render('login', { error: 'Server error occurred' });
            }
            logger.info('User logged in', { username: user.username, role: user.role, ip: req.ip });
            res.redirect(target);
        });
    } catch (error) {
        logger.error('Login failed', { username, error: error.message, ip: req.ip });
        res.render('login', { error: 'Server error occurred' });
    }
};

exports.logout = (req, res) => {
    req.session.destroy(err => {
        if (err) console.error(err);
        res.redirect('/');
    });
};
