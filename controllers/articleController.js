const Article = require('../models/Article');

exports.getArticleById = async (req, res) => {
    try {
        const article = await Article.findById(req.params.id).populate('author', 'username');
        
        if (!article || article.status !== 'פורסמה') {
            // Note: Editors and reporters might need to see drafts, but for public SEO SSR we only show published.
            // A small check can be added here if the user is logged in as editor/author to view it anyway.
            if (!req.session.user || (req.session.user.role === 'guest')) {
                 if(!article || article.status !== 'פורסמה') return res.status(404).send('Article not found or not published');
            }
        }

        // Increment view count (Student 4 might change this logic later for analytics)
        article.viewsCount += 1;
        await article.save();

        res.render('article', { article });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};
