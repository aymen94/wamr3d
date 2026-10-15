// The site's live backdrop, drawn by WAMR3D through `wamr3d/compat` in hybrid mode: WebGPU
// where the browser has it, WAMR3D's own WebGL 2 renderer otherwise.
// A wave field of instanced boxes (matrices written straight into `instanceMatrix.array`,
// the batched path) around a brand cube that can be hovered and clicked (Raycaster).
// With neither API the page keeps its static CSS backdrop; three.js is never loaded.

const BACKGROUND = { dark: 0x04050c, light: 0xf4f6fb };
const PALETTE = [[0.64, 0.35, 1.0], [0.24, 0.35, 1.0], [0.13, 0.89, 1.0]];
const FIELD_Y = -3.1;

export async function startHeroScene(canvas, report = () => {}) {
  let W;
  try {
    W = await import('wamr3d/compat');
    await W.init();
  } catch (error) {
    console.info('WAMR3D could not be loaded.', error);
    return report({ state: 'unsupported', reason: 'The WAMR3D module could not be loaded.' });
  }

  const renderer = new W.WebGPURenderer({ canvas, antialias: true, powerPreference: 'high-performance', backend: 'auto' });
  try {
    await renderer.init();
  } catch (error) {
    console.info('Neither WebGPU nor WebGL 2 is available.', error);
    return report({ state: 'unsupported', reason: 'Neither WebGPU nor WebGL 2 could start on this device.' });
  }
  const api = renderer.backend?.isWebGLBackend ? 'WebGL 2' : 'WebGPU';

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = innerWidth < 760;
  const scene = new W.Scene();
  let light = document.documentElement.dataset.theme === 'light';
  scene.background = new W.Color(BACKGROUND[light ? 'light' : 'dark']);
  scene.fog = new W.FogExp2(BACKGROUND[light ? 'light' : 'dark'], 0.045);
  addEventListener('wamr3d-theme', (event) => {
    light = event.detail === 'light';
    scene.background.setHex(BACKGROUND[light ? 'light' : 'dark']);
    scene.fog.color.setHex(BACKGROUND[light ? 'light' : 'dark']);
    if (reducedMotion) frame(performance.now());
  });

  const camera = new W.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 120);
  camera.position.set(0, 0.6, 13);

  scene.add(new W.HemisphereLight(0x8fb4ff, 0x0a0618, 0.9));
  const key = new W.DirectionalLight(0xffffff, 1.6);
  key.position.set(-5, 8, 6);
  scene.add(key);
  const cyanLight = new W.PointLight(0x22e4ff, 18, 16);
  const violetLight = new W.PointLight(0xa259ff, 18, 16);
  scene.add(cyanLight, violetLight);

  // Wave field.
  const columns = small ? 34 : 64, rows = small ? 22 : 30, spacing = 0.46;
  const count = columns * rows;
  const field = new W.InstancedMesh(new W.BoxGeometry(1, 1, 1), new W.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.45 }), count);
  field.frustumCulled = false;
  const cells = new Float32Array(count * 2);
  const tint = new W.Color();
  for (let i = 0; i < count; i++) {
    const c = i % columns, r = Math.floor(i / columns);
    cells[i * 2] = (c - (columns - 1) / 2) * spacing;
    cells[i * 2 + 1] = -r * spacing + 2.5;
    field.setColorAt(i, tint.setRGB(0.3, 0.4, 1));
  }
  const matrices = field.instanceMatrix.array;
  const colors = field.instanceColor.array;
  scene.add(field);

  // Brand cube: a dark metal core inside two edge frames, a ring and orbiting satellites.
  const core = new W.Group();
  scene.add(core);
  const coreMaterial = new W.MeshStandardMaterial({ color: 0x1a1f3d, roughness: 0.22, metalness: 0.85 });
  const cube = new W.Mesh(new W.BoxGeometry(1.5, 1.5, 1.5), coreMaterial);
  core.add(cube);
  const frameInner = edgeFrame(W, 2.1, 0x22e4ff, 0.9);
  const frameOuter = edgeFrame(W, 2.9, 0xa259ff, 0.55);
  core.add(frameInner, frameOuter);
  const ring = new W.Mesh(new W.TorusGeometry(2.45, 0.016, 8, 128), new W.MeshBasicMaterial({ color: 0x3d5afe, transparent: true, opacity: 0.85 }));
  ring.rotation.x = Math.PI / 2.3;
  core.add(ring);

  const satellites = [];
  const satelliteGeometry = new W.BoxGeometry(0.22, 0.22, 0.22);
  for (let i = 0; i < 7; i++) {
    const color = [0x22e4ff, 0xa259ff, 0x3d5afe][i % 3];
    const satellite = new W.Mesh(satelliteGeometry, new W.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.3 }));
    satellite.userData = { phase: (i / 7) * Math.PI * 2, radius: 2.45 + (i % 2) * 0.12, speed: 0.45 + (i % 3) * 0.08, base: color };
    core.add(satellite);
    satellites.push(satellite);
  }

  // Interaction state.
  const raycaster = new W.Raycaster();
  const pointer = { x: 0, y: 0, nx: 0, ny: 0, active: false, moved: false };
  const ripples = [];
  let hovered = null, coreHover = 0, spin = 0, scroll = 0, last = 0, energy = 0;

  const groundPoint = () => {
    raycaster.setFromCamera({ x: pointer.nx, y: pointer.ny }, camera);
    const origin = raycaster.ray.origin, direction = raycaster.ray.direction;
    const [ox, oy, oz, dx, dy, dz] = [origin.x, origin.y, origin.z, direction.x, direction.y, direction.z];
    // The getters return copies in engine memory; release them now rather than at GC.
    origin.free?.();
    direction.free?.();
    if (Math.abs(dy) < 1e-4) return null;
    const t = (FIELD_Y - oy) / dy;
    return t > 0 ? [ox + dx * t, oz + dz * t] : null;
  };

  const interactive = (target) => !(target instanceof Element) || !target.closest('a, button, input, textarea, select, summary, pre, code, iframe, [data-no-scene]');

  addEventListener('pointermove', (event) => {
    pointer.nx = (event.clientX / innerWidth) * 2 - 1;
    pointer.ny = -(event.clientY / innerHeight) * 2 + 1;
    pointer.active = interactive(event.target);
    pointer.moved = true;
  }, { passive: true });
  addEventListener('pointerdown', (event) => {
    if (!interactive(event.target) || event.button !== 0) return;
    pointer.nx = (event.clientX / innerWidth) * 2 - 1;
    pointer.ny = -(event.clientY / innerHeight) * 2 + 1;
    raycaster.setFromCamera({ x: pointer.nx, y: pointer.ny }, camera);
    const hitCore = raycaster.intersectObject(core, true).length > 0;
    let origin = groundPoint();
    if (hitCore) {
      origin = [core.position.x, core.position.z];
      spin = 1;
      energy = 1;
    }
    if (origin) {
      ripples.push({ x: origin[0], z: origin[1], start: performance.now() / 1000, strength: hitCore ? 1.6 : 1 });
      if (ripples.length > 5) ripples.shift();
    }
    if (reducedMotion) frame(performance.now());
  }, { passive: true });
  addEventListener('scroll', () => { scroll = scrollY; if (reducedMotion) frame(performance.now()); }, { passive: true });

  // Inner pages set data-route; there the cube moves aside and the scene dims behind text.
  let aside = 0;
  const resize = () => {
    const wide = innerWidth >= 1024;
    camera.aspect = innerWidth / innerHeight;
    camera.fov = innerWidth < 640 ? 58 : 42;
    camera.updateProjectionMatrix();
    core.userData.home = [wide ? 3.6 : 1.4, wide ? 0.35 : -1.4];
    core.position.set(core.userData.home[0] + aside * 2.2, core.userData.home[1], 0);
    core.scale.setScalar(wide ? 1 : 0.6);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    renderer.setSize(innerWidth, innerHeight, false);
    if (reducedMotion) frame(performance.now());
  };
  addEventListener('resize', resize, { passive: true });

  // FPS as actually measured in this page, shown in the hero badge.
  let frames = 0, fpsClock = performance.now();

  function frame(now) {
    const t = now / 1000;
    const dt = Math.min(0.05, last ? t - last : 0.016);
    last = t;

    // Camera: drift with the pointer, sink as the page scrolls.
    const depth = Math.min(scroll / Math.max(innerHeight, 1), 3);
    const inner = document.documentElement.dataset.route !== '/';
    aside += ((inner ? 1 : 0) - aside) * (reducedMotion ? 1 : Math.min(1, dt * 3));
    core.position.x = core.userData.home[0] + aside * 2.2;
    const targetX = pointer.nx * 0.45;
    const targetY = 0.6 + pointer.ny * 0.25 + Math.min(depth, 1.5) * 2.4;
    camera.position.x += (targetX - camera.position.x) * Math.min(1, dt * 2.5);
    camera.position.y += (targetY - camera.position.y) * Math.min(1, dt * 2.5);
    camera.position.z = 13 - Math.min(depth, 1.5) * 1.2;
    camera.lookAt(core.position.x * 0.35, -Math.min(depth, 1.5) * 1.4, -2);
    canvas.style.opacity = String((1 - Math.min(depth, 1.5) * 0.3) * (1 - aside * 0.35));

    // Hover test on the cube, once per frame.
    if (pointer.moved) {
      pointer.moved = false;
      raycaster.setFromCamera({ x: pointer.nx, y: pointer.ny }, camera);
      const hit = pointer.active ? raycaster.intersectObjects([cube, ...satellites], false)[0] : undefined;
      const next = hit ? hit.object : null;
      if (next !== hovered) {
        if (hovered && hovered !== cube) hovered.material.color.setHex(hovered.userData.base);
        if (next && next !== cube) next.material.color.setHex(0xffffff);
        hovered = next;
        document.documentElement.classList.toggle('cursor-pointer', !!hovered);
      }
    }
    coreHover += ((hovered ? 1 : 0) - coreHover) * Math.min(1, dt * 6);
    spin *= Math.pow(0.25, dt);
    energy *= Math.pow(0.35, dt);

    const motion = reducedMotion ? 0 : 1;
    const speed = 1 + coreHover * 1.5 + spin * 6;
    core.rotation.y += dt * 0.25 * speed * motion;
    cube.rotation.x = t * 0.21 * motion;
    cube.rotation.z = t * 0.13 * motion;
    frameInner.rotation.y -= dt * 0.35 * speed * motion;
    frameInner.rotation.x = Math.sin(t * 0.3) * 0.4 * motion;
    frameOuter.rotation.z += dt * 0.18 * speed * motion;
    frameOuter.rotation.x = 0.6 + Math.cos(t * 0.2) * 0.3 * motion;
    ring.rotation.z += dt * 0.4 * speed * motion;
    const pulse = 1 + energy * 0.25 + coreHover * 0.06;
    frameInner.scale.setScalar(pulse);
    coreMaterial.color.setRGB(0.1 + energy * 0.25, 0.12 + coreHover * 0.08, 0.24 + coreHover * 0.2 + energy * 0.4);

    satellites.forEach((s) => {
      const { phase, radius, speed: sp } = s.userData;
      const a = phase + t * sp * speed * 0.6 * motion;
      s.position.set(Math.cos(a) * radius, Math.sin(a * 1.7) * 0.55, Math.sin(a) * radius);
      s.rotation.x += dt * 1.1 * motion;
      s.rotation.y += dt * 1.4 * motion;
    });

    cyanLight.position.set(core.position.x + Math.cos(t * 0.5) * 4, 1.5, Math.sin(t * 0.5) * 4);
    violetLight.position.set(core.position.x - 6 + Math.sin(t * 0.37) * 3, -0.5, 2 + Math.cos(t * 0.37) * 3);

    // Wave field: heights from travelling waves, the pointer and click ripples.
    const hover = pointer.active && motion ? groundPoint() : null;
    for (let i = ripples.length - 1; i >= 0; i--) if (t - ripples[i].start > 4) ripples.splice(i, 1);
    for (let i = 0; i < count; i++) {
      const x = cells[i * 2], z = cells[i * 2 + 1];
      let h = 0.5 + 0.35 * Math.sin(x * 0.55 + t * 0.9 * motion) * Math.cos(z * 0.45 + t * 0.6 * motion)
        + 0.18 * Math.sin((x + z) * 0.9 - t * 1.4 * motion);
      if (hover) {
        const dx = x - hover[0], dz = z - hover[1];
        h += 1.1 * Math.exp(-(dx * dx + dz * dz) * 0.35);
      }
      for (const ripple of ripples) {
        const dx = x - ripple.x, dz = z - ripple.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        const age = t - ripple.start;
        const front = d - age * 6;
        h += ripple.strength * Math.exp(-front * front * 1.2) * Math.max(0, 1 - age / 4) * 1.4;
      }
      h = Math.max(0.06, h);
      const o = i * 16;
      matrices[o] = 0.3; matrices[o + 5] = h; matrices[o + 10] = 0.3; matrices[o + 15] = 1;
      matrices[o + 12] = x; matrices[o + 13] = FIELD_Y + h / 2; matrices[o + 14] = z;

      const k = Math.min(1, h / 1.6);
      const [a, b] = k < 0.5 ? [PALETTE[0], PALETTE[1]] : [PALETTE[1], PALETTE[2]];
      const f = k < 0.5 ? k * 2 : (k - 0.5) * 2;
      // On the light page the low boxes stay pale instead of fading to black.
      const glow = light ? 0.75 + k * 0.25 : 0.18 + k * 0.6;
      colors[i * 3] = (a[0] + (b[0] - a[0]) * f) * glow;
      colors[i * 3 + 1] = (a[1] + (b[1] - a[1]) * f) * glow;
      colors[i * 3 + 2] = (a[2] + (b[2] - a[2]) * f) * glow;
    }
    field.instanceMatrix.needsUpdate = true;
    field.instanceColor.needsUpdate = true;

    renderer.render(scene, camera);

    frames++;
    if (now - fpsClock > 600) {
      report({ state: 'running', api, fps: (frames * 1000) / (now - fpsClock), calls: renderer.info.render.calls, instances: count, objects: count + satellites.length + 4 });
      frames = 0;
      fpsClock = now;
    }
  }

  resize();
  canvas.classList.add('opacity-100');
  // After the fade-in, scroll-driven opacity must follow the frame without easing.
  setTimeout(() => { canvas.style.transition = 'none'; }, 1600);
  if (reducedMotion) {
    frame(performance.now());
    report({ state: 'static', api, instances: count, calls: renderer.info.render.calls });
  } else {
    renderer.setAnimationLoop(frame);
    report({ state: 'running', api, instances: count });
  }
}

// The twelve edges of a cube as line segments.
function edgeFrame(W, size, color, opacity) {
  const h = size / 2;
  const corners = [[-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h], [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]];
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const positions = new Float32Array(edges.flatMap(([a, b]) => [...corners[a], ...corners[b]]));
  const geometry = new W.BufferGeometry();
  geometry.setAttribute('position', new W.BufferAttribute(positions, 3));
  return new W.LineSegments(geometry, new W.LineBasicMaterial({ color, transparent: true, opacity }));
}
