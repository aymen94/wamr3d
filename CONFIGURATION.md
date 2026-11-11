# Configuring a WAMR3D development machine

Everything needed to build the engine, run the checks and benchmarks, and work on the website. Commands run from the repository root unless a step says otherwise. Versions are the ones this repository was last built and checked with (2026-11-11); newer patch releases usually work, but the wasm-bindgen CLI must match exactly.

## 1. Tools

| Tool | Version used | Needed for |
|---|---|---|
| Rust (`rustup`, `cargo`, `rustc`) | 1.99.1, stable | the engine |
| Rust target `wasm32-unknown-unknown` | with the toolchain | the browser module |
| Rust target `wasm32-wasip1` | with the toolchain | running the math tests as WebAssembly (optional) |
| `wasm-bindgen` CLI | **0.2.129, exactly** (pinned as `=0.2.129` in `engine/bindings/Cargo.toml`) | turning the module into the npm package |
| Node.js | 24.20 (any recent LTS with `fetch` and `WebSocket`) | build script, parity checks, benchmarks, website |
| npm | 12.2 | the optional three.js reference, the website |
| Chrome or Edge | a release with WebGPU (Chrome 155 was used) | browser checks, visual parity, browser benchmarks |
| Git | 2.55 | |
| TypeScript | 5.x, through `npx` (not installed in the repository) | checking the typings |

The engine and its package have no runtime dependencies. `three@0.186.1` (root `package.json`) is a development-only reference: tests read committed fixtures and images, so it is needed only to regenerate them, to compare live, or to run the Node benchmarks.

### Install

```sh
# Rust (on Windows without the MSVC build tools: stable-x86_64-pc-windows-gnu)
rustup toolchain install stable
rustup target add wasm32-unknown-unknown wasm32-wasip1

# the wasm-bindgen CLI at the pinned version
cargo install wasm-bindgen-cli --version 0.2.129
#   if that fails to compile (seen on the Windows GNU toolchain), download the
#   wasm-bindgen-0.2.129 release archive from github.com/rustwasm/wasm-bindgen/releases
#   and put wasm-bindgen(.exe) in ~/.cargo/bin

# the pinned three.js reference (development only)
npm install

# the website's dependencies (Vite, Tailwind CSS, and the published wamr3d package)
npm install --prefix website
```

`engine/bindings/build.mjs` looks for `cargo` and `wasm-bindgen` on `PATH` and then in `~/.cargo/bin`, so a rustup installed with `--no-modify-path` still works for the build. Other `cargo` commands need `~/.cargo/bin` on `PATH` (or the full path).

When `wasm-bindgen` in `engine/bindings/Cargo.toml` changes, install the CLI of the same version; a mismatch makes `build.mjs` fail with a schema-version error.

## 2. Compile and build

```sh
cd engine
cargo check --workspace --tests                          # fast type check, all crates and tests
cargo build --workspace --target wasm32-unknown-unknown  # the crates for WebAssembly
cd ..

node engine/bindings/build.mjs            # release build with SIMD -> dist/wamr3d (prints the module size)
node engine/bindings/build.mjs --no-simd  # the same without WebAssembly SIMD
```

`dist/wamr3d` is the npm package: the generated `wamr3d_wasm*` files plus the JavaScript in `engine/bindings/js/`. It is ignored by Git and rebuilt from scratch on every run. Browser pages load it, so **rebuild after every change** to Rust or to `engine/bindings/js/`.

## 3. Serve the examples

```sh
node examples/browser/serve.mjs          # http://localhost:8080 (builds dist/wamr3d if it is missing)
node examples/browser/serve.mjs 8081     # another port
```

Pages: `/examples/webgpu/`, `/examples/showcase/`, `/examples/compare/`, `/examples/ports/<name>/`, `/parity/visual/index.html`. Add `?backend=webgl` to a port to force WebGL 2.

## 4. Tests and checks

The full list of checks, what to run for which change, how to add tests and fixtures, and how to regenerate references is in [TESTING.md](TESTING.md). Most browser checks need a build (`node engine/bindings/build.mjs`) and the server of section 3; `npm install` (the pinned three.js) is needed only to regenerate references or compare live.

## 5. Benchmarks

Commands, output files and the procedure for recording a run and updating the website's figures are in [BENCHMARKS.md](BENCHMARKS.md); what to optimize and how to profile is in [PERFORMANCE.md](PERFORMANCE.md).

## 6. Website

```sh
npm run dev --prefix website      # development server (Vite)
npm run build --prefix website    # website/dist, then scripts/prepare-pages.mjs copies the examples it links
npm run preview --prefix website  # serve the built site
```

The website depends on the **published** `wamr3d` package (`website/package.json`), not on `dist/wamr3d`, so it shows only what has been released. The maintainer changes that dependency and deploys the site; pull requests do not.

## 7. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `cargo: command not found` | `~/.cargo/bin` is not on `PATH`; add it, or call `~/.cargo/bin/cargo`. |
| `build.mjs` fails in `wasm-bindgen` about the schema or version | the CLI does not match the crate; install `wasm-bindgen` 0.2.129. |
| `cargo install wasm-bindgen-cli` fails on Windows GNU | use the prebuilt release binary (section 1). |
| A page shows old behaviour | `dist/wamr3d` is stale: rebuild with `node engine/bindings/build.mjs`, then reload. |
| Browser checks time out or cannot connect | the server is not running on port 8080. |
| A visual case renders black | run it with `--console` to see the page's errors and warnings. |
| WebGPU is unavailable in the headless browser | the scripts pass `--enable-unsafe-webgpu --use-angle=d3d11`; check `chrome://gpu` in a normal window, update the GPU driver, or use `--browser=edge`. |
| Benchmarks are 20-50% slower than usual | leftover headless browsers: in PowerShell, `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" \| Where-Object { $_.CommandLine -match '--headless' }` lists them; stop those using a `wamr3d-` profile folder. |
| `node parity/bindings/check.mjs` or `bench/bench.mjs` cannot find `three` | run `npm install` at the root. |
| Edits made by scripts show every line changed | line endings: most files are LF, the root `README.md` is CRLF; keep each file's endings. |

## 8. Ignoring local files without committing ignore rules

`.gitignore` is shared with everyone. It ignores build output (`target/` of every crate, `/dist/`, `/website/dist/`, `/pkg/`), caches (`.npm-cache/`, `.vite/`, `.wrangler/`, `.parcel-cache/`, `*.tsbuildinfo`, `.eslintcache`), test output (`/parity/visual/out/`, `coverage/`), logs, and editor or OS clutter. Benchmark results under `bench/results/` are committed on purpose. For files only you have (editor settings, scratch scripts, local benchmark logs), use one of Git's local mechanisms; neither is committed or pushed.

**This repository only: `.git/info/exclude`.** Same syntax as `.gitignore`, read only in this clone:

```sh
echo "scratch/" >> .git/info/exclude
echo "*.local.md" >> .git/info/exclude
git status --ignored --short        # check what is now ignored
git check-ignore -v scratch/notes   # shows which file and line ignores a path
```

**A personal file for this repository: `core.excludesFile` set with `--local`.** Points Git at an ignore file of your choice, stored in `.git/config` of this clone only:

```sh
git config --local core.excludesFile "$HOME/.config/git/wamr3d-ignore"
git config --local --get core.excludesFile     # check
git config --local --unset core.excludesFile   # undo
```

Do not use `git config --global core.excludesFile` unless you mean to change every repository on the machine. Ignore rules only affect untracked files: to stop seeing changes to a file that is already tracked, the file has to be untracked by a commit, which changes the repository for everyone.
