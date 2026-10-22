// The site's live backdrop, drawn by WAMR3D through `wamr3d/compat` (three.js API) in hybrid
// mode: WebGPU where the browser has it, WAMR3D's own WebGL 2 renderer otherwise.
// A sparse wave field of instanced boxes around a brand cube that can be hovered and clicked.
// With neither API the page keeps its static CSS backdrop; three.js is never loaded.
//
// Lightweight by design:
// - No Raycaster. Picking is analytic (ray vs. sphere, ray vs. ground plane) computed in plain JS
//   from a camera state mirrored in JS, so clicks and hovers never walk mesh geometry.
// - Pointer events only record input; all work happens once per frame.
// - The field writes height + colour straight into the instance buffers (2 matrix floats
//   + 3 colour floats per box), no per-box engine calls.
// - Transforms are driven from JS-side state (set, never read back from the engine).
// - Rendering pauses while the tab is hidden; slow devices step quality down.

const BACKGROUND = { dark: 0x04050c, light: 0xf4f6fb };
const PALETTE = [[0.64, 0.35, 1.0], [0.24, 0.35, 1.0], [0.13, 0.89, 1.0]];
const SATELLITE_COLORS = [0x22e4ff, 0xa259ff, 0x3d5afe];
const FIELD_Y = -3.1;
const PIXEL_RATIOS = [1.5, 1.25, 1];
const LOW_FPS = 40;
const MAX_RIPPLES = 3;

// Base colour of the field for a height ratio k (violet → blue → cyan), sampled once.
const RAMP_STEPS = 32;
const RAMP = new Float32Array((RAMP_STEPS + 1) * 3);
for (let i = 0; i <= RAMP_STEPS; i++) {
  const k = i / RAMP_STEPS;
  const [a, b] = k < 0.5 ? [PALETTE[0], PALETTE[1]] : [PALETTE[1], PALETTE[2]];
  const f = k < 0.5 ? k * 2 : (k - 0.5) * 2;
  for (let j = 0; j < 3; j++) RAMP[i * 3 + j] = a[j] + (b[j] - a[j]) * f;
}

