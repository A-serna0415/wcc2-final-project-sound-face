//////// PARTICLE SYSTEM CONTROL

// I keep a fixed particle pool, then change how many are active and how large they feel.
let activeParticleCount = 0;
let activeParticleScale = 1;

function seedParticles(count) {
  particles = []; // Clear the old pool before rebuilding it.

  for (let i = 0; i < count; i++) {
    // I create the whole pool once so draw does not keep making new particles.
    particles.push(new FaceParticle());
  }

  activeParticleCount = count; // Start with the full pool active.
}

// The anchor comes from the face, but density and size also react to camera proximity.
function updateParticles(face) {
  const audioLevel = amplitudeAnalyzer ? amplitudeAnalyzer.getLevel() : 0; // Final audio level feeds back into motion.
  const faceSize = face
    ? landmarkDistance(face[FACE_POINTS.leftEyeOuter], face[FACE_POINTS.rightEyeOuter])
    : 0.11; // If no face is available, I keep a middle-size estimate.
  const anchor = face
    ? toCanvasPoint(face[FACE_POINTS.noseTip])
    : { x: width * 0.5, y: height * 0.55 }; // If no face is found, keep the cloud in the center area.
  const intensity =
    featureState.smooth.mouthOpen * 0.45 +
    featureState.smooth.browRaise * 0.25 +
    emotionState.confidence * 0.2 +
    audioLevel * 10; // This mixed value controls how energetic the cloud feels.
  const drift = featureState.smooth.headTilt * 0.25; // Head tilt adds sideways drift.
  const style = EMOTION_STYLES[emotionState.current]; // Current emotion gives the colour profile.
  // The same eye-distance measure is used here as a basic estimate of how close the face is.
  const densityAmount = constrain(map(faceSize, 0.07, 0.2, 0, 1), 0, 1);
  const targetScale = lerp(0.82, 1.7, densityAmount); // Closer face = larger overall particle system.
  const targetCount = floor(
    lerp(STAGE_CONFIG.particleCountMin, STAGE_CONFIG.particleCount, densityAmount)
  ); // Closer face also activates more particles.
  let nextCount = round(lerp(activeParticleCount, targetCount, 0.16)); // Ease the density change instead of snapping.

  // I ease the scale too, so the cloud grows and shrinks smoothly.
  activeParticleScale = lerp(activeParticleScale, targetScale, 0.12);

  // This snaps the count at the end so it does not get stuck one or two particles away.
  if (abs(targetCount - nextCount) < 2) {
    nextCount = targetCount;
  }

  if (nextCount > activeParticleCount) {
    for (let i = activeParticleCount; i < nextCount; i++) {
      // New particles are reset near the current face position instead of appearing from old positions.
      particles[i].reset(anchor, style, intensity, drift, emotionState.current);
    }
  }

  activeParticleCount = nextCount;

  for (let i = 0; i < activeParticleCount; i++) {
    // Every active particle reacts to the same emotion, but it still keeps its own motion.
    particles[i].update(anchor, style, intensity, drift, audioLevel, emotionState.current);
  }
}

function drawParticles() {
  blendMode(ADD); // Additive mode helps the glow accumulate visually.

  for (let i = 0; i < activeParticleCount; i++) {
    particles[i].draw(); // Each active particle draws its own glow and core.
  }

  blendMode(BLEND); // Restore default drawing mode after the particle pass.
}


//////////// PARTICLE CLASS

// Each particle has slightly different orbit values so the cloud feels organic instead of procedural.
class FaceParticle {
  constructor() {
    this.orbitDirection = random() > 0.5 ? 1 : -1; // Particles orbit clockwise or counter-clockwise.
    this.orbitAngle = random(TWO_PI); // Start angle on the sphere.
    this.orbitSpeed = random(0.006, 0.02); // Small speed differences stop the motion from locking together.
    this.orbitRadius = random(20, 80); // Base radius before emotion and proximity adjustments.
    this.noiseOffsetX = random(1000); // Personal noise seed for x behaviour.
    this.noiseOffsetY = random(1000); // Personal noise seed for y behaviour.
    this.noiseStep = random(0.002, 0.006); // Personal noise speed.
    this.reset({ x: width * 0.5, y: height * 0.55 }, EMOTION_STYLES.idle, 0.2, 0, "idle"); // Start from an idle setup.
  }

