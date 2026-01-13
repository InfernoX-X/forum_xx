
function parseContent(mainPath) {    
    return (req, res, next) => {
        req.mainPath = mainPath
        return next();
    };
}


module.exports = {parseContent}

