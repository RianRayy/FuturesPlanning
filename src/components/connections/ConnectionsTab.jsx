import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { PLATFORMS } from '../../integrations/platforms'

export default function ConnectionsTab({ hotelId, onConnectionChange }) {
  const [connections, setConnections] = useState({})   // { provider: connected_at }
  const [loading, setLoading] = useState(true)
  const [apiKeyForm, setApiKeyForm] = useState(null)   // platform id being configured
  const [apiKeyValues, setApiKeyValues] = useState({})
  const [saving, setSaving] = useState(null)

  useEffect(() => {
    if (hotelId) loadConnections()
  }, [hotelId])

  async function loadConnections() {
    const { data } = await supabase
      .from('crm_connections')
      .select('provider, connected_at, config')
      .eq('hotel_id', hotelId)

    const map = {}
    data?.forEach(c => { map[c.provider] = c })
    setConnections(map)
    setLoading(false)
  }

  async function handleConnect(platform) {
    if (platform.authType === 'oauth') {
      // OAuth flow — open popup window to platform auth URL
      // TODO: replace client_id values with your registered OAuth app IDs
      const params = new URLSearchParams({
        client_id: import.meta.env[`VITE_${platform.id.toUpperCase()}_CLIENT_ID`] ?? 'YOUR_CLIENT_ID',
        redirect_uri: `${window.location.origin}/oauth/callback/${platform.id}`,
        response_type: 'code',
        scope: getScope(platform.id),
        state: hotelId
      })

      const popup = window.open(
        `${platform.authUrl}?${params}`,
        `Connect ${platform.name}`,
        'width=600,height=700,scrollbars=yes'
      )

      // Listen for OAuth callback message from popup
      const handler = async (event) => {
        if (event.data?.type === 'oauth_success' && event.data?.provider === platform.id) {
          window.removeEventListener('message', handler)
          popup?.close()
          await loadConnections()
          onConnectionChange?.()
        }
      }
      window.addEventListener('message', handler)

    } else {
      // API key flow — show inline form
      setApiKeyForm(platform.id)
      setApiKeyValues({})
    }
  }

  async function handleSaveApiKey(platform) {
    setSaving(platform.id)
    try {
      await supabase
        .from('crm_connections')
        .upsert({
          hotel_id: hotelId,
          provider: platform.id,
          config: apiKeyValues,
          connected_at: new Date().toISOString()
        }, { onConflict: 'hotel_id,provider' })

      setApiKeyForm(null)
      await loadConnections()
      onConnectionChange?.()
    } catch (err) {
      console.error('Save connection error:', err)
    }
    setSaving(null)
  }

  async function handleDisconnect(providerId) {
    if (!window.confirm(`Disconnect ${providerId}? Lead ingestion from this platform will stop.`)) return
    await supabase
      .from('crm_connections')
      .delete()
      .eq('hotel_id', hotelId)
      .eq('provider', providerId)
    await loadConnections()
    onConnectionChange?.()
  }

  if (loading) return <div className="connections-loading">Loading connections...</div>

  const embedSnippet = `<iframe src="${window.location.origin}/inquiry/${hotelId}" style="width:100%;max-width:680px;height:780px;border:none;border-radius:12px;" title="Group Inquiry Form"></iframe>`

  return (
    <>
    <div className="connections-grid">
      {PLATFORMS.map(platform => {
        const connected = connections[platform.id]
        const showingForm = apiKeyForm === platform.id

        return (
          <div key={platform.id} className={`connection-card ${connected ? 'connection-card-connected' : ''}`}>
            <div className="connection-card-header">
              <div
                className="connection-logo"
                style={{ background: platform.bg, border: `1px solid ${platform.color}33` }}
                dangerouslySetInnerHTML={{ __html: platform.logo }}
              />
              <div className="connection-info">
                <div className="connection-name">{platform.name}</div>
                <div className="connection-by">{platform.by}</div>
              </div>
              {connected && (
                <div className="connection-status-badge">
                  <span className="connection-dot" />
                  Connected
                </div>
              )}
            </div>

            <p className="connection-description">{platform.description}</p>

            {/* API key inline form */}
            {showingForm && platform.authType === 'apikey' && (
              <div className="connection-apikey-form">
                {platform.fields?.map(field => (
                  <div key={field.key} className="form-group">
                    <label className="form-label">{field.label}</label>
                    {field.type === 'select' ? (
                      <select
                        className="form-input"
                        value={apiKeyValues[field.key] ?? ''}
                        onChange={e => setApiKeyValues(v => ({ ...v, [field.key]: e.target.value }))}
                      >
                        <option value="">Select...</option>
                        {field.options?.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input
                        type={field.type}
                        className="form-input"
                        placeholder={field.label}
                        value={apiKeyValues[field.key] ?? ''}
                        onChange={e => setApiKeyValues(v => ({ ...v, [field.key]: e.target.value }))}
                      />
                    )}
                  </div>
                ))}
                <div className="connection-form-actions">
                  <button className="btn-ghost" onClick={() => setApiKeyForm(null)}>Cancel</button>
                  <button
                    className="btn-primary"
                    onClick={() => handleSaveApiKey(platform)}
                    disabled={saving === platform.id}
                  >
                    {saving === platform.id ? 'Saving...' : 'Save & Connect'}
                  </button>
                </div>
              </div>
            )}

            <div className="connection-actions">
              {connected ? (
                <>
                  <div className="connection-date">
                    Connected {new Date(connected.connected_at).toLocaleDateString()}
                  </div>
                  <button
                    className="btn-disconnect"
                    onClick={() => handleDisconnect(platform.id)}
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <button
                  className="btn-connect"
                  style={{ borderColor: platform.color, color: platform.color }}
                  onClick={() => handleConnect(platform)}
                >
                  Connect {platform.name}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>

    {/* Website inquiry form embed */}
    <div className="embed-section">
      <h3>Your Website Inquiry Form</h3>
      <p className="embed-sub">
        Paste this snippet on your hotel's website. Every inquiry submitted flows straight
        into your dashboard, gets scored by the agent, and has a response drafted automatically.
      </p>
      <div className="embed-code-row">
        <code className="embed-code">{embedSnippet}</code>
        <button
          className="btn-outline btn-sm"
          onClick={() => navigator.clipboard.writeText(embedSnippet)}
        >
          Copy
        </button>
      </div>
      <a
        className="embed-preview-link"
        href={`/inquiry/${hotelId}`}
        target="_blank"
        rel="noreferrer"
      >
        Preview your form →
      </a>
    </div>
    </>
  )
}

function getScope(provider) {
  const scopes = {
    gmail:       'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly',
    outlook:     'Mail.Send Mail.Read offline_access',
    salesforce:  'api refresh_token',
    hubspot:     'crm.objects.deals.read crm.objects.contacts.read',
    cvent:       'event:read rfp:read rfp:write',
    delphi:      'opportunities:read opportunities:write'
  }
  return scopes[provider] ?? 'read'
}
