(() => {
  const { Engine, World, Bodies, Body, Composite, Constraint, Vector, Sleeping } = Matter;

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const nextCanvas = document.getElementById('nextCanvas');
  const nextCtx = nextCanvas.getContext('2d');

  const scoreValue = document.getElementById('scoreValue');
  const bestValue = document.getElementById('bestValue');
  const statusValue = document.getElementById('statusValue');
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('startBtn');
  const restartBtn = document.getElementById('restartBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const toast = document.getElementById('toast');
  const legendList = document.getElementById('legendList');

  const WIDTH = canvas.width;
  const HEIGHT = canvas.height;
  const CENTER_X = WIDTH / 2;
  const DROP_Y = 86;

  // Short Ball Guys style cup: flat bottom, slanted walls, open top.
  const CUP = {
    floorY: 652,
    floorLeftX: 122,
    floorRightX: 358,
    wallTopY: 420,
    leftTopX: 68,
    rightTopX: 412,
    strokeOuter: 20,
    strokeInner: 8
  };

  const TYPES = [
    { name: 'Blue', color: '#0c62f5', radius: 25, score: 10 },
    { name: 'Green', color: '#6ae84a', radius: 30, score: 22 },
    { name: 'Purple', color: '#a77bf1', radius: 35, score: 48 },
    { name: 'Red', color: '#f67b7b', radius: 40, score: 100 },
    { name: 'Orange', color: '#f78623', radius: 55, score: 210 },
    { name: 'Yellow', color: '#edd02d', radius: 65, score: 420 },
    { name: 'White', color: '#f2f1eb', radius: 75, score: 820 },
    { name: 'Super', color: '#ff00bb', radius: 90, score: 1600 },
    { name: 'Mega', color: '#00c2ff', radius: 50, score: 3200 },
    { name: 'Nova', color: '#7dff6a', radius: 40, score: 6400 }
  ];

  const state = {
    engine: Engine.create({ enableSleeping: true, gravity: { x: 0, y: 0.92 } }),
    blobs: [],
    effects: [],
    score: 0,
    best: Number(localStorage.getItem('squish-merge-best') || 0),
    currentLevel: 0,
    nextLevel: 0,
    dropX: CENTER_X,
    canDrop: true,
    dropCooldown: 0,
    started: false,
    paused: false,
    over: false,
    toastTimer: 0,
    lastTime: performance.now(),
    wallBodies: [],
    pairMergeTimers: new Map()
  };

  bestValue.textContent = String(state.best);

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function colorShade(hex, amt) {
    const num = parseInt(hex.slice(1), 16);
    const r = clamp((num >> 16) + amt, 0, 255);
    const g = clamp(((num >> 8) & 0xff) + amt, 0, 255);
    const b = clamp((num & 0xff) + amt, 0, 255);
    return `rgb(${r}, ${g}, ${b})`;
  }
  function pairKey(a, b) { return a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`; }
  function pickNextLevel() {
    const roll = Math.random();
    if (roll < 0.56) return 0;
    if (roll < 0.85) return 1;
    if (roll < 0.96) return 2;
    return 3;
  }

  function buildWorld() {
    World.clear(state.engine.world, false);
    state.engine.gravity.y = 0.92;
    state.engine.constraintIterations = 8;
    state.engine.positionIterations = 12;
    state.engine.velocityIterations = 12;

    const floorWidth = CUP.floorRightX - CUP.floorLeftX + 8;
    const floor = Bodies.rectangle(
      (CUP.floorLeftX + CUP.floorRightX) / 2,
      CUP.floorY + 4,
      floorWidth,
      16,
      { isStatic: true, friction: 0.28, frictionStatic: 0.42, restitution: 0, render: { visible: false }, label: 'cup-floor' }
    );

    const wallThickness = 24;
    const leftLen = Math.hypot(CUP.leftTopX - CUP.floorLeftX, CUP.wallTopY - CUP.floorY);
    const rightLen = Math.hypot(CUP.rightTopX - CUP.floorRightX, CUP.wallTopY - CUP.floorY);
    const leftAngle = Math.atan2(CUP.wallTopY - CUP.floorY, CUP.leftTopX - CUP.floorLeftX);
    const rightAngle = Math.atan2(CUP.wallTopY - CUP.floorY, CUP.rightTopX - CUP.floorRightX);

    const leftWall = Bodies.rectangle(
      (CUP.floorLeftX + CUP.leftTopX) / 2,
      (CUP.floorY + CUP.wallTopY) / 2,
      leftLen,
      wallThickness,
      { isStatic: true, angle: leftAngle, friction: 0.22, frictionStatic: 0.34, restitution: 0, slop: 0.005, render: { visible: false }, label: 'cup-wall-left' }
    );

    const rightWall = Bodies.rectangle(
      (CUP.floorRightX + CUP.rightTopX) / 2,
      (CUP.floorY + CUP.wallTopY) / 2,
      rightLen,
      wallThickness,
      { isStatic: true, angle: rightAngle, friction: 0.22, frictionStatic: 0.34, restitution: 0, slop: 0.005, render: { visible: false }, label: 'cup-wall-right' }
    );

    // Catch floor far below so spilled balls actually leave the cup first before ending the round.
    const outFloor = Bodies.rectangle(CENTER_X, HEIGHT + 140, WIDTH + 400, 60, {
      isStatic: true,
      friction: 0.16,
      frictionStatic: 0.28,
      restitution: 0,
      render: { visible: false },
      label: 'out-floor'
    });

    state.wallBodies = [floor, leftWall, rightWall, outFloor];
    World.add(state.engine.world, state.wallBodies);
  }

  function createBlob(level, x, y, options = {}) {
    const type = TYPES[level];
    const group = Body.nextGroup(true);
    const composite = Composite.create({ label: `blob-${level}` });
    const nodes = [];

    const ringCount = Math.max(18, Math.round(type.radius / 2.4));
    const nodeRadius = Math.max(4.6, type.radius * 0.09);
    const ringRadius = Math.max(12, type.radius - nodeRadius * 0.38);

    const center = Bodies.circle(x, y, nodeRadius * 1.1, {
      collisionFilter: { group },
      friction: 0.075,
      frictionStatic: 0.16,
      frictionAir: 0.034,
      restitution: 0.02,
      density: 0.0015,
      slop: 0.01,
      sleepThreshold: 30,
      render: { visible: false }
    });
    Composite.add(composite, center);
    nodes.push(center);

    for (let i = 0; i < ringCount; i += 1) {
      const angle = (Math.PI * 2 * i) / ringCount;
      const node = Bodies.circle(
        x + Math.cos(angle) * ringRadius,
        y + Math.sin(angle) * ringRadius,
        nodeRadius,
        {
          collisionFilter: { group },
          friction: 0.07,
          frictionStatic: 0.15,
          frictionAir: 0.035,
          restitution: 0.02,
          density: 0.00115,
          slop: 0.01,
          sleepThreshold: 30,
          render: { visible: false }
        }
      );
      nodes.push(node);
      Composite.add(composite, node);

      Composite.add(composite, Constraint.create({
        bodyA: center,
        bodyB: node,
        length: ringRadius,
        stiffness: 0.036,
        damping: 0.04,
        render: { visible: false }
      }));
    }

    for (let i = 1; i < nodes.length; i += 1) {
      const current = nodes[i];
      const next = nodes[i === nodes.length - 1 ? 1 : i + 1];
      const neighborDist = Vector.magnitude(Vector.sub(current.position, next.position));
      Composite.add(composite, Constraint.create({
        bodyA: current,
        bodyB: next,
        length: neighborDist,
        stiffness: 0.042,
        damping: 0.045,
        render: { visible: false }
      }));

      const farIndex = ((i - 1 + 3) % (nodes.length - 1)) + 1;
      const far = nodes[farIndex];
      if (far !== current) {
        Composite.add(composite, Constraint.create({
          bodyA: current,
          bodyB: far,
          length: Vector.magnitude(Vector.sub(current.position, far.position)),
          stiffness: 0.014,
          damping: 0.022,
          render: { visible: false }
        }));
      }
    }

    if (options.velocity) {
      nodes.forEach((node) => Body.setVelocity(node, options.velocity));
    }

    World.add(state.engine.world, composite);

    const blob = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      level,
      composite,
      nodes,
      center,
      radius: type.radius,
      color: type.color,
      bornAt: performance.now(),
      merging: false,
      settleBias: 0
    };

    state.blobs.push(blob);
    return blob;
  }

  function removeBlob(blob) {
    World.remove(state.engine.world, blob.composite, true);
    state.blobs = state.blobs.filter((entry) => entry !== blob);
  }

  function blobCenter(blob) {
    let x = 0;
    let y = 0;
    blob.nodes.forEach((node) => { x += node.position.x; y += node.position.y; });
    return { x: x / blob.nodes.length, y: y / blob.nodes.length };
  }

  function blobVelocity(blob) {
    let x = 0;
    let y = 0;
    blob.nodes.forEach((node) => { x += node.velocity.x; y += node.velocity.y; });
    return { x: x / blob.nodes.length, y: y / blob.nodes.length };
  }

  function blobTop(blob) {
    return Math.min(...blob.nodes.map((node) => node.position.y - node.circleRadius));
  }

  function blobBoundsRadius(blob) {
    const c = blobCenter(blob);
    return Math.max(...blob.nodes.slice(1).map((node) => Vector.magnitude(Vector.sub(node.position, c)) + node.circleRadius));
  }

  function blobContainRadius(blob) {
    const bounds = blobBoundsRadius(blob);
    return Math.max(blob.radius * 0.78, Math.min(bounds, blob.radius * 1.12));
  }

  function nudgeBlob(blob, dx, dy) {
    blob.nodes.forEach((node) => Body.translate(node, { x: dx, y: dy }));
  }

  function applyBlobImpulse(blob, impulseX, impulseY) {
    blob.nodes.forEach((node) => Body.setVelocity(node, {
      x: node.velocity.x + impulseX,
      y: node.velocity.y + impulseY
    }));
  }

  function coolBlob(blob, strength) {
    blob.nodes.forEach((node) => {
      Body.setVelocity(node, {
        x: node.velocity.x * strength,
        y: node.velocity.y * strength
      });
      node.angularVelocity *= strength;
    });
  }


  function keepBlobInsideCup(blob, passes = 1) {
    const leftAx = CUP.floorLeftX;
    const leftAy = CUP.floorY;
    const leftBx = CUP.leftTopX;
    const leftBy = CUP.wallTopY;
    const leftDx = leftBx - leftAx;
    const leftDy = leftBy - leftAy;
    const leftLen = Math.hypot(leftDx, leftDy) || 1;
    const leftNx = -leftDy / leftLen;
    const leftNy = leftDx / leftLen;

    const rightAx = CUP.floorRightX;
    const rightAy = CUP.floorY;
    const rightBx = CUP.rightTopX;
    const rightBy = CUP.wallTopY;
    const rightDx = rightBx - rightAx;
    const rightDy = rightBy - rightAy;
    const rightLen = Math.hypot(rightDx, rightDy) || 1;
    const rightNx = rightDy / rightLen;
    const rightNy = -rightDx / rightLen;

    const center = blobCenter(blob);
    const avgVel = blobVelocity(blob);
    const nearRim = center.y <= CUP.wallTopY + blob.radius * 1.15;
    const spillingOutLeft = nearRim && center.x < CUP.leftTopX - blob.radius * 0.08 && avgVel.x < 0;
    const spillingOutRight = nearRim && center.x > CUP.rightTopX + blob.radius * 0.08 && avgVel.x > 0;
    const letSpill = spillingOutLeft || spillingOutRight;

    for (let pass = 0; pass < passes; pass += 1) {
      let totalPushX = 0;
      let totalPushY = 0;
      let hitCount = 0;

      blob.nodes.slice(1).forEach((node) => {
        const r = node.circleRadius;
        const px = node.position.x;
        const py = node.position.y;

        const floorPen = (py + r) - CUP.floorY;
        if (px > CUP.floorLeftX - r - 12 && px < CUP.floorRightX + r + 12 && floorPen > 0) {
          totalPushY -= floorPen + 0.75;
          hitCount += 1;
        }

        if (letSpill) return;

        const wallZone = py >= CUP.wallTopY + 26 && py <= CUP.floorY + r;
        if (!wallZone) return;

        const leftSigned = (leftDx * (py - leftAy) - leftDy * (px - leftAx)) / leftLen;
        if (leftSigned < r + 0.45) {
          const pen = r + 0.45 - leftSigned;
          totalPushX += leftNx * pen;
          totalPushY += leftNy * pen;
          hitCount += 1;
        }

        const rightSigned = (rightDx * (py - rightAy) - rightDy * (px - rightAx)) / rightLen;
        if (rightSigned > -(r + 0.45)) {
          const pen = r + 0.45 + rightSigned;
          totalPushX += rightNx * pen;
          totalPushY += rightNy * pen;
          hitCount += 1;
        }
      });

      if (!hitCount) break;
      const pushX = totalPushX / hitCount;
      const pushY = totalPushY / hitCount;
      if (Math.abs(pushX) > 0.001 || Math.abs(pushY) > 0.001) {
        nudgeBlob(blob, pushX, pushY);
        if (pushY < 0) {
          blob.nodes.forEach((node) => {
            if (node.velocity.y > 0) {
              Body.setVelocity(node, { x: node.velocity.x * 0.992, y: node.velocity.y * 0.14 });
            }
          });
        }
      }
    }
  }

  function separateBlobPairs(iterations = 3) {
    for (let pass = 0; pass < iterations; pass += 1) {
      for (let i = 0; i < state.blobs.length; i += 1) {
        const a = state.blobs[i];
        const ca = blobCenter(a);
        const ra = blobContainRadius(a);

        for (let j = i + 1; j < state.blobs.length; j += 1) {
          const b = state.blobs[j];
          const cb = blobCenter(b);
          const rb = blobContainRadius(b);

          let delta = Vector.sub(cb, ca);
          let dist = Vector.magnitude(delta);
          if (dist < 0.0001) {
            delta = { x: Math.random() - 0.5, y: Math.random() - 0.5 };
            dist = Vector.magnitude(delta);
          }

          const sameLevel = a.level === b.level;
          const minDist = (ra + rb) * (sameLevel ? 0.84 : 0.9);
          if (dist >= minDist) continue;

          const normal = Vector.mult(delta, 1 / dist);
          const overlap = minDist - dist;
          const push = overlap * (sameLevel ? 0.34 : 0.4);
          nudgeBlob(a, -normal.x * push, -normal.y * push);
          nudgeBlob(b, normal.x * push, normal.y * push);

          const va = blobVelocity(a);
          const vb = blobVelocity(b);
          const closingSpeed = (vb.x - va.x) * normal.x + (vb.y - va.y) * normal.y;
          if (closingSpeed < -0.08) {
            const kick = Math.min(0.85, -closingSpeed * (sameLevel ? 0.05 : 0.12));
            applyBlobImpulse(a, -normal.x * kick, -normal.y * kick);
            applyBlobImpulse(b, normal.x * kick, normal.y * kick);
          }
        }
      }
    }
  }

  function pushBlobOutOfNeighbors(blob) {
    for (let pass = 0; pass < 6; pass += 1) {
      const center = blobCenter(blob);
      const radius = blobContainRadius(blob);
      let moved = false;

      state.blobs.forEach((other) => {
        if (other === blob) return;
        const oc = blobCenter(other);
        const or = blobContainRadius(other);
        let delta = Vector.sub(oc, center);
        let dist = Vector.magnitude(delta);
        if (dist < 0.0001) {
          delta = { x: Math.random() - 0.5, y: Math.random() - 0.5 };
          dist = Vector.magnitude(delta);
        }
        const minDist = (radius + or) * 0.86;
        if (dist >= minDist) return;

        const normal = Vector.mult(delta, 1 / dist);
        const overlap = minDist - dist;
        nudgeBlob(blob, -normal.x * overlap * 0.5, -normal.y * overlap * 0.5);
        nudgeBlob(other, normal.x * overlap * 0.5, normal.y * overlap * 0.5);
        moved = true;
      });

      if (!moved) break;
    }
  }

  function mergeBlobPair(a, b) {
    a.merging = true;
    b.merging = true;

    const centerA = blobCenter(a);
    const centerB = blobCenter(b);
    const mergedAt = {
      x: (centerA.x + centerB.x) / 2,
      y: Math.min(centerA.y, centerB.y) - 14
    };
    const velA = blobVelocity(a);
    const velB = blobVelocity(b);
    const mergedVelocity = {
      x: (velA.x + velB.x) / 2,
      y: (velA.y + velB.y) / 2 - 0.18
    };

    const nextLevel = Math.min(a.level + 1, TYPES.length - 1);
    removeBlob(a);
    removeBlob(b);
    state.pairMergeTimers.delete(pairKey(a, b));

    const mergedBlob = createBlob(nextLevel, mergedAt.x, mergedAt.y, { velocity: mergedVelocity });
    for (let pass = 0; pass < 10; pass += 1) {
      keepBlobInsideCup(mergedBlob, 2);
      pushBlobOutOfNeighbors(mergedBlob);
    }
    coolBlob(mergedBlob, 0.99);

    const gained = TYPES[nextLevel].score;
    state.score += gained;
    if (state.score > state.best) {
      state.best = state.score;
      localStorage.setItem('squish-merge-best', String(state.best));
      bestValue.textContent = String(state.best);
    }

    toast.textContent = `${TYPES[nextLevel].name} +${gained}`;
    toast.classList.add('show');
    state.toastTimer = 0.9;
    spawnBurst(mergedAt.x, mergedAt.y, TYPES[nextLevel].color);
    updateHud();
  }

  function maybeMerge(dt) {
    const seen = new Set();
    for (let i = 0; i < state.blobs.length; i += 1) {
      const a = state.blobs[i];
      if (a.merging || a.level === TYPES.length - 1) continue;
      for (let j = i + 1; j < state.blobs.length; j += 1) {
        const b = state.blobs[j];
        if (b.merging || a.level !== b.level) continue;

        const key = pairKey(a, b);
        seen.add(key);
        const ca = blobCenter(a);
        const cb = blobCenter(b);
        const dist = Vector.magnitude(Vector.sub(ca, cb));
        const relVel = Vector.magnitude(Vector.sub(blobVelocity(a), blobVelocity(b)));
        const target = blobContainRadius(a) + blobContainRadius(b);
        const age = performance.now() - Math.max(a.bornAt, b.bornAt);

        const closeEnough = dist < target * 1.045;
        const calmEnough = relVel < 3.6;
        if (age > 80 && closeEnough && calmEnough) {
          const next = (state.pairMergeTimers.get(key) || 0) + dt;
          state.pairMergeTimers.set(key, next);
          if (next > 0.025) {
            mergeBlobPair(a, b);
            return;
          }
        } else {
          const decayed = Math.max(0, (state.pairMergeTimers.get(key) || 0) - dt * 2.6);
          if (decayed <= 0) state.pairMergeTimers.delete(key);
          else state.pairMergeTimers.set(key, decayed);
        }
      }
    }

    for (const key of Array.from(state.pairMergeTimers.keys())) {
      if (!seen.has(key)) state.pairMergeTimers.delete(key);
    }
  }

  function updateEffects(dt) {
    state.effects.forEach((fx) => {
      fx.age += dt;
      fx.x += fx.vx * 60 * dt;
      fx.y += fx.vy * 60 * dt;
      fx.vy += 0.08;
      fx.vx *= 0.992;
    });
    state.effects = state.effects.filter((fx) => fx.age < fx.life);

    if (state.toastTimer > 0) {
      state.toastTimer -= dt;
      if (state.toastTimer <= 0) toast.classList.remove('show');
    }
  }

  function spawnBurst(x, y, color) {
    for (let i = 0; i < 14; i += 1) {
      const angle = (Math.PI * 2 * i) / 14 + Math.random() * 0.3;
      const speed = 2.4 + Math.random() * 3.2;
      state.effects.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 1.3, life: 0.6 + Math.random() * 0.35, age: 0, color });
    }
  }

  function updateHud() {
    scoreValue.textContent = String(state.score);
    bestValue.textContent = String(state.best);
    if (state.over) statusValue.textContent = 'Over';
    else if (!state.started) statusValue.textContent = 'Ready';
    else if (state.paused) statusValue.textContent = 'Paused';
    else statusValue.textContent = 'Running';
    pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';
  }

  function resetGame() {
    state.blobs = [];
    state.effects = [];
    state.pairMergeTimers = new Map();
    state.score = 0;
    state.currentLevel = pickNextLevel();
    state.nextLevel = pickNextLevel();
    state.dropX = CENTER_X;
    state.canDrop = true;
    state.dropCooldown = 0;
    state.started = false;
    state.paused = false;
    state.over = false;
    state.toastTimer = 0;

    buildWorld();
    overlay.classList.add('show');
    overlay.querySelector('h2').textContent = 'Drop, squish, merge.';
    overlay.querySelector('p').textContent = 'Same-color blobs merge into bigger ones. Keep the stack inside the cup and do not spill out.';
    startBtn.textContent = 'Start game';
    updateHud();
    drawNext();
  }

  function startGame() {
    state.started = true;
    state.over = false;
    state.paused = false;
    overlay.classList.remove('show');
    updateHud();
  }

  function dropBlob() {
    if (!state.started || state.over || state.paused || !state.canDrop) return;
    const radius = TYPES[state.currentLevel].radius;
    const minX = CUP.leftTopX + radius + 2;
    const maxX = CUP.rightTopX - radius - 2;
    const x = clamp(state.dropX, minX, maxX);
    createBlob(state.currentLevel, x, DROP_Y, { velocity: { x: 0, y: 0.08 } });
    state.currentLevel = state.nextLevel;
    state.nextLevel = pickNextLevel();
    state.canDrop = false;
    state.dropCooldown = 0.23;
    drawNext();
  }

  function gameOver() {
    if (state.over) return;
    state.over = true;
    state.started = false;
    overlay.classList.add('show');
    overlay.querySelector('h2').textContent = 'Round over';
    overlay.querySelector('p').textContent = `You scored ${state.score}. Hit restart and go again.`;
    startBtn.textContent = 'Play again';
    updateHud();
  }

  function pointSegmentDistance(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    return Math.hypot(px - cx, py - cy);
  }

  function isOutsideCup(center, radius) {
    if (center.y - radius < CUP.wallTopY - 20) return false;
    if (center.y > HEIGHT + 40) return true;

    const leftDist = pointSegmentDistance(center.x, center.y, CUP.floorLeftX, CUP.floorY, CUP.leftTopX, CUP.wallTopY);
    const rightDist = pointSegmentDistance(center.x, center.y, CUP.floorRightX, CUP.floorY, CUP.rightTopX, CUP.wallTopY);

    const leftSide = center.x < lerp(CUP.floorLeftX, CUP.leftTopX, clamp((CUP.floorY - center.y) / (CUP.floorY - CUP.wallTopY), 0, 1));
    const rightSide = center.x > lerp(CUP.floorRightX, CUP.rightTopX, clamp((CUP.floorY - center.y) / (CUP.floorY - CUP.wallTopY), 0, 1));

    return (leftSide && leftDist > radius * 0.2) || (rightSide && rightDist > radius * 0.2);
  }

  function calmStack() {
    state.blobs.forEach((blob) => {
      const vel = blobVelocity(blob);
      const speed = Math.hypot(vel.x, vel.y);
      const center = blobCenter(blob);
      const nearBottom = center.y > CUP.wallTopY + 30;
      const contained = center.x > CUP.leftTopX - blob.radius && center.x < CUP.rightTopX + blob.radius;
      if (!nearBottom || !contained) {
        blob.nodes.forEach((node) => Sleeping.set(node, false));
        return;
      }

      if (speed < 0.045) {
        blob.nodes.forEach((node) => {
          Body.setVelocity(node, { x: 0, y: 0 });
          node.angularVelocity = 0;
          Sleeping.set(node, true);
        });
      } else if (speed < 0.12) {
        coolBlob(blob, 0.7);
      } else if (speed < 0.24) {
        coolBlob(blob, 0.86);
      } else if (speed < 0.42) {
        coolBlob(blob, 0.95);
      }
    });
  }

  function update(dt) {
    if (!state.started || state.paused || state.over) return;

    Engine.update(state.engine, dt * 1000);
    state.blobs.forEach((blob) => keepBlobInsideCup(blob, 2));
    separateBlobPairs(3);
    state.blobs.forEach((blob) => keepBlobInsideCup(blob, 2));
    calmStack();

    if (!state.canDrop) {
      state.dropCooldown -= dt;
      if (state.dropCooldown <= 0) state.canDrop = true;
    }

    maybeMerge(dt);
    updateEffects(dt);

    for (const blob of state.blobs) {
      const center = blobCenter(blob);
      const radius = blobContainRadius(blob);
      if (isOutsideCup(center, radius) && center.y > CUP.wallTopY - 10) {
        gameOver();
        break;
      }
    }
  }

  function catmullRomClosed(points, tension = 1) {
    if (points.length < 3) return [];
    const segments = [];
    const n = points.length;
    for (let i = 0; i < n; i += 1) {
      const p0 = points[(i - 1 + n) % n];
      const p1 = points[i];
      const p2 = points[(i + 1) % n];
      const p3 = points[(i + 2) % n];
      const cp1 = { x: p1.x + ((p2.x - p0.x) / 6) * tension, y: p1.y + ((p2.y - p0.y) / 6) * tension };
      const cp2 = { x: p2.x - ((p3.x - p1.x) / 6) * tension, y: p2.y - ((p3.y - p1.y) / 6) * tension };
      segments.push({ p1, cp1, cp2, p2 });
    }
    return segments;
  }

  function drawFace(center, r) {
    const eyeY = center.y - r * 0.12;
    const eyeDx = r * 0.24;
    const eyeR = Math.max(2.2, r * 0.075);
    const pupilR = Math.max(1.3, eyeR * 0.46);

    ctx.fillStyle = '#243353';
    ctx.beginPath();
    ctx.arc(center.x - eyeDx, eyeY, eyeR, 0, Math.PI * 2);
    ctx.arc(center.x + eyeDx, eyeY, eyeR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(center.x - eyeDx - eyeR * 0.24, eyeY - eyeR * 0.22, pupilR, 0, Math.PI * 2);
    ctx.arc(center.x + eyeDx - eyeR * 0.24, eyeY - eyeR * 0.22, pupilR, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#243353';
    ctx.lineWidth = Math.max(2.2, r * 0.055);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(center.x, center.y + r * 0.12, r * 0.24, 0.12 * Math.PI, 0.88 * Math.PI);
    ctx.stroke();
  }

  function drawBlobBody(center, radius, color, points) {
    const segments = catmullRomClosed(points, 1);
    if (!segments.length) return;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(segments[0].p1.x, segments[0].p1.y);
    segments.forEach((s) => ctx.bezierCurveTo(s.cp1.x, s.cp1.y, s.cp2.x, s.cp2.y, s.p2.x, s.p2.y));
    ctx.closePath();

    const grad = ctx.createRadialGradient(
      center.x - radius * 0.34,
      center.y - radius * 0.38,
      radius * 0.12,
      center.x,
      center.y,
      radius * 1.1
    );
    grad.addColorStop(0, colorShade(color, 58));
    grad.addColorStop(1, colorShade(color, -18));
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.lineWidth = Math.max(4, radius * 0.078);
    ctx.strokeStyle = '#243353';
    ctx.stroke();

    ctx.globalAlpha = 0.24;
    ctx.beginPath();
    ctx.ellipse(center.x - radius * 0.22, center.y - radius * 0.34, radius * 0.22, radius * 0.12, -0.55, 0, Math.PI * 2);
    ctx.fillStyle = 'white';
    ctx.fill();
    ctx.globalAlpha = 1;

    drawFace(center, radius);
    ctx.restore();
  }

  function drawBlob(blob) {
    const center = blobCenter(blob);
    const rawPoints = blob.nodes.slice(1).map((node) => ({ x: node.position.x, y: node.position.y }));
    rawPoints.sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
    const points = rawPoints.map((p, i, arr) => {
      const prev = arr[(i - 1 + arr.length) % arr.length];
      const next = arr[(i + 1) % arr.length];
      return {
        x: prev.x * 0.18 + p.x * 0.64 + next.x * 0.18,
        y: prev.y * 0.18 + p.y * 0.64 + next.y * 0.18
      };
    });
    drawBlobBody(center, blob.radius, blob.color, points);
  }

  function drawEffects() {
    state.effects.forEach((fx) => {
      const alpha = 1 - fx.age / fx.life;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = fx.color;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 3 + alpha * 5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawBucket() {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.strokeStyle = 'rgba(36, 51, 83, 0.22)';
    ctx.lineWidth = CUP.strokeOuter + 6;
    ctx.beginPath();
    ctx.moveTo(CUP.leftTopX, CUP.wallTopY);
    ctx.lineTo(CUP.floorLeftX, CUP.floorY);
    ctx.lineTo(CUP.floorRightX, CUP.floorY);
    ctx.lineTo(CUP.rightTopX, CUP.wallTopY);
    ctx.stroke();

    ctx.strokeStyle = '#20252f';
    ctx.lineWidth = CUP.strokeOuter;
    ctx.beginPath();
    ctx.moveTo(CUP.leftTopX, CUP.wallTopY);
    ctx.lineTo(CUP.floorLeftX, CUP.floorY);
    ctx.lineTo(CUP.floorRightX, CUP.floorY);
    ctx.lineTo(CUP.rightTopX, CUP.wallTopY);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = CUP.strokeInner;
    ctx.beginPath();
    ctx.moveTo(CUP.leftTopX + 2, CUP.wallTopY + 5);
    ctx.lineTo(CUP.floorLeftX + 6, CUP.floorY - 4);
    ctx.lineTo(CUP.floorRightX - 6, CUP.floorY - 4);
    ctx.lineTo(CUP.rightTopX - 2, CUP.wallTopY + 5);
    ctx.stroke();

    ctx.restore();
  }

  function drawCurrentDropper() {
    if (!state.started || state.over) return;
    const type = TYPES[state.currentLevel];
    const x = clamp(state.dropX, CUP.leftTopX + type.radius + 2, CUP.rightTopX - type.radius - 2);
    const y = DROP_Y;

    ctx.save();
    ctx.strokeStyle = 'rgba(36, 51, 83, 0.14)';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 10]);
    ctx.beginPath();
    ctx.moveTo(x, 14);
    ctx.lineTo(x, y - type.radius - 10);
    ctx.stroke();
    ctx.setLineDash([]);

    const pts = [];
    const previewCount = 16;
    for (let i = 0; i < previewCount; i += 1) {
      const angle = (Math.PI * 2 * i) / previewCount;
      pts.push({ x: x + Math.cos(angle) * type.radius, y: y + Math.sin(angle) * type.radius });
    }
    drawBlobBody({ x, y }, type.radius, type.color, pts);

    if (!state.canDrop) {
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = '#243353';
      ctx.beginPath();
      ctx.arc(x, y, type.radius + 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawNext() {
    nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    const type = TYPES[state.nextLevel];
    const x = nextCanvas.width / 2;
    const y = nextCanvas.height / 2;
    const r = Math.min(type.radius * 0.48, 22);
    const pts = [];
    for (let i = 0; i < 16; i += 1) {
      const angle = (Math.PI * 2 * i) / 16;
      pts.push({ x: x + Math.cos(angle) * r, y: y + Math.sin(angle) * r });
    }
    const segments = catmullRomClosed(pts, 1);
    if (!segments.length) return;
    nextCtx.beginPath();
    nextCtx.moveTo(segments[0].p1.x, segments[0].p1.y);
    segments.forEach((s) => nextCtx.bezierCurveTo(s.cp1.x, s.cp1.y, s.cp2.x, s.cp2.y, s.p2.x, s.p2.y));
    nextCtx.closePath();
    const grad = nextCtx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.12, x, y, r * 1.2);
    grad.addColorStop(0, colorShade(type.color, 58));
    grad.addColorStop(1, colorShade(type.color, -18));
    nextCtx.fillStyle = grad;
    nextCtx.fill();
    nextCtx.lineWidth = 3.5;
    nextCtx.strokeStyle = '#243353';
    nextCtx.stroke();
  }

  function fillLegend() {
    legendList.innerHTML = '';
    TYPES.forEach((type) => {
      const item = document.createElement('div');
      item.className = 'legend-entry';
      item.innerHTML = `<div class="legend-dot" style="background:${type.color}"></div><span>${type.name}</span>`;
      legendList.appendChild(item);
    });
  }

  function render() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    drawBucket();
    state.blobs.slice().sort((a, b) => blobCenter(a).y - blobCenter(b).y).forEach(drawBlob);
    drawEffects();
    drawCurrentDropper();

    if (state.paused && state.started && !state.over) {
      ctx.fillStyle = 'rgba(18, 26, 49, 0.18)';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.fillStyle = '#15203a';
      ctx.font = '800 52px "Baloo 2"';
      ctx.textAlign = 'center';
      ctx.fillText('Paused', WIDTH / 2, HEIGHT / 2);
    }
  }

  function setPointer(clientX) {
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * WIDTH;
    state.dropX = clamp(x, CUP.leftTopX + 24, CUP.rightTopX - 24);
  }

  function togglePause() {
    if (!state.started || state.over) return;
    state.paused = !state.paused;
    updateHud();
  }

  canvas.addEventListener('pointermove', (event) => setPointer(event.clientX));
  canvas.addEventListener('pointerdown', (event) => {
    setPointer(event.clientX);
    if (!state.started) {
      startGame();
      return;
    }
    dropBlob();
  });

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      event.preventDefault();
      if (!state.started) startGame();
      else dropBlob();
    }
    if (event.code === 'KeyP') togglePause();
  });

  startBtn.addEventListener('click', () => {
    if (state.over) resetGame();
    startGame();
  });
  restartBtn.addEventListener('click', resetGame);
  pauseBtn.addEventListener('click', togglePause);

  function frame(now) {
    const dt = Math.min(0.033, (now - state.lastTime) / 1000 || 0.016);
    state.lastTime = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  fillLegend();
  resetGame();
  requestAnimationFrame(frame);
})();
