/**
 * Escape user input before using it inside a MongoDB $regex,
 * so characters like "(" or "*" are searched literally and can't break the query.
 */
module.exports = function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};
