const fs = require('fs');
const path = require('path');

/**
 * Simple application logger (errors + significant operational events).
 * Every entry is written as one JSON line to logs/app.log and echoed to the console.
 * The logs folder is git-ignored.
 */
const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');

try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (err) {
    console.error('Could not create logs directory:', err.message);
}

function write(level, message, meta = {}) {
    const entry = { time: new Date().toISOString(), level, message, ...meta };
    const line = JSON.stringify(entry);

    if (level === 'error') {
        console.error(line);
    } else {
        console.log(line);
    }

    // Asynchronous append so logging never blocks a request
    fs.appendFile(LOG_FILE, line + '\n', (err) => {
        if (err) console.error('Failed to write to log file:', err.message);
    });
}

module.exports = {
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta)
};
