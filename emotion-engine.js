//////// BLENDSHAPE CONFIGURATION

// MediaPipe returns the blendshapes as a list, so I first convert them into a simple name-value object.
function getPrimaryBlendshapeMap() {
  const map = {}; // This will store the blendshape values by name.

  if (!faceLandmarks || !faceLandmarks.faceBlendshapes || !faceLandmarks.faceBlendshapes[0]) {
    return map; // If no blendshapes exist yet, return an empty object.
  }

  const categories = faceLandmarks.faceBlendshapes[0].categories || []; // MediaPipe stores the values in this array.
  for (const category of categories) {
    map[category.categoryName] = category.score; // Example: map["jawOpen"] = 0.42.
  }

  return map; // The rest of the system reads this object directly.
}

// The system keeps continuous scores internally, then turns them into one more stable active emotion.
function updateEmotionState(blendshapeMap) {
  if (blendshapeMap) {
    updateEmotionBaseline(blendshapeMap); // Update the neutral reference whenever a face is available.
  }

  const targetScores = blendshapeMap ? inferEmotionScores(blendshapeMap) : createEmotionScoreMap(); // No face means every emotion score should drift toward zero.

  for (const emotion of EMOTION_KEYS) {
    // This makes the change softer from one frame to the next.
    emotionState.scores[emotion] = lerp(emotionState.scores[emotion], targetScores[emotion], 0.18);
  }

  // I compare the strongest emotion with the second strongest one before changing state.
  const dominant = getDominantEmotion(emotionState.scores);
  const nextEmotion =
    dominant.score > EMOTION_THRESHOLDS[dominant.name] && dominant.margin > 0.02
      ? dominant.name
      : "idle"; // If the strongest score is still weak or ambiguous, I stay neutral.

  if (nextEmotion === emotionState.current) {
    emotionState.candidate = nextEmotion; // If nothing changed, keep the same candidate.
    emotionState.holdFrames = 0; // Reset the hold counter.
  } else if (nextEmotion === emotionState.candidate) {
    emotionState.holdFrames += 1; // Count how long the new candidate stays dominant.
    if (emotionState.holdFrames >= 5) {
      emotionState.current = nextEmotion; // Commit to the new emotion after a short confirmation.
      emotionState.holdFrames = 0;
    }
  } else {
    emotionState.candidate = nextEmotion; // Start tracking a new possible emotion.
    emotionState.holdFrames = 1;
  }

  emotionState.confidence =
    emotionState.current === "idle" ? dominant.score : emotionState.scores[emotionState.current]; // The HUD and sound both read this as the current confidence.

  maybeTriggerEmotionAudio(); // Trigger the short emotion accent if the state is stable enough.
}


//////// BASELINE LEARNING

// This moving baseline is important because different faces start from different "neutral" shapes.
function updateEmotionBaseline(blendshapeMap) {
  const shouldLearnFast = !baselineState.ready;
  const shouldLearnSlow = baselineState.ready && looksEmotionallyNeutral(blendshapeMap);
  const learningRate = shouldLearnFast ? 0.08 : shouldLearnSlow ? 0.012 : 0;

  if (learningRate === 0) {
    return; // Skip baseline changes when the face does not look neutral enough.
  }

  for (const [name, value] of Object.entries(blendshapeMap)) {
    const current = baselineState.blendshapes[name];
    // This stores a moving neutral value for each blendshape.
    baselineState.blendshapes[name] = current === undefined ? value : lerp(current, value, learningRate);
  }

  baselineState.features.mouthOpen = lerp( // Store a neutral version of the geometric mouth opening too.
    baselineState.features.mouthOpen,
    featureState.raw.mouthOpen,
    learningRate
  );
  baselineState.features.mouthWidth = lerp( // Store a neutral version of mouth width.
    baselineState.features.mouthWidth,
    featureState.raw.mouthWidth,
    learningRate
  );
  baselineState.features.browRaise = lerp( // Store a neutral version of brow height.
    baselineState.features.browRaise,
    featureState.raw.browRaise,
    learningRate
  );
  baselineState.features.eyeOpen = lerp( // Store a neutral version of eye openness.
    baselineState.features.eyeOpen,
    featureState.raw.eyeOpen,
    learningRate
  );

  // After a short time, the system assumes it has learned a usable neutral face.
  baselineState.frameCount += 1;
  if (baselineState.frameCount > 45) {
    baselineState.ready = true;
  }
}

