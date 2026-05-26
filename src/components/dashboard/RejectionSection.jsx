import { useState } from 'react'
import { supabase } from '../../supabase'
import { PLATFORM_CONFIG } from '../../integrations'
import { declineOnPlatform } from '../../integrations'

const REJECTION_REASONS = {
  capacity: { label: 'Exceeds Capacity', color: '#ef4444', icon: '🏨' },
  minimum:  { label: 'Below Minimum',    color: '#f59e0b', icon: '📏' },
  budget:   { label: 'Budget Mismatch',  color: '#f97316', icon: '💰' },
  dates:    { label: 'Dates Blocked',    color: '#8b5cf6', icon: '📅' },
  other:    { label: 'Cannot Accommodate', color: '#64748b', icon: '✗'  }
}

function getRejectionType(reason) {
  if (!reason) return 'other'
  const r = reason.toLowerCase()
  if (r.includes('capacity') || r.includes('rooms') || r.includes('maximum')) return 'capacity'
  if (r.includes('minimum') || r.includes('too small')) return 'minimum'
  if (r.includes('budget') || r.includes('rate') || r.includes('below')) return 'budget'
  if (r.includes('date') || r.includes('blocked') || r.includes('unavailable')) return 'dates'
  return 'other'
}

export default function RejectionSection({ rejectedLeads, onUpdate }) {
  const [expanded, setExpanded] = useState({})
  const [sending, setSending] = useState({})

  async function handleSendDecline(item) {
    setSending(s => ({ ...s, [item.id]: true }))
    try {
      // Mark as declined
      await supabase
        .from('lead_decisions')
        .update({ declined_at: new Date().toISOString() })
        .eq('lead_id', item.id)

      // Log the decline email
      await supabase.from('email_threads').insert({
        lead_id: item.id,
        hotel_id: item.hotel_id,
        direction: 'outbound',
        subject: item.lead_decisions?.rejection_draft_subject,
        body: item.lead_decisions?.rejection_draft_body,
        to_address: item.contact_email
      })

      // Archive the lead
      await supabase
        .from('leads')
        .update({ status: 'archived' })
        .eq('id', item.id)

      // Notify through their platform
      try { await declineOnPlatform(item, item.hotel_id) } catch { /* non-critical */ }

      onUpdate?.()
    } catch (err) {
      console.error('Decline send error:', err)
    }
    setSending(s => ({ ...s, [item.id]: false }))
  }

  async function handleDismiss(item) {
    // Dismiss without sending — mark declined so it never resurfaces, then archive
    await supabase
      .from('lead_decisions')
      .update({ declined_at: new Date().toISOString() })
      .eq('lead_id', item.id)
    await supabase
      .from('leads')
      .update({ status: 'archived' })
      .eq('id', item.id)
    onUpdate?.()
  }

  return (
    <section className="dashboard-section">
      <div className="section-header">
        <div>
          <h2>Auto-Rejected Leads</h2>
          <p className="section-subheader">
            These groups cannot be accommodated based on hotel criteria.
            A decline email has been drafted — review and send.
          </p>
        </div>
        <span className="section-badge section-badge-rejected">{rejectedLeads.length} pending</span>
      </div>

      <div className="rejection-list" id="rejection-list">
        {rejectedLeads.map(lead => {
          const decision = lead.lead_decisions
          const rejType = getRejectionType(decision?.rejection_reason)
          const rejConfig = REJECTION_REASONS[rejType]
          const platform = PLATFORM_CONFIG[lead.source] ?? PLATFORM_CONFIG.email
          const isExpanded = expanded[lead.id]

          return (
            <div key={lead.id} className="rejection-card">
              <div className="rejection-card-header">
                <div className="rejection-reason-badge" style={{ color: rejConfig.color, borderColor: rejConfig.color }}>
                  <span>{rejConfig.icon}</span>
                  <span>{rejConfig.label}</span>
                </div>
                <div
                  className="lead-source-badge"
                  style={{ color: platform.color, background: platform.bg, borderColor: platform.color }}
                >
                  {platform.label}
                </div>
              </div>

              <div className="rejection-contact">
                <div className="rejection-name">{lead.contact_name || 'Unknown Contact'}</div>
                {lead.company && <div className="rejection-company">{lead.company}</div>}
                <div className="rejection-tags">
                  {lead.event_type && <span className="lead-tag">{lead.event_type}</span>}
                  {lead.group_size && <span className="lead-tag">{lead.group_size} rooms</span>}
                  {lead.dates_requested?.check_in && (
                    <span className="lead-tag">{lead.dates_requested.check_in}</span>
                  )}
                  {lead.budget_per_night && (
                    <span className="lead-tag">${lead.budget_per_night}/night</span>
                  )}
                </div>
              </div>

              <div className="rejection-why">
                <span className="reasoning-label">Why rejected</span>
                <p>{decision?.rejection_reason ?? 'Does not meet hotel criteria.'}</p>
              </div>

              {/* Decline email draft */}
              {decision?.rejection_draft_body && (
                <div
                  className="rejection-draft-preview"
                  onClick={() => setExpanded(e => ({ ...e, [lead.id]: !e[lead.id] }))}
                >
                  <div className="rejection-draft-subject">{decision.rejection_draft_subject}</div>
                  <div className={`rejection-draft-body ${isExpanded ? 'expanded' : ''}`}>
                    {decision.rejection_draft_body}
                  </div>
                  <span className="expand-toggle">
                    {isExpanded ? 'Collapse email' : 'Preview decline email'}
                  </span>
                </div>
              )}

              <div className="rejection-actions">
                <button className="btn-ghost" onClick={() => handleDismiss(lead)}>
                  Dismiss
                </button>
                <button
                  className="btn-decline"
                  onClick={() => handleSendDecline(lead)}
                  disabled={sending[lead.id]}
                >
                  {sending[lead.id]
                    ? 'Sending...'
                    : `Send Decline${platform.label !== 'Email' ? ` via ${platform.label}` : ''}`}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
