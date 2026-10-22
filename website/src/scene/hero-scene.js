// Live backdrop drawn by WAMR3D (`wamr3d/compat`, three.js-style API).
// A neon grid scrolls under a floating brand cube. Click the cube and it shatters into
// 27 mini cubes that bounce on the grid, then fly back and rebuild it.
//
// Chosen for WAMR3D's renderer (engine/renderer_webgpu, mesh fragment shader):
// - No lights at all. `MeshBasicMaterial` returns before any lighting code, and
//   `MeshMatcapMaterial` shades from the view normal alone (a built-in grey gradient), so
//   the cube still looks lit. The light loop, light uniforms and shadow paths never run.
// - Everything opaque: no blending, no transparent sort. The grid fades out through fog.
// - No MSAA and no tone mapping (the default), so frames draw straight to the canvas.
// - Static geometry: the grid scrolls by moving one transform; 27 instance matrices are
//   written only while the cube breaks and rebuilds (about 3 s). Math uses the plain-JS values of the object API.
// - 30 fps when idle, 60 fps while something reacts; rendering stops when the tab is hidden.
// - Without a real GPU (software WebGPU, SwiftShader, llvmpipe): half resolution, 24 fps.

const BG = { dark: 0x04050c, light: 0xf4f6fb };
const GROUND_Y = -2.2;
const TAU = Math.PI * 2;
const wrap = (a) => a % TAU; // the engine stores 32-bit floats: keep angles small
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;
const PIECE_COLORS = [0xa259ff, 0x3d5afe, 0x22e4ff];

// Loads the engine; if the default .wasm lookup fails (a bundler moved the JS away from it),
// uses the copy the site serves at dist/wamr3d/.
async function loadEngine() {
  const THREE = await import('wamr3d/compat');
  try {
    await THREE.init();
  } catch (error) {
    console.info('WAMR3D: default .wasm lookup failed, trying dist/wamr3d/.', error);
    await THREE.init(new URL('dist/wamr3d/wamr3d_wasm_bg.wasm', document.baseURI));
  }
  return THREE;
}

