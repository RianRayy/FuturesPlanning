import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabase'
import { format } from 'date-fns'
import { PLATFORM_CONFIG } from '../../integrations'

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1'
const ANON_KEY      = import.meta.env.VITE_SUPABASE_ANON_KEY

const SCORE_CONFIG = {
  hot: { label: 'Hot', className: 'score-hot', emoji: '🔴' },
  warm: { label: 'Warm', className: 'score-warm', emoji: '🟡' },
  cold: { label: 'Cold', className: 'score-cold', emoji: '⚪' }
}

export default function LeadCard({ lead, hotelId, onUpdate, onDecline }) {
  const navigate = useNavigate()
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(!!lead.lead_decisions?.sent_at)
  const [declining, setDeclining] = useState(false)
  const [declined, setDeclined] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [sendError, setSendError] = useState(null)

  const decision = lead.lead_decisions
  const score = decision?.score ?? 'cold'
  const config = SCORE_CONFIG[score]
  const platform = PLATFORM_CONFIG[lead.source] ?? PLATFORM_CONFIG.email
  const hasValidEmail = lead.contact_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.contact_email)

  const checkIn = lead.dates_requested?.check_in
  const checkOut = lead.dates_requested?.check_out

  async function handleDecline() {
    if (!window.confirm(`Decline ${lead.contact_name}'s inquiry? A decline email will be sent automatically.`)) return
    setDeclining(true)
    try {
      await onDecline(lead, hotelId)
      setDeclined(true)
      onUpdate?.()
    } catch (err) {
      console.error('Decline error:', err)
    }
    setDeclining(false)
  }

  async function handleConfirmSend() {
    setShowConfirmModal(false)
    setSending(true)
    setSendError(null)
    try {
      const res = await fetch(`${FUNCTIONS_URL}/gmail-send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
          'apikey': ANON_KEY
        },
        body: JSON.stringify({
          lead_id: lead.id,
          hotel_id: hotelId,
          to: lead.contact_email,
          subject: decision.draft_subject,
          body: decision.draft_body
        })
      })

      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Send failed')

      setSent(true)
      onUpdate?.()
    } catch (err) {
      console.error('Send error:', err)
      setSendError(err.message)
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
        <div
          className="lead-source-badge"
          style={{ color: platform.color, background: platform.bg, borderColor: platform.color }}
        >
          {platform.label}
        </div>
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
        {declined ? (
          <div className="declined-badge">Declined ✓</div>
        ) : !sent ? (
          <>
            <button
              className="btn-decline-sm"
              onClick={handleDecline}
              disabled={declining}
              title="Decline this inquiry"
            >
              {declining ? '...' : 'Decline'}
            </button>
            <button
              className="btn-outline"
              onClick={() => navigate(`/leads/${lead.id}`)}
            >
              Review Draft
            </button>
            <button
              className="btn-primary btn-send"
              onClick={() => { setSendError(null); setShowConfirmModal(true) }}
              disabled={sending || !decision?.draft_body || !hasValidEmail}
              title={!hasValidEmail ? 'No valid email address for this contact' : undefined}
            >
              {sending ? 'Sending...' : 'Approve & Send'}
            </button>
          </>
        ) : (
          <div className="sent-badge">Email sent ✓</div>
        )}
      </div>

      {sendError && (
        <div className="send-error-banner">
          ⚠ {sendError}
        </div>
      )}

      {/* Send confirmation modal */}
      {showConfirmModal && (
        <div className="modal-overlay" onClick={() => setShowConfirmModal(false)}>
          <div className="send-confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="send-confirm-header">
              <h3>Send this email?</h3>
              <p>This will be sent from your Gmail to <strong>{lead.contact_email}</strong></p>
            </div>

            <div className="send-confirm-email">
              <div className="send-confirm-field">
                <span className="send-confirm-label">To</span>
                <span className="send-confirm-value">{lead.contact_email}</span>
              </div>
              <div className="send-confirm-field">
                <span className="send-confirm-label">Subject</span>
                <span className="send-confirm-value">{decision.draft_subject}</span>
              </div>
              <div className="send-confirm-body">{decision.draft_body}</div>
            </div>

            <div className="send-confirm-actions">
              <button className="btn-ghost" onClick={() => setShowConfirmModal(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleConfirmSend}>
                Send Email
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
