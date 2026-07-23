// Intentionally minimal. The renderer talks to the local backend over HTTP
// (same origin in production), so no privileged bridge is needed. Kept as a
// dedicated, contextIsolated preload so we never expose Node to the renderer.
window.addEventListener('DOMContentLoaded', () => {
  // no-op
});
