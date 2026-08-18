import { createProvider } from './ai/provider.js';
import { Camera } from './camera.js';

const LS_KEY_API = 'razor_gemini_key';

class App {
  constructor() {
    this.config   = null;
    this.provider = null;
    this.camera   = new Camera();
    this.root     = document.getElementById('app');

    this.state = {
      screen:         'boot',
      hairLength:     null,
      selectedStyles: [],
      photo:          null,   // { base64, mimeType, dataUri }
      results:        [],     // [{ style, dataUri }]
      generating:     { current: 0, total: 0 },
      fullscreenIdx:  0,
      error:          null
    };
  }

  // ─── boot ──────────────────────────────────────────────────────────────────

  async init() {
    try {
      const resp = await fetch('./config.json');
      if (!resp.ok) throw new Error(`config.json: HTTP ${resp.status}`);
      this.config = await resp.json();

      // API key: config.json → localStorage
      if (!this.config.geminiApiKey) {
        this.config.geminiApiKey = localStorage.getItem(LS_KEY_API) || '';
      }

      if (!this.config.geminiApiKey) {
        this.go('setup');
        return;
      }

      this.provider = await createProvider(this.config);
      this.go('welcome');
    } catch (err) {
      this.go('fatal', { error: err.message });
    }
  }

  // ─── state machine ─────────────────────────────────────────────────────────

  go(screen, extra = {}) {
    Object.assign(this.state, { screen }, extra);
    this.render();
  }

  reset() {
    this.camera.stop();
    this.state.hairLength     = null;
    this.state.selectedStyles = [];
    this.state.photo          = null;
    this.state.results        = [];
    this.go('welcome');
  }

  // ─── render dispatcher ─────────────────────────────────────────────────────

  render() {
    const { screen } = this.state;
    const screens = {
      boot:         () => this.renderBoot(),
      setup:        () => this.renderSetup(),
      fatal:        () => this.renderFatal(),
      welcome:      () => this.renderWelcome(),
      'hair-length':() => this.renderHairLength(),
      'style-select':() => this.renderStyleSelect(),
      camera:       () => this.renderCamera(),
      generating:   () => this.renderGenerating(),
      results:      () => this.renderResults(),
      fullscreen:   () => this.renderFullscreen()
    };
    (screens[screen] || (() => { this.root.innerHTML = `<p>Unknown screen: ${screen}</p>`; }))();
  }

  // ─── screens ───────────────────────────────────────────────────────────────

  renderBoot() {
    this.root.innerHTML = `
      <div class="screen center">
        <div class="spinner"></div>
      </div>`;
  }

  renderFatal() {
    this.root.innerHTML = `
      <div class="screen center pad">
        <p class="icon-lg">⚠️</p>
        <h2>Setup error</h2>
        <p class="dim">${this.esc(this.state.error)}</p>
        <p class="dim small">Check <code>config.json</code> and reload.</p>
      </div>`;
  }

  renderSetup() {
    this.root.innerHTML = `
      <div class="screen center pad">
        <p class="icon-lg">💈</p>
        <h1 class="shop-name">${this.esc(this.config?.shopName ?? 'The Razor')}</h1>
        <p class="dim" style="max-width:380px;text-align:center;margin-bottom:32px">
          Enter your Google Gemini API key to enable AI hairstyle previews.
        </p>
        <input id="key-input" class="key-input" type="password"
               placeholder="AIza…"
               value="${this.esc(localStorage.getItem(LS_KEY_API) ?? '')}" />
        <button class="btn btn-primary" id="save-key">Save &amp; Continue</button>
        <p class="dim small" style="margin-top:16px">
          Get a free key at
          <span class="accent">aistudio.google.com</span>
        </p>
      </div>`;

    document.getElementById('save-key').addEventListener('click', async () => {
      const key = document.getElementById('key-input').value.trim();
      if (!key) return this.shake(document.getElementById('key-input'));
      localStorage.setItem(LS_KEY_API, key);
      this.config.geminiApiKey = key;
      try {
        this.provider = await createProvider(this.config);
        this.go('welcome');
      } catch (err) {
        this.go('fatal', { error: err.message });
      }
    });
  }

  renderWelcome() {
    this.root.innerHTML = `
      <div class="screen welcome-screen">
        <div class="welcome-body">
          <div class="barber-pole">
            <div class="pole-stripe"></div>
            <div class="pole-stripe"></div>
            <div class="pole-stripe"></div>
          </div>
          <h1 class="shop-name">${this.esc(this.config.shopName)}</h1>
          <p class="welcome-sub">AI Hairstyle Preview</p>
          <button class="btn btn-primary btn-xl" id="start-btn">Start Preview</button>
        </div>
        <p class="version-note dim">Tap to explore your next look</p>
      </div>`;

    document.getElementById('start-btn').addEventListener('click', () => this.go('hair-length'));
  }

