var mysql = require('mysql');
var config = require('../config');

var pool = mysql.createPool({
    host     : config.DB_CONFIG.DB_HOST,
    user     : config.DB_CONFIG.DB_USER,
    password : config.DB_CONFIG.DB_PASSWORD,
    database : config.DB_CONFIG.DB_TABLE,
    port     : config.DB_CONFIG.DB_PORT
});

module.exports = {
    query: function () {
        var queryArgs = Array.prototype.slice.call(arguments),
            events = [],
            eventNameIndex = {};

        pool.getConnection(function (err, conn) {
            if (err) {
                if (eventNameIndex.error) {
                    eventNameIndex.error();
                }
            }
            if (conn) { 
                var q = conn.query.apply(conn, queryArgs);
                q.on('end', function () {
                    conn.release();
                });

                events.forEach(function (args) {
                    q.on.apply(q, args);
                });
            }
        });

        return {
            on: function (eventName, callback) {
                events.push(Array.prototype.slice.call(arguments));
                eventNameIndex[eventName] = callback;
                return this;
            }
        };
    }
};