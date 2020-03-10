const log4js = require('log4js');

module.exports = class SocketController {
    constructor(io, controller) {
        this.logger = log4js.getLogger('SocketController');
        this.io = io;
        this.controller = controller;

        this.io.use((socket, next) => this.verifyNewSocket(socket, next));
        this.io.on('connection', socket => this.onConnected(socket));

        this.sockets = new Map();
        this.pendingDisplayIds = new Set();
    }

    async onConnected(socket) {
        this.logger.debug(`Socket ${socket.id} connected`);

        socket.on('error', (error) => this.logger.error(`Socket ${socket.id}`, error));
        socket.once('disconnect', (reason) => this.onDisconnect(socket, reason));

        let displayId = socket.handshake.query.displayId;
        let display = await this.controller.findDisplay(displayId);

        if (display === null || !display.active) {
            this.logger.warn(`Could not find an active display with id ${displayId}`);
            socket.emit('auth_error', { message: 'Display not active' });
            this.pendingDisplayIds.add(displayId);
            this.sockets.set(displayId, socket);
            return;
        }

        this.sockets.set(displayId, socket);
        socket.emit('auth_success', {});
    }

    onDisconnect(socket, reason) {
        this.logger.debug(`Socket ${socket.id} disconnected with reason ${reason}`);
        let displayId = socket.handshake.query.displayId;
        this.sockets.delete(displayId);
        this.pendingDisplayIds.delete(displayId);
    }

    /**
     * Checks if the respective Display is not yet fully authenticated.
     *
     * @param {String} displayId
     * @return {boolean} True if the Display has not been fully authenticated, False otherwise.
     */
    isDisplayPending(displayId) {
        return this.pendingDisplayIds.has(displayId);
    }

    /**
     * socket.io middleware to verify if a new socket connection should be allowed (i.e. sends the required data)
     *
     * @param socket
     * @param next
     */
    verifyNewSocket(socket, next) {
        if (!socket.handshake.query.hasOwnProperty('displayId')) {
            return next(new Error('Parameter displayId is missing'));
        }

        return next();
    }
};