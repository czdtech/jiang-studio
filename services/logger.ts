const isDev = Boolean(
  typeof import.meta !== 'undefined' &&
  (import.meta as { env?: { DEV?: boolean } }).env?.DEV
);

export const debugLog = (...args: unknown[]): void => {
  if (!isDev) return;
  console.log(...args);
};

export const debugWarn = (...args: unknown[]): void => {
  if (!isDev) return;
  console.warn(...args);
};

