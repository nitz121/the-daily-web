require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo').default || require('connect-mongo');
const path = require('path');
const connectDB = require('./config/db');
const logger = require('./utils/logger');

// Connect to MongoDB
connectDB();

const app = express();

// View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session Configuration (Survives Server Restart)
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        collectionName: 'sessions'
    }),
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 // 1 day
    }
}));

// Global variables for templates
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// Ignore favicon requests to prevent 404 errors in console
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/article', require('./routes/articles'));
app.use('/', require('./routes/feed'));
app.use('/', require('./routes/editor'));
app.use('/api/analytics', require('./routes/analytics'));

// 404 - no route matched
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ success: false, message: 'Endpoint not found' });
    }
    res.status(404).send('Page not found');
});

// Central error handler - logs the error and answers instead of crashing (e.g. malformed JSON body)
app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    logger.error('Request failed', {
        method: req.method,
        url: req.originalUrl,
        status,
        error: err.message,
        stack: status >= 500 ? err.stack : undefined
    });

    if (res.headersSent) return next(err);

    let message = status >= 500 ? 'Internal server error' : err.message;
    if (err.type === 'entity.parse.failed') message = 'Invalid JSON in request body';

    if (req.path.startsWith('/api/')) {
        return res.status(status).json({ success: false, message });
    }
    res.status(status).send(message);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
