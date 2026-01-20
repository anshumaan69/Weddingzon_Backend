const dotenv = require('dotenv');
// Load env vars immediately
dotenv.config();

console.log('--- SERVER STARTING ---');
console.log('Node Version:', process.version);
console.log('MONGO_URI Present:', !!process.env.MONGO_URI);
console.log('PORT:', process.env.PORT);

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION! Shutting down...');
  console.error(err.name, err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION! Shutting down...');
  console.error(err.name, err.message);
  console.error(err.stack);
  process.exit(1);
});

const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const connectDB = require('./config/db');
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');

// Connect to database
connectDB();

const app = express();

// Trust proxy for secure cookies (Render/Heroku/Vercel)
app.set('trust proxy', 1);

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(helmet());
app.use(require('compression')()); // Gzip Compression
app.use(morgan('dev'));

// Custom Request Logger
const logger = require('./utils/logger');
app.use((req, res, next) => {
  logger.info(`Incoming Request: ${req.method} ${req.url}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    // Sanitize body for logs (hide sensitive fields)
    body: req.body ? { ...req.body, password: req.body.password ? '***' : undefined, code: req.body.code ? '***' : undefined } : {}
  });
  next();
});

// CORS Configuration
// CORS Configuration
const allowedOrigins = [
  process.env.CLIENT_URL || 'http://localhost:3000',
  process.env.ADMIN_URL, // Add Admin URL
  'http://localhost:3001' // Add Local Admin Dev Port
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // In Dev: Allow any local network IP
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// Routes
app.get('/', (req, res) => {
  logger.info('Health Check Received');
  res.send('API is running...');
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/connections', require('./routes/connection.routes'));
app.use('/api/chat', require('./routes/chat.routes')); // Enabled Chat Routes
app.use('/api/notifications', require('./routes/notification.routes'));

// Global Error Handler
app.use((err, req, res, next) => {
  logger.error(`Global Error: ${err.message}`, { stack: err.stack });
  res.status(500).json({ message: 'Server Error' });
});

// Socket.io Setup
const http = require('http');
const { Server } = require('socket.io');
const initSocket = require('./socket/index');

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin
      if (!origin) return callback(null, true);
      // In Dev: Allow any local network IP
      if (process.env.NODE_ENV !== 'production') {
        return callback(null, true);
      }
      const allowed = process.env.CLIENT_URL || 'http://localhost:3000';
      if (origin === allowed) return callback(null, true);
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST']
  }
});

initSocket(io);
app.set('socketio', io);

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
