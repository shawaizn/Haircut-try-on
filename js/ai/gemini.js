import { AIProvider } from './provider.js';

const MODEL = 'gemini-2.0-flash-preview-image-generation';
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export class GeminiProvider extends AIProvider {
  constructor(apiKey) {
    super();
    this.apiKey = apiKey;
  }

  buildPrompt(styleName, styleHint, hairLength) {
    return (
      `You are a professional photo retoucher working for a barbershop. ` +
      `Edit the person's hair in this portrait photo to show a ${hairLength} "${styleName}" hairstyle ` +
      `(${styleHint}). ` +
      `Rules: ` +
      `(1) Keep the person's face, skin tone, eyes, nose, mouth, ears, facial hair, and expression EXACTLY as they are. ` +
      `(2) Change ONLY the hair — style, length, and shape — to match the requested look. ` +
      `(3) The result must be photorealistic, high-quality, and look like a professional barbershop portrait. ` +
      `(4) Natural lighting consistent with the original photo.`
    );
  }

  async generateHairstyle(imageBase64, mimeType, styleName, styleHint, hairLength) {
    const url = `${BASE_URL}/${MODEL}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const body = {
      contents: [{
        parts: [
          { inlineData: { mimeType, data: imageBase64 } },
          { text: this.buildPrompt(styleName, styleHint, hairLength) }
        ]
      }],
      generationConfig: {
        responseModalities: ['IMAGE']
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    const imagePart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);

    if (!imagePart) {
      const textPart = data.candidates?.[0]?.content?.parts?.find(p => p.text);
      throw new Error(textPart?.text || 'No image returned by Gemini');
    }

    const { mimeType: outMime, data: outData } = imagePart.inlineData;
    return `data:${outMime};base64,${outData}`;
  }
}
