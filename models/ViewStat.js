const mongoose = require('mongoose');

/**
 * View statistics (Student 4) - MongoDB "bucket pattern".
 *
 * One document per article per hour: { articleId, hour, count }.
 * Every view is a single atomic `$inc` on the bucket of the current hour (an upsert creates it),
 * so with thousands of concurrent readers there are no read-modify-write races, the collection
 * grows with the number of hours instead of the number of views, and a one-week chart
 * reads at most 168 small documents through the { articleId, hour } index.
 */
const viewStatSchema = new mongoose.Schema({
    articleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Article', required: true },
    hour: { type: Date, required: true }, // start of the hour (UTC)
    count: { type: Number, default: 0, min: 0 }
}, { versionKey: false });

viewStatSchema.index({ articleId: 1, hour: 1 }, { unique: true });
viewStatSchema.index({ hour: 1 }); // "most viewed in the last X days"

// Truncate a date to the start of its hour
viewStatSchema.statics.hourStart = function (date = new Date()) {
    const hour = new Date(date);
    hour.setUTCMinutes(0, 0, 0);
    return hour;
};

module.exports = mongoose.model('ViewStat', viewStatSchema);
