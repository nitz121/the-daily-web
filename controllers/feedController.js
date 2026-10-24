const Article = require('../models/Article');
const mongoose = require('mongoose');
const escapeRegex = require('../utils/escapeRegex');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50; // one request can't ask for the whole collection

// In-memory cache for weather data (15 minutes cache to meet the project requirement)
let weatherCache = {
    data: null,
    lastFetched: 0
};
const WEATHER_CACHE_DURATION = 15 * 60 * 1000; // 15 minutes in milliseconds

/**
 * Helper to strip HTML tags for card excerpt/summary
 */
function stripHtml(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>?/gm, '').trim();
}

/**
 * Render the main homepage (Student 2)
 */
exports.renderHomePage = async (req, res) => {
    try {
        // Fetch distinct categories for the initial filter pills
        const categories = await Article.distinct('category', { status: 'published' });

        // Get top 5 trending articles for sidebar
        const trendingArticles = await Article.find({ status: 'published' })
            .sort({ viewsCount: -1 })
            .limit(5)
            .select('title category viewsCount createdAt');

        res.render('index', {
            categories: categories || [],
            trendingArticles: trendingArticles || []
        });
    } catch (err) {
        console.error('Error rendering home page:', err);
        res.status(500).send('Server error while loading home page');
    }
};

/**
 * API: Get published articles with pagination, search, category filter, viewed filter, and sorting
 * GET /api/articles
 */
exports.getArticles = async (req, res) => {
    try {
        // page >= 1 (a negative page made the skip negative and crashed the query);
        // an invalid limit falls back to the default, a valid one is capped at MAX_PAGE_SIZE
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const requestedLimit = parseInt(req.query.limit);
        const limit = requestedLimit > 0 ? Math.min(requestedLimit, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
        const category = req.query.category || 'all';
        // typeof check: "?search=a&search=b" arrives as an array
        const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
        const sort = req.query.sort || 'date_desc';
        const viewed = req.query.viewed || 'all'; // 'all', 'viewed', 'unviewed'

        // Only published articles are shown in public feed
        const filter = { status: 'published' };

        // 1. Category Filter
        if (category && category !== 'all') {
            filter.category = category;
        }

        // 2. Search Filter (searches title or content)
        // The text is escaped, so characters like "(" or "+" are searched literally
        // (unescaped, "(" crashed the query and "a+b" matched "ab", "aab"...)
        if (search) {
            const pattern = escapeRegex(search);
            filter.$or = [
                { title: { $regex: pattern, $options: 'i' } },
                { content: { $regex: pattern, $options: 'i' } }
            ];
        }

        // 3. Viewed / Unviewed Filter
        // Combine client-sent viewed IDs (from localStorage) and session viewed IDs
        let clientViewedIds = [];
        if (req.query.viewedIds) {
            try {
                if (Array.isArray(req.query.viewedIds)) {
                    clientViewedIds = req.query.viewedIds;
                } else {
                    clientViewedIds = req.query.viewedIds.split(',').map(id => id.trim());
                }
            } catch (e) {
                clientViewedIds = [];
            }
        }

        const sessionViewedIds = req.session.viewedArticles || [];
        const combinedViewed = Array.from(new Set([...clientViewedIds, ...sessionViewedIds]))
            .filter(id => mongoose.Types.ObjectId.isValid(id));

        if (viewed === 'viewed') {
            filter._id = { $in: combinedViewed };
        } else if (viewed === 'unviewed') {
            filter._id = { $nin: combinedViewed };
        }

        // 4. Sorting
        let sortOption = { createdAt: -1 }; // default: newest
        if (sort === 'date_asc') {
            sortOption = { createdAt: 1 };
        } else if (sort === 'popularity' || sort === 'views_desc') {
            sortOption = { viewsCount: -1, createdAt: -1 };
        }

        // 5. Query execution with pagination
        const skip = (page - 1) * limit;
        const total = await Article.countDocuments(filter);
        const articles = await Article.find(filter)
            .sort(sortOption)
            .skip(skip)
            .limit(limit)
            .populate('author', 'username')
            .lean();

        // Format articles for client
        const formattedArticles = articles.map(art => {
            const cleanText = stripHtml(art.content);
            const summary = cleanText.length > 140 ? cleanText.substring(0, 140) + '...' : cleanText;

            return {
                _id: art._id,
                title: art.title,
                summary: summary,
                category: art.category,
                author: art.author ? art.author.username : 'Editorial Staff',
                imageUrl: art.imageUrl || '',
                viewsCount: art.viewsCount || 0,
                createdAt: art.createdAt
            };
        });

        res.json({
            success: true,
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            hasMore: skip + articles.length < total,
            articles: formattedArticles
        });
    } catch (err) {
        console.error('Error in /api/articles:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch articles' });
    }
};

/**
 * API: Get list of distinct published categories
 * GET /api/categories
 */
exports.getCategories = async (req, res) => {
    try {
        const categories = await Article.distinct('category', { status: 'published' });
        res.json({ success: true, categories });
    } catch (err) {
        console.error('Error fetching categories:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch categories' });
    }
};

/**
 * API: Weather widget proxy with 15-minute server-side caching
 * GET /api/weather
 * Exclusively uses OpenWeatherMap API (OPENWEATHER_API_KEY from .env)
 */
exports.getWeather = async (req, res) => {
    try {
        const now = Date.now();

        // Check if cache is still fresh (< 15 minutes)
        if (weatherCache.data && (now - weatherCache.lastFetched) < WEATHER_CACHE_DURATION) {
            return res.json({
                success: true,
                cached: true,
                data: weatherCache.data
            });
        }

        const apiKey = process.env.OPENWEATHER_API_KEY;
        if (!apiKey) {
            return res.status(500).json({
                success: false,
                message: 'OPENWEATHER_API_KEY is not defined in .env'
            });
        }

        const owmUrl = `https://api.openweathermap.org/data/2.5/weather?q=Tel%20Aviv&units=metric&appid=${apiKey}`;
        const owmRes = await fetch(owmUrl);
        const owmData = await owmRes.json();

        if (!owmRes.ok) {
            return res.status(owmRes.status).json({
                success: false,
                message: owmData.message || 'OpenWeatherMap API request failed',
                cod: owmData.cod
            });
        }

        let condition = owmData.weather && owmData.weather[0] ? owmData.weather[0].main : 'Clear';
        let icon = '☀️';
        if (condition.includes('Cloud')) icon = '⛅';
        else if (condition.includes('Rain') || condition.includes('Drizzle')) icon = '🌧️';
        else if (condition.includes('Thunder')) icon = '⛈️';
        else if (condition.includes('Snow')) icon = '❄️';
        else if (condition.includes('Mist') || condition.includes('Fog')) icon = '🌫️';

        const weatherResult = {
            city: owmData.name || 'Tel Aviv',
            temperature: Math.round(owmData.main.temp),
            windSpeed: Math.round((owmData.wind.speed || 0) * 3.6), // convert m/s to km/h
            condition: condition,
            icon: icon,
            source: 'OpenWeatherMap',
            updatedAt: new Date().toISOString()
        };

        // Save to 15-minute in-memory cache
        weatherCache = {
            data: weatherResult,
            lastFetched: now
        };

        res.json({
            success: true,
            cached: false,
            data: weatherResult
        });
    } catch (err) {
        console.error('OpenWeatherMap error:', err.message);
        res.status(500).json({ success: false, message: 'Weather service request failed' });
    }
};
