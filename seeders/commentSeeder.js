const Comment = require('../models/Comment');

const SAMPLE_NAMES = [
    'Noa', 'Daniel', 'Maya', 'Yossi', 'Tamar', 'Avi', 'Shira', 'Omer',
    'Liat', 'Eitan', 'Rachel', 'Michael', 'Sarah', 'David', 'Guest', 'Guest'
];

const SAMPLE_COMMENTS = [
    'Great article, thanks for the detailed coverage!',
    'Very interesting. I would love to read a follow-up on this.',
    'I am not sure I agree with all the conclusions here, but it is a good read.',
    'Finally someone is reporting on this topic.',
    'Does anyone know where I can find the full report mentioned in the article?',
    'This affects our neighborhood directly. Thanks for keeping us informed.',
    'Well written and balanced. Keep up the good work.',
    'The numbers in the third paragraph seem surprising - can you share the source?',
    'Shared this with my family, very relevant.',
    'I have been following this story for weeks, great to see an update.',
    'Interesting perspective, I had not thought about it that way.',
    'Could you add some expert opinions in the next update?',
    'This is exactly the kind of journalism we need.',
    'Thanks for explaining it so clearly.',
    'I hope the authorities take this seriously.',
    'Amazing photos and great reporting.',
    'Looking forward to more coverage on this.',
    'Can\'t believe this is happening. Thanks for the report.'
];

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * Demo comments: clears the existing comments, then gives ~60% of the published articles
 * 1-8 comments each, dated between the article's creation and now. Returns the count.
 */
async function seedComments(articles) {
    await Comment.deleteMany({});

    const now = Date.now();
    const latest = now - 10 * 60 * 1000; // keep demo comments outside the rate-limit window
    const comments = [];

    articles
        .filter((article) => article.status === 'published')
        .forEach((article) => {
            if (Math.random() > 0.6) return;

            const start = Math.min(new Date(article.createdAt || latest).getTime(), latest);
            const count = 1 + Math.floor(Math.random() * 8);

            for (let i = 0; i < count; i++) {
                const createdAt = new Date(start + Math.random() * (latest - start));
                comments.push({
                    articleId: article._id,
                    authorName: pick(SAMPLE_NAMES),
                    content: pick(SAMPLE_COMMENTS),
                    deviceId: `seed-device-${Math.floor(Math.random() * 300)}`,
                    ipAddress: `10.0.${Math.floor(Math.random() * 5)}.${Math.floor(Math.random() * 250)}`,
                    createdAt,
                    updatedAt: createdAt
                });
            }
        });

    await Comment.insertMany(comments);
    return comments.length;
}

module.exports = { seedComments };

// Standalone run: `npm run seed:comments`
// Re-creates demo comments for the articles already in the database,
// without touching users or articles.
if (require.main === module) {
    require('dotenv').config();
    const mongoose = require('mongoose');
    const Article = require('../models/Article');

    (async () => {
        await mongoose.connect(process.env.MONGODB_URI);
        const articles = await Article.find({ status: 'published' }).select('_id status createdAt').lean();
        const count = await seedComments(articles);
        console.log(`Created ${count} demo comments for ${articles.length} published articles.`);
        await mongoose.disconnect();
    })().catch((err) => {
        console.error('Comment seed failed:', err);
        process.exit(1);
    });
}
