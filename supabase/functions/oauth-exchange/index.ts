import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Token exchange endpoints per provider
const TOKEN_URLS: Record<string, string> = {
  gmail:       'https://oauth2.googleapis.com/token',
  outlook:     'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  salesforce:  'https://login.salesforce.com/services/oauth2/token',
  hubspot:     'https://api.hubapi.com/oauth/v1/token',
  cvent:       'https://api-platform.cvent.com/oauth2/token',
  delphi:      'https://api.delphicrm.com/oauth2/token',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { provider, code, hotelId } = await req.json()

    if (!provider || !code || !hotelId) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const tokenUrl = TOKEN_URLS[provider]
    if (!tokenUrl) {
      return new Response(JSON.stringify({ error: `Unknown provider: ${provider}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Retrieve secrets from environment
    const clientId     = Deno.env.get(`${provider.toUpperCase()}_CLIENT_ID`) ?? ''
    const clientSecret = Deno.env.get(`${provider.toUpperCase()}_CLIENT_SECRET`) ?? ''
    const redirectUri  = `${Deno.env.get('APP_URL')}/oauth/callback/${provider}`

    // Exchange authorization code for access token
    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
      })
    })

    if (!tokenRes.ok) {
      const errText = await tokenRes.text()
      console.error(`Token exchange failed for ${provider}:`, errText)
      return new Response(JSON.stringify({ error: `Token exchange failed: ${errText}` }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const tokens = await tokenRes.json()

    // Save connection to crm_connections using service role key (bypasses RLS)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    await supabase
      .from('crm_connections')
      .upsert({
        hotel_id:     hotelId,
        provider,
        config: {
          access_token:  tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_in:    tokens.expires_in,
          token_type:    tokens.token_type,
          scope:         tokens.scope,
        },
        connected_at: new Date().toISOString(),
      }, { onConflict: 'hotel_id,provider' })

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('oauth-exchange error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
