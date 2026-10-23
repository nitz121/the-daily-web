const mongoose = require('mongoose');

// Treat nested objects in filters as literal values. This is a project-wide
// defense against query-selector injection (for example { $ne: 'value' }).
mongoose.set('sanitizeFilter', true);

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI);
        console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
};

module.exports = connectDB;
