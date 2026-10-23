# Benchmarks

How WAMR3D is measured against three.js, where results are kept, and how they reach the website. Guidance on what to optimize and how to profile a change is in [PERFORMANCE.md](PERFORMANCE.md).

Benchmarks take minutes to hours. Run them for a release, a performance change that needs numbers, or when asked; correctness checks are in [TESTING.md](TESTING.md). Never publish a number that was not measured.

## Prerequisites

- A release build: `node engine/bindings/build.mjs` (benchmarks load `dist/wamr3d`).
- `npm install` at the root for the Node benchmarks (they import the pinned `three`).
- For browser benchmarks: the server running (`node examples/browser/serve.mjs`), Chrome or Edge with WebGPU.
- A quiet machine: close other GPU work, plug in a laptop, run one benchmark at a time, and stop leftover headless browsers ([CONFIGURATION.md](CONFIGURATION.md#7-troubleshooting)).

## Suites

| Command (from the repository root) | Measures | Output file |
|---|---|---|
| `node bench/bench.mjs` | low-level API vs three.js in Node.js: start-up (module size, instantiate time) and workloads; 5 warm-up runs, median of 25 samples | `bench.txt` |
| `node bench/compat.mjs` | object API (`wamr3d/compat`) vs three.js in Node.js, each library in its own process | `compat.txt` |
| `node bench/math.mjs` | small math as low-level Wasm classes and as `wamr3d/math` values vs three.js, and a mixed update of 10,000 objects; each library in its own process, under a minute | `math.txt` |
| `node examples/showcase/check.mjs --measure --size=<W>x<H>` | the showcase in the browser: fps, CPU update and submit time for separate and instanced meshes, all eight paths; options `--counts=2000,10000,50000`, `--modes=objects,instanced`, `--engines=…`, `--browser=chrome|edge` | `showcase-<W>x<H>.txt` |
| `node examples/showcase/check.mjs --measure --counts=100000 --modes=instanced --size=<W>x<H>` | 100,000 instanced bodies | `showcase100k-<W>x<H>.txt` |
| `node examples/compare/measure.mjs --gpu --size=<W>x<H>` | the comparison scene, one engine per page load (3 s warm-up, 8 s sample), including `native-mix` and `native-mix-webgl`; options include `--engines=…`, `--browser=chrome|edge` | `compare-<W>x<H>.txt` |

The showcase measurement takes about four minutes per resolution. Full runs use `1280x720`, `1920x1080`, `2560x1440` and `3840x2160`.

The mixed showcase engines are `wamr3d-mix` and `wamr3d-mix-webgl`; compare them with `wamr3d` and `wamr3d-webgl` for JS math plus batched transforms versus Wasm Euler transforms. `wamr3d-api` and `wamr3d-api-webgl` provide the three.js-style JS object API comparison.

## Recording a run

There is one results folder, `bench/results/`, holding the last run only: a new run replaces its logs, and git history keeps the older ones. Paths and links to it never change.

1. Run `powershell -ExecutionPolicy Bypass -File bench\run-browser.ps1 -Node`: it removes the previous logs, runs the Node.js and browser suites unattended, writes each output to `bench/results/` with the file names above and keeps a `run-log.txt`. Without `-Node` only the browser logs are replaced. Run every size you want shown in the same run. (By hand: redirect stdout, e.g. `node bench/bench.mjs > bench/results/bench.txt`, after deleting the old logs.)
2. Note the machine (CPU, GPU, browser version) and anything unusual in `STATUS.md` under "Benchmarks".
3. Right after the run, regenerate the website's data: `node website/scripts/benchmark-data.mjs` reads `bench/results/` and writes `website/src/data/benchmarks.js`. The dates shown come from the log files' modification times. It reads the UTF-16 and code-page-437 output of the PowerShell script as written. Configurations that are missing or did not parse are listed as failures, not filled in; sizes and suites that were not run are left out.
4. Update the figures quoted in [README.md](README.md) only from that run, with its date.

## Reading results

- Each browser configuration runs once per command; differences of a few percent between runs are noise.
- Sessions are not comparable: background load, drivers and browser updates move every engine, three.js included. Compare engines, or builds, within one session.
- Report slower cases as well as faster ones.

## Last run

| Run | Scope | Tree |
|---|---|---|
| [`bench/results/`](bench/results/), 2026-10-23 | Node.js (`bench.txt`, `compat.txt`, `math.txt`); showcase (2,000, 10,000 and 50,000 separate and instanced bodies) at 1280×720 and 3840×2160; 100,000 instanced and the comparison scene at 3840×2160; shown on the website | 0.9.4 |

i9-10900X, RTX 2070 SUPER, Chrome 156.0.8078.48 (ANGLE on Direct3D 11), Node.js 24.20, Windows. 1920×1080 and 2560×1440 were not run; the comparison scene was run only at 3840×2160. The 0.9.0 start-up change and the 2026-10-21 renderer changes were measured by profiling, not by these suites ([PERFORMANCE.md](PERFORMANCE.md#known-costs-and-results)).

Headline figures from this run (medians, single runs):

| Measure | WAMR3D | three.js | Lead |
|---|---|---|---|
| 50,000 separate meshes, 3840×2160, frame rate on WebGPU | 16.7 fps | 2.1 fps (WebGPU), 6.7 fps (WebGL) | 8.0× / 2.5× |
| 10,000 separate meshes, 3840×2160, frame rate on WebGPU | 60 fps (display limit) | 12.4 fps (WebGPU), 43.8 fps (WebGL) | 4.8× / 1.4× |
| 100,000 instanced bodies, 3840×2160, frame rate | 40.7 fps (WebGPU), 41.3 fps (WebGL 2) | 12.2 fps (WebGPU), 10.4 fps (WebGL) | 3.3× / 4.0× |
| 100,000 instanced bodies, 3840×2160, CPU scene update | 20.2 ms | 64.2 ms (WebGPU), 83.2 ms (WebGL) | 3.2× / 4.1× |
| Comparison scene, 10,004 objects, 3840×2160, CPU draw submission (WebGPU) | 5.6 ms | 94.4 ms | 16.9× |
| Comparison scene, 10,004 objects, 3840×2160, first frame (WebGPU) | 152 ms | 678 ms | 4.5× |
| Node.js: create, parent and destroy 10,000 objects | 1.58 ms | 38.37 ms | 24.3× |
| Node.js: set 10,000 transforms and update, one batched call | 0.685 ms | 2.530 ms | 3.7× |

Where it is not faster: at 2,000 bodies every engine reaches the 60 fps display limit; with 50,000 instanced bodies the object API ran at 20.9 fps on WebGPU and 17.6 fps on WebGL 2, against 19.7 fps and 20.8 fps for three.js. Single low-level Wasm math calls took 1.26× to 4.05× three.js's time (`bench.txt`), and object-API picking 1.21× (`compat.txt`).
