const User = require('../models/User');

exports.getLogin = (req, res) => {
    if (req.session.user) {
        return res.redirect('/');
    }
    res.render('login', { error: null });
};

exports.postLogin = async (req, res) => {
    const { username, password } = req.body;
    
    try {
        const user = await User.findOne({ username });
        if (!user) {
            return res.render('login', { error: 'Invalid username or password' });
        }

        const isMatch = await user.matchPassword(password);
        if (!isMatch) {
            return res.render('login', { error: 'Invalid username or password' });
        }

        // Keep the user in the server-side session (the browser only holds the session id)
        req.session.user = {
            id: user._id,
            username: user.username,
            role: user.role
        };

        // Redirect based on role
        let target = '/';
        if (user.role === 'reporter') {
            target = '/reporter-dashboard';
        } else if (user.role === 'editor') {
            target = '/editor-dashboard';
        }

        // Save the session to MongoDB before redirecting - otherwise the next request may arrive
        // before the session exists and the user is sent back to the login page.
        req.session.save((err) => {
            if (err) {
                console.error(err);
                return res.render('login', { error: 'Server error occurred' });
            }
            res.redirect(target);
        });
    } catch (error) {
        console.error(error);
        res.render('login', { error: 'Server error occurred' });
    }
};

exports.logout = (req, res) => {
    req.session.destroy(err => {
        if (err) console.error(err);
        res.redirect('/');
    });
};
