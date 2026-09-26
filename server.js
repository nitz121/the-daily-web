require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo').default || require('connect-mongo');
const path = require('path');
const connectDB = require('./config/db');

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

const Article = require('./models/Article');
app.get('/', async (req, res) => {
    try {
        const articles = await Article.find();
        let html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>The Daily Web - Temp Home</title>
            <link rel="stylesheet" href="/css/style.css">
        </head>
        <body>
            <header class="site-header">
                <nav class="site-nav">
                    <a href="/" class="site-logo">The Daily Web</a>
                    <div class="nav-links">
                        <a href="/auth/login" style="color: white; font-weight: bold;">Staff Login</a>
                    </div>
                </nav>
            </header>
            <main class="container" style="margin-top: 40px; background: white; padding: 40px; border-radius: 8px;">
                <h1 style="font-family: var(--font-serif); color: var(--primary-color);">Welcome to The Daily Web</h1>
                <p style="color: var(--light-text); margin-bottom: 20px;">(This temporary homepage will be replaced by Student 2's interactive feed)</p>
                
                <h3>Sample Articles for Testing (Student 1):</h3>
                <ul style="margin-top: 15px; line-height: 2;">
        `;
        
        articles.forEach(a => {
            html += `<li><a href="/article/${a._id}" style="color: var(--accent-color); text-decoration: none;"><strong>${a.title}</strong></a> <span style="color: #888; font-size: 0.9em;">[Status: ${a.status}]</span></li>`;
        });
        
        html += `
                </ul>
            </main>
        </body>
        </html>`;
        res.send(html);
    } catch (err) {
        res.send('Error loading home page');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