  reset(anchor, style, intensity, drift, emotion) {
    const spreadX = 28 + intensity * 140;
    const spreadY = 20 + intensity * 110;

    // Gaussian spread gives me a denser centre and softer edges.
    this.x = anchor.x + randomGaussian(0, spreadX); // Initial x position around the face anchor.
    this.y = anchor.y + randomGaussian(0, spreadY); // Initial y position around the face anchor.
    this.vx = randomGaussian(0, 0.42) + drift * 8; // Starting horizontal speed with head-tilt drift added in.
    this.vy = randomGaussian(-1.2, 1.2) - intensity * 1.1; // Starting vertical speed with a small upward bias.
    this.size = random(1.5, 4 + intensity * 11) * activeParticleScale; // Base size also reacts to expression energy.
    this.life = random(70, 170); // Lifetime before the particle is recycled.
    this.maxLife = this.life; // Store the initial lifetime for alpha fading.
    this.hue = random(style.hueMin, style.hueMax + 0.001); // Random hue inside the active emotion range.
    this.sat = style.sat; // Saturation from the emotion style.
    this.bri = style.bri; // Brightness from the emotion style.
    this.alphaMax = style.alphaMax; // Maximum alpha from the emotion style.
    this.emotion = emotion; // Remember the emotion that created this particle.
    this.orbitDirection = random() > 0.5 ? 1 : -1; // New orbit direction after every reset.
    this.orbitAngle = random(TWO_PI); // New orbit angle after every reset.
    this.orbitSpeed = random(0.006, 0.02); // New orbit speed after every reset.

    // Orbit radius grows with both expression energy and face distance.
    this.orbitRadius = random(18, 54 + intensity * 70) * activeParticleScale;
    this.noiseOffsetX = random(1000); // Noise seed for x modulation.
    this.noiseOffsetY = random(1000); // Noise seed for y modulation.
    this.noiseStep = random(0.002, 0.006); // Noise step amount for this particle.

    if (emotion === "idle") {
      const sphereX = cos(this.orbitAngle) * this.orbitRadius; // X position on the sphere.
      const sphereY = sin(this.orbitAngle) * this.orbitRadius * 0.92; // Slight vertical squash makes the sphere feel more perspective-like.

      // Idle starts from a circular cloud so the neutral state feels more like a floating sphere.
      this.x = anchor.x + sphereX;
      this.y = anchor.y + sphereY;
      this.vx = -sin(this.orbitAngle) * this.orbitSpeed * this.orbitRadius * 0.9; // Tangent velocity keeps the orbit moving.
      this.vy = cos(this.orbitAngle) * this.orbitSpeed * this.orbitRadius * 0.9; // Tangent velocity keeps the orbit moving.
      this.size = random(1.5, 3.8 + intensity * 8) * activeParticleScale; // Idle particles stay slightly smaller and calmer.
    } else if (emotion === "sadness") {
      // Sad particles start with more downward speed.
      this.vy = random(0.1, 1.1) + intensity * 0.4;
    }
  }