export async function startHeroScene(canvas, report = () => {}) {
  let THREE;
  try {
    THREE = await loadEngine();
  } catch (error) {
    console.info('WAMR3D could not be loaded.', error);
    return report({ state: 'unsupported', reason: 'The WAMR3D module could not be loaded.' });
  }
  const { Vector3, Matrix4, Quaternion, Color } = THREE; // plain-JS math values

  const root = document.documentElement;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  const pref = root.dataset.rendererBackend;
  const backend = pref === 'webgpu' || pref === 'webgl' ? pref : 'auto';

  // A chosen backend that fails is retried with 'auto' on a fresh canvas
  // (a canvas keeps the first context type it handed out).
  let renderer = null;
  for (const attempt of backend === 'auto' ? ['auto'] : [backend, 'auto']) {
    if (attempt !== backend) { const c = canvas.cloneNode(false); canvas.replaceWith(c); canvas = c; }
    const r = new THREE.WebGPURenderer({ canvas, antialias: false, backend: attempt });
    try { await r.init(); renderer = r; break; } catch (error) { console.info(`WAMR3D: backend "${attempt}" failed.`, error); }
  }
  if (!renderer) return report({ state: 'unsupported', reason: 'Neither WebGPU nor WebGL 2 could start on this device.' });

  const gl = renderer.backend.gl;
  const glName = gl ? gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) : '';
  const soft = renderer.backend.name === 'webgpu-software' || SOFTWARE.test(glName || '');
  const api = renderer.backend.isWebGLBackend ? 'WebGL 2' : soft ? 'WebGPU (software)' : 'WebGPU';

  let scale = soft ? 0.5 : weak ? 0.85 : Math.min(devicePixelRatio || 1, 1.25);
  const minScale = soft ? 0.3 : 0.5;
  const idleFps = soft ? 20 : 30, activeFps = soft ? 24 : weak ? 30 : 60;

  // ---------------------------------------------------------------- Scene
  const scene = new THREE.Scene();
  let light = root.dataset.theme === 'light';
  const bg = () => BG[light ? 'light' : 'dark'];
  scene.background = new Color(bg());
  scene.fog = new THREE.Fog(bg(), 9, 32);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 34);

  // Grid: static, opaque, vertex-coloured lines; fades out through the fog.
  const CELL = 2;
  const grid = new THREE.GridHelper(64, 32, 0x22e4ff, 0x3d5afe);
  grid.position.y = GROUND_Y;
  scene.add(grid);

  // Brand cube: matcap core (looks lit, needs no light) and an edge frame.
  const core = new THREE.Group();
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), new THREE.MeshMatcapMaterial({ color: 0x6f7dff }));
  const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2.1, 2.1, 2.1)), new THREE.LineBasicMaterial({ color: 0x22e4ff }));
  core.add(cube, frame);
  scene.add(core);

  // Explosion pieces: 3×3×3 cubes in one instanced draw. Until the click they sit tiny and
  // out of sight below the grid (valid matrices, so the mesh is drawn and its pipeline is
  // built at start rather than on the click).
  const N = 27, PIECE = 0.46;
  const pieces = new THREE.InstancedMesh(new THREE.BoxGeometry(PIECE, PIECE, PIECE), new THREE.MeshMatcapMaterial(), N);
  pieces.frustumCulled = false;
  const tint = new Color();
  for (let i = 0; i < N; i++) pieces.setColorAt(i, tint.setHex(PIECE_COLORS[i % 3]));
  const hidden = new Matrix4().makeScale(0.001, 0.001, 0.001).setPosition(0, GROUND_Y - 10, 0);
  for (let i = 0; i < N; i++) pieces.setMatrixAt(i, hidden);
  pieces.instanceMatrix.needsUpdate = true;
  scene.add(pieces);
  // Each piece keeps its slot in the cube (-1, 0, 1 on each axis) and its flight state.
  const shards = Array.from({ length: N }, (_, i) => ({
    slot: new Vector3((i % 3) - 1, Math.floor(i / 3) % 3 - 1, Math.floor(i / 9) - 1),
    p: new Vector3(), v: new Vector3(), from: new Vector3(), axis: new Vector3(), spin: 0, angle: 0, fromAngle: 0,
  }));
  let blast = 0, returning = false, pop = 0;
  // Timeline after the click, in seconds.
  const FLY = 1.6, BACK = 1.0, STAGGER = 0.35, DONE = FLY + BACK + STAGGER;
  const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);


  // ---------------------------------------------------------------- Picking (plain JS)
  const UP = new Vector3(0, 1, 0);
  const eye = new Vector3(), target = new Vector3(), corePos = new Vector3();
  const fwd = new Vector3(), right = new Vector3(), up = new Vector3(), dir = new Vector3(), tmp = new Vector3();
  const mat = new Matrix4(), quat = new Quaternion(), size = new Vector3();
  const rayDir = (nx, ny) => {
    fwd.subVectors(target, eye).normalize();
    right.crossVectors(fwd, UP).normalize();
    up.crossVectors(right, fwd);
    const th = Math.tan((camera.fov * Math.PI) / 360);
    return dir.copy(fwd).addScaledVector(right, nx * th * camera.aspect).addScaledVector(up, ny * th).normalize();
  };
  const hitsCore = (d) => {
    tmp.subVectors(corePos, eye);
    const along = tmp.dot(d), r = 1.15 * s.size;
    return along > 0 && tmp.lengthSq() - along * along < r * r;
  };

  // ---------------------------------------------------------------- State & input
  const s = { nx: 0, ny: 0, click: null, hover: false, moved: false, scroll: scrollY, rot: 0, homeX: 0, homeY: 0, size: 1, last: 0, opacity: -1, activeUntil: 0 };
  let running = false;
  const wake = () => { s.activeUntil = performance.now() + 1200; if (!running) draw(performance.now(), true); };

  const skip = (el) => el instanceof Element && el.closest('a, button, input, textarea, select, summary, pre, code, iframe, [data-no-scene]');
  const ndc = (e) => [(e.clientX / innerWidth) * 2 - 1, 1 - (e.clientY / innerHeight) * 2];
  addEventListener('pointermove', (e) => { [s.nx, s.ny] = ndc(e); s.moved = !skip(e.target); wake(); }, { passive: true });
  addEventListener('pointerdown', (e) => { if (!e.button && !skip(e.target)) { s.click = ndc(e); wake(); } }, { passive: true });
  addEventListener('scroll', () => { s.scroll = scrollY; wake(); }, { passive: true });
  addEventListener('wamr3d-theme', (e) => {
    light = e.detail === 'light';
    scene.background.setHex(bg()); scene.fog.color.setHex(bg());
    wake();
  });

  const resize = () => {
    const wide = innerWidth >= 1024;
    camera.aspect = innerWidth / innerHeight;
    camera.fov = innerWidth < 640 ? 58 : 42;
    camera.updateProjectionMatrix();
    s.homeX = wide ? 3.4 : 1.2; s.homeY = wide ? 0.2 : -0.6; s.size = wide ? 1 : 0.65;
    renderer.setPixelRatio(scale);
    renderer.setSize(innerWidth, innerHeight, false);
    wake();
  };
  addEventListener('resize', resize, { passive: true });

  // The cube hides and its pieces fly out from where it was.
  const explode = (t) => {
    const k = s.size;
    for (const sh of shards) {
      sh.p.copy(sh.slot).multiplyScalar(0.5 * k).add(corePos);
      sh.v.set(sh.slot.x * 2.6 + Math.random() - 0.5, 3 + sh.slot.y * 1.5 + Math.random() * 2, sh.slot.z * 2.6 + Math.random() - 0.5);
      sh.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      sh.spin = 4 + Math.random() * 8;
      sh.angle = 0;
    }
    core.visible = false;
    s.hover = false;
    root.classList.remove('cursor-pointer');
    blast = t;
    returning = false;
    // The animation plays even with reduced motion: it is a direct answer to a click.
    if (!running) renderer.setAnimationLoop(draw);
  };

  // The pieces are back in place: the cube reappears with a small pop.
  const rebuild = () => {
    for (let i = 0; i < N; i++) pieces.setMatrixAt(i, hidden);
    pieces.instanceMatrix.needsUpdate = true;
    s.rot = 0;
    pop = 1;
    core.visible = true;
    blast = 0;
    if (!running) renderer.setAnimationLoop(null);
  };

  // ---------------------------------------------------------------- Frame
  let frames = 0, fpsClock = 0, slow = 0;

  function draw(now, force = false) {
    const busy = blast || now < s.activeUntil;
    const fps = busy ? activeFps : idleFps;
    if (!force && now - s.last < 1000 / fps - 2) return;
    const t = now / 1000, dt = Math.min(0.05, s.last ? (now - s.last) / 1000 : 0.016), mo = still ? 0 : 1;
    s.last = now;

    // Camera follows pointer and scroll; on inner pages the cube moves aside and the scene dims.
    const depth = Math.min(s.scroll / innerHeight, 1.5), aside = root.dataset.route !== '/' ? 1 : 0;
    corePos.set(s.homeX + aside * 2.2, s.homeY + Math.sin(wrap(t * 1.2)) * 0.15 * mo, 0);
    eye.set(s.nx * 0.5, 1.2 + s.ny * 0.3 + depth * 2, 12 - depth);
    target.set(corePos.x * 0.35, -0.6 - depth * 1.2, -2);
    camera.position.set(eye.x, eye.y, eye.z);
    camera.lookAt(target.x, target.y, target.z);
    const opacity = Math.round((1 - depth * 0.3) * (1 - aside * 0.35) * 100) / 100;
    if (opacity !== s.opacity) canvas.style.opacity = String((s.opacity = opacity));

    grid.position.z = (t * 1.2 * mo) % CELL;

    if (s.moved && !blast) {
      s.moved = false;
      const over = hitsCore(rayDir(s.nx, s.ny));
      if (over !== s.hover) root.classList.toggle('cursor-pointer', (s.hover = over));
    }
    if (s.click) {
      const d = rayDir(s.click[0], s.click[1]); s.click = null;
      if (!blast && hitsCore(d)) explode(t);
    }

    if (!blast) {
      s.rot = wrap(s.rot + dt * 0.5 * mo);
      pop *= Math.pow(0.02, dt);
      core.position.copy(corePos);
      core.scale.setScalar(s.size * (s.hover ? 1.08 : 1) * (1 + pop * 0.18));
      core.rotation.set(wrap(s.rot * 0.6), s.rot, 0);
      frame.rotation.set(0, wrap(-s.rot * 1.5), wrap(s.rot * 0.4));
    }

    // Pieces: fly out and bounce on the grid, then rise back into their slots one by one.
    if (blast) {
      const age = t - blast, arr = pieces.instanceMatrix.array, floor = GROUND_Y + PIECE * 0.5, k = s.size;
      if (age >= FLY && !returning) {
        returning = true;
        for (const sh of shards) { sh.from.copy(sh.p); sh.fromAngle = sh.angle; }
      }
      for (let i = 0; i < N; i++) {
        const sh = shards[i];
        if (!returning) {
          sh.v.y -= 14 * dt;
          sh.p.addScaledVector(sh.v, dt);
          if (sh.p.y < floor) { sh.p.y = floor; sh.v.y *= -0.35; sh.v.x *= 0.7; sh.v.z *= 0.7; sh.spin *= 0.6; }
          sh.angle = wrap(sh.angle + sh.spin * dt);
        } else {
          // Bottom pieces first, so the cube builds up from the ground.
          const e = ease((age - FLY - ((sh.slot.y + 1) / 2) * STAGGER) / BACK);
          tmp.copy(sh.slot).multiplyScalar(0.5 * k).add(corePos);
          sh.p.lerpVectors(sh.from, tmp, e);
          sh.p.y += Math.sin(e * Math.PI) * 1.4;
          sh.angle = sh.fromAngle * (1 - e);
        }
        mat.compose(sh.p, quat.setFromAxisAngle(sh.axis, sh.angle), size.setScalar(k)).toArray(arr, i * 16);
      }
      pieces.instanceMatrix.needsUpdate = true;
      if (age >= DONE) rebuild();
    }

    renderer.render(scene, camera);

    // Every second: report; after two slow seconds in a row, lower the render scale.
    frames++;
    if (!fpsClock) fpsClock = now;
    if (now - fpsClock >= 1000) {
      const measured = (frames * 1000) / (now - fpsClock);
      report({ state: 'running', api, fps: measured, calls: renderer.info.render.calls, instances: blast ? N : 0, objects: 4 });
      slow = measured < fps * 0.75 ? slow + 1 : 0;
      frames = 0; fpsClock = now;
      if (slow >= 2 && scale > minScale) { slow = 0; scale = Math.max(minScale, scale * 0.8); resize(); }
    }
  }

  // ---------------------------------------------------------------- Start
  resize();
  await renderer.compileAsync?.(scene, camera).catch(() => {});
  canvas.classList.add('opacity-100');
  setTimeout(() => { canvas.style.transition = 'none'; }, 1600);

  if (still) {
    draw(performance.now(), true);
    return report({ state: 'static', api, instances: 0, calls: renderer.info.render.calls });
  }
  const loop = (on) => { running = on; renderer.setAnimationLoop(on ? draw : null); s.last = 0; fpsClock = 0; frames = 0; };
  loop(true);
  report({ state: 'running', api, instances: 0 });
  document.addEventListener('visibilitychange', () => loop(!document.hidden));
}
