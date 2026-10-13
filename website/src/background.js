let renderer, scene, camera, particles = [], rings = [], core;
const darkBg = 0x10130f;
const lightBg = 0xf3f5ef;
let scrollTarget = 0;

export async function startBackground(canvas) {
  if (!navigator.gpu || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  try {
    const packagePath = import.meta.env.DEV ? '../dist/dist/wamr3d/compat.js' : '../dist/wamr3d/compat.js';
    const W = await import(/* @vite-ignore */ new URL(packagePath, import.meta.url).href);
    await W.init();
    renderer = new W.WebGPURenderer({ canvas, antialias: true });
    await renderer.init();

    scene = new W.Scene();
    scene.background = new W.Color(document.documentElement.dataset.theme === 'light' ? lightBg : darkBg);
    camera = new W.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 100);
    camera.position.set(0, 0, 12);

    scene.add(new W.HemisphereLight(0xf0ffd8, 0x263223, 1.3));
    const sun = new W.DirectionalLight(0xffffff, 2);
    sun.position.set(-4, 7, 8);
    scene.add(sun);

    const center = new W.Vector3(3.4, 0.25, -3.5);
    core = new W.Mesh(
      new W.SphereGeometry(0.9, 20, 14),
      new W.MeshStandardMaterial({ color: 0x577d35, roughness: 0.26, metalness: 0.38 })
    );
    core.position.copy(center);
    scene.add(core);

    const ringGeometry = new W.TorusGeometry(1.55, 0.018, 5, 96);
    for (let i = 0; i < 3; i++) {
      const ring = new W.Mesh(ringGeometry, new W.MeshBasicMaterial({ color: i === 1 ? 0xd1e8a9 : 0x8ebc64, transparent: true, opacity: 0.38 }));
      ring.position.copy(center);
      ring.rotation.set(0.75 + i * 0.35, i * 0.7, i * 0.45);
      ring.userData.phase = i * 1.7;
      scene.add(ring);
      rings.push(ring);
    }

    const particleGeometry = new W.SphereGeometry(0.105, 8, 6);
    const palette = [0x9bdd5a, 0x607d45, 0xd1e8a9];
    const materials = palette.map(color => new W.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.12 }));
    for (let i = 0; i < 54; i++) {
      const phase = i / 54 * Math.PI * 2;
      const radius = i % 3 === 0 ? 6.25 : 4.6;
      const particle = new W.Mesh(particleGeometry, materials[i % materials.length]);
      particle.scale.setScalar(0.55 + (i % 4) * 0.24);
      particle.userData.phase = phase;
      particle.userData.radius = radius;
      particle.userData.height = 2.6 + (i % 4) * 0.16;
      particle.userData.depth = -2 - (i % 6) * 0.8;
      scene.add(particle);
      particles.push(particle);
    }

    addEventListener('resize', resize);
    addEventListener('scroll', () => { scrollTarget = scrollY / Math.max(1, innerHeight); }, { passive: true });
    addEventListener('wamr3d-theme', event => scene.background.set(event.detail === 'light' ? lightBg : darkBg));
    resize();
    renderer.setAnimationLoop(animate);
  } catch (error) {
    canvas.hidden = true;
    console.info('WAMR3D background needs WebGPU and a built Wasm package.', error);
  }
}

function resize() {
  if (!renderer || !camera) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
}

function animate(time) {
  const clock = time * 0.00035;
  camera.position.x += (Math.sin(scrollTarget * 0.55) * 0.42 - camera.position.x) * 0.025;
  camera.position.y += (-scrollTarget * 0.3 - camera.position.y) * 0.025;
  camera.position.z += (12 - Math.min(scrollTarget, 3) * 0.28 - camera.position.z) * 0.025;

  core.rotation.y = clock * 0.55;
  core.rotation.x = Math.sin(clock * 0.7) * 0.12;
  core.scale.setScalar(1 + Math.sin(clock * 1.5) * 0.035);

  rings.forEach((ring, i) => {
    ring.rotation.y = clock * (i === 1 ? -0.24 : 0.24) * (i + 1) + scrollTarget * 0.32;
    ring.rotation.z = Math.sin(clock + ring.userData.phase) * 0.12;
  });

  particles.forEach(particle => {
    const phase = particle.userData.phase + clock * 0.42;
    particle.position.set(
      Math.cos(phase) * particle.userData.radius,
      Math.sin(phase * 1.35) * particle.userData.height + Math.sin(clock + phase) * 0.12,
      particle.userData.depth + Math.cos(phase * 2) * 0.25
    );
    particle.rotation.set(phase, phase * 0.8, phase * 0.3);
  });

  renderer.render(scene, camera);
}
