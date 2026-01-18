const express = require('express');
const router = express.Router();
const db = require('../db');
const {verifyToken} = require('../utils/verify');

const headerConfig = [
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

router.get('/', verifyToken, async (req, res) => {
    try {
        const query = `
            SELECT 
                f.id, f.title, f.bio, f.header, 
                -- Count occurrences in the join table for this forum
                (SELECT COUNT(*) FROM post_categories pc 
                 JOIN posts p ON pc.post_id = p.id 
                 WHERE pc.forum_id = f.id AND p.deleted = 0) AS postCount,
                lp.title AS lastPostTitle,
                lp.created_at AS lastPostDate,
                u.username AS lastPostUser
            FROM forums f
            LEFT JOIN (
                -- Find the latest post ID linked to each forum
                SELECT pc.forum_id, MAX(pc.post_id) as max_id
                FROM post_categories pc
                JOIN posts p ON pc.post_id = p.id
                WHERE p.deleted = 0
                GROUP BY pc.forum_id
            ) latest_post_id ON f.id = latest_post_id.forum_id
            LEFT JOIN posts lp ON latest_post_id.max_id = lp.id
            LEFT JOIN users u ON lp.user_id = u.id
            ORDER BY f.created_at DESC`;

        // Keep your contributors query as is (user total posts)
        const contributorsQuery = `
            SELECT u.username, COUNT(p.id) AS post_count 
            FROM users u
            JOIN posts p ON u.id = p.user_id
            WHERE p.deleted = 0
            GROUP BY u.id
            ORDER BY post_count DESC 
            LIMIT 10`;

        const [topContributors] = await db.execute(contributorsQuery);
        const [rawForums] = await db.execute(query);         

        const grouped = rawForums.reduce((acc, forum) => {
            const key = forum.header;
            if (!acc[key]) acc[key] = [];
            acc[key].push(forum);
            return acc;
        }, {});

        const finalForums = headerConfig.map(config => {
            return {
                name: config.id,
                icon: config.icon,
                color: config.color,
                data: grouped[config.id] || [] 
            };
        }).filter(header => header.data.length > 0);

        res.render('index', { 
            forums: finalForums,
            user: res.userInfo,
            topContributors: topContributors,
            timeAgo
        });

    } catch (err) {
        console.error('Database Error:', err);
        res.status(500).send('Internal Server Error');
    }
});

router.get('/search-results', verifyToken, async (req, res) => {
    try {
        const query = `
            SELECT 
                p.id, p.user_id, p.title, p.content, p.url, p.image, p.created_at, 
                u.username,
                GROUP_CONCAT(f.title) as categories,
                GROUP_CONCAT(f.id) as forum_ids  -- Added this line
            FROM posts p 
            JOIN users u ON p.user_id = u.id
            LEFT JOIN post_categories pc ON p.id = pc.post_id
            LEFT JOIN forums f ON pc.forum_id = f.id
            WHERE (p.title LIKE ? OR p.content LIKE ?) AND p.deleted = 0 
            GROUP BY p.id
            ORDER BY p.created_at DESC
        `;

        // Note: I also added p.user_id above so the "Delete" button check (user.id === post.user_id) works.

        const [posts] = await db.execute(query, [`%${req.query.q}%`, `%${req.query.q}%`]);

        res.render('pages/search', { 
            posts,
            user: res.userInfo,
            timeAgo: timeAgo,
            searchKey: req.query.q
        });
    } catch (err) {
        console.error("Search Error:", err);
        res.status(500).send('Search Error');
    }
});

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

    res.redirect('/');
  } catch (err) {
    console.error('Error at creating forum:', err);
    res.status(500).json({ message: 'Error creating forum' });
  }

});

module.exports = router;


