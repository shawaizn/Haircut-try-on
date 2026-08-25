import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Extract client IP for deduplication
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    'unknown'

  // Check if this IP already used the demo
  const { data: existing } = await supabase
    .from('demo_usage')
    .select('id')
    .eq('ip_address', ip)
    .maybeSingle()

  if (existing) {
    return new Response(JSON.stringify({ error: 'already_used' }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Check demo pool
  const { data: pool } = await supabase
    .from('demo_pool')
    .select('credits_remaining')
    .eq('id', 1)
    .single()

  if (!pool || pool.credits_remaining <= 0) {
    return new Response(JSON.stringify({ error: 'pool_empty' }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const body = await req.json()
  const { imageBase64, style } = body

  if (!imageBase64 || !style) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const prompt = `HAIR EDIT ONLY — do not alter the face, eyes, nose, mouth, jaw, ears, skin tone, beard, eyebrows, expression, pose, clothing or background. Set the top hair length to Grade 3 (10mm clipper). Apply a "${style}" hairstyle. Photorealistic, high quality.`

  const b64 = imageBase64.replace(/^data:image\/\w+;base64,/, '')
  const imageBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  const imageBlob = new Blob([imageBytes], { type: 'image/jpeg' })

  const formData = new FormData()
  formData.append('model', 'gpt-image-2')
  formData.append('prompt', prompt)
  formData.append('image', imageBlob, 'photo.jpg')
  formData.append('n', '1')
  formData.append('size', '1024x1024')
  formData.append('quality', 'medium')

  const openaiRes = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: formData,
  })

  if (!openaiRes.ok) {
    const errData = await openaiRes.json()
    return new Response(JSON.stringify({ error: errData.error?.message || 'Generation failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const result = await openaiRes.json()
  const imageData = result.data?.[0]?.b64_json

  if (!imageData) {
    return new Response(JSON.stringify({ error: 'No image returned' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Deduct from demo pool and record IP usage in parallel
  await Promise.all([
    supabase.from('demo_pool')
      .update({ credits_remaining: pool.credits_remaining - 1 })
      .eq('id', 1),
    supabase.from('demo_usage')
      .insert({ ip_address: ip, used_at: new Date().toISOString() }),
  ])

  return new Response(JSON.stringify({ image: `data:image/png;base64,${imageData}` }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
