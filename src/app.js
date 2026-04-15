require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const { initSocket } = require('./socket');

const app = express();
const server = http.createServer(app);

// Connect to MongoDB
connectDB();

// Init Socket.io on the same HTTP server
initSocket(server);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/artisan', require('./routes/artisan'));
app.use('/api/jobs', require('./routes/jobs'));
app.use('/api/artisans', require('./routes/artisans'));  // discovery + public profiles
app.use('/api/chat', require('./routes/chat'));                   // in-app messaging
app.use('/api/admin', require('./routes/admin'));               // admin panel
app.use('/api/notifications',  require('./routes/notifications'));   // notification history
app.use('/api/subscriptions',  require('./routes/subscriptions'));   // subscription & billing
app.use('/api/reviews',        require('./routes/reviews'));         // user review history

// Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({ success: true, message: 'FixNG API is running.' });
});

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found.' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: err.message || 'Server error.' });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`FixNG server running on port ${PORT}`);
});

module.exports = app;
