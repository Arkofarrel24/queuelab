/**
 * The queue animation on a canvas.
 *
 * This class does not run the simulation. It is only told the state of the
 * simulation engine (who is at which server, who is waiting) and then moves
 * one "token" per customer toward its place. That way what appears on screen
 * is always the real state of the simulation, not an imitation.
 *
 * There are two drawing styles: circles (the Live layer, compact and easy to
 * count) and little people (the preview on the Setup layer, more lively).
 */

import { PRIORITY_CLASS } from '../sim/engine.js';

/** Time (seconds) a token needs to cover about 63% of its distance. */
const GLIDE_SECONDS = 0.09;
const REJECT_SECONDS = 0.7;
const TWO_PI = Math.PI * 2;

const STATE = Object.freeze({ QUEUE: 'queue', SERVICE: 'service', LEAVING: 'leaving' });

export class QueueCanvas {
  #canvas;
  #context;
  #colors;
  #servers = 1;
  #capacity = Infinity;
  #layout = null;
  /** @type {Map<number, object>} one token per customer id */
  #tokens = new Map();
  #rejections = [];
  #hiddenInQueue = 0;
  #figures;
  #figureScale;
  #minHeight;
  /** Seconds since drawing started; drives the walking bob of the figures. */
  #time = 0;

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} [options]
   * @param {boolean} [options.figures]    draw customers as little people instead of circles
   * @param {number} [options.figureScale] enlargement of the people figures
   * @param {number} [options.minHeight]   minimum canvas height in pixels
   */
  constructor(canvas, { figures = false, figureScale = 1, minHeight } = {}) {
    this.#canvas = canvas;
    this.#context = canvas.getContext('2d');
    this.#figures = figures;
    this.#figureScale = figureScale;
    this.#minHeight = minHeight;
    const style = getComputedStyle(canvas);
    const color = (name) => style.getPropertyValue(name).trim();
    this.#colors = {
      regular: color('--pink'),
      priority: color('--yellow'),
      rejected: color('--red'),
      progress: color('--lime'),
      line: color('--line'),
      muted: color('--on-surface-muted'),
      ink: color('--ink'),
    };
    // Shirt colors for the figures. Yellow is left out: it marks the priority class.
    this.#colors.outfits = [this.#colors.regular, color('--blue'), this.#colors.progress];
  }

  configure({ servers, capacity }) {
    this.#servers = servers;
    this.#capacity = capacity;
    this.clear();
    this.resize();
  }

  clear() {
    this.#tokens.clear();
    this.#rejections = [];
    this.#hiddenInQueue = 0;
  }

  /** Recomputes the layout from the canvas's current width. */
  resize() {
    const canvas = this.#canvas;
    const width = canvas.clientWidth;
    if (width === 0) return;

    const figures = this.#figures;
    const compact = width < 560;
    let radius = compact ? 7 : 9;
    if (figures) radius = Math.round((compact ? 8 : 10) * this.#figureScale);
    const spacing = radius * 2 + (compact ? 6 : 8);
    // A person is taller than wide, so rows and servers are spaced further apart.
    const rowSpacing = figures ? radius * 3.5 : spacing;
    const tokenHalfHeight = figures ? radius * 1.7 : radius;
    const pad = compact ? 12 : 20;
    const labelHeight = 26;
    const boothWidth = compact ? 56 : 92;
    const exitWidth = compact ? 30 : 64;
    const boothGap = 8;
    let boothHeight = compact ? 30 : 36;
    if (figures) boothHeight = radius * 3.8;

    const boothsHeight = this.#servers * boothHeight + (this.#servers - 1) * boothGap;
    const minHeight = this.#minHeight ?? (compact ? 230 : 270);
    const height = Math.max(minHeight, pad * 2 + labelHeight + boothsHeight);
    const top = pad + labelHeight;
    const bottom = height - pad;
    const centerY = (top + bottom) / 2;

    const boothX = width - pad - exitWidth - boothWidth;
    const boothTop = centerY - boothsHeight / 2;
    const booths = Array.from({ length: this.#servers }, (_, i) => {
      const y = boothTop + i * (boothHeight + boothGap);
      return {
        x: boothX,
        y,
        width: boothWidth,
        height: boothHeight,
        tokenX: boothX + boothWidth - boothHeight / 2 - 4,
        tokenY: y + boothHeight / 2,
      };
    });

    // The waiting line: its head is on the right, next to the servers. Extra
    // rows appear alternately below and above the middle row.
    const headX = boothX - spacing * 1.4;
    const entranceX = pad + (compact ? 8 : 36);
    const perRow = Math.max(1, Math.floor((headX - entranceX) / spacing) + 1);
    const halfRows = Math.max(
      0,
      Math.floor((Math.min(centerY - top, bottom - centerY) - tokenHalfHeight) / rowSpacing),
    );
    const rowCount = 1 + 2 * halfRows;
    const waitingRoom = this.#capacity === Infinity ? Infinity : this.#capacity - this.#servers;
    const slotCount = Math.min(perRow * rowCount, waitingRoom);
    const slots = Array.from({ length: slotCount }, (_, k) => {
      const row = Math.floor(k / perRow);
      const offset = row % 2 === 1 ? (row + 1) / 2 : -row / 2;
      return { x: headX - (k % perRow) * spacing, y: centerY + offset * rowSpacing };
    });

    const ratio = window.devicePixelRatio || 1;
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    this.#context.setTransform(ratio, 0, 0, ratio, 0, 0);

    this.#layout = {
      width,
      height,
      pad,
      radius,
      centerY,
      bottom,
      booths,
      slots,
      entranceX,
      headX,
      exitX: width + radius * 3,
      compact,
      showWaitingRoom: Number.isFinite(waitingRoom) && waitingRoom <= perRow * rowCount,
    };
  }

  /**
   * Brings the tokens in line with the state of the simulation.
   *
   * @param {import('../sim/engine.js').QueueSimulation} simulation
   * @param {boolean} animate false = tokens jump straight to their place (used
   *   when the simulation runs too fast for the eye to follow, or when the
   *   user has asked for reduced motion)
   */
  sync(simulation, animate) {
    const layout = this.#layout;
    if (!layout) return;
    const present = new Set();

    const place = (customer, x, y, state) => {
      let token = this.#tokens.get(customer.id);
      if (!token) {
        token = {
          id: customer.id,
          customer,
          x: animate ? -layout.radius * 2 : x,
          y: animate ? layout.centerY : y,
          alpha: 1,
        };
        this.#tokens.set(customer.id, token);
      }
      token.targetX = x;
      token.targetY = y;
      token.state = state;
      if (!animate) {
        token.x = x;
        token.y = y;
      }
      present.add(customer.id);
    };

    simulation.servers.forEach((customer, i) => {
      if (customer) place(customer, layout.booths[i].tokenX, layout.booths[i].tokenY, STATE.SERVICE);
    });

    const waiting = simulation.line.peek(layout.slots.length);
    waiting.forEach((customer, k) => place(customer, layout.slots[k].x, layout.slots[k].y, STATE.QUEUE));
    this.#hiddenInQueue = simulation.queueLength - waiting.length;

    for (const token of this.#tokens.values()) {
      if (present.has(token.id) || token.state === STATE.LEAVING) continue;
      if (!animate) {
        this.#tokens.delete(token.id);
      } else {
        // Customers who finished service walk out to the right; the rest fade in place.
        if (token.state === STATE.SERVICE) token.targetX = layout.exitX;
        token.state = STATE.LEAVING;
      }
    }
  }

  /** Shows a rejected customer: steps in briefly, then drops out. */
  reject(customer) {
    if (this.#rejections.length < 12) this.#rejections.push({ customer, age: 0 });
  }

  /**
   * @param {number} dt    seconds since the previous frame
   * @param {number} clock simulated time currently on display
   */
  draw(dt, clock) {
    const layout = this.#layout;
    if (!layout) return;
    const context = this.#context;
    context.clearRect(0, 0, layout.width, layout.height);
    this.#time += dt;

    this.#drawLabels();
    this.#drawWaitingRoom();
    this.#drawBooths();

    // Exponential decay: the motion is equally smooth on 60 Hz and 120 Hz screens.
    const glide = 1 - Math.exp(-dt / GLIDE_SECONDS);
    for (const token of this.#tokens.values()) {
      token.x += (token.targetX - token.x) * glide;
      token.y += (token.targetY - token.y) * glide;
      if (token.state === STATE.LEAVING) {
        token.alpha -= dt * 4;
        if (token.alpha <= 0 || token.x > layout.width + layout.radius) {
          this.#tokens.delete(token.id);
          continue;
        }
      }
      if (this.#figures) this.#drawFigure(token, clock);
      else this.#drawToken(token, clock);
    }

    this.#drawRejections(dt);
    this.#drawOverflow();
  }

  #drawLabels() {
    const { pad, width, booths, headX, entranceX, compact } = this.#layout;
    const context = this.#context;
    context.font = `600 ${compact ? 10 : 11}px "Fira Code", ui-monospace, monospace`;
    context.fillStyle = this.#colors.muted;
    context.textBaseline = 'top';

    context.textAlign = 'left';
    context.fillText('ARRIVE', pad, pad);
    context.textAlign = 'center';
    context.fillText('QUEUE', (entranceX + headX) / 2 + 20, pad);
    context.fillText('SERVERS', booths[0].x + booths[0].width / 2, pad);
    context.textAlign = 'right';
    context.fillText('EXIT', width - pad, pad);
  }

  /** With a limited capacity, the waiting places are drawn as empty circles. */
  #drawWaitingRoom() {
    const { slots, radius, showWaitingRoom } = this.#layout;
    if (!showWaitingRoom) return;
    const context = this.#context;
    context.save();
    context.strokeStyle = this.#colors.muted;
    context.globalAlpha = 0.55;
    context.lineWidth = 1.5;
    context.setLineDash([3, 3]);
    for (const slot of slots) {
      context.beginPath();
      context.arc(slot.x, slot.y, radius + 2, 0, TWO_PI);
      context.stroke();
    }
    context.restore();
  }

  #drawBooths() {
    const { booths, compact } = this.#layout;
    const context = this.#context;
    context.font = `700 ${compact ? 11 : 13}px "Fira Code", ui-monospace, monospace`;
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    context.lineWidth = 2;
    booths.forEach((booth, i) => {
      context.strokeStyle = this.#colors.line;
      context.strokeRect(booth.x, booth.y, booth.width, booth.height);
      context.fillStyle = this.#colors.line;
      context.fillText(String(i + 1), booth.x + 8, booth.y + booth.height / 2 + 1);
    });
  }

  #drawToken(token, clock) {
    const { radius } = this.#layout;
    const context = this.#context;
    const { customer } = token;
    const isPriority = customer.priorityClass === PRIORITY_CLASS.HIGH;

    context.save();
    context.globalAlpha = Math.max(token.alpha, 0);
    context.translate(token.x, token.y);

    // Service progress ring: it closes exactly when the customer's service ends.
    if (token.state === STATE.SERVICE) {
      const done = this.#serviceProgress(customer, clock);
      context.strokeStyle = this.#colors.progress;
      context.lineWidth = 3;
      context.beginPath();
      context.arc(0, 0, radius + 4.5, -Math.PI / 2, -Math.PI / 2 + done * TWO_PI);
      context.stroke();
    }

    // A different shape per class, so the classes are not told apart by color alone.
    context.fillStyle = isPriority ? this.#colors.priority : this.#colors.regular;
    context.strokeStyle = this.#colors.line;
    context.lineWidth = 2;
    context.beginPath();
    if (isPriority) {
      const r = radius + 1;
      context.moveTo(0, -r);
      context.lineTo(r, 0);
      context.lineTo(0, r);
      context.lineTo(-r, 0);
      context.closePath();
    } else {
      context.arc(0, 0, radius, 0, TWO_PI);
    }
    context.fill();
    context.stroke();
    context.restore();
  }

  /** The part of the service that has elapsed, from 0 to 1. */
  #serviceProgress(customer, clock) {
    const span = customer.serviceEnd - customer.serviceStart;
    return span > 0 ? Math.min(Math.max((clock - customer.serviceStart) / span, 0), 1) : 1;
  }

  /** A simple person: a round head and a body in a colored shirt. */
  #drawFigure(token, clock) {
    const { radius: r } = this.#layout;
    const context = this.#context;
    const { customer } = token;
    const isPriority = customer.priorityClass === PRIORITY_CLASS.HIGH;

    // While still on the move, the figure bobs up and down as if walking.
    const distance = Math.abs(token.targetX - token.x) + Math.abs(token.targetY - token.y);
    const bob = distance > 1.5 ? Math.sin(this.#time * 16 + token.id) * 1.6 : 0;

    context.save();
    context.globalAlpha = Math.max(token.alpha, 0);
    context.translate(token.x, token.y + bob);

    // Service progress: a bar under the feet that fills up until service ends.
    if (token.state === STATE.SERVICE) {
      const done = this.#serviceProgress(customer, clock);
      context.fillStyle = this.#colors.muted;
      context.globalAlpha *= 0.45;
      context.fillRect(-r, r * 1.62, r * 2, 3);
      context.globalAlpha = Math.max(token.alpha, 0);
      context.fillStyle = this.#colors.progress;
      context.fillRect(-r, r * 1.62, r * 2 * done, 3);
    }

    const outfits = this.#colors.outfits;
    context.strokeStyle = this.#colors.line;
    context.lineWidth = 2;

    // Body
    context.fillStyle = isPriority ? this.#colors.priority : outfits[token.id % outfits.length];
    context.beginPath();
    if (context.roundRect) context.roundRect(-r * 0.8, -r * 0.3, r * 1.6, r * 1.7, [r * 0.7, r * 0.7, 2, 2]);
    else context.rect(-r * 0.8, -r * 0.3, r * 1.6, r * 1.7);
    context.fill();
    context.stroke();

    // Head
    context.fillStyle = this.#colors.line;
    context.beginPath();
    context.arc(0, -r * 0.95, r * 0.55, 0, TWO_PI);
    context.fill();

    // The priority class is marked by a diamond above the head, not by shirt color alone.
    if (isPriority) {
      const top = -r * 2.1;
      const half = r * 0.38;
      context.fillStyle = this.#colors.priority;
      context.beginPath();
      context.moveTo(0, top - half);
      context.lineTo(half, top);
      context.lineTo(0, top + half);
      context.lineTo(-half, top);
      context.closePath();
      context.fill();
    }
    context.restore();
  }

  #drawRejections(dt) {
    const { radius, centerY, entranceX } = this.#layout;
    const context = this.#context;
    this.#rejections = this.#rejections.filter((rejection) => {
      rejection.age += dt / REJECT_SECONDS;
      const t = rejection.age;
      if (t >= 1) return false;

      const x = -radius + (entranceX + radius * 2) * Math.min(t * 2.2, 1);
      const fall = Math.max(t - 0.45, 0) / 0.55;
      const y = centerY + fall * fall * 70;
      const size = radius + 1;

      context.save();
      context.globalAlpha = 1 - fall;
      context.translate(x, y);
      context.fillStyle = this.#colors.rejected;
      context.strokeStyle = this.#colors.line;
      context.lineWidth = 2;
      context.fillRect(-size, -size, size * 2, size * 2);
      context.strokeRect(-size, -size, size * 2, size * 2);
      context.strokeStyle = this.#colors.ink;
      context.beginPath();
      context.moveTo(-size / 2, -size / 2);
      context.lineTo(size / 2, size / 2);
      context.moveTo(size / 2, -size / 2);
      context.lineTo(-size / 2, size / 2);
      context.stroke();
      context.restore();
      return true;
    });
  }

  #drawOverflow() {
    if (this.#hiddenInQueue <= 0) return;
    const { pad, bottom, compact } = this.#layout;
    const context = this.#context;
    context.font = `700 ${compact ? 12 : 14}px "Fira Code", ui-monospace, monospace`;
    context.textAlign = 'left';
    context.textBaseline = 'bottom';
    context.fillStyle = this.#colors.priority;
    context.fillText(`+${this.#hiddenInQueue.toLocaleString('en-US')} more in the queue`, pad, bottom + 6);
  }
}
