# STATUS.md: WAMR3D

## Current state (2026-10-18)

- Published npm package: `wamr3d@0.6.0`. The repository is far ahead of it: everything under "Done since 0.6.0" is unreleased. The next release should be `0.7.0` ([NPM.md](NPM.md)); the website keeps depending on `0.6.0` until it is published.
- Rust crate `wamr3d` (bindings) is `0.5.0`, independent of the npm version; internal crates stay at `0.1.0`.
- **Not yet verified.** This round was implemented without running the checks, on request. What was run: `cargo build` (native and `wasm32-unknown-unknown`), `cargo test --workspace --no-run` (the tests compile), `node --check` on every JavaScript module, and `node engine/bindings/build.mjs`. Not run: the Rust tests, the parity checks, the visual parity cases, the typings check and the example smoke tests. Several renderer unit tests (`engine/renderer_webgpu/src/tests.rs`) still assert the old per-object uniform layout and will fail until they are updated to the material blocks (see DECISIONS.md, "Frame format").

## Done since 0.6.0

### Renderer (WebGPU and WebGL 2)

- **Frame format:** material settings moved out of the per-object uniforms into per-material blocks (1 KiB each, packed once per frame and bound with a dynamic offset); objects keep their matrices, flags, skin offset and sprite centre. Draw info has eight numbers per draw (material block and custom shader added). See DECISIONS.md.
- **Texture slots:** 24 kinds of map share the 12 slots of a draw; maps that read the same texture share a slot (packed occlusion/roughness/metalness images take one). Every map has its own uv transform and uv set (`texture.channel`, `uv1`).
- **Vertex tangents** for normal maps (and clearcoat normal and anisotropy frames), from a `tangent` attribute when the geometry has one.
- **Skinning:** `SkinnedMesh`, `Skeleton`, `Bone`, attached and detached bind modes. Bone matrices are computed in the engine per frame and drawn from one float texture; shadows of skinned meshes follow the pose; raycasts test the posed triangles.
- **Morph targets:** blended in the engine into a geometry of the mesh's own when the weights change (relative or absolute), so picking and bounds see the blended shape.
- **`MeshPhysicalMaterial`:** transmission (with thickness, attenuation and dispersion, over a mipmapped copy of the opaque scene), iridescence (thin-film fresnel), anisotropy, and the maps of every layer (`clearcoatMap`, `clearcoatRoughnessMap`, `clearcoatNormalMap`, `sheenColorMap`, `sheenRoughnessMap`, `specularIntensityMap`, `specularColorMap`, `transmissionMap`, `thicknessMap`, `iridescenceMap`, `iridescenceThicknessMap`, `anisotropyMap`).
- **Lights:** `RectAreaLight` (without three.js's LTC tables: exact diffuse form factor, representative-point specular) and `LightProbe` (spherical harmonics).
- **Shadows:** `VSMShadowMap` (moments blurred per shadow map, Chebyshev test); alpha-tested casters and displacement in shadow maps.
- **Environments:** up to eight environment maps per frame (the scene's and materials' own `envMap`), stacked in one texture; render-target textures as environment or background; HDR (float) cube textures and float `DataTexture`s.
- **Blending:** three.js's normal, additive, subtractive and multiply blending, and `premultipliedAlpha`.
- **Points and lines:** `PointsMaterial.size` above one pixel (with `sizeAttenuation`, `map` and `alphaMap`) and `linewidth` above one pixel, drawn as quads.
- **Render targets:** `DepthTexture`, several colour attachments (`count`; the built-in materials write the first), multisampled targets on WebGL 2, `renderer.autoClear`.
- **`ShaderMaterial` and `RawShaderMaterial`** (GLSL, three.js's built-in uniforms and attributes, custom attributes including integer ones) on WebGL 2. On WebGPU they draw unlit, as three.js's WebGPURenderer draws no GLSL either.
- **Post-processing:** built-in full-screen effects (copy, luminosity high pass, blur, bloom composite, FXAA, output) on both backends.

### Object API and add-ons

- Curves, paths and shapes (`Curve` and every curve class, `CurvePath`, `Path`, `Shape`, `ShapePath`, `ShapeUtils`, `Box2`), with `ShapeGeometry`, `ExtrudeGeometry`, `TubeGeometry`, `EdgesGeometry` and `WireframeGeometry`.
- Animation: keyframe tracks, interpolants, `AnimationClip`, `AnimationMixer`, `AnimationAction`, `PropertyBinding`, `PropertyMixer`, `AnimationObjectGroup`, `AnimationUtils`.
- `EventDispatcher` on objects, materials, geometries and textures (`dispose` events), `Controls`.
- Loaders: `Cache`, `LoadingManager`, `Loader`, `LoaderUtils`, `FileLoader`, `ImageLoader`, `ImageBitmapLoader`, `TextureLoader`, `CubeTextureLoader`, `DataTextureLoader`, `AnimationLoader`, `BufferGeometryLoader`, `MaterialLoader`, `ObjectLoader`.
- Audio: `AudioContext`, `AudioListener`, `Audio`, `PositionalAudio`, `AudioAnalyser`, `AudioLoader`.
- Helpers: `ArrowHelper`, `BoxHelper`, `Box3Helper`, `PlaneHelper`, `CameraHelper`, `DirectionalLightHelper`, `PointLightHelper`, `SpotLightHelper`, `HemisphereLightHelper`, `PolarGridHelper`, `SkeletonHelper`.
- All three.js constants; `SphericalHarmonics3`, `UniformsUtils`.
- Add-ons under `wamr3d/addons/` with three.js's paths: `controls/` (`OrbitControls`, `MapControls`, `PointerLockControls`, `FirstPersonControls`, `FlyControls`, `TrackballControls`, `DragControls`), `postprocessing/` (`EffectComposer`, `Pass`, `RenderPass`, `ShaderPass`, `OutputPass`, `UnrealBloomPass`, `FXAAPass`), `shaders/` (`CopyShader`, `FXAAShader`, `LuminosityHighPassShader`, `OutputShader`), `lines/` (`Line2`, `LineSegments2`, `LineMaterial`, `LineGeometry`, `LineSegmentsGeometry`).

### Performance notes

- Material data is packed once per material per frame instead of once per draw; the per-object upload is 128 bytes read per draw.
- Skinning matrices are computed in WebAssembly in one pass over the frame, uploaded as one texture; morph blending runs only when weights change.
- Texture sets are interned across the main and shadow passes; shadow casters without an alpha test draw without a fragment stage.
- Animation writes transforms through allocation-free `fromArray` on bound vectors, which reach the engine in the next batched flush.

## Verification

Last full verification: 2026-10-16, on the tree before this round (659 Rust tests, parity checks, 35/35 visual cases on WebGPU, 32/35 on WebGL 2). See git history for that report. This round needs the full set run again (CONFIGURATION.md lists the commands); expect the renderer layout tests to need updating first.

## Ported examples

`examples/ports/` holds three.js games and scenes run on WAMR3D through `wamr3d/compat` with the import changed: Crossy Road and Stack (Hunor Márton Borbély), City 3D (Victor Vergara), and the official examples `webgl_geometry_minecraft` and `webgl_lights_spotlights`, plus three pages written for WAMR3D (`fluid-particles`, `water`, `car`). `?engine=three` runs the ported code on three.js. Workarounds written when features were missing can now be removed (Phong and toon stand-ins, hand-built boxes instead of `Box3.setFromObject`, the missing reflections in `water` and `car`).

## Undeveloped and incomplete work

- **GLTFLoader** (add-on) is not written yet; `ObjectLoader` covers three.js's own JSON format.
- Post-processing: only the built-in passes draw on WebGPU; a `ShaderPass` with other GLSL shaders needs WebGL 2. No node-based (TSL) post-processing.
- `ShaderMaterial` does not receive lights, fog or shadows, and `#include` supports only a few chunks (`common`, `premultiplied_alpha_fragment`; the colour-space and tone-mapping chunks are empty because the renderer encodes after the pass).
- `CustomBlending` draws as normal blending; a render target's extra colour attachments are not written by the built-in materials.
- Depth textures cannot be bound as maps of built-in materials on WebGPU (they read white).
- Wide line loops are drawn without their closing segment; `LineMaterial` dashes and world units are not drawn.
- `UnrealBloomPass` uses kernel sizes 3 to 11 and white tints.
- Skinned meshes are not frustum-culled.
- WebGL 2: 1-pixel points, lines and wireframes rasterize slightly differently from WebGPU; without `EXT_color_buffer_float` it falls back to sRGB blending and skips tone mapping, float targets, environments and VSM.
- `TransformControls`, `ArcballControls` and loaders of other formats (FBX, OBJ, RGBE, EXR, KTX2, Draco) are not provided.

## Constraints

WAMR3D has its own WebGPU and WebGL 2 renderers. three.js's TSL/node-based rendering and its WebGL renderer are not ported. No schedule is assigned to the items above.
