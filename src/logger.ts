import winston from 'winston'
import { Logger } from './types'

// Re-export Logger from types for backwards compatibility
export type { Logger } from './types'

/**
 * Winston logger configuration options
 */
export interface WinstonLoggerOptions {
  /** Minimum log level to output */
  level?: 'debug' | 'info' | 'warn' | 'error'
  /** Whether to colorize output (default: true) */
  colorize?: boolean
  /** Whether to include timestamps (default: true) */
  timestamp?: boolean
  /** Custom Winston transports */
  transports?: winston.transport[]
  /** Whether to silence logs (useful for testing) */
  silent?: boolean
}

/**
 * Winston-based logger implementation
 */
export class WinstonLogger implements Logger {
  private logger: winston.Logger

  /**
   * Creates a new Winston logger
   * @param options Logger configuration options
   */
  constructor(options: WinstonLoggerOptions = {}) {
    const {
      level = 'info',
      colorize = true,
      timestamp = true,
      transports = [],
      silent = false,
    } = options

    // Create default console transport if none provided
    const defaultTransports: winston.transport[] = transports.length
      ? transports
      : [
          new winston.transports.Console({
            level,
            format: winston.format.combine(
              timestamp ? winston.format.timestamp() : winston.format.simple(),
              colorize ? winston.format.colorize() : winston.format.simple(),
              winston.format.printf(
                ({ timestamp, level, message, ...rest }: Record<string, any>) => {
                  const meta = Object.keys(rest).length ? JSON.stringify(rest) : ''
                  return `${timestamp ? `[${timestamp}] ` : ''}${level}: ${message} ${meta}`
                },
              ),
            ),
          }),
        ]

    // Create Winston logger
    this.logger = winston.createLogger({
      level,
      transports: defaultTransports,
      silent,
    })
  }

  /**
   * Logs a debug message
   * @param message Message to log
   * @param meta Additional metadata
   */
  debug(message: string, ...meta: any[]): void {
    this.logger.debug(message, ...meta)
  }

  /**
   * Logs an info message
   * @param message Message to log
   * @param meta Additional metadata
   */
  info(message: string, ...meta: any[]): void {
    this.logger.info(message, ...meta)
  }

  /**
   * Logs a warning message
   * @param message Message to log
   * @param meta Additional metadata
   */
  warn(message: string, ...meta: any[]): void {
    this.logger.warn(message, ...meta)
  }

  /**
   * Logs an error message
   * @param message Message to log
   * @param meta Additional metadata
   */
  error(message: string, ...meta: any[]): void {
    this.logger.error(message, ...meta)
  }
}

/**
 * Console-based logger implementation
 * Simpler alternative to Winston for basic use cases
 */
export class ConsoleLogger implements Logger {
  /**
   * Creates a new console logger
   * @param options Logger configuration options
   */
  constructor(private options: { silent?: boolean } = {}) {}

  /**
   * Logs a debug message
   * @param message Message to log
   * @param meta Additional metadata
   */
  debug(message: string, ...meta: any[]): void {
    if (!this.options.silent) {
      console.debug(message, ...meta)
    }
  }

  /**
   * Logs an info message
   * @param message Message to log
   * @param meta Additional metadata
   */
  info(message: string, ...meta: any[]): void {
    if (!this.options.silent) {
      console.info(message, ...meta)
    }
  }

  /**
   * Logs a warning message
   * @param message Message to log
   * @param meta Additional metadata
   */
  warn(message: string, ...meta: any[]): void {
    if (!this.options.silent) {
      console.warn(message, ...meta)
    }
  }

  /**
   * Logs an error message
   * @param message Message to log
   * @param meta Additional metadata
   */
  error(message: string, ...meta: any[]): void {
    if (!this.options.silent) {
      console.error(message, ...meta)
    }
  }
}

/**
 * Creates a default logger
 * @param options Logger configuration options
 * @returns Logger instance
 */
export function createDefaultLogger(options: WinstonLoggerOptions = {}): Logger {
  return new WinstonLogger(options)
}
