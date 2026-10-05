/**
 * Navigation between layers.
 *
 * The active layer is decided by the hash in the address (#setup, #results,
 * #live). That makes the browser's back button work, and gives every layer
 * its own address that can be shared.
 */

const ORDER = ['setup', 'results', 'live'];
const TITLES = { setup: 'Setup', results: 'Results', live: 'Live' };

/**
 * @param {(active: string, previous: string | null) => void} onChange
 */
export function createLayers(onChange) {
  const layers = ORDER.map((name) => document.querySelector(`[data-layer="${name}"]`));
  const links = [...document.querySelectorAll('[data-layer-link]')];
  let previous = null;

  function current() {
    const name = window.location.hash.slice(1);
    return ORDER.includes(name) ? name : ORDER[0];
  }

  function apply({ moveFocus }) {
    const active = current();
    const activeIndex = ORDER.indexOf(active);

    layers.forEach((layer, index) => {
      let state = 'active';
      if (index < activeIndex) state = 'behind';
      else if (index > activeIndex) state = 'ahead';
      layer.dataset.state = state;
      // A layer underneath keeps only its title strip; its content must not
      // be reachable by keyboard or screen reader. A layer that has not been
      // opened yet is disabled entirely.
      layer.inert = state === 'ahead';
      layer.querySelector('.layer__body').inert = state !== 'active';
    });

    for (const link of links) {
      if (link.dataset.layerLink === active) link.setAttribute('aria-current', 'step');
      else link.removeAttribute('aria-current');
    }

    document.title = `${TITLES[active]} · QueueLab`;
    if (moveFocus) {
      layers[activeIndex].querySelector('.layer__title').focus({ preventScroll: true });
    }
    if (active !== previous) {
      onChange(active, previous);
      previous = active;
    }
  }

  window.addEventListener('hashchange', () => apply({ moveFocus: true }));
  apply({ moveFocus: false });

  return {
    get current() {
      return current();
    },
    go(name) {
      window.location.hash = name;
    },
  };
}
