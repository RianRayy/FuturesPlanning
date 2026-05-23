import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabase'
import { format } from 'date-fns'

const SCORE_CONFIG = {
  hot: { label: 'Hot', className: 'score-hot', emoji: '🔴' },
  warm: { label: 'Warm', className: 'score-warm', emoji: '🟡' },
  cold: { label: 'Cold', className: 'score-cold', emoji: '⚪' }
}

export default function LeadCard({ lead, onUpdate }) {
  const navigate = useNavigate()
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(!!lead.lead_decisions?.sent_at)

  const decision = lead.lead_decisions
  const score = decision?.score ?? 'cold'
  const config = SCORE_CONFIG[score]

  const checkIn = lead.dates_requested?.check_in
  const checkOut = lead.dates_requested?.check_out

  async function handleApproveAndSend() {
    setSending(true)
    try {
      // Mark as approved and sent in the database
      // In production this would trigger the SendGrid send via API
      await supabase
        .from('lead_decisions')
        .update({
          approved_at: new Date().toISOString(),
          sent_at: new Date().toISOString()
        })
        .eq('lead_id', lead.id)

      // Log in email_threads
      await supabase.from('email_threads').insert({
        lead_id: lead.id,
        hotel_id: lead.hotel_id,
        direction: 'outbound',
        subject: decision.draft_subject,
        body: decision.draft_body,
        to_address: lead.contact_email
      })

      setSent(true)
      onUpdate?.()
    } catch (err) {
      console.error('Send error:', err)
    }
    setSending(false)
  }

  return (
    <div className={`lead-card ${config.className} ${sent ? 'lead-card-sent' : ''}`}>
      <div className="lead-card-header">
        <div className="lead-score-badge">
          <span className="score-emoji">{config.emoji}</span>
          <span className="score-label">{config.label}</span>
        </div>
        <div className="lead-source">{lead.source}</div>
      </div>

      <div className="lead-card-body">
        <h3 className="lead-contact">{lead.contact_name || 'Unknown Contact'}</h3>
        {lead.company && <p className="lead-company">{lead.company}</p>}

        <div className="lead-details">
          {lead.event_type && (
            <span className="lead-tag">{lead.event_type}</span>
          )}
          {lead.group_size && (
            <span className="lead-tag">{lead.group_size} rooms</span>
          )}
          {checkIn && (
            <span className="lead-tag">
              {format(new Date(checkIn), 'MMM d')}
              {checkOut ? ` – ${format(new Date(checkOut), 'MMM d, yyyy')}` : ''}
            </span>
          )}
          {lead.budget_per_night && (
            <span className="lead-tag">${lead.budget_per_night}/night</span>
          )}
        </div>

        {/* Agent reasoning — the key insight */}
        {decision?.reasoning && (
          <div className="lead-reasoning">
            <span className="reasoning-label">Agent insight</span>
            <p>{decision.reasoning}</p>
          </div>
        )}
      </div>

      <div className="lead-card-actions">
        {!sent ? (
          <>
            <button
              className="btn-outline"
              onClick={() => navigate(`/leads/${lead.id}`)}
            >
              Review Draft
            </button>
            <button
              className="btn-primary btn-send"
              onClick={handleApproveAndSend}
              disabled={sending || !decision?.draft_body}
            >
              {sending ? 'Sending...' : 'Approve & Send'}
            </button>
          </>
        ) : (
          <div className="sent-badge">
            Email sent ✓
          </div>
        )}
      </div>
    </div>
  )
}
