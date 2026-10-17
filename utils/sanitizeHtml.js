/**
 * Minimal HTML sanitizer for article content.
 * Article bodies are rendered unescaped in article.ejs (<%- %>) so the formatting is kept,
 * which means anything saved must first be stripped of executable parts (stored XSS protection).
 */
function sanitizeHtml(html) {
    if (typeof html !== 'string') return '';

    return html
        // Dangerous elements together with everything inside them
        .replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, '')
        // Leftover opening / closing / self-closing dangerous tags
        .replace(/<\/?(script|style|iframe|object|embed|link|meta|base|form)\b[^>]*>/gi, '')
        // Inline event handlers such as onclick="..." or onerror=...
        .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        // javascript: URLs in href / src (quoted and unquoted)
        .replace(/\s(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, ' $1="#"')
        .replace(/\s(href|src)\s*=\s*javascript:[^\s>]*/gi, ' $1="#"')
        .trim();
}

module.exports = sanitizeHtml;
