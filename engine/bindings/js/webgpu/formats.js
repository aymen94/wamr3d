// Formats, filters and pipeline-key bits shared by the WebGPU host's modules.

export const WRAPS = { 1000: 'repeat', 1001: 'clamp-to-edge', 1002: 'mirror-repeat' };
// Texture filter constants: nearest 1003, linear 1006, and their mipmapped variants.
export const LINEAR = new Set( [ 1006, 1007, 1008 ] ), MIPMAPPED = new Set( [ 1004, 1005, 1007, 1008 ] ), MIP_LINEAR = new Set( [ 1005, 1008 ] );
// With tone mapping the scene is drawn into this linear format, then tone-mapped onto the canvas.
export const HDR_FORMAT = 'rgba16float', HDR_KEY = 1 << 10;
// Render targets hold linear colour without encoding (three.js NoColorSpace); RGBA8_KEY
// marks pipelines for such a target, SINGLE_KEY those without multisampling.
export const RGBA8_KEY = 1 << 11, SINGLE_KEY = 1 << 12;
