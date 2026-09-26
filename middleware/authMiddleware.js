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
