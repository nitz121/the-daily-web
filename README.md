# The Daily Web

A news management and publishing system: a public news feed, server-rendered article pages,
a reporter workspace, an editor approval area and Impact Analytics.

Built with **Node.js, Express, MongoDB (Mongoose), EJS and Vanilla JavaScript** (MVC architecture, REST APIs, AJAX).

---

## Installation & running

**Requirements:** Node.js 20+ and a MongoDB database (local or MongoDB Atlas).

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables
cp .env.example .env      # then fill in the values (see below)

# 3. Load the demo data (500+ articles, users, view statistics) - this resets the database
npm run seed

# 4. Start the server
npm run dev               # development (auto-restart with nodemon)
npm start                 # production
```

Open http://localhost:3000

### Environment variables (`.env`)

| Variable | Description |
|---|---|
| `MONGODB_URI` | MongoDB connection string |
| `SESSION_SECRET` | Secret used to sign the session cookie |
| `PORT` | HTTP port (default 3000) |
| `OPENWEATHER_API_KEY` | OpenWeatherMap API key (free plan) |

`.env` is git-ignored - never commit passwords or API keys.

### Demo users (password for all: `password123`)

| Username | Role |
|---|---|
| `editor_jane` | Editor |
| `reporter_john`, `reporter_alice`, `reporter_dana` | Reporter |
| `guest_user` | Guest |

---

## Project structure

```
the-daily-web/
├── server.js                  # Express app: sessions, routes, 404 + central error handler
├── seed.js                    # Demo data script (npm run seed)
├── config/db.js               # MongoDB connection
├── models/                    # Mongoose models (M)
│   ├── User.js                # Users and roles, bcrypt-hashed passwords
│   ├── Article.js             # Articles, live vs draft versions, workflow state machine
│   └── ViewStat.js            # View statistics (hourly buckets)
├── controllers/               # Request handlers (C)
│   ├── authController.js      # Login / logout
│   ├── articleController.js   # Server-rendered article page + view tracking
│   ├── feedController.js      # Home page, feed API, categories, weather
│   ├── editorController.js    # Editor area API
│   └── analyticsController.js # Impact Analytics API
├── routes/                    # URL -> controller mapping
├── middleware/authMiddleware.js  # Role checks (server side)
├── services/analyticsService.js  # View collection and chart data preparation
├── seeders/editorSeeder.js    # Demo data for the editor area and analytics
├── utils/                     # logger (logs/app.log), HTML sanitizer
├── views/                     # EJS templates (V)
└── public/                    # CSS and client-side JavaScript
```

---

## Features

### Public site
- **Home page feed** - infinite scroll (20 articles at a time), search, category / read-unread filters,
  sorting by date or popularity, all without page reloads.
- **Article page** - fully rendered on the server (SEO), plain-text meta description.
- **Weather widget** - OpenWeatherMap, cached on the server for 15 minutes.

### Users & security
- Login for reporters and editors; passwords hashed with bcrypt.
- Sessions stored in MongoDB (`connect-mongo`), so users stay logged in after a server restart.
- Every permission is checked on the server (`middleware/authMiddleware.js` + the article state machine).

### Editor area (`/editor-dashboard`)
- All articles filtered by workflow stage (Pending approval / Published / Returned / In preparation / All), title search, 20 per page.
- **Review** - side-by-side *Currently published* vs *Proposed update*, with "Title changed / Content changed" markers.
- **Approve & publish**, **Return for corrections** (a note is required), **Edit** by the editor, **Delete**.
- Every action updates the table without reloading the page.

### Article lifecycle
`status` is the lifecycle until the first publication. After that the article stays `published`
(readers keep seeing `title` / `content`), and an update has its own lifecycle in `revisionStatus`,
with its text in `draftTitle` / `draftContent`.

| Transition | Who |
|---|---|
| In preparation → Pending approval | the article's reporter |
| Returned → Pending approval | the article's reporter |
| Pending approval → Published | editor (the draft becomes the live version) |
| Pending approval → Returned | editor, with a note |

Any other transition is rejected. Before the first publication the transitions apply to `status`,
after it to `revisionStatus`. The first edit of a published article opens an update
(`revisionStatus = 'draft'`) and the live version stays unchanged until an editor approves the update.
The rules live in `models/Article.js` (`transitionTo`, `canEditBy`, `applyEdit`).

### Impact Analytics
- A chart of an article's views over time (Chart.js), with a dashed marker at every moment
  an editor approved and published the article or an update.
- Time ranges of 24h / 7 days / 30 days / All, plus **Focus** on an update (24 hours before and after it).
- For every update: the average views per hour before vs after it, and the change in percent.
- A "most viewed in the last 7 days" list for choosing an article, and a statistics reset.

**Data model - why hourly buckets:** views are stored in `ViewStat` as one document per article per hour
(`{ articleId, hour, count }`). Every view is a single atomic `$inc` with upsert. That means:
- no read-modify-write races, even with thousands of concurrent readers;
- the collection grows with the number of hours, not the number of views;
- a weekly chart reads at most 168 small documents through the `{ articleId, hour }` index.

The approval times are kept in the article itself (`publishHistory`). `services/analyticsService.js`
groups the buckets with `$dateTrunc`, fills empty hours or days with 0, and maps every approval to its
point on the time axis, which is the format Chart.js expects.

### Logs
Errors and significant events (approvals, returns, deletions, rejected actions) are written as JSON lines
to `logs/app.log` (`utils/logger.js`).

---

## Main API endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/articles` | Public feed (search, filters, sort, pagination) |
| GET | `/api/editor/articles` | Editor: list by stage + search + tab counters |
| GET / PUT | `/api/editor/articles/:id` | Editor: live vs proposed version / edit |
| PATCH | `/api/articles/:id/status` | Status change (reporter: submit, editor: approve / return) |
| DELETE | `/api/articles/:id` | Editor: delete an article with its comments and statistics |
| GET | `/api/analytics/article/:id` | Chart data (`range=24h\|7d\|30d\|all` or `from`/`to`) |
| GET | `/api/analytics/top` | Most viewed articles in a range |
| DELETE | `/api/analytics/article/:id` | Reset an article's statistics |
