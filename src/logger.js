const winston = require('winston');
const path = require('path');

const getLogger = (module, type) => {
    const modulePath = module.filename.split('/').slice(-2).join('/');
    const logger = new winston.Logger({
        transports: [
            new (winston.transports.Console)({
                colorize: true,
                level: (process.env.NODE_ENV === 'development') ? 'debug' : 'error',
                label: modulePath
            })
        ]
    });

    switch (type) {
        case 'error':
            logger.add(winston.transports.File, {
                name: 'error-file',
                filename: path.join(__dirname, './logs/error.log'),
                level: 'error',
				maxsize: 5242880,
                maxFiles: 5,
            });
            return logger;
        case 'info':
            logger.add(winston.transports.File, {
                name: 'info-file',
                filename: path.join(__dirname, './logs/info.log'),
                level: 'info',
				maxsize: 5242880,
                maxFiles: 5,
            });
            return logger;
        default:
            return logger;
    }
};

module.exports = module => ({
    error(err) {
        getLogger(module, 'error').error(err);
    },
    info(err) {
        getLogger(module, 'info').info(err);
    },
    debug(err) {
        getLogger(module, 'default').debug(err);
    }
});