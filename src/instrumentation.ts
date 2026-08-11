export async function register() {
  // Next.js's gzip middleware adds a 'drain' listener per concurrent streaming
  // response; the default of 10 triggers a false-positive memory-leak warning
  // when several document-proxy or SSE requests are in flight at the same time.
  const { EventEmitter } = await import("events");
  EventEmitter.defaultMaxListeners = 25;
}
