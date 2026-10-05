# QueueLab: a service queue simulator

A web app for learning queueing theory. You describe a queueing system and
get two answers side by side: the result of the **analytic formulas** and the
result of a **discrete-event simulation**. Comparing them shows when the
formulas can be trusted and when they cannot.

Built with plain HTML, CSS, and JavaScript. There is no framework and no build
step, so it can be hosted on GitHub Pages as is.

## Contents

- [What it does](#what-it-does)
- [Running it](#running-it)
- [Queueing theory in brief](#queueing-theory-in-brief)
- [Analytic vs. simulation](#analytic-vs-simulation)
- [How the simulation engine works](#how-the-simulation-engine-works)
- [Design decisions](#design-decisions)
- [Validation](#validation)
- [Project structure](#project-structure)
- [Limitations](#limitations)
- [References](#references)

## What it does

The app is made of three stacked layers. A layer you have passed keeps peeking
out at the top and can be clicked to go back.

| Layer | Content |
|---|---|
| **01 Setup** | The parameter form, six quick examples, a summary ticket that evaluates the formulas instantly, and a preview stage: a queue of little people that keeps running on the parameters you have entered. A warning appears automatically when ρ ≥ 1. |
| **02 Results** | A table of six metrics (ρ, L, Lq, W, Wq, P₀): the formula value, the simulation mean with its 95% confidence interval, the percentage difference, and a small plot of where the formula falls relative to the interval. |
| **03 Live** | An animation of one replication (customers arrive, queue, get served, leave), a chart of queue length over time, and a histogram of waiting times. The speed can be adjusted, paused, or skipped to the end. |

Parameters you can set:

- arrival rate λ and service rate per server μ (customers per hour),
- number of servers c, from 1 to 10,
- queue discipline: FIFO, LIFO, or two-class non-preemptive priority,
- system capacity: unlimited or limited (M/M/c/K),
- run length, warm-up period, number of replications, and random seed.

## Running it

### On your own machine

The app uses ES modules, and browsers refuse to load modules from a `file://`
address. So the page has to be opened through a local server; double-clicking
`index.html` will not work.

From the project folder:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. If Node is installed, `npm start` runs the
same command.

### On GitHub Pages

1. Push the contents of this folder to a GitHub repository.
2. Open **Settings → Pages**, choose **Deploy from a branch**, branch `main`,
   folder `/ (root)`.
3. Wait about a minute, then open the address GitHub gives you.

Nothing needs to be built. The only external files are Chart.js and the
fonts, both loaded from a CDN.

### Running the tests

Requires Node 20 or newer. There are no dependencies to install.

```bash
npm test
```

```bash
npm run validate
```

`npm test` runs 79 tests. `npm run validate` prints a table comparing theory
and simulation for the reference cases.

## Queueing theory in brief

A queueing system has three parts: customers who arrive, a waiting line, and
servers. Queueing theory answers questions such as "how long does a customer
wait on average?" and "how many servers are enough?".

### Kendall's notation

A queueing system is written as **A/S/c/K**:

| Position | Meaning | In this app |
|---|---|---|
| A | distribution of interarrival times | M (exponential) |
| S | distribution of service times | M (exponential) |
| c | number of servers | 1 to 10 |
| K | system capacity: those waiting + those in service | unlimited (not written) or a number |

The letter **M** stands for *Markov* or *memoryless*: the distribution is
exponential. Arrivals whose interarrival times are exponential with mean 1/λ
are the same thing as a Poisson process with rate λ. So **M/M/3** means
Poisson arrivals, exponential service, three servers, and an unlimited queue;
**M/M/1/5** means one server with at most five customers in the system.

### Basic quantities

| Symbol | Meaning |
|---|---|
| λ | arrival rate |
| μ | service rate of one server |
| a = λ/μ | offered load (Erlangs) |
| ρ = λ/(cμ) | traffic intensity; as long as ρ < 1 it equals the server utilization |
| L | average number of customers in the system |
| Lq | average number of customers in the queue |
| W | average time in the system (waiting + service) |
| Wq | average waiting time |
| P₀ | probability that the system is empty |

Two relationships hold in every model:

- **Little's law**: L = λ·W and Lq = λ·Wq.
- W = Wq + 1/μ.

### The formulas for each model

**M/M/1**

```
ρ  = λ/μ
P₀ = 1 − ρ
L  = ρ / (1 − ρ)
Lq = ρ² / (1 − ρ)
W  = 1 / (μ − λ)
Wq = ρ / (μ − λ)
```

**M/M/c**, with the Erlang C formula for the probability that a customer has
to wait:

```
P₀      = 1 / [ Σ(n=0..c−1) aⁿ/n!  +  aᶜ / (c!·(1 − ρ)) ]
C(c, a) = [ aᶜ / (c!·(1 − ρ)) ] · P₀
Lq      = C(c, a) · ρ / (1 − ρ)
Wq      = Lq / λ
W       = Wq + 1/μ
L       = λ·W
```

**M/M/c/K**, from the balance equations of a birth-death process:

```
p_n   = p₀ · aⁿ / n!                  for n ≤ c
p_n   = p₀ · aⁿ / (c!·c^(n−c))        for c ≤ n ≤ K
P_K   = p_K                           probability a customer is rejected
λ_eff = λ·(1 − P_K)
L     = Σ n·p_n          Lq = Σ (n − c)·p_n
W     = L / λ_eff        Wq = Lq / λ_eff
ρ     = λ_eff / (cμ)
```

**Non-preemptive priority, two classes, equal μ** (Cobham's formula):

```
W₀          = C(c, a) / (cμ)
Wq priority = W₀ / (1 − σ₁)                  σ₁ = p·ρ, p = share of the priority class
Wq regular  = W₀ / [ (1 − σ₁)·(1 − ρ) ]
```

### The stability condition

With an unlimited queue, the formulas above only hold when **ρ < 1**. When
ρ ≥ 1, customers arrive faster than all servers together can serve them, the
queue grows without bound, and a steady state is never reached. The app shows
a warning for this case and leaves the analytic column empty.

With limited capacity the system is always stable. The excess load shows up
as customers being turned away, not as a queue that keeps growing.

### The queue discipline does not change the averages

FIFO, LIFO, and non-preemptive priority give the **same** average L, Lq, W,
and Wq. None of them looks at service times when choosing a customer, and
none interrupts a service in progress, so the number of customers in the
system over time is unaffected.

What changes is the *distribution* of waiting times. Under LIFO some
customers are served almost at once while others wait a very long time. Under
priority, waiting time moves from the priority class to the regular class.
This effect is visible in the histogram on the Live layer and in the
per-class table on the Results layer.

## Analytic vs. simulation

| | Analytic | Simulation |
|---|---|---|
| How it works | plug numbers into formulas | imitate arrivals and services one by one with random numbers |
| Result | one exact value | an estimate, reported with a confidence interval |
| Valid for | steady state, under strict assumptions (exponential, ρ < 1) | any situation that can be programmed, including the start-up phase and unstable systems |
| Speed | instant | proportional to the number of customers simulated |
| Weakness | no formula once an assumption is broken | takes time, and the result always carries random error |

Each tests the other. The formulas are used to make sure the simulation
engine is correct; the simulation is used to see behavior the formulas do not
cover.

### When the two disagree

The models in this app satisfy every assumption of the formulas, so in the
long run the two always agree. Differences appear because the simulation is
finite:

1. **ρ ≥ 1.** There is no steady state. The formulas have no answer, while
   the simulated figures depend on the run length.
2. **ρ close to 1.** The system needs a very long time to reach steady state.
   The quick example "Nearly saturated" (ρ = 0.97) shows this with the default
   settings: four of the six metrics fall outside the interval, off by about
   16%.
3. **Warm-up too short.** The system starts empty, and the quiet start gets
   counted.
4. **Too few or too short replications.** The interval is wide, so a large
   difference may not mean anything.
5. **Chance.** A 95% interval fails to contain the true value about 1 time in
   20.

## How the simulation engine works

The engine lives in [`src/sim/engine.js`](src/sim/engine.js) and never touches
the DOM, so it can run in Node for testing.

### A clock that jumps

A discrete-event simulation does not advance second by second. The simulation
clock jumps straight to the next *event*, because nothing changes between two
events. The whole engine is a single loop:

1. take the earliest event from the list,
2. advance the clock to that event's time,
3. change the state of the system,
4. schedule new events.

### Four kinds of events

| Event | What happens |
|---|---|
| `ARRIVAL` | Schedules the next arrival. Then: system full → rejected; a server is free → served at once and its `DEPARTURE` is scheduled; otherwise → joins the line. |
| `DEPARTURE` | The customer leaves. If the line is not empty, the server calls the next customer according to the queue discipline. |
| `WARMUP_END` | The statistics are reset to zero. Customers who are waiting or being served are left untouched. |
| `END` | The simulation stops. |

### The future event list

Scheduled events are kept in the *future event list*, a *binary min-heap*
keyed by `(time, sequence number)`. The sequence number decides which event
goes first when two fall at the same time, which keeps the results
deterministic.

### Two kinds of statistics

- **Time averages** (L, Lq, ρ, P₀): each time the clock advances by Δt, the
  engine adds `value × Δt` to an accumulator, before the state changes. At the
  end the total is divided by the observation time. This is the area under the
  curve divided by its width.
- **Per-customer averages** (W, Wq): summed over the customers who arrive
  after the warm-up, then divided by their count.

### Random numbers

`Math.random()` cannot be seeded. The engine uses the **sfc32** generator,
whose initial state is `(seed, replication index, stream number)`. Exponential
times are generated by the inverse transform: `x = −ln(1 − U) / rate`.

Arrivals, services, and priority classes each have their own random stream. As
a result, changing the queue discipline does not change the sequence of
arrival times, and two scenarios are compared on exactly the same arrival
pattern (*common random numbers*).

### Warm-up and replications

The system starts empty, which is not representative of steady state. Data
collected during the warm-up period is discarded. The run length you enter
includes the warm-up: a run of 1,000 hours with a 100-hour warm-up means 900
observed hours.

A single run gives just one random number per metric. The simulation is
repeated R times with different random sequences, and the mean is reported
with a 95% confidence interval:

```
x̄ ± t(0.975; R−1) · s / √R
```

## Design decisions

| Decision | Reason |
|---|---|
| The simulation engine is fully separate from the display | It can be tested in Node without a browser, and the animation runs the same engine as the results table, not an imitation. |
| ES modules without a bundler | No build step. The trade-off is that local development needs an HTTP server. |
| sfc32 instead of Mulberry32 | Mulberry32 has a single cycle of length 2³². With dozens of replications and three streams, two streams can overlap, and the replications would no longer be independent. sfc32 has a 128-bit state. |
| A separate random stream per source of randomness | Comparisons between disciplines are fair, because the arrival pattern is the same. |
| K means system capacity, not queue length | It matches Kendall's notation, so the textbook formulas can be used as they are. |
| Two-class, non-preemptive priority | The most common kind at service counters, and it has an analytic formula (Cobham) to compare against. |
| M/M/c/K is computed on a logarithmic scale | The weights aⁿ exceed the floating-point range when λ is far above cμ and K is large. |
| The run length includes the warm-up | It follows the convention of simulation packages such as Arena. |
| Replications run in a Web Worker | The page stays responsive, and a long simulation can be cancelled. |
| The animation replays the first replication | Its numbers can be matched with one of the replications in the table; the seed is the same. |
| The preview on the Setup layer runs the real engine | It is not a video or decoration: changing λ, μ, or the number of servers changes the visible queue at once. It can be paused, and it stays still from the start when the operating system is set to reduce motion. |
| Animation tokens follow the engine's state | The display can never drift from the simulation. When the speed is too high for the eye to follow, tokens jump to their place without motion. |
| The queue-length chart uses per-bin averages | A long simulation has millions of points. What is stored is the area per bin, so merging bins loses no precision. |
| The histogram separates customers who did not wait | In theory they are a probability mass at zero, not part of the curve. |
| Hours in the engine, minutes in the display | Rates per hour are the convention in queueing problems; minutes are easier to read for waiting times. |
| A workload limit of 60 million customers | Keeps the browser from running out of time or memory on extreme inputs. |

### Interface design

- **Three stacked layers.** Each layer has its own color (yellow, paper, dark)
  so your position in the flow is always clear. The address changes with the
  layer (`#setup`, `#results`, `#live`), so the browser's back button works.
- **Colors with a fixed meaning.** Blue always means analytic, pink always
  means simulation. That meaning is never carried by color alone: there are
  text labels, different shapes (diamonds and bars), and different line
  styles (dashed and solid).
- **Accessibility.** Every control works with the keyboard, focus is clearly
  visible, errors appear under the field they belong to, every chart has a
  text summary (the histogram also has a data table), and the animations do
  not start on their own when the operating system is set to reduce motion.

## Validation

The simulation engine is validated in two ways.

**Against textbook examples.** The analytic formulas are tested on problems
with published answers: the muffler shop M/M/1 and M/M/2 (Heizer & Render) and
the emission inspection station M/M/3/7 (Gross & Harris).

**Against the formulas.** 30 replications × 10,000 hours, warm-up 500 hours:

| Case | Metric | Theory | Simulation (± 95% CI) | Difference |
|---|---|---|---|---|
| M/M/1, λ=8, μ=10 | ρ | 0.8000 | 0.8004 ± 0.0015 | +0.05% |
| | L | 4.0000 | 3.9858 ± 0.0501 | −0.35% |
| | Lq | 3.2000 | 3.1855 ± 0.0490 | −0.45% |
| | W (hours) | 0.5000 | 0.4983 ± 0.0060 | −0.34% |
| | Wq (hours) | 0.4000 | 0.3982 ± 0.0059 | −0.44% |
| | P₀ | 0.2000 | 0.1996 ± 0.0015 | −0.18% |
| M/M/2, λ=8, μ=5 | L | 4.4444 | 4.4294 ± 0.0501 | −0.34% |
| | Lq | 2.8444 | 2.8287 ± 0.0479 | −0.55% |

The automated tests also match the simulation against the formulas for M/M/3,
M/M/5, M/M/1/5, M/M/3/7, M/M/2/2, and priority (Cobham's formula). To pass,
the relative difference must be below 2% and no more than 4 standard errors.

## Project structure

```
.
├── index.html              the three-layer page
├── styles/
│   ├── tokens.css          colors, typography, spacing, per-layer colors
│   ├── base.css            reset and shared components (buttons, fields, cards)
│   ├── layout.css          top bar and the layer stack
│   └── views.css           the content of each layer
├── src/
│   ├── sim/                simulation engine (no DOM)
│   │   ├── engine.js       events, system state, statistics
│   │   ├── event-queue.js  future event list (min-heap)
│   │   ├── waiting-line.js FIFO, LIFO, priority
│   │   ├── rng.js          seeded generator, exponential variates
│   │   ├── replications.js replications and confidence intervals
│   │   └── worker.js       Web Worker wrapper
│   ├── analytic/
│   │   └── formulas.js     M/M/1, M/M/c, M/M/c/K, Erlang C, Cobham
│   ├── stats/              data condensers for the charts (no DOM)
│   │   ├── binned-series.js
│   │   └── wait-histogram.js
│   └── ui/
│       ├── app.js          entry point
│       ├── layers.js       navigation between layers
│       ├── form.js         layer 01
│       ├── hero-preview.js the queue preview on layer 01
│       ├── results-view.js layer 02
│       ├── live-view.js    layer 03
│       ├── queue-canvas.js the animation
│       ├── charts.js       Chart.js charts
│       ├── runner.js       runs the worker
│       └── model.js, format.js, dom.js
├── tests/                  79 tests (node --test)
└── scripts/validate.js     theory vs. simulation table
```

## Limitations

- Exponential distributions only. Models such as M/D/1 or M/G/1 are not
  included.
- All servers are identical, and customers never leave the queue (no balking
  or reneging other than rejection when the system is full).
- Priority has only two classes and is non-preemptive. Per-class formulas are
  available only for a stable, unlimited queue.
- The theoretical curve in the histogram is the FIFO curve. For LIFO and
  priority it is shown as a reference, not a prediction.
- Confidence intervals use the 95% level only.
- In short simulations, the coverage of the intervals for L and Lq is
  slightly below 95% because their distributions are skewed to the right.

## References

- Cobham, A. (1954). Priority assignment in waiting line problems. *Journal of
  the Operations Research Society of America*, 2(1), 70–76.
- Gross, D., Shortle, J. F., Thompson, J. M., & Harris, C. M. (2008).
  *Fundamentals of Queueing Theory* (4th ed.). Wiley.
- Heizer, J., Render, B., & Munson, C. *Operations Management: Sustainability
  and Supply Chain Management*, Module D: Waiting-Line Models. Pearson.
- Kendall, D. G. (1953). Stochastic processes occurring in the theory of
  queues and their analysis by the method of the imbedded Markov chain.
  *Annals of Mathematical Statistics*, 24(3), 338–354.
- Law, A. M. (2015). *Simulation Modeling and Analysis* (5th ed.).
  McGraw-Hill.
- Little, J. D. C. (1961). A proof for the queuing formula: L = λW.
  *Operations Research*, 9(3), 383–387.

Third-party libraries: [Chart.js](https://www.chartjs.org/) (MIT) for the
charts, the Bricolage Grotesque and Fira Code fonts (SIL Open Font License),
and icons adapted from [Lucide](https://lucide.dev/) (ISC).
