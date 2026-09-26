require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Article = require('./models/Article');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/thedailyweb';

const seed = async () => {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Clear existing data
    await User.deleteMany({});
    await Article.deleteMany({});
    console.log('Cleared existing users and articles');

    // ── Users ──────────────────────────────────────────────────────────────
    const users = await User.insertMany([
        { username: 'editor_jane',    password: 'password123', role: 'editor'   },
        { username: 'reporter_john',  password: 'password123', role: 'reporter' },
        { username: 'reporter_alice', password: 'password123', role: 'reporter' },
        { username: 'guest_user',     password: 'password123', role: 'guest'    },
    ]);

    // Note: insertMany bypasses the pre-save hook, so we need to hash manually.
    // Instead, let's use save() for each user so bcrypt runs.
    // The above insertMany is replaced by the loop below:
    await User.deleteMany({});
    const userDefs = [
        { username: 'editor_jane',    password: 'password123', role: 'editor'   },
        { username: 'reporter_john',  password: 'password123', role: 'reporter' },
        { username: 'reporter_alice', password: 'password123', role: 'reporter' },
        { username: 'guest_user',     password: 'password123', role: 'guest'    },
    ];
    const savedUsers = [];
    for (const def of userDefs) {
        const u = new User(def);
        await u.save(); // triggers bcrypt pre-save hook
        savedUsers.push(u);
        console.log(`  Created user: ${u.username} (${u.role})`);
    }

    const [editor, reporter1, reporter2] = savedUsers;

    // ── Articles ───────────────────────────────────────────────────────────
    const articles = [
        {
            title: 'Breaking: Local Tech Startup Raises $10M',
            content: '<p>A local technology startup has successfully raised $10 million in Series A funding, marking a significant milestone for the regional tech scene. Investors cited the company\'s innovative approach to renewable energy monitoring as the key driver of confidence.</p>',
            author: reporter1._id,
            category: 'Technology',
            status: 'published',
            viewsCount: 142
        },
        {
            title: 'City Council Approves New Public Transport Plan',
            content: '<p>The city council voted unanimously yesterday to approve a comprehensive overhaul of the public transport network. The plan includes 12 new bus routes and an expansion of the light rail system, expected to be completed by 2027.</p>',
            author: reporter2._id,
            category: 'Local News',
            status: 'published',
            viewsCount: 89
        },
        {
            title: 'Weekend Sports Roundup',
            content: '<p>This weekend saw exciting action across multiple sports. The local football team secured a 3-1 victory, while the basketball squad remains undefeated after their latest win.</p>',
            author: reporter1._id,
            category: 'Sports',
            status: 'published',
            viewsCount: 203
        },
        {
            title: 'Draft Article: Upcoming Music Festival Preview',
            content: '<p>This is the original published version.</p>',
            draftTitle: 'Draft: Summer Music Festival - Full Preview',
            draftContent: '<p>This is an updated draft with new performer announcements — not yet approved by the editor.</p>',
            author: reporter2._id,
            category: 'Entertainment',
            status: 'pending',
            viewsCount: 0
        },
        {
            title: 'Investigating Water Quality Reports',
            content: 'Draft - pending editor approval.',
            draftTitle: 'Water Quality Issues in the Northern District',
            draftContent: '<p>Initial draft content covering the water quality reports...</p>',
            author: reporter1._id,
            category: 'Environment',
            status: 'returned',
            editorNote: 'Needs more verified sources. Please add at least 2 expert quotes before resubmitting.',
            viewsCount: 0
        },
    ];

    for (const def of articles) {
        const a = new Article(def);
        await a.save();
        console.log(`  Created article: "${a.title}" [${a.status}]`);
    }

    console.log('\nSeed complete!');
    console.log('─────────────────────────────────');
    console.log('Login credentials (all passwords: password123):');
    console.log('  editor_jane    → role: editor');
    console.log('  reporter_john  → role: reporter');
    console.log('  reporter_alice → role: reporter');
    console.log('  guest_user     → role: guest');
    console.log('─────────────────────────────────');

    await mongoose.disconnect();
    process.exit(0);
};

seed().catch(err => {
    console.error('Seed failed:', err);
    process.exit(1);
});
