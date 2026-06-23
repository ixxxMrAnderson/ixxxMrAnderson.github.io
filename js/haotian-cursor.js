(() => {
  const canvas = document.getElementById("haotian-particle-canvas");
  const cursor = document.getElementById("haotian-cursor");
  const title = document.querySelector(".hero-name");
  if (!canvas || !cursor || !title) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  const WORD_LINES = ["Haotian", "Chu"];
  const RENDER_SCALE = 0.82;
  const GRID_SIZE = 74;
  const MAX_PARTICLES = 23000;

  const pointer = {
    active: false,
    entered: false,
    x: 0,
    y: 0,
    px: 0,
    py: 0,
    tx: 0,
    ty: 0,
    radius: 136,
    strength: 4.8,
    lastMove: 0,
  };

  let width = 0;
  let height = 0;
  let dpr = 1;
  let particles = [];
  let active = new Set();
  let grid = new Map();
  let staticLayer = document.createElement("canvas");
  let staticCtx = staticLayer.getContext("2d", { alpha: true });
  let cursorX = 0;
  let cursorY = 0;
  let cursorScale = 1;
  let targetCursorScale = 1;
  let cursorOpacity = 0;
  let targetCursorOpacity = 0;
  let raf = 0;
  let running = false;

  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function cellKey(x, y) {
    return `${Math.floor(x / GRID_SIZE)},${Math.floor(y / GRID_SIZE)}`;
  }

  function closestPointOnSegment(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const denom = abx * abx + aby * aby;
    if (denom === 0) return { x: bx, y: by };
    const t = clamp(((px - ax) * abx + (py - ay) * aby) / denom, 0, 1);
    return { x: ax + abx * t, y: ay + aby * t };
  }

  function makeParticle(x, y) {
    return {
      homeX: x,
      homeY: y,
      x,
      y,
      vx: 0,
      vy: 0,
      radius: rand(1.0, 1.85),
      alpha: rand(0.32, 0.74),
      phase: rand(0, Math.PI * 2),
      drift: rand(0.35, 1.05),
    };
  }

  function buildParticlesFromTitle() {
    const scale = width < 760 ? 0.3 : 0.26;
    const mask = document.createElement("canvas");
    const maskCtx = mask.getContext("2d", { willReadFrequently: true });
    const longestLine = WORD_LINES.reduce((longest, line) => line.length > longest.length ? line : longest, "");
    const fontSize = Math.min(width / (longestLine.length * 0.56), height * 0.3);
    const lineHeight = fontSize * 1.08;

    mask.width = Math.max(1, Math.floor(width * scale));
    mask.height = Math.max(1, Math.floor(height * scale));

    const centerX = width * (width < 760 ? 0.31 : 0.24) * scale;
    const centerY = height * 0.47 * scale;

    maskCtx.clearRect(0, 0, mask.width, mask.height);
    maskCtx.fillStyle = "#fff";
    maskCtx.font = `700 ${fontSize * scale}px Arial Black, Arial, Helvetica, sans-serif`;
    maskCtx.textAlign = "left";
    maskCtx.textBaseline = "middle";
    const startY = centerY - ((WORD_LINES.length - 1) * lineHeight * scale) / 2;
    const imageRect = document.querySelector(".hero-image")?.getBoundingClientRect();
    const haotianWidth = maskCtx.measureText(WORD_LINES[0]).width;
    const nHalfWidth = maskCtx.measureText("n").width * 0.5;
    const leftX = imageRect && width >= 760
      ? imageRect.left * scale + nHalfWidth - haotianWidth
      : centerX;
    WORD_LINES.forEach((line, index) => {
      maskCtx.fillText(line, leftX, startY + index * lineHeight * scale);
    });

    const image = maskCtx.getImageData(0, 0, mask.width, mask.height);
    const step = width < 760 ? 2 : 1;
    const next = [];

    for (let y = 0; y < mask.height; y += step) {
      for (let x = 0; x < mask.width; x += step) {
        const i = (y * mask.width + x) * 4 + 3;
        const alpha = image.data[i];
        if (alpha < 88) continue;
        const left = x > 0 ? image.data[(y * mask.width + x - 1) * 4 + 3] : 0;
        const right = x < mask.width - 1 ? image.data[(y * mask.width + x + 1) * 4 + 3] : 0;
        const up = y > 0 ? image.data[((y - 1) * mask.width + x) * 4 + 3] : 0;
        const down = y < mask.height - 1 ? image.data[((y + 1) * mask.width + x) * 4 + 3] : 0;
        const edge = Math.max(
          Math.abs(alpha - left),
          Math.abs(alpha - right),
          Math.abs(alpha - up),
          Math.abs(alpha - down)
        );
        const keepChance = edge > 30 ? 1 : 0.82;
        if (Math.random() > keepChance) continue;
        next.push(makeParticle(x / scale + rand(-1.6, 1.6), y / scale + rand(-1.6, 1.6)));
      }
    }

    while (next.length > MAX_PARTICLES) {
      next.splice(Math.floor(Math.random() * next.length), 1);
    }

    particles = next;
    active = new Set();
    buildGrid();
  }

  function buildGrid() {
    grid = new Map();
    particles.forEach((p, index) => {
      const key = cellKey(p.homeX, p.homeY);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(index);
    });
  }

  function renderStaticLayer() {
    staticLayer.width = Math.floor(width * dpr);
    staticLayer.height = Math.floor(height * dpr);
    staticCtx = staticLayer.getContext("2d", { alpha: true });
    staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    staticCtx.clearRect(0, 0, width, height);
    staticCtx.fillStyle = "#b8b1aa";

    for (const p of particles) {
      staticCtx.globalAlpha = p.alpha;
      staticCtx.beginPath();
      staticCtx.arc(p.homeX, p.homeY, p.radius, 0, Math.PI * 2);
      staticCtx.fill();
    }

    staticCtx.globalAlpha = 1;
  }

  function resize() {
    dpr = RENDER_SCALE;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildParticlesFromTitle();
    renderStaticLayer();
    draw();
    requestTick();
  }

  function activateNearPointer() {
    if (!pointer.active) return;

    const minX = Math.min(pointer.x, pointer.px) - pointer.radius;
    const maxX = Math.max(pointer.x, pointer.px) + pointer.radius;
    const minY = Math.min(pointer.y, pointer.py) - pointer.radius;
    const maxY = Math.max(pointer.y, pointer.py) + pointer.radius;
    const startCol = Math.floor(minX / GRID_SIZE);
    const endCol = Math.floor(maxX / GRID_SIZE);
    const startRow = Math.floor(minY / GRID_SIZE);
    const endRow = Math.floor(maxY / GRID_SIZE);

    for (let row = startRow; row <= endRow; row += 1) {
      for (let col = startCol; col <= endCol; col += 1) {
        const bucket = grid.get(`${col},${row}`);
        if (!bucket) continue;
        for (const index of bucket) {
          const p = particles[index];
          const point = closestPointOnSegment(p.homeX, p.homeY, pointer.px, pointer.py, pointer.x, pointer.y);
          const distance = Math.hypot(p.homeX - point.x, p.homeY - point.y);
          if (distance < pointer.radius) {
            if (!active.has(index)) {
              p.x = p.homeX;
              p.y = p.homeY;
            }
            active.add(index);
          }
        }
      }
    }
  }

  function disturbParticle(p) {
    if (!pointer.active) return;

    const speed = Math.hypot(pointer.x - pointer.px, pointer.y - pointer.py);
    const point = speed > 4
      ? closestPointOnSegment(p.x, p.y, pointer.px, pointer.py, pointer.x, pointer.y)
      : { x: pointer.x, y: pointer.y };
    const dx = p.x - point.x;
    const dy = p.y - point.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0 || distance > pointer.radius) return;

    const falloff = (1 - distance / pointer.radius) ** 2.2;
    const nx = dx / distance;
    const ny = dy / distance;
    const motion = Math.max(1, speed);
    const mx = (pointer.x - pointer.px) / motion;
    const my = (pointer.y - pointer.py) / motion;
    const drag = Math.min(2.5, motion / 28);

    p.vx += nx * falloff * pointer.strength * 0.24;
    p.vy += ny * falloff * pointer.strength * 0.24;
    p.vx += mx * falloff * pointer.strength * drag * 0.28;
    p.vy += my * falloff * pointer.strength * drag * 0.28;
  }

  function updateActiveParticles() {
    activateNearPointer();
    const settled = [];

    for (const index of active) {
      const p = particles[index];
      p.phase += 0.008;
      disturbParticle(p);

      const homeDx = p.homeX - p.x;
      const homeDy = p.homeY - p.y;
      const offset = Math.abs(homeDx) + Math.abs(homeDy);
      const recovering = !pointer.active;
      const current = pointer.active ? 1 : clamp(offset / 180, 0, 0.36);
      const pull = recovering ? 0.00034 : 0.0016;
      const damping = recovering ? 0.885 : 0.932;
      const moveScale = recovering ? 0.32 : 1;
      const maxSpeed = recovering ? 0.24 : 8;
      const swirlX = Math.sin(p.phase + p.y * 0.018) * 0.004 * p.drift * current;
      const swirlY = Math.cos(p.phase * 0.9 + p.x * 0.014) * 0.0036 * p.drift * current;

      p.vx += homeDx * pull + swirlX;
      p.vy += homeDy * pull + swirlY;
      p.vx *= damping;
      p.vy *= damping;

      const velocity = Math.hypot(p.vx, p.vy);
      if (velocity > maxSpeed) {
        const limit = maxSpeed / velocity;
        p.vx *= limit;
        p.vy *= limit;
      }

      p.x += p.vx * moveScale;
      p.y += p.vy * moveScale;

      const speed = Math.abs(p.vx) + Math.abs(p.vy);
      if (!pointer.active && speed < 0.012 && offset < 0.22) {
        p.x = p.homeX;
        p.y = p.homeY;
        p.vx = 0;
        p.vy = 0;
        settled.push(index);
      }
    }

    for (const index of settled) active.delete(index);
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(staticLayer, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (active.size === 0) return;

    ctx.save();
    for (const index of active) {
      const p = particles[index];
      const erase = p.radius + 1.8;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#050505";
      ctx.beginPath();
      ctx.arc(p.homeX, p.homeY, erase, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "#b8b1aa";
    for (const index of active) {
      const p = particles[index];
      const stretch = clamp(Math.hypot(p.vx, p.vy) / 12, 0, 1);
      const radius = p.radius + stretch * 0.8;
      ctx.globalAlpha = p.alpha * (0.7 + stretch * 0.3);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function updateCursor() {
    if (!finePointer.matches) return false;

    cursorX = lerp(cursorX, pointer.tx, 0.2);
    cursorY = lerp(cursorY, pointer.ty, 0.2);
    cursorScale = lerp(cursorScale, targetCursorScale, 0.18);
    cursorOpacity = lerp(cursorOpacity, targetCursorOpacity, 0.22);
    cursor.style.opacity = String(cursorOpacity);
    cursor.style.transform = `translate3d(${cursorX - 36}px, ${cursorY - 36}px, 0) scale(${cursorScale})`;

    return (
      Math.abs(cursorX - pointer.tx) > 0.2 ||
      Math.abs(cursorY - pointer.ty) > 0.2 ||
      Math.abs(cursorOpacity - targetCursorOpacity) > 0.01 ||
      Math.abs(cursorScale - targetCursorScale) > 0.01
    );
  }

  function tick(time) {
    if (pointer.active && time - pointer.lastMove > 150) pointer.active = false;
    updateActiveParticles();
    draw();

    const cursorMoving = updateCursor();
    if (active.size > 0 || pointer.active || cursorMoving) {
      raf = window.requestAnimationFrame(tick);
    } else {
      running = false;
    }
  }

  function requestTick() {
    if (running) return;
    running = true;
    raf = window.requestAnimationFrame(tick);
  }

  function onPointerMove(event) {
    if (!finePointer.matches) return;
    if (!pointer.entered) {
      pointer.entered = true;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.px = event.clientX;
      pointer.py = event.clientY;
      cursorX = event.clientX;
      cursorY = event.clientY;
    } else {
      pointer.px = pointer.x;
      pointer.py = pointer.y;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    }

    pointer.tx = event.clientX;
    pointer.ty = event.clientY;
    pointer.radius = event.buttons ? 190 : 136;
    pointer.strength = event.buttons ? 7.5 : 4.8;
    pointer.active = true;
    pointer.lastMove = performance.now();
    targetCursorOpacity = 1;
    requestTick();
  }

  function onPointerLeave() {
    pointer.active = false;
    pointer.entered = false;
    targetCursorOpacity = 0;
    requestTick();
  }

  function onPointerDown() {
    targetCursorScale = 0.72;
    pointer.radius = 190;
    pointer.strength = 7.5;
    requestTick();
  }

  function onPointerUp() {
    targetCursorScale = 1;
    pointer.radius = 136;
    pointer.strength = 4.8;
    requestTick();
  }

  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerleave", onPointerLeave);
  window.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("beforeunload", () => window.cancelAnimationFrame(raf));

  resize();
})();
