const sharp = require('sharp');

const resize = async (imagePath, widthInPixel=null, qualityPercentage=80) => {
    try {
        const width = parseInt(widthInPixel, 10)
        if(qualityPercentage > 100){
            qualityPercentage = 100
        }
        qualityPercentage = parseInt(qualityPercentage)
        
        const imageBuffer = await sharp(imagePath).resize({ width: width }).png({ quality: qualityPercentage }).toBuffer();
        return imageBuffer
    
    } catch (error) {
        console.log(error);
        return "Error on resizing"
    }
}

module.exports = { resize };