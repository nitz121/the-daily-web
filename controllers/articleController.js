const Article = require('../models/Article');

exports.getArticleById = async (req, res) => {
    try {
        const article = await Article.findById(req.params.id).populate('author', 'username');

        if (!article) {
            return res.status(404).send('Article not found');
        }

        // Public users can only see published articles.
        // Reporters and editors can preview any status for review purposes.
        const isStaff = req.session.user && req.session.user.role !== 'guest';
        if (article.status !== 'published' && !isStaff) {
            return res.status(404).send('Article not found or not published');
        }

        // Increment view count (Student 4 may extend this for detailed analytics)
        article.viewsCount += 1;
        await article.save();

        res.render('article', { article });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};