  renderHairLength() {
    const lengths = this.config.hairLengths;
    const cards = lengths.map(l => `
      <button class="length-card" data-id="${l.id}">
        <span class="length-name">${this.esc(l.name)}</span>
        <span class="length-desc dim">${this.esc(l.description)}</span>
      </button>`).join('');

    this.root.innerHTML = `
      <div class="screen">
        <header class="top-bar">
          <span class="step-label">Step 1 of 3</span>
          <h2 class="step-title">How long is your hair?</h2>
        </header>
        <div class="length-grid">${cards}</div>
        ${this.renderFooter()}
      </div>`;

    this.root.querySelectorAll('.length-card').forEach(card => {
      card.addEventListener('click', () => {
        this.state.hairLength = card.dataset.id;
        this.go('style-select');
      });
    });
    this.wireFooter();
  }

  renderStyleSelect() {
    const { selectedStyles, hairLength } = this.state;
    const max = this.config.maxStyles;

    const cards = this.config.styles.map(s => {
      const sel = selectedStyles.includes(s.id);
      return `
        <button class="style-card ${sel ? 'selected' : ''}" data-id="${s.id}">
          ${sel ? `<span class="check-badge">✓</span>` : ''}
          <span class="style-name">${this.esc(s.name)}</span>
        </button>`;
    }).join('');

    const count = selectedStyles.length;
    const canGenerate = count >= 1;

    this.root.innerHTML = `
      <div class="screen">
        <header class="top-bar">
          <span class="step-label">Step 2 of 3 &nbsp;·&nbsp; ${this.esc(hairLength)} hair</span>
          <h2 class="step-title">Choose up to ${max} styles</h2>
          <p class="step-sub dim">${count} of ${max} selected</p>
        </header>
        <div class="style-grid">${cards}</div>
        <div class="footer-bar">
          <button class="btn btn-outline" id="back-btn">← Back</button>
          <button class="btn btn-primary ${canGenerate ? '' : 'disabled'}" id="next-btn">
            Take Photo →
          </button>
        </div>
      </div>`;

    this.root.querySelectorAll('.style-card').forEach(card => {
      card.addEventListener('click', () => {
        const id  = card.dataset.id;
        const idx = this.state.selectedStyles.indexOf(id);
        if (idx >= 0) {
          this.state.selectedStyles.splice(idx, 1);
        } else {
          if (this.state.selectedStyles.length >= max) return this.shake(card);
          this.state.selectedStyles.push(id);
        }
        this.renderStyleSelect();
      });
    });

    document.getElementById('back-btn').addEventListener('click', () => this.go('hair-length'));
    document.getElementById('next-btn').addEventListener('click', () => {
      if (!canGenerate) return;
      this.go('camera');
    });
  }

  renderCamera() {
    this.root.innerHTML = `
      <div class="screen camera-screen">
        <video id="viewfinder" autoplay playsinline muted></video>
        <div class="camera-overlay">
          <div class="camera-guide-ring"></div>
        </div>
        <div class="camera-bar">
          <button class="btn btn-icon" id="flip-btn" title="Flip camera">⟳</button>
          <button class="shutter-btn" id="capture-btn">
            <span class="shutter-inner"></span>
          </button>
          <button class="btn btn-icon" id="back-btn" title="Back">✕</button>
        </div>
        <p class="camera-hint dim">Centre your face in the frame</p>
      </div>`;

    const video = document.getElementById('viewfinder');

    this.camera.start(video).catch(err => {
      this.go('fatal', { error: `Camera access denied: ${err.message}` });
    });

    document.getElementById('flip-btn').addEventListener('click', () => {
      this.camera.flip();
      this.camera.start(video).catch(() => {});
    });

    document.getElementById('back-btn').addEventListener('click', () => {
      this.camera.stop();
      this.go('style-select');
    });

    document.getElementById('capture-btn').addEventListener('click', async () => {
      try {
        const photo = await this.camera.capture(video);
        this.camera.stop();
        this.state.photo = photo;
        await this.runGeneration();
      } catch (err) {
        this.go('fatal', { error: err.message });
      }
    });
  }

  renderGenerating() {
    const { current, total } = this.state.generating;
    const pct = total ? Math.round((current / total) * 100) : 0;
    const styles = this.state.selectedStyles
      .map(id => this.config.styles.find(s => s.id === id)?.name ?? id);

    this.root.innerHTML = `
      <div class="screen center">
        <div class="gen-ring">
          <svg viewBox="0 0 120 120">
            <circle class="ring-bg" cx="60" cy="60" r="52"/>
            <circle class="ring-fg" cx="60" cy="60" r="52"
              stroke-dasharray="${2 * Math.PI * 52}"
              stroke-dashoffset="${2 * Math.PI * 52 * (1 - pct / 100)}"/>
          </svg>
          <span class="ring-pct">${pct}%</span>
        </div>
        <h2 style="margin-top:32px">Generating your looks…</h2>
        <p class="dim" style="font-size:18px;margin-top:8px">
          ${current < total ? `Creating: <strong>${this.esc(styles[current] ?? '')}</strong>` : 'Almost done…'}
        </p>
        <div class="style-chips">
          ${styles.map((n, i) => `
            <span class="chip ${i < current ? 'chip-done' : i === current ? 'chip-active' : ''}">
              ${i < current ? '✓ ' : ''}${this.esc(n)}
            </span>`).join('')}
        </div>
      </div>`;
  }

