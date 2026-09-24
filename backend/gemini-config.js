// Four total attempts; retry only transient server failures.
export const geminiHttpOptions = {
  retryOptions: {
    attempts: 4,
    initialDelay: 1,
    maxDelay: 8,
    expBase: 2,
    jitter: 1,
    httpStatusCodes: [500, 502, 503, 504],
  },
};
