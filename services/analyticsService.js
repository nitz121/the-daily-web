const Article = require('../models/Article');
const ViewStat = require('../models/ViewStat');

/**
 * Impact Analytics service (Student 4)
 * Collects article views into hourly buckets and turns them into chart-ready data:
 * a continuous time axis, views per bucket, editor approval markers and before/after impact.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const TIMEZONE = 'Asia/Jerusalem';
const IMPACT_WINDOW_HOURS = 24;

const RANGES = { '24h': DAY_MS, '7d': 7 * DAY_MS, '30d': 30 * DAY_MS, all: null };
const RANGE_KEYS = Object.keys(RANGES);
const MAX_HOURLY_SPAN = 7 * DAY_MS;  // longer windows are grouped by day
const MAX_CUSTOM_SPAN = 31 * DAY_MS; // limit for a custom from/to window

// 'YYYY-MM-DD' of a date in the newsroom time zone - the key of a daily bucket
const dayKeyFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
});

function badRequest(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

function round1(value) {
    return Math.round(value * 10) / 10;
}

// ── Collect ─────────────────────────────────────────────────────────────────
// Two independent atomic updates - no document is read first, so concurrent views never
// overwrite each other. A concurrent upsert that hits the unique index is retried by MongoDB.
async function recordView(articleId) {
    const hour = ViewStat.hourStart();
    await Promise.all([
        ViewStat.updateOne({ articleId, hour }, { $inc: { count: 1 } }, { upsert: true }),
        Article.updateOne({ _id: articleId }, { $inc: { viewsCount: 1 } }, { timestamps: false })
    ]);
}

// ── Chart window ────────────────────────────────────────────────────────────
// Either a named range (24h / 7d / 30d / all) or a custom from/to window (focus on an update)
function resolveWindow(article, query) {
    const end = new Date(ViewStat.hourStart().getTime() + HOUR_MS); // end of the current hour

    if (query.from || query.to) {
        const from = ViewStat.hourStart(new Date(query.from));
        let to = new Date(query.to);
        if (isNaN(from) || isNaN(to)) throw badRequest('Invalid time window');
        if (to > end) to = end;
        if (from >= to) throw badRequest('Invalid time window');
        if (to - from > MAX_CUSTOM_SPAN) throw badRequest('A custom time window is limited to 31 days');
        return { from, to };
    }

    const range = query.range || '7d';
    if (!RANGE_KEYS.includes(range)) throw badRequest('Unknown range');

    if (range === 'all') {
        const start = article.publishedAt || article.createdAt || new Date();
        return { from: ViewStat.hourStart(start), to: end };
    }
    return { from: new Date(end.getTime() - RANGES[range]), to: end };
}

// ── Chart data ──────────────────────────────────────────────────────────────
async function getArticleTimeline(article, { from, to }) {
    const unit = to - from <= MAX_HOURLY_SPAN ? 'hour' : 'day';

    // 1. Sum the hourly buckets per hour or per day (days in the newsroom time zone)
    const rows = await ViewStat.aggregate([
        { $match: { articleId: article._id, hour: { $gte: from, $lt: to } } },
        {
            $group: {
                _id: { $dateTrunc: { date: '$hour', unit, timezone: TIMEZONE } },
                views: { $sum: '$count' }
            }
        },
        { $sort: { _id: 1 } }
    ]);

    // 2. Continuous time axis: hours/days without views get 0 so the line does not skip them
    const keyOf = (date) => (unit === 'hour'
        ? ViewStat.hourStart(date).toISOString()
        : dayKeyFormatter.format(date));

    const viewsByKey = new Map(rows.map(row => [keyOf(row._id), row.views]));
    const buckets = [];
    for (let t = from.getTime(); t < to.getTime(); t += HOUR_MS) {
        const key = keyOf(new Date(t));
        if (buckets[buckets.length - 1] !== key) buckets.push(key);
    }
    const views = buckets.map(key => viewsByKey.get(key) || 0);

    // 3. Editor approvals inside the window become markers on the chart
    const history = article.publishHistory || [];
    const markers = [];
    history.forEach((record, i) => {
        const at = new Date(record.publishedAt);
        if (at < from || at >= to) return;
        const index = buckets.indexOf(keyOf(at));
        if (index === -1) return;
        markers.push({
            index,
            at,
            type: i === 0 ? 'publish' : 'update',
            number: i,
            editor: editorName(record)
        });
    });

    return {
        unit,
        from,
        to,
        buckets,
        views,
        markers,
        publications: await buildPublications(article, history),
        totals: {
            views: article.viewsCount || 0,
            viewsInRange: views.reduce((sum, v) => sum + v, 0),
            updates: Math.max(history.length - 1, 0)
        }
    };
}

function editorName(record) {
    return record.editor && record.editor.username ? record.editor.username : 'Editor';
}

// Every approval of the article, and for each update the average views per hour
// in the 24 hours before it vs the 24 hours after it (cut at the neighbouring updates / now)
async function buildPublications(article, history) {
    const times = history.map(record => ViewStat.hourStart(record.publishedAt).getTime());
    const nowEnd = ViewStat.hourStart().getTime() + HOUR_MS;
    const windowMs = IMPACT_WINDOW_HOURS * HOUR_MS;

    // Only the hours around the updates are needed - one query for all of them
    const windows = times.slice(1).map(t => ({ hour: { $gte: new Date(t - windowMs), $lt: new Date(t + windowMs) } }));
    const stats = windows.length
        ? await ViewStat.find({ articleId: article._id, $or: windows }).select('hour count -_id').lean()
        : [];

    const sumBetween = (start, end) => stats
        .filter(s => s.hour.getTime() >= start && s.hour.getTime() < end)
        .reduce((sum, s) => sum + s.count, 0);

    return history.map((record, i) => {
        const publication = {
            number: i,
            type: i === 0 ? 'publish' : 'update',
            at: record.publishedAt,
            editor: editorName(record),
            title: record.title,
            avgBefore: null,
            avgAfter: null,
            changePct: null
        };
        if (i === 0) return publication;

        const boundary = times[i];
        const beforeStart = Math.max(boundary - windowMs, times[i - 1]);
        const afterEnd = Math.min(boundary + windowMs, times[i + 1] || Infinity, nowEnd);
        const beforeHours = (boundary - beforeStart) / HOUR_MS;
        const afterHours = (afterEnd - boundary) / HOUR_MS;

        if (beforeHours > 0) publication.avgBefore = round1(sumBetween(beforeStart, boundary) / beforeHours);
        if (afterHours > 0) publication.avgAfter = round1(sumBetween(boundary, afterEnd) / afterHours);
        if (publication.avgBefore > 0 && publication.avgAfter !== null) {
            publication.changePct = Math.round((publication.avgAfter - publication.avgBefore) / publication.avgBefore * 100);
        }
        publication.beforeHours = beforeHours;
        publication.afterHours = afterHours;
        return publication;
    });
}

// ── Lists & maintenance ─────────────────────────────────────────────────────
async function getTopArticles(range, limit) {
    const match = RANGES[range] ? { hour: { $gte: new Date(Date.now() - RANGES[range]) } } : {};

    return ViewStat.aggregate([
        { $match: match },
        { $group: { _id: '$articleId', views: { $sum: '$count' } } },
        { $sort: { views: -1 } },
        { $limit: limit },
        { $lookup: { from: Article.collection.name, localField: '_id', foreignField: '_id', as: 'article' } },
        { $unwind: '$article' },
        {
            $project: {
                views: 1,
                title: '$article.title',
                category: '$article.category',
                updates: { $max: [{ $subtract: [{ $size: { $ifNull: ['$article.publishHistory', []] } }, 1] }, 0] }
            }
        }
    ]);
}

async function resetArticleStats(articleId) {
    const result = await ViewStat.deleteMany({ articleId });
    await Article.updateOne({ _id: articleId }, { $set: { viewsCount: 0 } }, { timestamps: false });
    return result.deletedCount;
}

function deleteArticleStats(articleId) {
    return ViewStat.deleteMany({ articleId });
}

module.exports = {
    RANGE_KEYS,
    recordView,
    resolveWindow,
    getArticleTimeline,
    getTopArticles,
    resetArticleStats,
    deleteArticleStats
};
