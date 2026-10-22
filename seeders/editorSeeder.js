const mongoose = require('mongoose');
const ViewStat = require('../models/ViewStat');

/**
 * Demo data for the editor area and Impact Analytics
 *  - applyLifecycle(): publication data, articles updated several times after publication,
 *    published articles with an update in progress, never-published articles
 *  - buildViewStats(): hourly view buckets that follow each article's history
 *    (the viewsCount of every article is the sum of its buckets)
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const BATCH_SIZE = 5000;
const MULTI_UPDATE_ARTICLES = 15;

const UPDATE_NOTES = [
    'New figures were released and have been added to this report.',
    'Officials responded to our questions; their comments are included below.',
    'Corrected the timeline of events and added expert analysis.',
    'Added on-the-ground reporting from the scene.'
];

const RETURN_NOTES = [
    'Please add at least two verified sources before resubmitting.',
    'The headline overstates the findings - please make it more accurate.',
    'Some figures do not match the official report. Please double-check them.'
];

const random = (min, max) => min + Math.random() * (max - min);

const israelHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' });

// The given hour of the day (Israel time) `daysAgo` days ago - e.g. "two days ago at 14:00"
function localHourDaysAgo(daysAgo, hour, now) {
    const base = ViewStat.hourStart(new Date(now - daysAgo * DAY_MS));
    for (let offset = -12; offset <= 12; offset++) {
        const candidate = new Date(base.getTime() + offset * HOUR_MS);
        if (parseInt(israelHour.format(candidate), 10) === hour) return candidate;
    }
    return base;
}

function updateParagraph(at, note) {
    const date = at.toLocaleString('en-GB', {
        timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });
    return `<p><em>Update (${date}): ${note}</em></p>`;
}

function shuffle(list) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

// ── Article lifecycle data ──────────────────────────────────────────────────
function applyLifecycle(articles, editor, now = Date.now()) {
    const summary = { published: 0, unpublished: 0, multiUpdate: [], updatesInProgress: 0, demoUpdateAt14: null };
    const candidates = [];

    articles.forEach(article => {
        article._id = new mongoose.Types.ObjectId();
        if (!article.createdAt) article.createdAt = new Date(now - random(2, 6) * DAY_MS);
        if (!article.updatedAt) article.updatedAt = article.createdAt;

        if (article.status !== 'published') {
            // Never published: the text exists only as the working version
            if (article.draftTitle == null) {
                article.draftTitle = article.title;
                article.draftContent = article.content;
            }
            article.title = '';
            article.content = '';
            article.viewsCount = 0;
            if (article.status === 'returned' && !article.editorNote) {
                article.editorNote = RETURN_NOTES[summary.unpublished % RETURN_NOTES.length];
            }
            summary.unpublished++;
            return;
        }

        article.publishedAt = article.createdAt;
        article.publishHistory = [{ publishedAt: article.publishedAt, editor: editor._id, title: article.title }];
        summary.published++;

        const ageDays = (now - article.publishedAt.getTime()) / DAY_MS;
        if (article.revisionStatus) {
            summary.updatesInProgress++; // prepared in seed.js (e.g. the music festival article)
        } else if (ageDays >= 10 && ageDays <= 30) {
            candidates.push(article);
        }
    });

    const shuffled = shuffle(candidates);

    // Articles that went through several approved updates after publication
    shuffled.slice(0, MULTI_UPDATE_ARTICLES).forEach((article, i) => {
        const updateCount = i % 2 === 0 ? 3 : 2;
        // The first one demonstrates the spec's example: an update approved at 14:00
        const lastUpdate = i === 0 ? localHourDaysAgo(2, 14, now) : new Date(now - random(1, 6) * DAY_MS);
        const firstUpdate = article.publishedAt.getTime() + random(1, 3) * DAY_MS;

        for (let k = 0; k < updateCount; k++) {
            const at = new Date(firstUpdate + (lastUpdate.getTime() - firstUpdate) * (k / (updateCount - 1)));
            article.content += updateParagraph(at, UPDATE_NOTES[(i + k) % UPDATE_NOTES.length]);
            article.publishHistory.push({ publishedAt: at, editor: editor._id, title: article.title });
        }
        article.updatedAt = lastUpdate;

        summary.multiUpdate.push(article.title);
        if (i === 0) summary.demoUpdateAt14 = article.title;
    });

    // Published articles with an update in progress - readers keep seeing the live version
    shuffled.slice(MULTI_UPDATE_ARTICLES, MULTI_UPDATE_ARTICLES + 12).forEach((article, i) => {
        article.revisionStatus = i < 8 ? 'pending' : (i < 10 ? 'draft' : 'returned');
        article.draftTitle = `${article.title} (Updated)`;
        article.draftContent = `${article.content}<p><strong>Update:</strong> ${UPDATE_NOTES[i % UPDATE_NOTES.length]}</p>`;
        if (article.revisionStatus === 'returned') {
            article.editorNote = RETURN_NOTES[i % RETURN_NOTES.length];
        }
        article.updatedAt = new Date(now - random(1, 48) * HOUR_MS);
        summary.updatesInProgress++;
    });

    return summary;
}

// ── View statistics ─────────────────────────────────────────────────────────
// Fewer readers at night, more in the evening (Israel time is about UTC+3 - good enough for demo data)
function dailyCycle(time) {
    const hour = (new Date(time).getUTCHours() + 3) % 24;
    if (hour < 6) return 0.25;
    if (hour < 9) return 0.8;
    if (hour < 18) return 1;
    if (hour < 23) return 1.3;
    return 0.6;
}

// Expected views per hour: a peak right after publication that decays, a long tail,
// and a boost after every approved update
function trafficProfile(ageHours, updateCount) {
    if (updateCount > 0) {
        // A running story with a steady readership; every update brings readers back
        return { peak: random(25, 45), decay: random(48, 96), tail: random(4, 8), boost: random(6, 14), boostDecay: random(18, 36) };
    }
    if (ageHours < 24) {
        return { peak: random(80, 150), decay: random(8, 16), tail: 0.5, boost: 0, boostDecay: 1 };
    }
    return { peak: random(3, 10), decay: random(24, 60), tail: random(0.01, 0.06), boost: 0, boostDecay: 1 };
}

function buildViewStats(articles, now = Date.now()) {
    const stats = [];
    const lastHour = ViewStat.hourStart(new Date(now)).getTime();

    articles.forEach(article => {
        if (article.status !== 'published') return; // never public - no views

        const start = ViewStat.hourStart(article.publishedAt).getTime();
        const profile = trafficProfile((lastHour - start) / HOUR_MS, article.publishHistory.length - 1);
        // Each update has its own effect - some bring many readers back, some hardly any
        const updates = article.publishHistory.slice(1).map(record => ({
            hour: ViewStat.hourStart(record.publishedAt).getTime(),
            boost: profile.boost * random(0.3, 1.6)
        }));

        let total = 0;
        for (let t = start; t <= lastHour; t += HOUR_MS) {
            let rate = profile.peak * Math.exp(-(t - start) / HOUR_MS / profile.decay) + profile.tail;
            updates.forEach(update => {
                if (t >= update.hour) rate += update.boost * Math.exp(-(t - update.hour) / HOUR_MS / profile.boostDecay);
            });
            rate *= dailyCycle(t) * random(0.7, 1.3);

            // Random rounding keeps the expected value for small rates
            const count = Math.floor(rate + Math.random());
            if (count > 0) {
                stats.push({ articleId: article._id, hour: new Date(t), count });
                total += count;
            }
        }
        article.viewsCount = total;
    });

    return stats;
}

async function insertViewStats(stats) {
    for (let i = 0; i < stats.length; i += BATCH_SIZE) {
        await ViewStat.insertMany(stats.slice(i, i + BATCH_SIZE), { ordered: false, lean: true });
    }
}

module.exports = { applyLifecycle, buildViewStats, insertViewStats };
