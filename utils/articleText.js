/**
 * The article page renders article content as raw HTML (<%- %>).
 * Reporters write plain text, so the server converts it to safe HTML:
 * every special character is escaped (a reporter can't inject <script>),
 * an empty line starts a new paragraph and a single line break becomes <br>.
 */

function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * "First paragraph\n\nSecond <b>"  ->  "<p>First paragraph</p><p>Second &lt;b&gt;</p>"
 */
function textToHtml(text) {
    return text
        .replace(/\r\n/g, '\n')
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
        .join('');
}

/**
 * Reverse of textToHtml: turns stored HTML back into plain text for the editor's textarea.
 */
function htmlToText(html) {
    if (!html) return '';
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>\s*/gi, '\n\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&') // last, so "&amp;lt;" becomes "&lt;" and not "<"
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

module.exports = { textToHtml, htmlToText };
