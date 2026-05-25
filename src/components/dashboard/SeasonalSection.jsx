import { useState } from 'react'
import { supabase } from '../../supabase'

const SCORE_CONFIG = {
  high:   { emoji: '🔥', label: 'High Potential', color: '#ef4444' },
  medium: { emoji: '⭐', label: 'Good Potential', color: '#f59e0b' },
  low:    { emoji: '📋', label: 'Worth a Try',   color: '#64748b' }
}

const OUTCOME_LABELS = {
  booked:               { label: 'Previously Booked', color: '#22c55e' },
  lost_to_competitor:   { label: 'Chose Competitor',  color: '#f59e0b' },
  no_response:          { label: 'No Response',        color: '#64748b' },
  declined_by_hotel:    { label: 'Declined Last Year', color: '#94a3b8' },
  pending:              { label: 'Past Inquiry',        color: '#4f7ef8' }
}

export default function SeasonalSection({ outreachList, scoreFilter, onClearFilter, onUpdate }) {
  const [expanded, setExpanded] = useState({})
  const [sending, setSending] = useState({})

  async function handleApprove(item) {
    setSending(s => ({ ...s, [item.id]: true }))
    try {
      await supabase
        .from('seasonal_outreach')
        .update({ status: 'approved', sent_at: new Date().toISOString() })
        .eq('id', item.id)

      // Log in email_threads
      await supabase.from('email_threads').insert({
        lead_id: item.lead_id,
        hotel_id: item.hotel_id,
        direction: 'outbound',
        subject: item.draft_subject,
        body: item.draft_body
      })

      onUpdate?.()
    } catch (err) {
      console.error(err)
    }
    setSending(s => ({ ...s, [item.id]: false }))
  }

  async function handleDismiss(item) {
    await supabase
      .from('seasonal_outreach')
      .update({ status: 'dismissed' })
      .eq('id', item.id)
    onUpdate?.()
  }

  // Sort: high first, then by score descending; apply filter if set
  const sorted = [...outreachList]
    .filter(item => !scoreFilter || item.score_label === scoreFilter)
    .sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 }
      return order[a.score_label] - order[b.score_label] || b.potential_score - a.potential_score
    })

  return (
    <section className="dashboard-section">
      <div className="section-header">
        <h2>
          {scoreFilter === 'high' ? '🔥 Hot Seasonal Recruits' :
           scoreFilter === 'medium' ? '⭐ Warm Recruits' :
           'Recruit for This Season'}
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {scoreFilter && (
            <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={onClearFilter}>
              Show all
            </button>
          )}
          <span className="section-badge section-badge-seasonal">
            {sorted.length} opportunities
          </span>
        </div>
      </div>
      <p className="seasonal-subtitle">
        These groups inquired or booked around this time last year.
        The agent has scored each one and drafted personalized outreach.
      </p>

      <div className="seasonal-list">
        {sorted.map(item => {
          const config = SCORE_CONFIG[item.score_label] ?? SCORE_CONFIG.medium
          const outcomeConfig = OUTCOME_LABELS[item.leads?.outcome ?? 'pending']
          const isExpanded = expanded[item.id]

          return (
            <div key={item.id} className={`seasonal-card seasonal-${item.score_label}`}>
              <div className="seasonal-card-header">
                <div className="seasonal-score">
                  <span className="seasonal-emoji">{config.emoji}</span>
                  <div>
                    <div className="seasonal-score-label" style={{ color: config.color }}>
                      {config.label}
                    </div>
                    <div className="seasonal-score-num">
                      {Math.round(item.potential_score * 100)}% repeat potential
                    </div>
                  </div>
                </div>
                {outcomeConfig && (
                  <span
                    className="seasonal-outcome-badge"
                    style={{ color: outcomeConfig.color, borderColor: outcomeConfig.color }}
                  >
                    {outcomeConfig.label}
                  </span>
                )}
              </div>

              <div className="seasonal-contact">
                <div className="seasonal-name">{item.leads?.contact_name ?? 'Unknown Contact'}</div>
                {item.leads?.company && (
                  <div className="seasonal-company">{item.leads.company}</div>
                )}
                <div className="seasonal-tags">
                  {item.leads?.event_type && (
                    <span className="lead-tag">{item.leads.event_type}</span>
                  )}
                  {item.leads?.group_size && (
                    <span className="lead-tag">{item.leads.group_size} rooms</span>
                  )}
                  {item.leads?.budget_per_night && (
                    <span className="lead-tag">${item.leads.budget_per_night}/night</span>
                  )}
                </div>
              </div>

              {/* Why the agent picked this one */}
              <div className="seasonal-reasoning">
                <span className="reasoning-label">Why reach out</span>
                <p>{item.reasoning}</p>
              </div>

              {/* Score signals breakdown */}
              {item.repeat_signals?.length > 0 && (
                <div className="seasonal-signals">
                  {item.repeat_signals.map((signal, i) => (
                    <div key={i} className={`signal-pill signal-${signal.impact}`}>
                      {signal.factor}: {signal.value}
                    </div>
                  ))}
                </div>
              )}

              {/* Email draft preview */}
              <div
                className="seasonal-draft-preview"
                onClick={() => setExpanded(e => ({ ...e, [item.id]: !e[item.id] }))}
              >
                <div className="seasonal-draft-subject">{item.draft_subject}</div>
                <div className={`seasonal-draft-body ${isExpanded ? 'expanded' : ''}`}>
                  {item.draft_body}
                </div>
                <span className="expand-toggle">
                  {isExpanded ? 'Collapse email' : 'Preview full email'}
                </span>
              </div>

              <div className="seasonal-actions">
                <button className="btn-ghost" onClick={() => handleDismiss(item)}>
                  Dismiss
                </button>
                <button
                  className="btn-primary btn-send"
                  onClick={() => handleApprove(item)}
                  disabled={sending[item.id]}
                >
                  {sending[item.id] ? 'Sending...' : 'Approve & Send'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
