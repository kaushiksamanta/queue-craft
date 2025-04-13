// Type declarations for Vitest
import { MockInstance } from 'vitest';

// Extend the global namespace
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Vi {
    interface Mock<T = any, Y extends any[] = any[]> extends MockInstance<T, Y> {
      mock: {
        calls: Y[];
        instances: any[];
        invocationCallOrder: number[];
        results: { type: string; value: T }[];
        lastCall: Y;
      };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function fn<T extends (...args: any[]) => any>(
    implementation?: T,
  ): Vi.Mock<ReturnType<T>, Parameters<T>>;
}

// Add mock property to Function interface
declare global {
  interface Function {
    mock?: {
      calls: any[][];
      instances: any[];
      invocationCallOrder: number[];
      results: { type: string; value: any }[];
      lastCall: any[];
    };
  }
}
