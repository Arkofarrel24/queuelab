/** Number formatting for display. */

const LOCALE = 'en-US';

/** A number with a fixed number of decimals. NaN becomes a dash, infinity becomes ∞. */
export function formatNumber(value, fractionDigits = 3) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '−∞';
  return value.toLocaleString(LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** The number of decimals adapts to the size of the value, so large numbers stay short. */
export function formatAdaptive(value) {
  const magnitude = Math.abs(value);
  let digits = 3;
  if (magnitude >= 1000) digits = 0;
  else if (magnitude >= 100) digits = 1;
  else if (magnitude >= 10) digits = 2;
  return formatNumber(value, digits);
}

/** A whole number with thousands separators. */
export function formatInteger(value) {
  return formatNumber(Math.round(value), 0);
}

/** A fraction from 0 to 1 as a percentage. */
export function formatPercent(fraction, fractionDigits = 1) {
  const text = formatNumber(fraction * 100, fractionDigits);
  return text === '—' || text === '∞' ? text : `${text}%`;
}

/** A signed relative difference, such as "+1.20%" or "−0.40%". */
export function formatDifference(fraction) {
  if (!Number.isFinite(fraction)) return '—';
  let sign = '';
  if (fraction > 0) sign = '+';
  else if (fraction < 0) sign = '−';
  return `${sign}${formatNumber(Math.abs(fraction) * 100, 2)}%`;
}

/** A large count in words, such as "1.6 million" or "320 thousand". */
export function formatCount(value) {
  if (value >= 1e6) return `${formatNumber(value / 1e6, value >= 1e7 ? 0 : 1)} million`;
  if (value >= 1e4) return `${formatNumber(value / 1e3, 0)} thousand`;
  return formatInteger(value);
}

/** A count with its noun, singular or plural: "1 customer", "27 customers". */
export function pluralize(count, singular, plural = `${singular}s`) {
  return `${formatInteger(count)} ${Math.round(count) === 1 ? singular : plural}`;
}

/** Simulated time in hours as "12 h 05 m". */
export function formatClock(hours) {
  const totalMinutes = Math.floor(hours * 60 + 1e-9);
  const h = Math.floor(totalMinutes / 60);
  const m = String(totalMinutes % 60).padStart(2, '0');
  return `${formatInteger(h)} h ${m} m`;
}

/** A duration in hours, without needless decimals: "1,000 hours", "1 hour". */
export function formatHours(hours) {
  const text = formatNumber(hours, Number.isInteger(hours) ? 0 : 1);
  return `${text} ${hours === 1 ? 'hour' : 'hours'}`;
}
