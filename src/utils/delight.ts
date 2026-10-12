// Delight & Micro-interactions Utility
// Provides festive confetti celebrations, Web Audio tactile chimes, and micro-interaction effects

export function triggerConfetti(originX?: number, originY?: number) {
  const container = document.createElement('div');
  container.className = 'confetti-burst-container';
  container.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    z-index: 99999;
    overflow: hidden;
  `;
  document.body.appendChild(container);

  const colors = [
    '#007AFF', '#34C759', '#FF9500', '#AF52DE', '#FF2D55', 
    '#FFCC00', '#30B0C7', '#64D2FF', '#FFD60A', '#30D158'
  ];

  const startX = originX ?? window.innerWidth / 2;
  const startY = originY ?? window.innerHeight / 3;
  const particleCount = 45;

  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement('div');
    const color = colors[Math.floor(Math.random() * colors.length)];
    const size = Math.random() * 8 + 6;
    const isCircle = Math.random() > 0.5;

    // Random velocity & angle
    const angle = (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.5;
    const velocity = Math.random() * 280 + 120;
    const endX = Math.cos(angle) * velocity;
    const endY = Math.sin(angle) * velocity + Math.random() * 100 + 80;
    const rotation = Math.random() * 720 - 360;

    particle.style.cssText = `
      position: absolute;
      top: ${startY}px;
      left: ${startX}px;
      width: ${size}px;
      height: ${isCircle ? size : size * 1.6}px;
      background: ${color};
      border-radius: ${isCircle ? '50%' : '2px'};
      opacity: 1;
      transform: translate3d(0, 0, 0) rotate(0deg);
      transition: transform 0.85s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.85s ease-out;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
    `;

    container.appendChild(particle);

    requestAnimationFrame(() => {
      particle.style.transform = `translate3d(${endX}px, ${endY}px, 0) rotate(${rotation}deg)`;
      particle.style.opacity = '0';
    });
  }

  // Play subtle celebratory chime
  playSuccessSound();

  setTimeout(() => {
    container.remove();
  }, 1000);
}

// Web Audio API Synthesizer (Zero external dependencies)
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

export function playSuccessSound() {
  const isSoundEnabled = localStorage.getItem('coal_sound_enabled') !== 'false';
  if (!isSoundEnabled) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    // Pleasant chord (C5, E5, G5, C6)
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.06);

      gain.gain.setValueAtTime(0.001, now + idx * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.08, now + idx * 0.06 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.06 + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.38);
    });
  } catch {
    // Graceful silent fallback
  }
}

export function playPopSound() {
  const isSoundEnabled = localStorage.getItem('coal_sound_enabled') !== 'false';
  if (!isSoundEnabled) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(840, now + 0.05);

    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.07);
  } catch {
    // Silently continue
  }
}

export function playCashChime() {
  const isSoundEnabled = localStorage.getItem('coal_sound_enabled') !== 'false';
  if (!isSoundEnabled) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(987.77, now); // B5
    osc.frequency.setValueAtTime(1318.51, now + 0.08); // E6

    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.09);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.48);
  } catch {
    // Silently continue
  }
}
