let defaultPoolSize: number;

try {
  if (typeof navigator !== "undefined") {
    defaultPoolSize = navigator.hardwareConcurrency ?? 4;
  } else {
    defaultPoolSize = (await import("node:os")).cpus().length;
  }
} catch (e) {
  defaultPoolSize = 8;
}

// minus 1 main thread and 4 (by default) libuv pools size
// see http://docs.libuv.org/en/v1.x/threadpool.html
let libuvPoolSize = Number(process.env.UV_THREADPOOL_SIZE);
if (isNaN(libuvPoolSize)) {
  libuvPoolSize = 4;
}
defaultPoolSize = Math.max(4, defaultPoolSize - 1 - libuvPoolSize);

/**
 * Cross-platform aprox number of logical cores
 */
export {defaultPoolSize};
