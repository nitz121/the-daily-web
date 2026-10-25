exports.ensureAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    }
    res.redirect('/auth/login');
};

exports.ensureEditor = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'editor') {
        return next();
    }
    res.status(403).send('Access Denied: Editors only');
};

// JSON versions for AJAX endpoints: an API call gets a JSON error instead of a redirect / HTML page
exports.ensureEditorApi = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Please log in first' });
    }
    if (req.session.user.role !== 'editor') {
        return res.status(403).json({ success: false, message: 'Access denied: editors only' });
    }
    next();
};

exports.ensureStaffApi = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Please log in first' });
    }
    if (req.session.user.role !== 'reporter' && req.session.user.role !== 'editor') {
        return res.status(403).json({ success: false, message: 'Access denied: staff only' });
    }
    next();
};

// Allows only the given roles, e.g. requireRole('reporter').
// API calls (/api/...) get a JSON 401/403; pages get a redirect to login or a 403 page.
// The role comes from the server-side session, so it can't be changed in the browser.
exports.requireRole = (...roles) => (req, res, next) => {
    const user = req.session.user;
    const isApi = req.originalUrl.startsWith('/api/');

    if (!user) {
        if (isApi) {
            return res.status(401).json({ success: false, message: 'Please log in to perform this action' });
        }
        return res.redirect('/auth/login');
    }

    if (!roles.includes(user.role)) {
        if (isApi) {
            return res.status(403).json({ success: false, message: 'You do not have permission to perform this action' });
        }
        return res.status(403).send('Access Denied');
    }

    next();
};