// I only update the baseline when the face looks calm, otherwise the calibration drifts too much.
function looksEmotionallyNeutral(blendshapeMap) {
  const smile = averageRawBlendshapes(blendshapeMap, ["mouthSmileLeft", "mouthSmileRight"]); // Raw smile amount.
  const frown = averageRawBlendshapes(blendshapeMap, ["mouthFrownLeft", "mouthFrownRight"]); // Raw frown amount.
  const browDown = averageRawBlendshapes(blendshapeMap, ["browDownLeft", "browDownRight"]); // Raw brow tension.
  const eyeWide = averageRawBlendshapes(blendshapeMap, ["eyeWideLeft", "eyeWideRight"]); // Raw eye widening.
  const noseSneer = averageRawBlendshapes(blendshapeMap, ["noseSneerLeft", "noseSneerRight"]); // Raw nose tension.
  const jawOpen = getBlendshapeValue(blendshapeMap, "jawOpen"); // Raw jaw opening.

  return (
    smile < 0.34 &&
    frown < 0.24 &&
    browDown < 0.22 &&
    eyeWide < 0.22 &&
    noseSneer < 0.16 &&
    jawOpen < 0.22
  );
}


///////// EMOTION INFERENCE

// These scores are heuristic. They are meant for expressive interaction, not scientific emotion analysis.
function inferEmotionScores(blendshapeMap) {
  const smile = averageBlendshapeDeltas(blendshapeMap, ["mouthSmileLeft", "mouthSmileRight"], 0.03); // Smile intensity above neutral.
  const cheekSquint = averageBlendshapeDeltas(blendshapeMap, ["cheekSquintLeft", "cheekSquintRight"], 0.02); // Cheek lift above neutral.
  const frown = averageBlendshapeDeltas(blendshapeMap, ["mouthFrownLeft", "mouthFrownRight"], 0.02); // Frown intensity above neutral.
  const browDown = averageBlendshapeDeltas(blendshapeMap, ["browDownLeft", "browDownRight"], 0.02); // Brow pressure above neutral.
  const eyeWide = averageBlendshapeDeltas(blendshapeMap, ["eyeWideLeft", "eyeWideRight"], 0.02); // Eye widening above neutral.
  const eyeSquint = averageBlendshapeDeltas(blendshapeMap, ["eyeSquintLeft", "eyeSquintRight"], 0.02); // Eye squint above neutral.
  const noseSneer = averageBlendshapeDeltas(blendshapeMap, ["noseSneerLeft", "noseSneerRight"], 0.02); // Nose tension above neutral.
  const mouthStretch = averageBlendshapeDeltas(blendshapeMap, ["mouthStretchLeft", "mouthStretchRight"], 0.02); // Horizontal mouth tension.
  const mouthPress = averageBlendshapeDeltas(blendshapeMap, ["mouthPressLeft", "mouthPressRight"], 0.02); // Pressed lips.
  const upperLipRaise = averageBlendshapeDeltas(blendshapeMap, ["mouthUpperUpLeft", "mouthUpperUpRight"], 0.02); // Upper lip lift.
  const browInnerUp = getBlendshapeDelta(blendshapeMap, "browInnerUp", 0.02); // Inner brow lift.
  const jawOpen = getBlendshapeDelta(blendshapeMap, "jawOpen", 0.02); // Jaw opening.
  const mouthOpenDelta = positiveFeatureDelta("mouthOpen", 0.025); // Geometric mouth opening above neutral.
  const mouthWidthDelta = positiveFeatureDelta("mouthWidth", 0.025); // Geometric mouth widening above neutral.
  const browRaiseDelta = positiveFeatureDelta("browRaise", 0.015); // Geometric brow lift above neutral.
  const eyeOpenDelta = positiveFeatureDelta("eyeOpen", 0.02); // Geometric eye opening above neutral.
  const eyeCloseDelta = negativeFeatureDelta("eyeOpen", 0.02); // Geometric eye closing below neutral.
  const mouthWidthDrop = negativeFeatureDelta("mouthWidth", 0.018); // Geometric mouth narrowing below neutral.

  return {
    // Angry is mostly brow pressure, squinting, and mouth tension.
    angry: constrain(
      browDown * 0.38 +
        eyeSquint * 0.22 +
        mouthPress * 0.16 +
        noseSneer * 0.08 +
        mouthOpenDelta * 0.08 +
        eyeCloseDelta * 0.08,
      0,
      1
    ),
    // Happy is mostly smile shape, cheeks, and a wider mouth.
    happy: constrain(
      smile * 0.42 +
        cheekSquint * 0.22 +
        mouthWidthDelta * 0.2 +
        mouthOpenDelta * 0.06 +
        eyeOpenDelta * 0.06,
      0,
      1
    ),
    // Disgust is mostly nose sneer and upper lip lift.
    disgust: constrain(
      noseSneer * 0.42 +
        upperLipRaise * 0.22 +
        mouthPress * 0.18 +
        browDown * 0.1 +
        eyeSquint * 0.08,
      0,
      1
    ),
    // Surprise is mostly open jaw, wide eyes, and raised brows.
    surprised: constrain(
      jawOpen * 0.42 +
        eyeWide * 0.28 +
        browInnerUp * 0.2 +
        browRaiseDelta * 0.1,
      0,
      1
    ),
    // Fear overlaps with surprise, but it uses mouth stretch and tension more.
    fear: constrain(
      eyeWide * 0.28 +
        browInnerUp * 0.22 +
        mouthStretch * 0.22 +
        jawOpen * 0.14 +
        mouthWidthDrop * 0.14,
      0,
      1
    ),
    // Sadness is mostly frown, inner brow lift, and less eye openness.
    sadness: constrain(
      frown * 0.4 +
        browInnerUp * 0.28 +
        eyeCloseDelta * 0.16 +
        mouthWidthDrop * 0.1 +
        mouthPress * 0.06,
      0,
      1
    ),
  };
}


