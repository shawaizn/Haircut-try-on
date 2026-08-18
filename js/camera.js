export class Camera {
  constructor() {
    this.stream = null;
    this.facingMode = 'environment';
  }

  async start(videoEl) {
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: this.facingMode },
        width:  { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });
    videoEl.srcObject = this.stream;
    await videoEl.play();
  }

  flip() {
    this.facingMode = this.facingMode === 'user' ? 'environment' : 'user';
  }

  /**
   * Captures the current video frame.
   * @returns {Promise<{ base64: string, mimeType: string, dataUri: string }>}
   */
  async capture(videoEl) {
    const w = videoEl.videoWidth  || 1280;
    const h = videoEl.videoHeight || 720;

    const canvas = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    if (this.facingMode === 'user') {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(videoEl, 0, 0, w, h);

    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('Canvas capture failed')); return; }
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUri = reader.result;
          const base64  = dataUri.split(',')[1];
          resolve({ base64, mimeType: 'image/jpeg', dataUri });
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      }, 'image/jpeg', 0.92);
    });
  }

  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
  }
}
