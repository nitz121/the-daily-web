require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Article = require('./models/Article');
const ViewStat = require('./models/ViewStat');
const { applyLifecycle, buildViewStats, insertViewStats } = require('./seeders/editorSeeder');
const { seedComments } = require('./seeders/commentSeeder');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/thedailyweb';

const seed = async () => {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Clear existing data
    await User.deleteMany({});
    await Article.deleteMany({});
    await ViewStat.deleteMany({});
    console.log('Cleared existing users, articles and view statistics');

    // ── Users ──────────────────────────────────────────────────────────────
    const userDefs = [
        { username: 'editor_jane',    password: 'password123', role: 'editor'   },
        { username: 'reporter_john',  password: 'password123', role: 'reporter' },
        { username: 'reporter_alice', password: 'password123', role: 'reporter' },
        { username: 'reporter_dana',  password: 'password123', role: 'reporter' },
        { username: 'guest_user',     password: 'password123', role: 'guest'    },
    ];

    const savedUsers = [];
    for (const def of userDefs) {
        const u = new User(def);
        await u.save(); // triggers bcrypt pre-save hook
        savedUsers.push(u);
        console.log(`  Created user: ${u.username} (${u.role})`);
    }

    const [editor, reporter1, reporter2, reporter3] = savedUsers;
    const reporters = [reporter1, reporter2, reporter3];

    // ── Base Core Articles ──────────────────────────────────────────────────
    const coreArticles = [
        {
            title: 'Breaking: Local Tech Startup Raises $10M',
            content: '<p>A local technology startup has successfully raised $10 million in Series A funding, marking a significant milestone for the regional tech scene. Investors cited the company\'s innovative approach to renewable energy monitoring as the key driver of confidence.</p>',
            author: reporter1._id,
            category: 'Technology',
            status: 'published',
            viewsCount: 1420,
            imageUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=600&auto=format&fit=crop&q=80',
            createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2)
        },
        {
            title: 'City Council Approves New Public Transport Plan',
            content: '<p>The city council voted unanimously yesterday to approve a comprehensive overhaul of the public transport network. The plan includes 12 new bus routes and an expansion of the light rail system, expected to be completed by 2027.</p>',
            author: reporter2._id,
            category: 'Local News',
            status: 'published',
            viewsCount: 890,
            imageUrl: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=600&auto=format&fit=crop&q=80',
            createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5)
        },
        {
            title: 'Weekend Sports Roundup: Historic Championship Win',
            content: '<p>This weekend saw exciting action across multiple leagues. The local football team secured a 3-1 victory in the final minutes, while the basketball squad remains undefeated following an overtime thriller.</p>',
            author: reporter1._id,
            category: 'Sports',
            status: 'published',
            viewsCount: 2030,
            imageUrl: 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=600&auto=format&fit=crop&q=80',
            createdAt: new Date(Date.now() - 1000 * 60 * 60 * 8)
        },
        {
            // Published article with an update waiting for approval (Student 4):
            // readers keep seeing title/content until the editor approves the draft fields
            title: 'Upcoming Music Festival Preview',
            content: '<p>This is the original published version previewing the summer lineup.</p>',
            draftTitle: 'Summer Music Festival - Full Performer Schedule',
            draftContent: '<p>This is an updated version with new performer announcements — not yet approved by the editor.</p>',
            author: reporter2._id,
            category: 'Entertainment',
            status: 'published',
            revisionStatus: 'pending',
            viewsCount: 45,
            imageUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop&q=80',
            createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5),
            updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 3)
        },
        {
            title: 'Investigating Water Quality Reports in Northern District',
            content: 'Draft - pending editor approval.',
            draftTitle: 'Water Quality Issues in the Northern District Rivers',
            draftContent: '<p>Initial draft content covering the regional water quality reports...</p>',
            author: reporter1._id,
            category: 'Environment',
            status: 'returned',
            editorNote: 'Needs more verified sources. Please add at least 2 expert quotes before resubmitting.',
            viewsCount: 12,
            imageUrl: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=600&auto=format&fit=crop&q=80'
        }
    ];

    // ── Generate 500+ Articles for Project Defense (Page 7 requirement) ─────
    console.log('Generating 500+ demonstration articles across categories...');

    const categories = ['Technology', 'Sports', 'Local News', 'Entertainment', 'Environment', 'Economy', 'Science', 'Health'];

    const sampleTopics = {
        'Technology': [
            'Next-Gen AI Processors Unveiled by Semiconductor Giants',
            'Quantum Computing Breakthrough Achieved at National Lab',
            'Cybersecurity Experts Warn of Sophisticated Phishing Wave',
            'Autonomous Electric Delivery Fleets Hit Metro Streets',
            'New Open-Source Database Architecture Cuts Cloud Latency by 40%',
            'Wearable Health Monitors Detect Heart Anomalies Early',
            'Global Satellite Internet Constellation Completes Second Phase',
            'Browser Standards Committee Finalizes Modern Web Specifications'
        ],
        'Sports': [
            'Championship League Match Ends in Dramatic Penalty Shootout',
            'Olympic Hopeful Smashes Decathlon National Record',
            'Tennis Prodigy Shocks Top Seed in Straight Sets Victory',
            'Marathon Winners Set Blistering Pace in City Downtown',
            'Off-Season Trade Rumors Heat Up Ahead of Transfer Deadline',
            'Youth Academy Players Promoted to First Team Squad',
            'Basketball Finals: Underdogs Force Deciding Game 7',
            'Extreme Mountain Biking World Tour Announces Host Venues'
        ],
        'Local News': [
            'City Unveils New Green Urban Park with Solar Walkways',
            'Downtown Historic District Preservation Plan Approved',
            'Annual Community Food & Culture Festival Draws Record Crowds',
            'Municipal Library Launches Free Digital Literacy Workshops',
            'Bridge Renovation Project Nears Completion Ahead of Schedule',
            'Regional Transit Authority Expands Night Owl Bus Service',
            'Volunteers Plant Over 5,000 Trees in Suburban Reforestation',
            'Local High School Robotics Team Wins National Contest'
        ],
        'Entertainment': [
            'International Film Festival Awards Top Honors to Indie Drama',
            'Pop Superstar Announces Global Stadium Tour for 2027',
            'Acclaimed Director Returns with Gripping Mystery Mini-Series',
            'Broadway Revival Breaks Box Office Records in Opening Weekend',
            'Video Game Developers Release Highly Anticipated Space Odyssey',
            'Museum Opens Immersive Exhibition on Renaissance Masters',
            'Vinyl Record Sales Surge to 30-Year High Among Young Fans',
            'Streaming Platform Renews Hit Sci-Fi Series for Final Season'
        ],
        'Environment': [
            'Renewable Energy Grid Sets New Clean Generation Record',
            'Marine Biologists Discover Thriving Deep-Sea Coral Colony',
            'Clean Ocean Initiative Removes Over 100 Tons of Plastic',
            'Reforestation Efforts Show Promising Recovery in Biodiversity',
            'Scientists Develop Eco-Friendly Biodegradable Packaging Alternative',
            'City Implements Advanced Rainwater Harvesting in Public Buildings',
            'Wildlife Corridor Connects Fragmented Forest Reserves',
            'Global Climate Summit Delegates Agree on Stricter Emissions Caps'
        ],
        'Economy': [
            'Central Bank Announces Modest Interest Rate Adjustment',
            'Export Sector Records Robust Growth Driven by Tech Exports',
            'Small Businesses Benefit from New Microloan Assistance Program',
            'Housing Market Cools as New Residential Projects Open',
            'Retail Sales Show Strong Resilience in Quarterly Report',
            'Renewable Energy Investments Outpace Traditional Energy Sectors',
            'Employment Figures Exceed Expectations with 45,000 New Jobs',
            'Stock Indices Rally Following Strong Corporate Earnings Reports'
        ],
        'Science': [
            'James Webb Telescope Captures Unprecedented View of Early Galaxy',
            'Researchers Discover Compound Targeting Drug-Resistant Bacteria',
            'Physicists Observe Elusive Subatomic Particle Behavior',
            'Geneticists Map Complete Genome of Endangered Alpine Flora',
            'Deep Sea Exploration Probe Reaches Mariana Trench Depths',
            'Clean Fusion Energy Experiment Sustains Plasma for Record Duration',
            'Meteorological Satellite Network Enhances Hurricane Forecasting',
            'Nanomaterial Innovation Paves the Way for Ultra-Efficient Batteries'
        ],
        'Health': [
            'Clinical Trial Shows Promising Results for Universal Flu Vaccine',
            'Nutritionists Emphasize Mediterranean Diet for Longevity',
            'Mental Health Awareness Campaign Launches Across Universities',
            'Breakthrough in Non-Invasive Glucose Monitoring for Diabetes',
            'Pediatric Hospitals Adopt VR Distraction Therapy for Children',
            'Cardiologists Release Updated Heart Health Guidelines',
            'Sleep Researchers Correlate Consistent Rest with Cognitive Resilience',
            'Telemedicine Usage Surges as Patients Embrace Digital Consultations'
        ]
    };

    const generatedArticles = [];
    const now = Date.now();

    for (let i = 1; i <= 510; i++) {
        const cat = categories[i % categories.length];
        const topicList = sampleTopics[cat];
        // `i % categories.length` already selects the category. Advance the topic
        // only after one full category cycle, otherwise every category gets one title.
        const baseTitle = topicList[Math.floor(i / categories.length) % topicList.length];
        const title = i <= topicList.length ? baseTitle : `${baseTitle} (Part ${Math.floor(i / topicList.length) + 1})`;

        const author = reporters[i % reporters.length];
        
        // Distribution of statuses: 465 published, 15 pending, 10 returned, 20 draft
        let status = 'published';
        if (i > 490) status = 'draft';
        else if (i > 480) status = 'returned';
        else if (i > 465) status = 'pending';

        // Stagger publication dates over past 60 days
        const daysAgo = (i % 60) + Math.random();
        const createdAt = new Date(now - daysAgo * 24 * 60 * 60 * 1000);

        // Realistic views count
        const viewsCount = Math.floor(Math.random() * 3500) + 15;

        generatedArticles.push({
            title: title,
            content: `<p>This in-depth report on <strong>${title}</strong> examines the latest developments, implications, and expert insights shaping the ${cat.toLowerCase()} field today.</p><p>Stakeholders and industry observers note that ongoing innovations and proactive policies continue to play a pivotal role. Further updates and community discussions are expected in the coming weeks.</p>`,
            author: author._id,
            category: cat,
            status: status,
            viewsCount: viewsCount,
            createdAt: createdAt,
            updatedAt: createdAt
        });
    }

    // ── Publication history, updates & view statistics (Student 4) ─────────
    const allArticles = [...coreArticles, ...generatedArticles];
    const lifecycle = applyLifecycle(allArticles, editor);
    const viewStats = buildViewStats(allArticles);

    // Save all articles to MongoDB
    const savedArticles = await Article.insertMany(allArticles);
    console.log(`Inserting ${viewStats.length} hourly view buckets...`);
    await insertViewStats(viewStats);

    const totalCount = await Article.countDocuments();
    const publishedCount = await Article.countDocuments({ status: 'published' });
    const totalViews = viewStats.reduce((sum, bucket) => sum + bucket.count, 0);

    // ── Demo comments for published articles (Student 3) ───────────────────
    const commentCount = await seedComments(savedArticles);

    console.log(`\nSeed complete! Total articles: ${totalCount} (${publishedCount} published).`);
    console.log(`  Not published yet:                 ${lifecycle.unpublished}`);
    console.log(`  Published with an update in progress: ${lifecycle.updatesInProgress}`);
    console.log(`  Updated several times after publish: ${lifecycle.multiUpdate.length}`);
    console.log(`  View buckets: ${viewStats.length} (${totalViews} views)`);
    console.log(`  Comments: ${commentCount}`);
    if (lifecycle.demoUpdateAt14) {
        console.log(`  Demo: "${lifecycle.demoUpdateAt14}" got an update approved two days ago at 14:00`);
    }
    console.log('─────────────────────────────────');
    console.log('Login credentials (all passwords: password123):');
    console.log('  editor_jane    → role: editor');
    console.log('  reporter_john  → role: reporter');
    console.log('  reporter_alice → role: reporter');
    console.log('  reporter_dana  → role: reporter');
    console.log('  guest_user     → role: guest');
    console.log('─────────────────────────────────');

    await mongoose.disconnect();
    process.exit(0);
};

seed().catch(err => {
    console.error('Seed failed:', err);
    process.exit(1);
});