////////// SCORE HELPERS

function getDominantEmotion(scores) {
  let topName = "idle"; // Current strongest emotion label while looping.
  let topScore = 0; // Current strongest score while looping.
  let secondScore = 0; // Current second-strongest score while looping.

  for (const emotion of EMOTION_KEYS) {
    const score = scores[emotion];
    // I keep the first and second strongest values to check if one emotion is clearly winning.
    if (score > topScore) {
      secondScore = topScore;
      topScore = score;
      topName = emotion;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  return {
    name: topName, // Strongest emotion label.
    score: topScore, // Strongest score value.
    margin: topScore - secondScore, // Distance from the second strongest score.
  };
}

function getBlendshapeValue(map, name) {
  return map[name] || 0; // If a blendshape does not exist, treat it as zero.
}

function getBlendshapeDelta(map, name, deadzone = 0) {
  const raw = getBlendshapeValue(map, name); // Current raw blendshape value from MediaPipe.
  const baseline = baselineState.blendshapes[name] || 0; // Learned neutral value for this same blendshape.
  // Deadzone stops tiny face noise from counting as expression.
  return max(0, raw - baseline - deadzone);
}

function averageBlendshapeDeltas(map, names, deadzone = 0) {
  let total = 0; // Sum the active amount for a list of related blendshapes.

  for (const name of names) {
    total += getBlendshapeDelta(map, name, deadzone);
  }

  return total / max(names.length, 1); // Return the average instead of the full sum.
}

function averageRawBlendshapes(map, names) {
  let total = 0; // Sum the raw values for a group of blendshapes.

  for (const name of names) {
    total += getBlendshapeValue(map, name);
  }

  return total / max(names.length, 1); // Return the average raw value.
}

function positiveFeatureDelta(name, deadzone = 0) {
  // This tells me how much a feature went above neutral.
  return max(0, featureState.raw[name] - baselineState.features[name] - deadzone);
}

function negativeFeatureDelta(name, deadzone = 0) {
  // This tells me how much a feature dropped below neutral.
  return max(0, baselineState.features[name] - featureState.raw[name] - deadzone);
}

function createEmotionScoreMap() {
  // I keep the same shape for this object everywhere so the update loops stay simple.
  return {
    angry: 0,
    happy: 0,
    disgust: 0,
    surprised: 0,
    fear: 0,
    sadness: 0,
  };
}
