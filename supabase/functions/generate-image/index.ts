import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const APP_URL = Deno.env.get('APP_URL')!
const FROM_EMAIL = Deno.env.get('FROM_EMAIL')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GRADE_MM: Record<string, string> = {
  '1': '3mm', '2': '6mm', '3': '10mm', '4': '13mm',
  '5': '16mm', '6': '19mm', '7': '22mm', '8': '25mm',
}

function buildPrompt(length: string, style: string): string {
  let lengthDesc: string
  if (length === 'keep_top') {
    lengthDesc = 'Keep the hair on top EXACTLY as it is — same length, volume and texture. Only change the sides and back.'
  } else if (length.startsWith('grade_')) {
    const n = length.replace('grade_', '')
    lengthDesc = `Set the top hair length to Grade ${n} (${GRADE_MM[n] || '10mm'} clipper).`
  } else if (length === 'medium_scissors') {
    lengthDesc = 'Set the top hair to a medium scissors length.'
  } else if (length === 'long_scissors') {
    lengthDesc = 'Set the top hair to a long scissors length.'
  } else {
    lengthDesc = 'Set the top hair to a medium length.'
  }
  return `HAIR EDIT ONLY — do not alter the face, eyes, nose, mouth, jaw, ears, skin tone, beard, eyebrows, expression, pose, clothing or background. ${lengthDesc} Apply a "${style}" hairstyle. Photorealistic, high quality.`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const jwt = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data: barber } = await supabase
    .from('barbers')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!barber) {
    return new Response(JSON.stringify({ error: 'Account not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (barber.account_status !== 'active') {
    return new Response(JSON.stringify({ error: 'Account inactive' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (barber.credits_remaining <= 0) {
    return new Response(JSON.stringify({ error: 'no_credits' }), {
      status: 402,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const body = await req.json()
  const { imageBase64, length, style } = body

  if (!imageBase64 || !length || !style) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Decode base64 image
  const b64 = imageBase64.replace(/^data:image\/\w+;base64,/, '')
  const imageBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  const imageBlob = new Blob([imageBytes], { type: 'image/jpeg' })

  const formData = new FormData()
  formData.append('model', 'gpt-image-2')
  formData.append('prompt', buildPrompt(length, style))
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

  // Deduct credit server-side
  const newCredits = barber.credits_remaining - 1
  await supabase.from('barbers')
    .update({ credits_remaining: newCredits })
    .eq('id', user.id)

  // Low credit warning — once per billing cycle
  if (newCredits <= 20 && !barber.low_credit_warning_sent) {
    await supabase.from('barbers')
      .update({ low_credit_warning_sent: true })
      .eq('id', user.id)

    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: barber.email,
        subject: "You're running low on credits",
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#333">
            <h2>You're running low on credits.</h2>
            <p>You have <strong>${newCredits} credits</strong> remaining this month.</p>
            <p>Each customer try-on uses one credit. To avoid interruption upgrade your plan now — it takes one click.</p>
            <p><a href="${APP_URL}/dashboard.html" style="background:#C9A84C;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block">Upgrade now</a></p>
            <p style="color:#888">Made by Energise AI</p>
          </div>
        `,
      }),
    }).catch(console.error)
  }

  return new Response(JSON.stringify({ image: `data:image/png;base64,${imageData}` }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
