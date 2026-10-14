# STATUS.md: WAMR3D

## Undeveloped and incomplete work

### Renderer and materials

- Wire environment settings into the object API: `scene.environment`, `scene.environmentIntensity`, `scene.environmentRotation`, `material.envMap`, `envMapIntensity`, and `envMapRotation`. The low-level environment API exists, but object API support and visual parity coverage are missing.
- Add texture maps beyond the colour `map`, including normal, roughness, metalness, and related maps; add mipmaps and texture transforms where needed.
- Implement point-light shadows, area lights, shadow filtering modes other than PCF, and scene background textures.
- Implement post-processing, render-target depth textures, and multiple render-target attachments.
- Add a WebGL fallback. The current renderer requires WebGPU.
- Support lines wider than one pixel. Points currently render at one pixel.
- Improve physically based lighting parity; a strong-light comparison still differs by about 1.8/255.

### Object API and geometry

- Add missing object and material classes, including `LineLoop`, `SkinnedMesh`, `LOD`, `MeshPhongMaterial`, `MeshPhysicalMaterial`, `MeshToonMaterial`, `MeshNormalMaterial`, and `ShaderMaterial`.
- Add picking for sprites and individual instances of `InstancedMesh`.
- Add morph targets, interleaved buffers, and JavaScript bindings for integer vertex attributes.
- Add geometry primitives beyond box, plane, sphere, cylinder, cone, circle, ring, and torus.
- Add JavaScript bindings for `Triangle`, `Line3`, `Spherical`, and `Cylindrical`.

### Supporting systems

- Add loaders beyond `TextureLoader`, including object and buffer geometry loading. glTF support would require an add-on.
- Add animation, audio, controls, and additional helpers.
- Add random helpers and UUID support.

## Constraints

The renderer targets WebGPU. TSL/node-based rendering, WebGL backends, and the listed out-of-scope Three.js systems remain unported. No schedule is assigned to these items.