  // Every emotion changes the force pattern, but the face anchor always remains the main reference point.
  update(anchor, style, intensity, drift, audioLevel, emotion) {
    const dx = anchor.x - this.x; // Vector from particle to the face anchor.
    const dy = anchor.y - this.y; // Vertical distance from particle to anchor.
    const distanceToAnchor = max(sqrt(dx * dx + dy * dy), 1); // Distance to the anchor.
    const nx = dx / distanceToAnchor; // Normalized x direction.
    const ny = dy / distanceToAnchor; // Normalized y direction.
    const audioPush = audioLevel * 18 + intensity * 0.08; // Shared force coming from sound and gesture energy.

    this.life -= 1; // Count down the lifetime.
    this.hue = lerp(this.hue, random(style.hueMin, style.hueMax + 0.001), 0.02); // Blend slowly into the current emotion hue range.
    this.sat = lerp(this.sat, style.sat, 0.08); // Blend saturation toward the current emotion.
    this.bri = lerp(this.bri, style.bri, 0.08); // Blend brightness toward the current emotion.
    this.alphaMax = lerp(this.alphaMax, style.alphaMax, 0.08); // Blend alpha toward the current emotion.
    this.vx += drift * 0.05; // Head tilt nudges the particle field sideways.

    if (emotion === "angry") {
      // Angry pushes harder and jitters more.
      this.vx -= nx * (0.06 + audioPush * 0.02);
      this.vy -= ny * (0.06 + audioPush * 0.02);
      this.vx += random(-0.45, 0.45);
      this.vy += random(-0.35, 0.35);
    } else if (emotion === "happy") {
      // Happy moves more around the face instead of straight away from it.
      this.vx += -ny * 0.06 * this.orbitDirection;
      this.vy += nx * 0.06 * this.orbitDirection;
      this.vx += random(-0.22, 0.22);
      this.vy -= 0.05 + audioPush * 0.01;
    } else if (emotion === "disgust") {
      // Disgust moves away and slows down.
      this.vx -= nx * 0.04;
      this.vy -= ny * 0.04;
      this.vx *= 0.985;
      this.vy *= 0.985;
    } else if (emotion === "surprised") {
      // Surprise throws particles outward more suddenly.
      this.vx -= nx * (audioPush * 0.04 + 0.03);
      this.vy -= ny * (audioPush * 0.04 + 0.03);
      this.vx += random(-0.18, 0.18);
      this.vy += random(-0.18, 0.18);
    } else if (emotion === "fear") {
      // Fear mostly trembles.
      this.vx += random(-0.38, 0.38) * (0.5 + audioPush * 0.05);
      this.vy += random(-0.38, 0.38) * (0.5 + audioPush * 0.05);
      this.vx += nx * 0.015;
      this.vy += ny * 0.015;
    } else if (emotion === "sadness") {
      // Sadness drops down gradually.
      this.vx += random(-0.05, 0.05);
      this.vy += 0.04 + audioPush * 0.006;
      this.vx *= 0.985;
    } else {
      // In idle mode the particles follow a rotating circular target around the face.
      this.orbitAngle += this.orbitSpeed * this.orbitDirection + drift * 0.01;

      const breathingRadius =
        this.orbitRadius +
        sin(frameCount * 0.02 + this.noiseOffsetX) * (2 + intensity * 10) * activeParticleScale; // Slight breathing motion so the idle cloud does not feel rigid.
      const targetX = anchor.x + cos(this.orbitAngle) * breathingRadius; // Current target x on the idle orbit.
      const targetY = anchor.y + sin(this.orbitAngle) * breathingRadius * 0.92; // Current target y on the idle orbit.
      const orbitDx = targetX - this.x; // Horizontal distance to the orbit target.
      const orbitDy = targetY - this.y; // Vertical distance to the orbit target.

      // Idle follows a circular target so the cloud reads more like a 2D sphere.
      this.vx += orbitDx * 0.012;
      this.vy += orbitDy * 0.012;
      this.vx += randomGaussian(0, 0.018); // Small noise keeps the idle motion organic.
      this.vy += randomGaussian(0, 0.018); // Small noise keeps the idle motion organic.
    }

    this.vx *= 0.96; // Damping keeps the motion soft instead of chaotic.
    this.vy *= 0.96;
    this.x += this.vx; // Move in x.
    this.y += this.vy; // Move in y.

    if (
      this.life <= 0 ||
      this.x < -80 || // Recycle if the particle leaves the left side of the screen.
      this.x > width + 80 || // Recycle if the particle leaves the right side of the screen.
      this.y < -80 || // Recycle if the particle leaves the top.
      this.y > height + 80 || // Recycle if the particle leaves the bottom.
      this.emotion !== emotion // Recycle if the global emotion changed since this particle was born.
    ) {
      // I recycle the particle instead of deleting it.
      this.reset(anchor, style, intensity, drift, emotion);
    }
  }

  draw() {
    const alpha = map(this.life, 0, this.maxLife, 0, this.alphaMax); // Fade the particle over its lifetime.
    const glowSize = this.size * 2.4; // Inner glow size.
    const outerGlowSize = this.size * 4.2; // Outer glow size.

    noStroke();
    // These extra circles fake a glow without using heavy blur effects.
    fill(this.hue % 360, this.sat, this.bri, alpha * 0.08);
    circle(this.x, this.y, outerGlowSize); // Largest faint halo.
    fill(this.hue % 360, this.sat, this.bri, alpha * 0.18);
    circle(this.x, this.y, glowSize); // Middle glow.
    fill(this.hue % 360, this.sat, this.bri, alpha);
    circle(this.x, this.y, this.size); // Bright core point.
  }
}