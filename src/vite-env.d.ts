/// <reference types="vite/client" />

interface PaperQuayBridge {
  invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(
    eventName: string,
    handler: (event: { event: string; payload: T }) => void,
  ): Promise<() => void>;
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
  };
  clipboard?: {
    readText(): string;
    writeText(value: string): void;
  };
  onFileDrop(
    handler: (payload: {
      type: 'enter' | 'over' | 'leave' | 'drop';
      paths: string[];
    }) => void,
  ): () => void;
}

interface Window {
  paperquay?: PaperQuayBridge;
}
