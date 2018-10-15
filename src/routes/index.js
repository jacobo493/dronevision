const noteRoutes = require('./routes');
module.exports = function (app, db, ai) {
    noteRoutes(app, db, ai);
};