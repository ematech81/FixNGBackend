const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let io;

// Map of userId → socketId for targeted delivery
const connectedUsers = new Map();

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: { origin: '*' },
    pingTimeout: 60000,    // keep alive on flaky Nigerian networks
    pingInterval: 25000,
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Unauthorized'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;

    if (userId) {
      // Each user joins a private room named after their userId
      socket.join(userId);
      connectedUsers.set(userId, socket.id);
      console.log(`Socket connected: userId=${userId} socketId=${socket.id}`);
    }

    socket.on('disconnect', () => {
      if (userId) {
        connectedUsers.delete(userId);
        console.log(`Socket disconnected: userId=${userId}`);
      }
    });
  });

  return io;
};

// Send event to a specific user by their userId
const emitToUser = (userId, event, data) => {
  if (!io) return;
  io.to(userId.toString()).emit(event, data);
};

// Send event to multiple users
const emitToUsers = (userIds, event, data) => {
  if (!io) return;
  userIds.forEach((id) => io.to(id.toString()).emit(event, data));
};

const getIO = () => {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
};

module.exports = { initSocket, emitToUser, emitToUsers, getIO, connectedUsers };
