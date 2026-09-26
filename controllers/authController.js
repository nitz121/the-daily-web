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

        // Save session
        req.session.user = {
            id: user._id,
            username: user.username,
            role: user.role
        };

        // Redirect based on role
        if (user.role === 'reporter') {
            res.redirect('/reporter-dashboard'); // Student 3 will build this
        } else if (user.role === 'editor') {
            res.redirect('/editor-dashboard'); // Student 4 will build this
        } else {
            res.redirect('/');
        }
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
