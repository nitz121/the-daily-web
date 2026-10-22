const mongoose = require('mongoose');

/**
 * View statistics - one document per article per hour: { articleId, hour, count }.
 * Each view is one atomic $inc on the current hour's bucket (upsert), so concurrent readers
 * never overwrite each other and a one-week chart reads at most 168 small documents.
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
