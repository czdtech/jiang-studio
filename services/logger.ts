const isDev =
  typeof import.meta !== 'undefined' &&
  typeof (import.meta as any).env !== 'undefined' &&
  !!(import.meta as any).env.DEV;

export const debugLog = (...args: unknown[]): void => {
  if (!isDev) return;
  console.log(...args);
};

export const debugWarn = (...args: unknown[]): void => {
  if (!isDev) return;
  console.warn(...args);
};

