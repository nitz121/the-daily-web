const Article = require('../models/Article');
const mongoose = require('mongoose');

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
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const category = req.query.category || 'all';
        const search = req.query.search ? req.query.search.trim() : '';
        const sort = req.query.sort || 'date_desc';
        const viewed = req.query.viewed || 'all'; // 'all', 'viewed', 'unviewed'

        // Only published articles are shown in public feed
        const filter = { status: 'published' };

        // 1. Category Filter
        if (category && category !== 'all') {
            filter.category = category;
        }

        // 2. Search Filter (searches title or content)
        if (search) {
            filter.$or = [
                { title: { $regex: search, $options: 'i' } },
                { content: { $regex: search, $options: 'i' } }
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
 * Uses Open-Meteo API (free, no credit card, no API key required)
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

        // Coordinates for Tel Aviv (32.0853, 34.7818)
        const url = 'https://api.open-meteo.com/v1/forecast?latitude=32.0853&longitude=34.7818&current_weather=true';
        
        // Native fetch in Node 18+
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Weather service returned HTTP ${response.status}`);
        }

        const data = await response.json();
        const current = data.current_weather || {};

        // Map weather code to descriptive text and icon
        const weatherCode = current.weathercode;
        let condition = 'Clear';
        let icon = '☀️';

        if ([1, 2, 3].includes(weatherCode)) {
            condition = 'Partly Cloudy';
            icon = '⛅';
        } else if ([45, 48].includes(weatherCode)) {
            condition = 'Foggy';
            icon = '🌫️';
        } else if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(weatherCode)) {
            condition = 'Rainy';
            icon = '🌧️';
        } else if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) {
            condition = 'Snowy';
            icon = '❄️';
        } else if ([95, 96, 99].includes(weatherCode)) {
            condition = 'Thunderstorm';
            icon = '⛈️';
        }

        const weatherResult = {
            city: 'Tel Aviv',
            temperature: Math.round(current.temperature),
            windSpeed: current.windspeed,
            condition,
            icon,
            updatedAt: new Date().toISOString()
        };

        // Save to cache
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
        console.error('Weather API fetch error:', err.message);

        // If fetch fails but we have previous cached data, return it
        if (weatherCache.data) {
            return res.json({
                success: true,
                cached: true,
                fallback: true,
                data: weatherCache.data
            });
        }

        // Graceful fallback for offline development/presentation
        const fallbackData = {
            city: 'Tel Aviv',
            temperature: 24,
            windSpeed: 14,
            condition: 'Clear Sky',
            icon: '☀️',
            updatedAt: new Date().toISOString()
        };

        res.json({
            success: true,
            cached: false,
            fallback: true,
            data: fallbackData
        });
    }
};
