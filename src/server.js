import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { Server as SocketIOServer } from 'socket.io';

import { connectDB } from './config/db.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { setupSignaling } from './sockets/signalingHandler.js';
import { setTerminateRoomFn } from './controllers/adminController.js';

import authRoutes from './routes/authRoutes.js';
import callRoutes from './routes/callRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import subscriptionRoutes from './routes/subscriptionRoutes.js';
import lyoraRoutes from './routes/lyoraRoutes.js';
import { setupLyoraHandler } from './sockets/lyoraHandler.js';

dotenv.config();

const app = express();
const server = http.createServer(app);

// Allowed origins for CORS (Vercel deployments & localhost)
const rawOrigins = process.env.ALLOWED_ORIGINS || '';
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'https://app.aqeleo.cfd',
  'https://admin.aqeleo.cfd',
  ...rawOrigins.split(',').map((o) => o.trim()).filter(Boolean),
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (
      allowedOrigins.includes(origin) ||
      origin.endsWith('.aqeleo.cfd') ||
      origin.includes('localhost') ||
      origin.includes('127.0.0.1') ||
      origin.includes('.vercel.app')
    ) {
      return callback(null, true);
    }
    return callback(new Error(`CORS origin not allowed: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

// Security and utility middlewares
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Health check endpoint (useful for Render keep-alive and ping monitors)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    platform: 'AQELEO Video Platform',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/lyora', lyoraRoutes);

// Global Error Handler
app.use(errorHandler);

// Setup Socket.io Server for WebRTC Signaling & Admin Monitoring
const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.includes(origin) ||
        origin.endsWith('.aqeleo.cfd') ||
        origin.includes('localhost') ||
        origin.includes('127.0.0.1') ||
        origin.includes('.vercel.app')
      ) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 30000,
  pingInterval: 15000,
});

// Initialize WebRTC signaling & link termination method
const signalingService = setupSignaling(io);
setTerminateRoomFn(signalingService.terminateRoom);

// Initialize Lyora AI Audio Companion Socket Handler
setupLyoraHandler(io);

// Start server
const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`[AQELEO Backend] Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
    console.log(`[AQELEO Backend] Health check: http://localhost:${PORT}/api/health`);
  });
});

export { app, server, io };