export async function startHeroScene(canvas, report = () => {}) {
  let THREE;
  try {
    THREE = await import('wamr3d/compat');
    await THREE.init();
  } catch (error) {
    console.info('WAMR3D could not be loaded.', error);
    return report({ state: 'unsupported', reason: 'The WAMR3D module could not be loaded.' });
  }

  // ---------------------------------------------------------------- Device profile
  const preference = document.documentElement.dataset.rendererBackend;
  const backend = ['auto', 'webgpu', 'webgl'].includes(preference) ? preference : 'auto';

  let softwareAdapter = false;
  try {
    const adapter = backend !== 'webgl' ? await navigator.gpu?.requestAdapter() : null;
    softwareAdapter = !!adapter && !!(adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter);
  } catch {}
  const lowPower = softwareAdapter || (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = innerWidth < 760;

  // ---------------------------------------------------------------- Renderer
  // A chosen backend does not fall back on its own, so retry with 'auto' on a fresh canvas
  // (a canvas keeps the first context type it handed out).
  let renderer = null;
  for (const attempt of backend === 'auto' ? ['auto'] : [backend, 'auto']) {
    if (attempt !== backend) {
      const fresh = canvas.cloneNode(false);
      canvas.replaceWith(fresh);
      canvas = fresh;
    }
    const candidate = new THREE.WebGPURenderer({ canvas, antialias: !lowPower, powerPreference: 'high-performance', backend: attempt });
    try {
      await candidate.init();
      renderer = candidate;
      break;
    } catch (error) {
      console.info(`WAMR3D could not start with backend "${attempt}".`, error);
    }
  }
  if (!renderer) return report({ state: 'unsupported', reason: 'Neither WebGPU nor WebGL 2 could start on this device.' });
  const api = renderer.backend?.isWebGLBackend ? 'WebGL 2' : 'WebGPU';

  // ---------------------------------------------------------------- Scene
  const scene = new THREE.Scene();
  let light = document.documentElement.dataset.theme === 'light';
  const backgroundHex = () => BACKGROUND[light ? 'light' : 'dark'];
  scene.background = new THREE.Color(backgroundHex());
  scene.fog = new THREE.FogExp2(backgroundHex(), 0.045);

  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 120);
  // JS mirror of the camera: position, look-at target, fov and aspect. Picking reads this, never the engine.
  const cam = { x: 0, y: 0.6, z: 13, tx: 0, ty: 0, tz: -2, fov: 42, aspect: innerWidth / innerHeight };

  scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x0a0618, 0.9));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
  keyLight.position.set(-5, 8, 6);
  scene.add(keyLight);
  const cyanLight = new THREE.PointLight(0x22e4ff, 18, 16);
  scene.add(cyanLight);
  const violetLight = lowPower ? null : new THREE.PointLight(0xa259ff, 18, 16);
  if (violetLight) scene.add(violetLight);

  // ---------------------------------------------------------------- Wave field (sparse)
  const columns = small ? 14 : lowPower ? 18 : 24;
  const rows = small ? 9 : lowPower ? 8 : 11;
  const spacing = (small ? 15.6 : 29.4) / columns;
  const boxSize = spacing * 0.62;
  const count = columns * rows;

  const field = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.45 }),
    count,
  );
  field.frustumCulled = false;
  const baseColor = new THREE.Color(0.3, 0.4, 1);
  for (let i = 0; i < count; i++) field.setColorAt(i, baseColor); // creates instanceColor

  // Grid stored near to far, so the far rows can be dropped by lowering `count`.
  const cells = new Float32Array(count * 2);
  const matrices = field.instanceMatrix.array;
  const colors = field.instanceColor.array;
  for (let i = 0; i < count; i++) {
    const x = ((i % columns) - (columns - 1) / 2) * spacing;
    const z = -Math.floor(i / columns) * spacing + 2.5;
    cells[i * 2] = x;
    cells[i * 2 + 1] = z;
    // Column-major scale + translation; only [5] (height) and [13] (y) change per frame.
    const o = i * 16;
    matrices.fill(0, o, o + 16);
    matrices[o] = boxSize; matrices[o + 5] = 0.1; matrices[o + 10] = boxSize; matrices[o + 15] = 1;
    matrices[o + 12] = x; matrices[o + 13] = FIELD_Y; matrices[o + 14] = z;
  }
  field.instanceMatrix.needsUpdate = true;
  scene.add(field);

  // ---------------------------------------------------------------- Brand cube
  const core = new THREE.Group();
  scene.add(core);
  const coreMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1f3d, roughness: 0.22, metalness: 0.85 });
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), coreMaterial);
  const frameInner = edgeFrame(THREE, 2.1, 0x22e4ff, 0.9);
  const frameOuter = edgeFrame(THREE, 2.9, 0xa259ff, 0.55);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.45, 0.016, 4, lowPower ? 48 : 72),
    new THREE.MeshBasicMaterial({ color: 0x3d5afe, transparent: true, opacity: 0.85 }),
  );
  ring.rotation.x = Math.PI / 2.3;
  core.add(cube, frameInner, frameOuter, ring);

  const satelliteGeometry = new THREE.BoxGeometry(0.22, 0.22, 0.22);
  const satelliteCount = lowPower ? 3 : 5;
  const satellites = Array.from({ length: satelliteCount }, (_, i) => {
    const base = SATELLITE_COLORS[i % 3];
    const mesh = new THREE.Mesh(satelliteGeometry, new THREE.MeshStandardMaterial({ color: base, roughness: 0.3, metalness: 0.3 }));
    core.add(mesh);
    return {
      mesh, base,
      phase: (i / satelliteCount) * Math.PI * 2,
      radius: 2.45 + (i % 2) * 0.12,
      speed: 0.45 + (i % 3) * 0.08,
      angle: 0, x: 0, y: 0, z: 0, // local position, mirrored in JS
    };
  });

  // JS-side transform state (written to the engine, never read back).
  const state = {
    coreX: 0, coreY: 0, coreScale: 1, homeX: 0, homeY: 0,
    coreRotY: 0, innerRotY: 0, outerRotZ: 0, ringRotZ: 0,
    aside: 0, hoverMix: 0, spin: 0, energy: 0, opacity: -1,
  };

  // ---------------------------------------------------------------- Picking (pure JS)
  const ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: -1 };
  // Builds the world-space ray through NDC (nx, ny) from the mirrored camera.
  const castRay = (nx, ny) => {
    let fx = cam.tx - cam.x, fy = cam.ty - cam.y, fz = cam.tz - cam.z;
    const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
    let rx = -fz, rz = fx; // forward × (0,1,0)
    const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
    const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy; // right × forward
    const th = Math.tan((cam.fov * Math.PI) / 360), tw = th * cam.aspect;
    let dx = fx + rx * nx * tw + ux * ny * th;
    let dy = fy + uy * ny * th;
    let dz = fz + rz * nx * tw + uz * ny * th;
    const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
    ray.ox = cam.x; ray.oy = cam.y; ray.oz = cam.z; ray.dx = dx; ray.dy = dy; ray.dz = dz;
  };
  // Distance along the ray to a sphere, or Infinity.
  const hitSphere = (cx, cy, cz, r) => {
    const lx = cx - ray.ox, ly = cy - ray.oy, lz = cz - ray.oz;
    const tca = lx * ray.dx + ly * ray.dy + lz * ray.dz;
    if (tca < 0) return Infinity;
    return lx * lx + ly * ly + lz * lz - tca * tca <= r * r ? tca : Infinity;
  };
  const ground = { x: 0, z: 0 };
  const hitGround = () => {
    if (Math.abs(ray.dy) < 1e-4) return null;
    const t = (FIELD_Y - ray.oy) / ray.dy;
    if (t <= 0) return null;
    ground.x = ray.ox + ray.dx * t;
    ground.z = ray.oz + ray.dz * t;
    return ground;
  };
  // -1 nothing, 0 cube, 1.. satellite index + 1. Assumes the ray was cast this frame.
  const pick = () => {
    let best = Infinity, target = -1;
    const s = state.coreScale;
    const t0 = hitSphere(state.coreX, state.coreY, 0, 1.1 * s);
    if (t0 < best) { best = t0; target = 0; }
    const cos = Math.cos(state.coreRotY), sin = Math.sin(state.coreRotY);
    satellites.forEach((sat, i) => {
      const wx = state.coreX + s * (sat.x * cos + sat.z * sin);
      const wy = state.coreY + s * sat.y;
      const wz = s * (-sat.x * sin + sat.z * cos);
      const t = hitSphere(wx, wy, wz, 0.28 * s);
      if (t < best) { best = t; target = i + 1; }
    });
    return target;
  };

  // ---------------------------------------------------------------- Input (record only)
  const pointer = { nx: 0, ny: 0, active: false, moved: false, click: false };
  let lastTarget = null, lastInteractive = true;
  const interactive = (target) => {
    if (target === lastTarget) return lastInteractive;
    lastTarget = target;
    lastInteractive = !(target instanceof Element) || !target.closest('a, button, input, textarea, select, summary, pre, code, iframe, [data-no-scene]');
    return lastInteractive;
  };
  const setPointer = (event) => {
    pointer.nx = (event.clientX / innerWidth) * 2 - 1;
    pointer.ny = -(event.clientY / innerHeight) * 2 + 1;
  };
  let loopRunning = false;
  const redrawIfStatic = () => { if (!loopRunning) frame(performance.now()); };

  addEventListener('pointermove', (event) => {
    setPointer(event);
    pointer.active = interactive(event.target);
    pointer.moved = true;
  }, { passive: true });
  addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !interactive(event.target)) return;
    setPointer(event);
    pointer.click = true;
    redrawIfStatic();
  }, { passive: true });

  let scroll = scrollY;
  addEventListener('scroll', () => { scroll = scrollY; redrawIfStatic(); }, { passive: true });
  addEventListener('wamr3d-theme', (event) => {
    light = event.detail === 'light';
    scene.background.setHex(backgroundHex());
    scene.fog.color.setHex(backgroundHex());
    redrawIfStatic();
  });

  // ---------------------------------------------------------------- Sizing & quality
  let quality = lowPower ? PIXEL_RATIOS.length - 1 : 0;
  let drawn = count;
  const minDrawn = Math.ceil(rows / 2) * columns;

  const resize = () => {
    const wide = innerWidth >= 1024;
    cam.aspect = innerWidth / innerHeight;
    cam.fov = innerWidth < 640 ? 58 : 42;
    camera.aspect = cam.aspect;
    camera.fov = cam.fov;
    camera.updateProjectionMatrix();
    state.homeX = wide ? 3.6 : 1.4;
    state.homeY = wide ? 0.35 : -1.4;
    state.coreScale = wide ? 1 : 0.6;
    core.scale.setScalar(state.coreScale);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, PIXEL_RATIOS[quality]));
    renderer.setSize(innerWidth, innerHeight, false);
    redrawIfStatic();
  };
  addEventListener('resize', resize, { passive: true });

  // ---------------------------------------------------------------- Frame
  const ripples = [];
  let hovered = -1, last = 0;
  let frames = 0, fpsClock = performance.now(), slowReports = 0, quietUntil = 0;
  const started = performance.now();

  function frame(now) {
    const t = now / 1000;
    const dt = Math.min(0.05, last ? t - last : 0.016);
    last = t;
    const motion = reducedMotion ? 0 : 1;

    // Camera: drift with the pointer, sink as the page scrolls.
    const depth = Math.min(scroll / Math.max(innerHeight, 1), 1.5);
    const inner = document.documentElement.dataset.route !== '/';
    state.aside += ((inner ? 1 : 0) - state.aside) * (reducedMotion ? 1 : Math.min(1, dt * 3));
    state.coreX = state.homeX + state.aside * 2.2;
    state.coreY = state.homeY;
    const ease = reducedMotion ? 1 : Math.min(1, dt * 2.5);
    cam.x += (pointer.nx * 0.45 - cam.x) * ease;
    cam.y += (0.6 + pointer.ny * 0.25 + depth * 2.4 - cam.y) * ease;
    cam.z = 13 - depth * 1.2;
    cam.tx = state.coreX * 0.35; cam.ty = -depth * 1.4; cam.tz = -2;
    camera.position.set(cam.x, cam.y, cam.z);
    camera.lookAt(cam.tx, cam.ty, cam.tz);

    const opacity = Math.round((1 - depth * 0.3) * (1 - state.aside * 0.35) * 100) / 100;
    if (opacity !== state.opacity) { state.opacity = opacity; canvas.style.opacity = String(opacity); }

    // One ray per frame serves hover, click and the ground bump.
    castRay(pointer.nx, pointer.ny);

    if (pointer.click) {
      pointer.click = false;
      quietUntil = now + 1200; // don't count the click frame as "slow"
      const onCore = pick() >= 0;
      const origin = onCore ? { x: state.coreX, z: 0 } : hitGround();
      if (onCore) { state.spin = 1; state.energy = 1; }
      if (origin) {
        ripples.push({ x: origin.x, z: origin.z, start: t, strength: onCore ? 1.6 : 1 });
        if (ripples.length > MAX_RIPPLES) ripples.shift();
      }
    }

    if (pointer.moved) {
      pointer.moved = false;
      const next = pointer.active ? pick() : -1;
      if (next !== hovered) {
        if (hovered > 0) satellites[hovered - 1].mesh.material.color.setHex(satellites[hovered - 1].base);
        if (next > 0) satellites[next - 1].mesh.material.color.setHex(0xffffff);
        hovered = next;
        document.documentElement.classList.toggle('cursor-pointer', hovered >= 0);
      }
    }

    state.hoverMix += ((hovered >= 0 ? 1 : 0) - state.hoverMix) * Math.min(1, dt * 6);
    state.spin *= Math.pow(0.25, dt);
    state.energy *= Math.pow(0.35, dt);

    // Brand cube (all from JS state).
    const speed = 1 + state.hoverMix * 1.5 + state.spin * 6;
    const step = dt * speed * motion;
    state.coreRotY += step * 0.25;
    state.innerRotY -= step * 0.35;
    state.outerRotZ += step * 0.18;
    state.ringRotZ += step * 0.4;
    core.position.set(state.coreX, state.coreY, 0);
    core.rotation.y = state.coreRotY;
    cube.rotation.set(t * 0.21 * motion, 0, t * 0.13 * motion);
    frameInner.rotation.set(Math.sin(t * 0.3) * 0.4 * motion, state.innerRotY, 0);
    frameInner.scale.setScalar(1 + state.energy * 0.25 + state.hoverMix * 0.06);
    frameOuter.rotation.set(0.6 + Math.cos(t * 0.2) * 0.3 * motion, 0, state.outerRotZ);
    ring.rotation.set(Math.PI / 2.3, 0, state.ringRotZ);
    coreMaterial.color.setRGB(0.1 + state.energy * 0.25, 0.12 + state.hoverMix * 0.08, 0.24 + state.hoverMix * 0.2 + state.energy * 0.4);

    for (const sat of satellites) {
      sat.angle += sat.speed * speed * 0.6 * dt * motion;
      const a = sat.phase + sat.angle;
      sat.x = Math.cos(a) * sat.radius;
      sat.y = Math.sin(a * 1.7) * 0.55;
      sat.z = Math.sin(a) * sat.radius;
      sat.mesh.position.set(sat.x, sat.y, sat.z);
      sat.mesh.rotation.set(t * 1.1 * motion + sat.phase, t * 1.4 * motion, 0);
    }

    cyanLight.position.set(state.coreX + Math.cos(t * 0.5) * 4, 1.5, Math.sin(t * 0.5) * 4);
    violetLight?.position.set(state.coreX - 6 + Math.sin(t * 0.37) * 3, -0.5, 2 + Math.cos(t * 0.37) * 3);

    // Wave field.
    const hover = pointer.active && motion ? hitGround() : null;
    const hx = hover ? hover.x : 0, hz = hover ? hover.z : 0;
    for (let i = ripples.length - 1; i >= 0; i--) if (t - ripples[i].start > 4) ripples.splice(i, 1);
    const fronts = ripples.map((r) => {
      const age = t - r.start, radius = age * 6;
      const inner2 = Math.max(0, radius - 3) ** 2, outer2 = (radius + 3) ** 2;
      return { x: r.x, z: r.z, radius, inner2, outer2, gain: r.strength * Math.max(0, 1 - age / 4) * 1.4 };
    });
    const qa = t * 0.9 * motion, qb = t * 0.6 * motion, qc = -t * 1.4 * motion;
    const glowBase = light ? 0.75 : 0.18, glowRange = light ? 0.25 : 0.6;

    for (let i = 0; i < drawn; i++) {
      const x = cells[i * 2], z = cells[i * 2 + 1];
      let h = 0.5 + 0.35 * Math.sin(x * 0.55 + qa) * Math.cos(z * 0.45 + qb) + 0.18 * Math.sin((x + z) * 0.9 + qc);
      if (hover) {
        const dx = x - hx, dz = z - hz, d2 = dx * dx + dz * dz;
        if (d2 < 30) h += 1.1 * Math.exp(-d2 * 0.35);
      }
      for (let j = 0; j < fronts.length; j++) {
        const f = fronts[j];
        const dx = x - f.x, dz = z - f.z, d2 = dx * dx + dz * dz;
        if (d2 < f.inner2 || d2 > f.outer2) continue; // outside the ring band: skip sqrt/exp
        const front = Math.sqrt(d2) - f.radius;
        h += f.gain * Math.exp(-front * front * 1.2);
      }
      if (h < 0.06) h = 0.06;

      const o = i * 16;
      matrices[o + 5] = h;
      matrices[o + 13] = FIELD_Y + h / 2;

      const k = h < 1.6 ? h / 1.6 : 1;
      const r = Math.round(k * RAMP_STEPS) * 3, glow = glowBase + k * glowRange, c = i * 3;
      colors[c] = RAMP[r] * glow;
      colors[c + 1] = RAMP[r + 1] * glow;
      colors[c + 2] = RAMP[r + 2] * glow;
    }
    field.instanceMatrix.needsUpdate = true;
    field.instanceColor.needsUpdate = true;

    renderer.render(scene, camera);

    // FPS badge + adaptive quality.
    frames++;
    if (now - fpsClock > 600) {
      const fps = (frames * 1000) / (now - fpsClock);
      report({ state: 'running', api, fps, calls: renderer.info.render.calls, instances: drawn, objects: drawn + satellites.length + 4 });
      frames = 0;
      fpsClock = now;
      if (now - started > 3000 && now > quietUntil && drawn > minDrawn) {
        slowReports = fps < LOW_FPS ? slowReports + 1 : 0;
        if (slowReports === 2) {
          slowReports = 0;
          if (quality < PIXEL_RATIOS.length - 1) {
            quality++;
            resize();
          } else {
            drawn = Math.max(minDrawn, drawn - Math.ceil(rows / 4) * columns);
            field.count = drawn;
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- Start
  resize();
  if (renderer.compileAsync) {
    await renderer.compileAsync(scene, camera).catch((error) => console.info('WAMR3D could not prebuild its shaders.', error));
  }
  canvas.classList.add('opacity-100');
  setTimeout(() => { canvas.style.transition = 'none'; }, 1600);

  if (reducedMotion) {
    frame(performance.now());
    report({ state: 'static', api, instances: count, calls: renderer.info.render.calls });
    return;
  }

  const setLoop = (on) => {
    loopRunning = on;
    renderer.setAnimationLoop(on ? frame : null);
  };
  setLoop(true);
  report({ state: 'running', api, instances: count });

  // Stop drawing while the tab is hidden.
  document.addEventListener('visibilitychange', () => {
    setLoop(!document.hidden);
    last = 0;
    frames = 0;
    fpsClock = performance.now();
  });
}

// The twelve edges of a cube as line segments.
function edgeFrame(THREE, size, color, opacity) {
  const h = size / 2;
  const corners = [[-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h], [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]];
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(edges.flatMap(([a, b]) => [...corners[a], ...corners[b]]), 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
}
