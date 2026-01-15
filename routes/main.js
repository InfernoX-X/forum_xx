const express = require('express');
const router = express.Router();
const db = require('../db');
const {verifyToken} = require('../utils/verify');

const categoryConfig = [
    { id: "General", icon: "fa-skull-crossbones", color: "#fc6c2a" },
    { id: "The Seduction Series (Willing & Talked Into)", icon: "fa-heart", color: "#F93742" },
    { id: "The Reluctant Series", icon: "fa-hand-paper", color: "#ff3300" },
    { id: "The Corruption", icon: "fa-biohazard", color: "#cc33ff" },
    { id: "The Gangbang Hub", icon: "fa-users", color: "#00ccff" },
    { id: "Spouse Sharing & Cuckoldry", icon: "fa-eye", color: "#33cc33" },
    { id: "The Exchange (Deals & Leverage)", icon: "fa-hand-holding-dollar", color: "#ffd700" },
    { id: "The Hardcore & Extreme Section", icon: "fa-skull-crossbones", color: "#888888" }
];


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

router.get('/',verifyToken, async (req, res) => {
    try {
        const query = `
            SELECT 
                f.id, f.title, f.bio, f.category, 
                COUNT(p.id) AS postCount,
                lp.title AS lastPostTitle,
                lp.created_at AS lastPostDate,
                u.username AS lastPostUser
            FROM forums f
            LEFT JOIN posts p ON f.id = p.forum_id
            LEFT JOIN (
                SELECT forum_id, MAX(id) as max_id
                FROM posts
                GROUP BY forum_id
            ) latest_post_id ON f.id = latest_post_id.forum_id
            LEFT JOIN posts lp ON latest_post_id.max_id = lp.id
            LEFT JOIN users u ON lp.user_id = u.id
            GROUP BY f.id
            ORDER BY f.created_at DESC`;

        // Query to get the top 10 contributors based on post count
        const contributorsQuery = `
            SELECT u.username, COUNT(p.id) AS post_count 
            FROM users u
            JOIN posts p ON u.id = p.user_id
            GROUP BY u.id
            ORDER BY post_count DESC 
            LIMIT 10`
        ;

        const [topContributors] = await db.execute(contributorsQuery);

        const [rawForums] = await db.execute(query);        

        // 1. Group the raw database results
        const grouped = rawForums.reduce((acc, forum) => {
            const key = forum.category;
            if (!acc[key]) acc[key] = [];
            acc[key].push(forum);
            return acc;
        }, {});

        // 2. Build final ordered list with icons
        const finalForums = categoryConfig.map(config => {
            return {
                name: config.id,
                icon: config.icon,
                color: config.color,
                data: grouped[config.id] || [] // Empty array if no forums exist in this category yet
            };
        }).filter(category => category.data.length > 0); // Hide categories that have 0 forums

        res.render('index', { 
            forums: finalForums, // Now an array of objects
            user: res.userInfo,
            topContributors: topContributors,
            timeAgo
        });

    } catch (err) {
        console.error('Database Error on main page load:', err);
        res.status(500).send('Could not load characters.');
    }
});

router.get('/search-results',verifyToken, async (req, res) => {
  try {

    // Updated SQL query with JOIN and GROUP BY
        const query = `
            SELECT 
                p.id, p.title, p.content, p.url, p.image, p.created_at, u.username
            FROM posts p JOIN users u ON p.user_id = u.id
            WHERE p.title LIKE ? OR p.content LIKE ?  AND p.deleted = 0 
            ORDER BY p.created_at DESC
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


