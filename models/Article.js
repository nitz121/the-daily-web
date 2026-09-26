const mongoose = require('mongoose');

const articleSchema = new mongoose.Schema({
    title: { type: String, required: true },
    content: { type: String, required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    category: { type: String, required: true },
    status: {
        type: String,
        enum: ['בהכנה', 'ממתינה לאישור עורך', 'פורסמה', 'הוחזרה לתיקונים'],
        default: 'בהכנה'
    },
    imageUrl: { type: String },
    viewsCount: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Article', articleSchema);
