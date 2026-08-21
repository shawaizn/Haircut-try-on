require('dotenv').config();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const express  = require('express');
const multer   = require('multer');
const fetch    = require('node-fetch');
const FormData = require('form-data');
const path     = require('path');

const app    = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 },
  fileFilter: function(req, file, cb) {
    cb(null, file.mimetype.startsWith('image/'));
  }
});

const PORT = process.env.PORT || 3000;

const LENGTHS = {
  g1:     { label: 'Grade 1', mm: '3mm'  },
  g2:     { label: 'Grade 2', mm: '6mm'  },
  g3:     { label: 'Grade 3', mm: '10mm' },
  g4:     { label: 'Grade 4', mm: '13mm' },
  g5:     { label: 'Grade 5', mm: '16mm' },
  g6:     { label: 'Grade 6', mm: '19mm' },
  g7:     { label: 'Grade 7', mm: '22mm' },
  g8:     { label: 'Grade 8', mm: '25mm' },
  medium: { label: 'Medium',  scissors: true },
  long:   { label: 'Long',    scissors: true },
  keep:   { label: 'Keep Top' },
};

function buildTopDesc(lengthId) {
  if (lengthId === 'keep') {
    return 'Keep the hair on top EXACTLY as it is — same length, volume and texture. Only change the sides and back.';
  }
  const l = LENGTHS[lengthId];
  if (!l) return '';
  if (l.scissors) {
    return `Set the top hair to a ${l.label.toLowerCase()} scissors length.`;
  }
  return `Set the top hair length to ${l.label} (${l.mm} clipper).`;
}

app.use(express.static(path.join(__dirname)));

app.post('/api/generate', upload.single('image'), async (req, res) => {
  try {
    const apiKey = OPENAI_API_KEY;
    if (!apiKey || apiKey === 'sk-...') {
      return res.status(500).json({ error: 'OpenAI API key not set in server.js.' });
    }

    const { length, style } = req.body;
    const imageBuffer = req.file && req.file.buffer;

    if (!imageBuffer) return res.status(400).json({ error: 'No photo received.' });
    if (!length || !LENGTHS[length]) return res.status(400).json({ error: 'Invalid length.' });
    if (!style || typeof style !== 'string') return res.status(400).json({ error: 'Invalid style.' });

    const topDesc = buildTopDesc(length);
    const styleName = style.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const prompt =
      'HAIR EDIT ONLY — do not alter the face, eyes, nose, mouth, jaw, ears, skin tone, ' +
      'beard, eyebrows, expression, pose, clothing or background. ' +
      topDesc + ' ' +
      `Apply a "${styleName}" hairstyle. Photorealistic, high quality.`;

    const fd = new FormData();
    fd.append('model',   'gpt-image-2');
    fd.append('prompt',  prompt);
    fd.append('image',   imageBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });
    fd.append('n',       '1');
    fd.append('size',    '1024x1024');
    fd.append('quality', 'medium');

    const oaRes = await fetch('https://api.openai.com/v1/images/edits', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, ...fd.getHeaders() },
      body:    fd
    });

    const data = await oaRes.json();

    if (data.error) {
      return res.status(400).json({ error: data.error.message });
    }

    const b64 = data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) {
      return res.status(500).json({ error: 'No image returned from OpenAI.' });
    }

    res.json({ image: b64 });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

app.listen(PORT, () => {
  console.log(`Razor's Edge running → http://localhost:${PORT}`);
});
