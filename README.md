# The Daily Web

A news management and publishing system built with **Node.js, Express, MongoDB (Mongoose), EJS and Vanilla JavaScript** (MVC, REST, AJAX).

## Installation & Running

Requirements: Node.js 18+ and a MongoDB database (e.g. MongoDB Atlas).

```bash
npm install
cp .env.example .env      # then fill in the values (see below)
npm run seed              # demo users, 500+ articles and comments (clears existing data!)
npm run dev               # or: npm start
```

Open http://localhost:3000

### Environment variables (`.env`)

| Variable | Description |
|---|---|
| `PORT` | Server port (default 3000) |
| `MONGODB_URI` | MongoDB connection string |
| `SESSION_SECRET` | Secret used to sign the session cookie |
| `OPENWEATHER_API_KEY` | OpenWeatherMap API key (weather widget) |

`.env` is git-ignored and must never be committed.

### Scripts

| Command | What it does |
|---|---|
| `npm start` / `npm run dev` | Start the server (dev uses nodemon) |
| `npm run seed` | Recreate users, articles and comments |
| `npm run seed:comments` | Recreate only the demo comments for the articles already in the database |

### Demo users (password: `password123`)

| Username | Role |
|---|---|
| `editor_jane` | Editor |
| `reporter_john`, `reporter_alice` | Reporter |

## Project Structure

```
server.js                  Express app: middleware, sessions, routes
config/
  db.js                    MongoDB connection
  categories.js            Allowed article categories
models/                    Mongoose models
  User.js                  Users (bcrypt-hashed passwords, roles)
  Article.js               Articles: live fields + draft fields + revisionStatus
  Comment.js               Comments (with rate-limit fields)
controllers/               Request handlers (the "C" in MVC)
  authController.js        Login / logout
  articleController.js     Public article page (SSR)
  feedController.js        Home feed API, categories, weather (15-min cache)
  commentController.js     Comments API
  reporterController.js    Reporter dashboard, editor, article create/autosave/submit API
routes/                    URL -> controller mapping
middleware/
  authMiddleware.js        Role checks (server-side, from the session)
  commentRateLimiter.js    Max 3 comments per minute per device / IP
views/                     EJS templates (the "V" in MVC)
  index.ejs, article.ejs, login.ejs
  partials/header.ejs
  reporter/dashboard.ejs, reporter/editor.ejs
public/
  css/                     style.css, comments.css, reporter.css
  js/                      feed.js, comments.js, reporter-dashboard.js, article-editor.js
utils/
  logger.js                JSON-line logs to logs/app.log
  articleText.js           Plain text <-> safe HTML paragraphs
  escapeRegex.js           Safe user input for MongoDB $regex
seed.js, seeders/          Demo data
```

## Main Features

### Public site
- **Home feed**: published articles only, infinite scroll (20 at a time), search, category and read/unread filters, sorting by date or popularity, all without a page reload.
- **Weather widget**: OpenWeatherMap, cached on the server for 15 minutes.
- **Article page**: server-rendered (full content in the initial HTML, for search engines). Every visit is counted.

### Comments
- Loaded and posted with AJAX. A new comment appears at the top of the list immediately, without reloading the list.
- **Rate limit**: a device can post at most **3 comments per minute**. The server blocks extra attempts with `429 Too Many Requests` and a message, and the UI shows a countdown.
  - A device is identified by a random id in its session cookie **or** by its IP address, so a new or incognito window on the same machine is blocked too.
  - The count comes from the comments collection (indexed), so the limit survives a server restart and works across several server instances.
- Comment text is always rendered as text (no HTML injection).
- Editors can edit and delete comments.

### Authentication & permissions
- Login for reporters and editors. Passwords are hashed with bcrypt.
- Sessions are stored in MongoDB, so users stay logged in after a server restart.
- All permission checks happen on the server, based on the session.

### Reporter area (`/reporter-dashboard`)
- Lists the reporter's own articles with their state:
  - In Preparation
  - Awaiting Approval
  - Published
  - Returned for Corrections
- Tabs, counts, title search and pagination.
- Create a new article, edit drafts and returned articles, and see the editor's note.
- Submit for approval. Allowed transitions:
  - draft → pending
  - returned → pending
- **Editing a published article**:
  - The change is saved as a new version in the draft fields, and `revisionStatus` tracks it (draft → pending → approved / returned).
  - The article stays `published`, so readers keep seeing the last approved version until an editor approves the update.
- **Autosave** (no "Save" button):
  - The editor saves 1.5 s after typing stops, and at least every 10 s while typing.
  - Saves go one request at a time, in order, and only when something changed.
  - Unsaved changes are backed up in `localStorage` and restored after a crash or network failure.
  - When the tab is closed, the last changes are sent with `fetch(..., { keepalive: true })`.
  - The work is stored on the server, so it continues on any computer.
- A reporter cannot edit another reporter's article, and cannot edit an article while it awaits approval.

### Logging
Errors and significant events are written as JSON lines to `logs/app.log`, for example:
- comment posted, edited or deleted
- comment blocked by the rate limit
- article created or submitted
- forbidden access attempts

## REST API (comments & reporter)

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/api/articles/:id/comments?page=&limit=&search=` | Public | Comments of a published article, newest first |
| POST | `/api/articles/:id/comments` | Public, rate limited | Add a comment `{ content, authorName? }` |
| PUT | `/api/comments/:id` | Editor | Edit a comment `{ content }` |
| DELETE | `/api/comments/:id` | Editor | Delete a comment |
| GET | `/api/reporter/articles?status=&search=&page=` | Reporter | The reporter's own articles + counts per state |
| POST | `/api/articles` | Reporter | Create a draft `{ title, category, imageUrl, content }` |
| PUT | `/api/articles/:id` | Owner reporter / editor | Autosave the draft fields |
| PATCH | `/api/articles/:id/submit` | Owner reporter | Submit the article (or its update) for approval |