  renderResults() {
    const { results, photo } = this.state;

    const cards = results.map((r, i) => `
      <button class="result-card" data-idx="${i}">
        <img src="${r.dataUri}" alt="${this.esc(r.style.name)}" loading="lazy" />
        <div class="result-label">${this.esc(r.style.name)}</div>
      </button>`).join('');

    this.root.innerHTML = `
      <div class="screen">
        <header class="top-bar">
          <h2 class="step-title">Your Looks</h2>
          <p class="step-sub dim">Tap a style to see it full-screen</p>
        </header>
        <div class="results-grid">
          <button class="result-card original" data-idx="-1">
            <img src="${photo.dataUri}" alt="Original" />
            <div class="result-label dim">Original</div>
          </button>
          ${cards}
        </div>
        <div class="footer-bar">
          <button class="btn btn-primary btn-wide" id="restart-btn">Start Again</button>
        </div>
      </div>`;

    this.root.querySelectorAll('.result-card').forEach(card => {
      card.addEventListener('click', () => {
        const idx = parseInt(card.dataset.idx, 10);
        this.go('fullscreen', { fullscreenIdx: idx });
      });
    });

    document.getElementById('restart-btn').addEventListener('click', () => this.reset());
  }

  renderFullscreen() {
    const { fullscreenIdx, results, photo } = this.state;
    const isOriginal = fullscreenIdx === -1;
    const src   = isOriginal ? photo.dataUri : results[fullscreenIdx].dataUri;
    const label = isOriginal ? 'Original' : results[fullscreenIdx].style.name;

    this.root.innerHTML = `
      <div class="screen fullscreen-screen">
        <img class="fullscreen-img" src="${src}" alt="${this.esc(label)}" />
        <div class="fullscreen-bar">
          <span class="fullscreen-label">${this.esc(label)}</span>
          <button class="btn btn-outline" id="close-btn">← Back</button>
        </div>
        <div class="fullscreen-nav">
          ${fullscreenIdx > -1 ? `<button class="nav-arrow" id="prev-btn">‹</button>` : '<span></span>'}
          ${fullscreenIdx < results.length - 1 ? `<button class="nav-arrow" id="next-btn">›</button>` : '<span></span>'}
        </div>
      </div>`;

    document.getElementById('close-btn').addEventListener('click', () => this.go('results'));
    document.getElementById('prev-btn')?.addEventListener('click', () => {
      this.go('fullscreen', { fullscreenIdx: fullscreenIdx - 1 });
    });
    document.getElementById('next-btn')?.addEventListener('click', () => {
      this.go('fullscreen', { fullscreenIdx: fullscreenIdx + 1 });
    });
  }

  // ─── generation flow ───────────────────────────────────────────────────────

  async runGeneration() {
    const { photo, selectedStyles, hairLength } = this.state;
    const styleObjs = selectedStyles.map(id => this.config.styles.find(s => s.id === id)).filter(Boolean);
    const total = styleObjs.length;

    this.state.results    = [];
    this.state.generating = { current: 0, total };
    this.go('generating');

    for (let i = 0; i < styleObjs.length; i++) {
      const style = styleObjs[i];
      this.state.generating = { current: i, total };
      this.renderGenerating();

      try {
        const dataUri = await this.provider.generateHairstyle(
          photo.base64,
          photo.mimeType,
          style.name,
          style.hint || style.name,
          hairLength
        );
        this.state.results.push({ style, dataUri });
      } catch (err) {
        this.state.results.push({
          style,
          dataUri: this.errorPlaceholder(style.name, err.message)
        });
      }
    }

    this.state.generating = { current: total, total };
    this.renderGenerating();
    await this.pause(400);
    this.go('results');
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  renderFooter() {
    return `<div class="footer-bar"><button class="btn btn-outline" id="restart-btn">Start Again</button></div>`;
  }

  wireFooter() {
    document.getElementById('restart-btn')?.addEventListener('click', () => this.reset());
  }

  shake(el) {
    el.classList.add('shake');
    el.addEventListener('animationend', () => el.classList.remove('shake'), { once: true });
  }

  esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  pause(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  errorPlaceholder(name, message) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
      <rect width="400" height="400" fill="#1e1e1e"/>
      <text x="200" y="180" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#c9a227">${name}</text>
      <text x="200" y="220" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#888">Generation failed</text>
      <text x="200" y="250" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#555" width="360">${message.slice(0, 60)}</text>
    </svg>`;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }
}

const app = new App();
app.init();
