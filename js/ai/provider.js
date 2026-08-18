/**
 * Base class for AI image providers.
 * To add a new provider: extend AIProvider, implement generateHairstyle(),
 * then register it in the factory below.
 */
export class AIProvider {
  /**
   * @param {string} imageBase64  - Raw base64 image data (no data-URI prefix)
   * @param {string} mimeType     - e.g. "image/jpeg"
   * @param {string} styleName    - Human-readable style name, e.g. "Skin Fade"
   * @param {string} styleHint    - Short description of the style
   * @param {string} hairLength   - "short" | "medium" | "long"
   * @returns {Promise<string>}   - data-URI of the generated image
   */
  async generateHairstyle(imageBase64, mimeType, styleName, styleHint, hairLength) {
    throw new Error(`${this.constructor.name} must implement generateHairstyle()`);
  }
}

export async function createProvider(config) {
  const { aiProvider } = config;

  if (aiProvider === 'gemini') {
    const { GeminiProvider } = await import('./gemini.js');
    return new GeminiProvider(config.geminiApiKey);
  }

  throw new Error(`Unknown AI provider: "${aiProvider}". Supported: gemini`);
}
