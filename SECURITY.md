# Security

## Supported versions

Only the latest release on npm (`wamr3d`, currently 0.9.x) receives fixes. Before 1.0, fixes ship in a new patch or minor version, not as backports.

## Reporting a vulnerability

Report privately through GitHub's private vulnerability reporting on <https://github.com/aymen94/wamr3d> (Security tab, "Report a vulnerability"). If that option is not shown, open an issue that asks for a private contact, without details of the problem. Include the version, the browser and backend (WebGPU or WebGL 2), and a minimal page or file that reproduces it.

Please do not disclose the issue publicly until a fixed version is published.

## Scope

Relevant reports include:

- **Loaders** (`wamr3d/addons/loaders/`: glTF with Draco, KTX2 and meshopt, FBX, OBJ/MTL, HDR/RGBE, EXR) parsing untrusted files: crashes, hangs, unbounded memory use, or out-of-bounds reads.
- **The Wasm boundary:** a handle, index or typed-array view that reads or writes memory it should not. Engine crates are `#![forbid(unsafe_code)]`, so such a bug would sit in the bindings, the JavaScript hosts or `wasm-bindgen` output.
- **The package's supply chain:** the npm package has no runtime dependencies; anything in `dist/wamr3d` that loads remote code is a bug.

Not vulnerabilities by themselves:

- `ShaderMaterial` and `RawShaderMaterial` compile the GLSL the application gives them, as in three.js. Do not pass untrusted shader source.
- `DRACOLoader` and `KTX2Loader` load their decoders from the path the application sets (`setDecoderPath`, `setTranscoderPath`); serve those from a source you trust.
- The comparison and reference pages under `examples/` load three.js from a CDN on purpose (`examples/three-reference.js`); production code does not.
- GPU driver crashes or hangs caused by a valid scene; report them as bugs.
