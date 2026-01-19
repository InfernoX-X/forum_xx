const express = require('express');
const router = express.Router();
const db = require('../db');
const {verifyToken} = require('../utils/verify');


function timeAgo(date) {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    let interval = Math.floor(seconds / 31536000);

    if (interval >= 1) return interval + " years ago";
    interval = Math.floor(seconds / 2592000);
    if (interval >= 1) return interval + " months ago";
    interval = Math.floor(seconds / 86400);
    if (interval >= 1) return interval + " days ago";
    interval = Math.floor(seconds / 3600);
    if (interval >= 1) return interval + " hours ago";
    interval = Math.floor(seconds / 60);
    if (interval >= 1) return interval + " minutes ago";
    return Math.floor(seconds) + " seconds ago";
}


router.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 15; // Number of posts per page
        const offset = (page - 1) * limit;

        // 1. Get total post count for pagination math
        const [countResult] = await db.execute(
            'SELECT COUNT(*) as total FROM posts WHERE deleted = 0'
        );
        const totalPosts = countResult[0].total;
        const totalPages = Math.ceil(totalPosts / limit);

        // 2. Fetch the specific slice of posts (Latest first)
        const [posts] = await db.execute(`
            SELECT p.*, u.username, 
                   GROUP_CONCAT(f.title) as categories,
                   GROUP_CONCAT(f.id) as forum_ids
            FROM posts p 
            JOIN users u ON p.user_id = u.id 
            LEFT JOIN post_categories pc ON p.id = pc.post_id
            LEFT JOIN forums f ON pc.forum_id = f.id
            WHERE p.deleted = 0
            GROUP BY p.id
            ORDER BY p.created_at DESC
            LIMIT ? OFFSET ?`, [limit.toString(), offset.toString()]);

        const [allForums] = await db.execute(
            `SELECT id, title, header FROM forums ORDER BY header DESC, title ASC`
        );

        res.render('index', { 
            posts: posts,
            allForums: allForums,
            user: res.userInfo,
            timeAgo: timeAgo,
            currentPage: page,
            totalPages: totalPages,
            forumTitle: "Home",
            siteTitle: "ForumX" // Ensure this is passed for your <title> tag
        });
    } catch (err) {
        console.error('Database Error:', err);
        res.redirect("/");
    }
});

router.get('/search', verifyToken, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 15; // Number of posts per page
        const offset = (page - 1) * limit;
        const searchTerm = req.query.q || '';

        // 1. Get total post count for pagination math
        const [countResult] = await db.execute(
            'SELECT COUNT(*) as total FROM posts WHERE deleted = 0'
        );
        const totalPosts = countResult[0].total;
        const totalPages = Math.ceil(totalPosts / limit);


        const query = `
            SELECT 
                p.*, 
                u.username,
                GROUP_CONCAT(f.title) as categories,
                GROUP_CONCAT(f.id) as forum_ids
            FROM posts p 
            JOIN users u ON p.user_id = u.id
            LEFT JOIN post_categories pc ON p.id = pc.post_id
            LEFT JOIN forums f ON pc.forum_id = f.id
            WHERE (p.title LIKE ? OR p.content LIKE ?) AND p.deleted = 0 
            GROUP BY p.id
            ORDER BY p.created_at DESC
            LIMIT ? OFFSET ?
        `;

        const [posts] = await db.execute(query, [
            `%${searchTerm}%`, 
            `%${searchTerm}%`, 
            limit.toString(), 
            offset.toString()
        ]);

        res.render('pages/search', { 
            posts,
            user: res.userInfo,
            timeAgo: timeAgo,
            currentPage: page,
            totalPages: totalPages,
            searchKey: searchTerm
        });
    } catch (err) {
        console.error("Search Error:", err);
        res.status(500).send('Search Error');
    }
});

router.get('/contribute', async (req, res) => {
    try {
        // 1. Fetch ALL forums for the "Post" checkboxes
        // Sorted by header so they group nicely in the view
        const [allForums] = await db.execute(`
            SELECT id, title, header 
            FROM forums 
            ORDER BY header DESC, title ASC
        `);

        const [headers] = await db.execute(`
            SELECT DISTINCT header as name 
            FROM forums 
            WHERE header IS NOT NULL AND header != ''
            ORDER BY header DESC
        `);

        res.render('pages/contribute', { 
            allForums: allForums,
            forums: headers,
            user: res.userInfo,
        });
    } catch (err) {
        console.error('Database Error:', err);
        res.status(500).send("Internal Server Error");
    }
});


// Create New Tag
router.post('/forum/create', async (req, res) => {
  const userId = req.user.userId;
  const { title, header, bio } = req.body;

  if (!title || !header) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  const query = `
    INSERT INTO forums (user_id,title,header,bio) VALUES (?, ?, ?, ?)
  `;

  try {
    const [result] = await db.execute(query, [userId,title,header,bio]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Error at creating forum' });
    }

    res.redirect('/contribute');
  } catch (err) {
    console.error('Error at creating forum:', err);
    res.status(500).json({ message: 'Error creating forum' });
  }

});


module.exports = router;


