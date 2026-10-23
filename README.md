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

# 3. Load the demo data (500+ articles, users, view statistics, comments) - this resets the database
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

`npm run seed:comments` recreates only the demo comments for the articles already in the database
(users and articles are not touched).

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
├── config/
│   ├── db.js                  # MongoDB connection
│   └── categories.js          # Article categories a reporter can choose
├── models/                    # Mongoose models (M)
│   ├── User.js                # Users and roles, bcrypt-hashed passwords
│   ├── Article.js             # Articles, live vs draft versions, workflow state machine
│   ├── Comment.js             # Comments (+ device id / IP for the rate limit)
│   └── ViewStat.js            # View statistics (hourly buckets)
├── controllers/               # Request handlers (C)
│   ├── authController.js      # Login / logout
│   ├── articleController.js   # Server-rendered article page + view tracking
│   ├── feedController.js      # Home page, feed API, categories, weather
│   ├── commentController.js   # Comments API
│   ├── reporterController.js  # Reporter area: dashboard, editor page, create / autosave API
│   ├── editorController.js    # Editor area API
│   └── analyticsController.js # Impact Analytics API
├── routes/                    # URL -> controller mapping
├── middleware/
│   ├── authMiddleware.js      # Role checks (server side)
│   └── commentRateLimiter.js  # Max 3 comments per minute per device / IP
├── services/analyticsService.js  # View collection and chart data preparation
├── seeders/
│   ├── editorSeeder.js        # Demo data for the editor area and analytics
│   └── commentSeeder.js       # Demo comments (npm run seed:comments)
├── utils/                     # logger (logs/app.log), HTML sanitizer, plain text -> HTML, regex escaping
├── views/                     # EJS templates (V), incl. reporter/ and partials/
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
- Editor-only user administration API: list/search, create, update role or password, and delete users with no authored articles. Password hashes are never returned.

### Comments
- Loaded and posted with AJAX. A new comment appears at the top of the list immediately, without reloading the list.
- **Rate limit**: a device can post at most **3 comments per minute**. Extra attempts get `429 Too Many Requests`
  with a message, and the UI shows a countdown.
  - A device is identified by a random id in its session cookie **or** by its IP address, so a new or incognito
    window on the same machine is blocked too.
  - The count comes from the comments collection (indexed), so the limit survives a server restart and works
    across several server instances.
- Comment text is always rendered as text (no HTML injection). Editors can edit and delete comments.

### Reporter area (`/reporter-dashboard`)
- The reporter's own articles by stage (In preparation / Pending approval / Returned / Published / All),
  with counters, title search and "Load more" (20 per page). The editor's note is shown on returned articles.
- Create a new article, edit drafts, returned articles and published articles, and submit for approval
  (`PATCH /api/articles/:id/status` - the same state machine as the editor area).
- Editing a published article goes through `applyEdit`: only the title and content are versioned, so they are saved
  as an update in `draftTitle` / `draftContent` and readers keep seeing the live version until an editor approves.
  The category and image of a published article are read-only.
- **Autosave** (no "Save" button):
  - Saves 1.5 s after typing stops, and at least every 10 s while typing.
  - One request at a time, in order, and only when something changed - continuous typing does not flood the server.
  - Unsaved changes are backed up in `localStorage` and restored after a crash or network failure.
  - When the tab is closed, the last changes are sent with `fetch(..., { keepalive: true })`.
  - The work is stored on the server, so it continues on any computer.
- The reporter writes plain text; the server escapes it and turns blank lines into paragraphs.

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
Errors and significant events (approvals, returns, deletions, rejected actions, articles created / submitted,
comments posted / moderated, comments blocked by the rate limit) are written as JSON lines
to `logs/app.log` (`utils/logger.js`).

---

## Main API endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/articles` | Public feed (search, filters, sort, pagination) |
| GET | `/api/editor/articles` | Editor: list by stage + search + tab counters |
| GET / PUT | `/api/editor/articles/:id` | Editor: live vs proposed version / edit |
| GET | `/api/reporter/articles` | Reporter: own articles by stage + search + tab counters |
| POST | `/api/articles` | Reporter: create an article (first autosave) |
| PUT | `/api/articles/:id` | Reporter: autosave the working version |
| PATCH | `/api/articles/:id/status` | Status change (reporter: submit, editor: approve / return) |
| DELETE | `/api/articles/:id` | Editor: delete an article with its comments and statistics |
| GET | `/api/analytics/article/:id` | Chart data (`range=24h\|7d\|30d\|all` or `from`/`to`) |
| GET | `/api/analytics/top` | Most viewed articles in a range |
| DELETE | `/api/analytics/article/:id` | Reset an article's statistics |
| GET / POST | `/api/users` | Editor: list/search users or create a user |
| PUT / DELETE | `/api/users/:id` | Editor: update or delete a user (only if no authored articles) |
| GET | `/api/articles/:id/comments` | Comments of an article (newest first, paginated, search) |
| POST | `/api/articles/:id/comments` | Add a comment (max 3 per minute per device) |
| PUT / DELETE | `/api/comments/:id` | Editor: edit / delete a comment |
