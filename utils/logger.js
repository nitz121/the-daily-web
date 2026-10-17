const fs = require('fs');
const path = require('path');

/**
 * Minimal application logger.
 * Every entry is written as one JSON line to logs/app.log (append mode)
 * and echoed to the console, so errors and significant operational events
 * (comments posted, rate-limit blocks, articles submitted...) are kept on disk.
 */
const LOG_DIR = path.join(__dirname, '..', 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

const logStream = fs.createWriteStream(path.join(LOG_DIR, 'app.log'), { flags: 'a' });

function write(level, event, details = {}) {
    const entry = JSON.stringify({
        time: new Date().toISOString(),
        level,
        event,
        ...details
    });

    logStream.write(entry + '\n');

    if (level === 'error') {
        console.error(entry);
    } else {
        console.log(entry);
    }
}

module.exports = {
    info: (event, details) => write('info', event, details),
    warn: (event, details) => write('warn', event, details),
    error: (event, details) => write('error', event, details)
};
