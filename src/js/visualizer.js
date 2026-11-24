// ===== AUDIO VISUALIZER MODULE =====

class AudioVisualizer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.barCount = 14;
    this.bars = new Array(this.barCount).fill(0);
    this.targetBars = new Array(this.barCount).fill(0);
    this.animationId = null;
    this.isActive = false;
    this.hue = 140; // Spotify green hue

    // High DPI support
    this.setupCanvas();
  }

  setupCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.displayWidth = rect.width;
    this.displayHeight = rect.height;
  }

  start() {
    this.isActive = true;
    this.animate();
  }

  stop() {
    this.isActive = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  // Simulate audio data (will be replaced with real audio data later)
  generateSimulatedData() {
    for (let i = 0; i < this.barCount; i++) {
      // Create a natural-looking pattern
      const baseHeight = 0.3;
      const variation = Math.random() * 0.7;
      const centerBias = 1 - Math.abs(i - this.barCount / 2) / (this.barCount / 2) * 0.4;
      this.targetBars[i] = (baseHeight + variation) * centerBias;
    }
  }

  // Set real audio data (from Spotify Analysis or Web Audio API)
  setAudioData(dataArray) {
    const step = Math.floor(dataArray.length / this.barCount);
    for (let i = 0; i < this.barCount; i++) {
      this.targetBars[i] = dataArray[i * step] / 255;
    }
  }

  animate() {
    if (!this.isActive) return;

    // Generate new target values periodically
    if (Math.random() < 0.15) {
      this.generateSimulatedData();
    }

    // Smooth interpolation
    for (let i = 0; i < this.barCount; i++) {
      this.bars[i] += (this.targetBars[i] - this.bars[i]) * 0.18;
    }

    this.draw();
    this.animationId = requestAnimationFrame(() => this.animate());
  }

  draw() {
    const { ctx, displayWidth, displayHeight, barCount, bars } = this;
    
    // Clear
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    const barWidth = 6;
    const barGap = 4;
    const totalWidth = barCount * (barWidth + barGap) - barGap;
    const startX = (displayWidth - totalWidth) / 2;
    const maxBarHeight = displayHeight * 0.85;
    const baseY = displayHeight * 0.9;

    for (let i = 0; i < barCount; i++) {
      const barHeight = Math.max(4, bars[i] * maxBarHeight);
      const x = startX + i * (barWidth + barGap);
      const y = baseY - barHeight;

      // Gradient for each bar
      const gradient = ctx.createLinearGradient(x, baseY, x, y);
      gradient.addColorStop(0, `hsla(${this.hue}, 70%, 45%, 0.9)`);
      gradient.addColorStop(0.5, `hsla(${this.hue}, 80%, 55%, 1)`);
      gradient.addColorStop(1, `hsla(${this.hue + 20}, 90%, 65%, 1)`);

      // Main bar
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, [3, 3, 1, 1]);
      ctx.fill();

      // Glow effect
      ctx.shadowColor = `hsla(${this.hue}, 80%, 55%, 0.4)`;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Reflection (mirror below, faded)
      const reflectionHeight = barHeight * 0.3;
      const reflGradient = ctx.createLinearGradient(x, baseY, x, baseY + reflectionHeight);
      reflGradient.addColorStop(0, `hsla(${this.hue}, 70%, 50%, 0.15)`);
      reflGradient.addColorStop(1, 'transparent');

      ctx.fillStyle = reflGradient;
      ctx.beginPath();
      ctx.roundRect(x, baseY + 2, barWidth, reflectionHeight, [0, 0, 1, 1]);
      ctx.fill();
    }
  }

  // Update color theme (can match album art colors)
  setColor(hue) {
    this.hue = hue;
  }
}

// Global instance
let visualizer;
