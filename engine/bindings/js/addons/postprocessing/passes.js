// Post-processing in the shape of three.js's EffectComposer add-ons. The built-in passes
// (copy, luminosity high pass, bloom, FXAA, output) draw with the renderer's own effect
// shaders on WebGPU and WebGL 2; a ShaderPass with any other shader draws its GLSL, which
// needs the WebGL 2 backend (as three.js's WebGPURenderer, WebGPU draws no GLSL).

export { CopyShader, LuminosityHighPassShader, FXAAShader, OutputShader } from './passes/shaders.js';
export { Pass, FullScreenQuad } from './passes/pass.js';
export { RenderPass, ShaderPass, OutputPass, FXAAPass, UnrealBloomPass } from './passes/passes.js';
export { EffectComposer } from './passes/composer.js';
