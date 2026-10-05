/** Small helpers for building DOM elements without innerHTML. */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Creates an HTML element.
 *
 * @param {string} tag
 * @param {Record<string, string | number | boolean>} [attributes] `class`, `text`, or plain attributes
 * @param {(Node | string | null | undefined | false)[]} [children]
 */
export function h(tag, attributes = {}, children = []) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === false || value === null || value === undefined) continue;
    if (name === 'class') element.className = value;
    else if (name === 'text') element.textContent = value;
    else element.setAttribute(name, value === true ? '' : String(value));
  }
  element.append(...children.filter(Boolean));
  return element;
}

/** Creates an SVG element. */
export function svg(tag, attributes = {}, children = []) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
  element.append(...children);
  return element;
}

/** An icon from the <symbol> sprite in index.html. Decorative, so hidden from screen readers. */
export function icon(name, className = 'icon') {
  return svg('svg', { class: className, 'aria-hidden': 'true' }, [
    svg('use', { href: `#i-${name}` }),
  ]);
}
