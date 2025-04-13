// This file extends the global TypeScript types for Vitest
import { expect, afterEach, beforeEach, describe, it, vi } from 'vitest';

// Make Vitest globals available
global.expect = expect;
global.afterEach = afterEach;
global.beforeEach = beforeEach;
global.describe = describe;
global.it = it;
global.vi = vi;

// Extend the mock functionality for better TypeScript support
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Vi {
    interface AsymmetricMatchersContaining {
      // Add any custom matchers here
    }
  }
}
