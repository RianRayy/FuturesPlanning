import { useState, useEffect } from 'react'

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1'
const ANON_KEY      = import.meta.env.VITE_SUPABASE_ANON_KEY

const WIN_CONFIG = {
  high:   { label: 'High',   color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  medium: { label: 'Medium', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  low:    { label: 'Low',    color: '#ef4444', bg: 'rgba(239,68,68,0.12)'  }
}

const IMPACT_ICON  = { positive: '↑', negative: '↓', neutral: '→' }
const IMPACT_COLOR = { positive: '#10b981', negative: '#ef4444', neutral: '#7c8db5' }

// Recalculate win probability in real time as the user adjusts the rate
function computeWinProbability(currentRate, suggestion) {
  if (!suggestion || currentRate === null) return null

  const { rate_range, lead_budget, suggested_rate } = suggestion

  // Above planner's stated budget — very hard to win
  if (lead_budget && currentRate > lead_budget) {
    return {
      prob: 'low',
      note: `Rate is above the planner's stated budget of $${lead_budget}/night — very unlikely to win`
    }
  }

  // Significantly above market high — nearly impossible
  if (currentRate > rate_range.high + 20) {
    return {
      prob: 'low',
      note: `$${currentRate - rate_range.high} above the top of market range — consider lowering to stay competitive`
    }
  }

  // Above market high but not extreme — still low
  if (currentRate > rate_range.high) {
    return {
      prob: 'low',
      note: `Slightly above typical market range — competitors may undercut at this price`
    }
  }

  // Between suggested and market high — medium
  if (currentRate > suggested_rate) {
    const over = currentRate - suggested_rate
    return {
      prob: 'medium',
      note: `$${over}/night above suggested — competitive but may lose to a lower bid`
    }
  }

  // At or within $10 of suggested — high
  if (currentRate >= suggested_rate - 10) {
    const headroom = lead_budget ? `$${lead_budget - currentRate}/night below planner budget` : 'well-positioned'
    return {
      prob: 'high',
      note: `Strong position — ${headroom}`
    }
  }

  // Well below suggested — high but flag it
  const under = suggested_rate - currentRate
  return {
    prob: 'high',
    note: `$${under}/night below suggested — excellent win chance, though you may be leaving revenue on the table`
  }
}

export default function BidAdvisorModal({ lead, decision, hotelId, onConfirm, onCancel, sending }) {
  const [loading, setLoading]       = useState(true)
  const [suggestion, setSuggestion] = useState(null)
  const [error, setError]           = useState(null)
  const [rate, setRate]             = useState(null)
  const [notes, setNotes]           = useState('')
  const [showEmail, setShowEmail]   = useState(false)

  useEffect(() => { fetchSuggestion() }, [])

  async function fetchSuggestion() {
    try {
      const res = await fetch(`${FUNCTIONS_URL}/suggest-bid`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
          'apikey': ANON_KEY
        },
        body: JSON.stringify({ hotel_id: hotelId, lead_id: lead.id })
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to get suggestion')
      setSuggestion(data)
      setRate(data.suggested_rate)
    } catch (err) {
      setError(err.message)
      // Fall back to lead's stated budget or 0
      setRate(lead.budget_per_night ?? 0)
    } finally {
      setLoading(false)
    }
  }

  function adjustRate(delta) {
    setRate(r => Math.max(0, Math.round((r + delta) / 5) * 5))
  }

  // Recomputes live as rate changes
  const liveWin = computeWinProbability(rate, suggestion)
  const winCfg  = WIN_CONFIG[liveWin?.prob ?? suggestion?.win_probability ?? 'medium']

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="bid-advisor-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="bid-advisor-header">
          <div>
            <h3>Rate Intelligence</h3>
            <p>{lead.contact_name}{lead.company ? ` · ${lead.company}` : ''} · {lead.group_size} rooms</p>
          </div>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>

        <div className="bid-advisor-body">
          {loading ? (
            <div className="bid-advisor-loading">
              <div className="loading-spinner" style={{ width: 28, height: 28 }} />
              <p>Analyzing market conditions...</p>
            </div>
          ) : (
            <>
              {/* Rate control */}
              <div className="bid-rate-section">
                <div className="bid-rate-label">
                  Your Bid Rate
                  {suggestion && (
                    <span className="bid-rate-suggested-tag">
                      Suggested: ${suggestion.suggested_rate}/night
                    </span>
                  )}
                </div>
                <div className="bid-rate-controls">
                  <button className="bid-rate-btn" onClick={() => adjustRate(-5)}>−$5</button>
                  <div className="bid-rate-display">
                    <span className="bid-rate-dollar">$</span>
                    <input
                      type="number"
                      className="bid-rate-input"
                      value={rate ?? ''}
                      onChange={e => setRate(Number(e.target.value))}
                      min={0}
                    />
                    <span className="bid-rate-unit">/night</span>
                  </div>
                  <button className="bid-rate-btn" onClick={() => adjustRate(5)}>+$5</button>
                </div>

                {suggestion && (
                  <div className="bid-rate-range">
                    <span>Market range for this group: </span>
                    <strong>${suggestion.rate_range.low} – ${suggestion.rate_range.high}/night</strong>
                    {suggestion.lead_budget && (
                      <span className="bid-rate-budget">
                        · Planner budget: ${suggestion.lead_budget}/night
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Win probability — updates live as rate changes */}
              {(liveWin || suggestion) && (
                <div className="bid-win-row" style={{ background: winCfg.bg, borderColor: winCfg.color }}>
                  <div className="bid-win-badge" style={{ color: winCfg.color }}>
                    {winCfg.label} Win Probability
                  </div>
                  <div className="bid-win-note">
                    {liveWin?.note ?? suggestion?.probability_note}
                  </div>
                </div>
              )}

              {/* Reasoning */}
              {suggestion && (
                <div className="bid-reasoning-section">
                  <div className="bid-section-label">Agent Analysis</div>
                  <p className="bid-reasoning">{suggestion.reasoning}</p>
                  {suggestion.market_context && (
                    <p className="bid-market-context">{suggestion.market_context}</p>
                  )}
                </div>
              )}

              {/* Factors */}
              {suggestion?.factors?.length > 0 && (
                <div className="bid-factors">
                  {suggestion.factors.map((f, i) => (
                    <div key={i} className="bid-factor">
                      <span className="bid-factor-icon" style={{ color: IMPACT_COLOR[f.impact] }}>
                        {IMPACT_ICON[f.impact]}
                      </span>
                      <div>
                        <span className="bid-factor-label">{f.label}</span>
                        <span className="bid-factor-note">{f.note}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {error && !suggestion && (
                <div className="bid-error">⚠ Could not fetch rate suggestion — enter your rate manually above.</div>
              )}

              {/* Adjustable notes */}
              <div className="bid-notes-section">
                <div className="bid-section-label">Notes to Planner <span className="bid-optional">(optional)</span></div>
                <textarea
                  className="bid-notes-input"
                  placeholder="Any additional terms, inclusions, or availability notes for the planner..."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                />
              </div>

              {/* Email preview toggle */}
              <button
                className="bid-email-toggle"
                onClick={() => setShowEmail(v => !v)}
              >
                {showEmail ? '▲ Hide email draft' : '▼ Preview email draft'}
              </button>

              {showEmail && (
                <div className="bid-email-preview">
                  <div className="bid-email-field">
                    <span className="send-confirm-label">To</span>
                    <span className="send-confirm-value">{lead.contact_email || '—'}</span>
                  </div>
                  <div className="bid-email-field">
                    <span className="send-confirm-label">Subject</span>
                    <span className="send-confirm-value">{decision?.draft_subject}</span>
                  </div>
                  <div className="bid-email-body">{decision?.draft_body}</div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Actions */}
        <div className="bid-advisor-actions">
          <button className="btn-ghost" onClick={onCancel} disabled={sending}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={() => onConfirm({ bidRate: rate, bidNotes: notes })}
            disabled={loading || sending || rate === null}
          >
            {sending ? 'Submitting...' : `Submit Bid at $${rate}/night & Send Email`}
          </button>
        </div>
      </div>
    </div>
  )
}
