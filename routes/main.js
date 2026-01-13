const express = require('express');
const router = express.Router();
const db = require('../db');
const {verifyToken} = require('../utils/verify');

router.get('/',verifyToken, async (req, res) => {
  try {

    // Updated SQL query with JOIN and GROUP BY
        const query = `
            SELECT 
                f.id, f.title, f.bio, f.category, 
                COUNT(IF(p.deleted = 0, p.id, NULL)) AS postCount
            FROM forums f
            LEFT JOIN posts p ON f.id = p.forum_id
            GROUP BY f.id
            ORDER BY f.created_at DESC
        `;


    const [rawForums] = await db.execute(query);

    const forums = rawForums.reduce((acc, forum) => {
        const key = forum.category;
        if (!acc[key]) {
            acc[key] = [];
        }
        acc[key].push(forum);
        return acc;
    }, {});

    res.render('index', { 
        forums: forums,
        user: res.userInfo
    });
    } catch (err) {
        console.error('Database Error on main page load:', err);
        res.status(500).send('Could not load characters.');
    }
});

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

router.get('/search-results',verifyToken, async (req, res) => {
  try {

    // Updated SQL query with JOIN and GROUP BY
        const query = `
            SELECT 
                id, title, content, url, image, created_at
            FROM posts
            WHERE title LIKE ? OR content LIKE ?  AND deleted = 0 
            ORDER BY created_at DESC
        `;

    const [posts] = await db.execute(query, [`%${req.query.q}%`,`%${req.query.q}%`]);

    res.render('pages/search', { 
        posts,
        user: res.userInfo,
        timeAgo: timeAgo,
        searchKey: req.query.q
    });
    } catch (err) {
        console.error('Database Error on main page load:', err);
        res.status(500).send('Could not load characters.');
    }
});




// Create Forum
router.post('/forum/create', async (req, res) => {
  const userId = req.user.userId;
  const { title, category, bio } = req.body;

  if (!title || !category) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  const query = `
    INSERT INTO forums (user_id,title,category,bio) VALUES (?, ?, ?, ?)
  `;

  try {
    const [result] = await db.execute(query, [userId,title,category,bio]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Error at creating forum' });
    }

    res.redirect('/');
  } catch (err) {
    console.error('Error at creating forum:', err);
    res.status(500).json({ message: 'Error creating forum' });
  }

});

module.exports = router;


