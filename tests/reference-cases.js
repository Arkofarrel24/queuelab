/**
 * Reference cases for validating the simulation engine.
 *
 * The theoretical values are written out as plain numbers, not computed by
 * this project's code, so that the test does not depend on the module under
 * test. All times are in hours.
 */

export const RUN_SETTINGS = Object.freeze({
  duration: 10_000,
  warmup: 500,
  replications: 30,
  seed: 20_261_005,
});

export const REFERENCE_CASES = Object.freeze([
  {
    name: 'M/M/1, λ = 8/hour, μ = 10/hour',
    config: { arrivalRate: 8, serviceRate: 10, servers: 1 },
    // ρ  = λ/μ           = 0.8
    // P0 = 1 - ρ         = 0.2
    // L  = ρ/(1 - ρ)     = 4
    // Lq = ρ²/(1 - ρ)    = 3.2
    // W  = 1/(μ - λ)     = 0.5 hours
    // Wq = ρ/(μ - λ)     = 0.4 hours
    theory: { rho: 0.8, L: 4, Lq: 3.2, W: 0.5, Wq: 0.4, P0: 0.2 },
  },
  {
    name: 'M/M/2, λ = 8/hour, μ = 5/hour per server',
    config: { arrivalRate: 8, serviceRate: 5, servers: 2 },
    // ρ  = λ/(2μ)            = 0.8
    // P0 = (1 - ρ)/(1 + ρ)   = 1/9
    // L  = 2ρ/(1 - ρ²)       = 40/9
    // Lq = L - λ/μ           = 128/45
    // W  = L/λ               = 5/9 hours
    // Wq = Lq/λ              = 16/45 hours
    theory: { rho: 0.8, L: 40 / 9, Lq: 128 / 45, W: 5 / 9, Wq: 16 / 45, P0: 1 / 9 },
  },
]);
