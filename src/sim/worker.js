/**
 * Web Worker: runs all replications off the main thread so the page stays
 * responsive while a long simulation is running.
 */

import { runReplications } from './replications.js';

self.onmessage = ({ data }) => {
  const { config, replications } = data;
  try {
    const started = performance.now();
    const { runs, summary } = runReplications(config, replications, (done, total) => {
      self.postMessage({ type: 'progress', done, total });
    });
    self.postMessage({ type: 'done', runs, summary, elapsedMs: performance.now() - started });
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
};
