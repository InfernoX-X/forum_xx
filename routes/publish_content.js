const express = require('express');
const router = express.Router();
const {resize} = require("../utils/resize")
const path = require("path")

// 1 Year in ms
const CachedTime = 31536000000;

router.get('/:url', async (req, res) => {
    const img_url = path.join(req.mainPath,req.params.url)
    
    const width = req.query.width || null
    const quality = req.query.quality || 80
    const imgBuffer = await resize(img_url,width,quality)    
    // console.log(img_url,width,quality);
    res.setHeader('Cache-Control', `public, max-age=${CachedTime}`);
    res.type('image/jpeg').send(imgBuffer);
});

module.exports = router;

