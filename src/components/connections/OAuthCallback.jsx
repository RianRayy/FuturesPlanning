import { useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../../supabase'

/**
 * Handles OAuth redirects from external platforms.
 * This page runs inside a popup window opened by ConnectionsTab.
 * On success it saves the connection to crm_connections, then
 * postMessages the opener and closes itself.
 */
export default function OAuthCallback() {
  const { provider } = useParams()
  const [searchParams] = useSearchParams()

  useEffect(() => {
    handleCallback()
  }, [])

  async function handleCallback() {
    const code  = searchParams.get('code')
    const state = searchParams.get('state')   // hotelId passed as state
    const error = searchParams.get('error')

    if (error || !code) {
      // Close popup — user denied or something went wrong
      window.opener?.postMessage({ type: 'oauth_error', provider, error }, window.location.origin)
      window.close()
      return
    }

    try {
      // Exchange code for tokens via a Supabase Edge Function
      // (keeps client_secret server-side)
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/oauth-exchange`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
          },
          body: JSON.stringify({ provider, code, hotelId: state })
        }
      )

      if (!res.ok) throw new Error(await res.text())

      // Notify opener and close
      window.opener?.postMessage({ type: 'oauth_success', provider }, window.location.origin)
    } catch (err) {
      console.error('OAuth callback error:', err)
      window.opener?.postMessage({ type: 'oauth_error', provider, error: err.message }, window.location.origin)
    }

    window.close()
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100vh',
      background: '#0f1117', color: '#e8eaf0',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: '50%',
        border: '3px solid #2d3149', borderTopColor: '#4f7ef8',
        animation: 'spin 0.8s linear infinite', marginBottom: 16
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <p style={{ color: '#7c8db5', fontSize: 14 }}>Connecting your account…</p>
    </div>
  )
}
