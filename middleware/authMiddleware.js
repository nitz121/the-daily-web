exports.ensureAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    }
    res.redirect('/auth/login');
};

exports.ensureReporter = (req, res, next) => {
    if (req.session.user && (req.session.user.role === 'reporter' || req.session.user.role === 'editor')) {
        return next();
    }
    res.status(403).send('Access Denied: Reporters only');
};

exports.ensureEditor = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'editor') {
        return next();
    }
    res.status(403).send('Access Denied: Editors only');
};

// JSON versions for AJAX endpoints (Student 4) - an API call gets a JSON error instead of a redirect / HTML
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
