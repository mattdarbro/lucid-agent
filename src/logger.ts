type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // Cyan
  info: '\x1b[32m',  // Green
  warn: '\x1b[33m',  // Yellow
  error: '\x1b[31m', // Red
};

const RESET = '\x1b[0m';

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[LOG_LEVEL as LogLevel];
}

function formatMessage(level: LogLevel, message: string, ...args: any[]): string {
  const timestamp = new Date().toISOString();
  const color = COLORS[level];
  const levelStr = level.toUpperCase().padEnd(5);

  let formattedMsg = `${color}[${timestamp}] ${levelStr}${RESET} ${message}`;

  if (args.length > 0) {
    formattedMsg += ' ' + args.map(arg =>
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
  }

  return formattedMsg;
}

export const logger = {
  debug(message: string, ...args: any[]): void {
    if (shouldLog('debug')) {
      console.log(formatMessage('debug', message, ...args));
    }
  },

  info(message: string, ...args: any[]): void {
    if (shouldLog('info')) {
      console.log(formatMessage('info', message, ...args));
    }
  },

  warn(message: string, ...args: any[]): void {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', message, ...args));
    }
  },

  error(message: string, ...args: any[]): void {
    if (shouldLog('error')) {
      console.error(formatMessage('error', message, ...args));
    }
  },
};
