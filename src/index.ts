import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { config, validateConfig } from './config';
import { testConnection, closeConnections } from './db';
import { logger } from './logger';
import usersRouter from './routes/users';
import conversationsRouter from './routes/conversations';
import capturesRouter from './routes/captures';
import calendarRouter from './routes/calendar';
import peopleRouter from './routes/people';

// Validate configuration on startup
try {
  validateConfig();
  logger.info('Configuration validated successfully');
} catch (error: any) {
  logger.error('Configuration validation failed:', error.message);
  process.exit(1);
}

const app = express();
const PORT = config.port;
const HOST = '0.0.0.0';

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// ============================================================================
// HEALTH & INFO ENDPOINTS
// ============================================================================

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'lucid-agent',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

app.get('/info', (req, res) => {
  res.json({
    agent: config.agent.name,
    features: config.features,
    studioApi: config.studioApi.url,
    version: '1.0.0',
  });
});

// ============================================================================
// ROUTES
// ============================================================================

app.use('/v1/users', usersRouter);
app.use('/v1/conversations', conversationsRouter);
app.use('/v1/captures', capturesRouter);
app.use('/v1/calendar', calendarRouter);
app.use('/v1/people', peopleRouter);

// TODO: Chat endpoint with streaming
// app.use('/v1/chat', chatRouter);

// TODO: Memory endpoints
// app.use('/v1/memory', memoryRouter);

// TODO: Personality endpoint
// app.use('/v1/personality', personalityRouter);

// TODO: Autonomous thoughts endpoint
// app.use('/v1/thoughts', thoughtsRouter);

// ============================================================================
// ERROR HANDLERS
// ============================================================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

async function startServer() {
  try {
    // Test database connection
    logger.info('Testing database connection...');
    const dbConnected = await testConnection();

    if (!dbConnected) {
      logger.error('Failed to connect to database. Exiting...');
      process.exit(1);
    }

    // Start Express server
    const server = app.listen(PORT, HOST, () => {
      logger.info(`🧠 ${config.agent.name} agent running on ${HOST}:${PORT}`);
      logger.info(`📊 Health: http://localhost:${PORT}/health`);
      logger.info(`ℹ️  Info: http://localhost:${PORT}/info`);
      logger.info(`🔗 Studio API: ${config.studioApi.url}`);

      if (config.features.autonomousAgents) {
        logger.info('🤖 Autonomous agents: ENABLED');
      }
      if (config.features.dreams) {
        logger.info('💭 Dreams: ENABLED');
      }
      if (config.features.webResearch) {
        logger.info('🔍 Web research: ENABLED');
      }
    });

    // Graceful shutdown handlers
    const shutdown = async () => {
      logger.info('Shutting down gracefully...');
      server.close(async () => {
        await closeConnections();
        logger.info('Server shut down complete');
        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    // Error handlers
    server.on('error', (error: any) => {
      logger.error('Server error:', error);
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} is already in use`);
        process.exit(1);
      }
    });

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection:', { promise, reason });
      process.exit(1);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();
