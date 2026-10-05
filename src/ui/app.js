/**
 * Application entry point: wires together the form, the simulation worker,
 * and the three layers.
 *
 * The flow goes one way. The form produces a configuration; the worker runs
 * all replications; the outcome, together with the analytic results for the
 * same configuration, is handed to the Results layer and the Live layer.
 */

import { analyze } from '../analytic/formulas.js';
import { createForm } from './form.js';
import { createHeroPreview } from './hero-preview.js';
import { createLayers } from './layers.js';
import { createLiveView } from './live-view.js';
import { markResultsStale, renderResults } from './results-view.js';
import { runInWorker } from './runner.js';

const live = createLiveView();
const hero = createHeroPreview();
let job = null;
let hasRun = false;

function markStale(stale) {
  markResultsStale(stale);
  live.markStale(stale);
}

const form = createForm({
  onChange() {
    if (hasRun) markStale(true);
  },

  onSystem: hero.setSystem,

  async onSubmit(config, replications) {
    form.setBusy(true);
    job = runInWorker(config, replications, form.setProgress);
    try {
      const { runs, summary, elapsedMs } = await job.result;
      const run = { config, replications, analytic: analyze(config), runs, summary, elapsedMs };
      hasRun = true;
      renderResults(run);
      live.load(run);
      markStale(false);
      // New results are read from the top, not from the previous scroll position.
      for (const body of document.querySelectorAll('.layer--results .layer__body, .layer--live .layer__body')) {
        body.scrollTop = 0;
      }
      layers.go('results');
    } catch (error) {
      if (error.name !== 'AbortError') {
        form.showRunError(`The simulation could not run: ${error.message}`);
      }
    } finally {
      job = null;
      form.setBusy(false);
    }
  },
});

form.onCancel(() => job?.cancel());

const layers = createLayers((active) => {
  hero.setActive(active === 'setup');
  if (active === 'live') live.activate();
  else live.deactivate();
});

renderResults(null);
