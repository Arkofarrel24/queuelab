/** Runs the replications in a Web Worker and reports their progress. */

/**
 * @param {object} config        simulation configuration (no functions; it must be clonable to the worker)
 * @param {number} replications
 * @param {(done: number, total: number) => void} onProgress
 * @returns {{ result: Promise<{ runs: object[], summary: object, elapsedMs: number }>, cancel: () => void }}
 */
export function runInWorker(config, replications, onProgress) {
  const worker = new Worker(new URL('../sim/worker.js', import.meta.url), { type: 'module' });
  let settle;

  const result = new Promise((resolve, reject) => {
    settle = { resolve, reject };
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        onProgress(data.done, data.total);
      } else if (data.type === 'done') {
        worker.terminate();
        resolve({ runs: data.runs, summary: data.summary, elapsedMs: data.elapsedMs });
      } else {
        worker.terminate();
        reject(new Error(data.message));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'The simulation worker failed to load.'));
    };
  });

  worker.postMessage({ config, replications });

  return {
    result,
    cancel() {
      worker.terminate();
      const error = new Error('Simulation cancelled.');
      error.name = 'AbortError';
      settle.reject(error);
    },
  };
}
