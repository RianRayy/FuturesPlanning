import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabase'
import { format } from 'date-fns'
import { PLATFORM_CONFIG } from '../../integrations'
import BidAdvisorModal from './BidAdvisorModal'

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1'
const ANON_KEY      = import.meta.env.VITE_SUPABASE_ANON_KEY

// Platforms that use formal bid/proposal submissions —
// these get the full Bid Advisor modal instead of the simple email confirm.
// Add 'hotelplanner' here once their API is live.
const BID_ADVISOR_PLATFORMS = ['cvent']

const SCORE_CONFIG = {
  hot: { label: 'Hot', className: 'score-hot', emoji: '🔴' },
  warm: { label: 'Warm', className: 'score-warm', emoji: '🟡' },
  cold: { label: 'Cold', className: 'score-cold', emoji: '⚪' }
}

export default function LeadCard({ lead, hotelId, onUpdate, onDecline }) {
  const navigate = useNavigate()
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(!!lead.lead_decisions?.sent_at)
  const [emailWasSent, setEmailWasSent] = useState(!!lead.lead_decisions?.sent_at)
  const [declining, setDeclining] = useState(false)
  const [declined, setDeclined] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [sendError, setSendError] = useState(null)
  const [emailInput, setEmailInput] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)
  const [draftSubject, setDraftSubject] = useState(decision?.draft_subject ?? '')
  const [draftBody, setDraftBody] = useState(decision?.draft_body ?? '')

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

  async function handleSaveEmail() {
    if (!emailInput || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)) return
    setSavingEmail(true)
    try {
      await supabase.from('leads').update({ contact_email: emailInput }).eq('id', lead.id)
      onUpdate?.()
    } catch (err) {
      console.error('Save email error:', err)
    }
    setSavingEmail(false)
  }

  async function handleConfirmSend({ bidRate, bidNotes } = {}) {
    setShowConfirmModal(false)
    setSending(true)
    setSendError(null)

    // Save any edits the user made in the modal back to the DB
    await supabase
      .from('lead_decisions')
      .update({ draft_subject: draftSubject, draft_body: draftBody })
      .eq('lead_id', lead.id)

    // No email on file — just mark as approved in the system, no Gmail send
    if (!hasValidEmail) {
      try {
        await supabase
          .from('lead_decisions')
          .update({ approved_at: new Date().toISOString(), sent_at: new Date().toISOString() })
          .eq('lead_id', lead.id)
        setEmailWasSent(false)
        setSent(true)
        onUpdate?.()
      } catch (err) {
        setSendError(err.message)
      }
      setSending(false)
      return
    }

    // Email on file — send via Gmail (which also auto-submits Cvent proposal if applicable)
    try {
      const res = await fetch(`${FUNCTIONS_URL}/gmail-send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
          'apikey': ANON_KEY
        },
        body: JSON.stringify({
          lead_id:   lead.id,
          hotel_id:  hotelId,
          to:        lead.contact_email,
          subject:   draftSubject,
          body:      draftBody,
          // Bid advisor params — passed through to Cvent proposal if applicable
          bid_rate:  bidRate ?? null,
          bid_notes: bidNotes ?? null
        })
      })

      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Send failed')

      setEmailWasSent(true)
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

        {/* Inline email entry when no address on file */}
        {!hasValidEmail && !sent && (
          <div className="lead-email-missing">
            <span className="lead-email-missing-label">⚠ No email on file</span>
            <div className="lead-email-input-row">
              <input
                type="email"
                className="lead-email-input"
                placeholder="Enter email address..."
                value={emailInput}
                onChange={e => setEmailInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveEmail()}
              />
              <button
                className="btn-ghost btn-sm"
                onClick={handleSaveEmail}
                disabled={savingEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)}
              >
                {savingEmail ? '...' : 'Save'}
              </button>
            </div>
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
              disabled={sending || !decision?.draft_body}
            >
              {sending ? 'Sending...' : 'Approve & Send'}
            </button>
          </>
        ) : (
          <div className="sent-badge">
            {emailWasSent ? 'Email sent ✓' : 'Approved ✓'}
          </div>
        )}
      </div>

      {sendError && (
        <div className="send-error-banner">
          ⚠ {sendError}
        </div>
      )}

      {/* Cvent: show bid advisor modal with rate intelligence */}
      {showConfirmModal && lead.source === 'cvent' && (
        <BidAdvisorModal
          lead={lead}
          decision={decision}
          hotelId={hotelId}
          onConfirm={handleConfirmSend}
          onCancel={() => setShowConfirmModal(false)}
          sending={sending}
        />
      )}

      {/* All other sources: simple email confirmation modal */}
      {showConfirmModal && lead.source !== 'cvent' && (
        <div className="modal-overlay" onClick={() => setShowConfirmModal(false)}>
          <div className="send-confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="send-confirm-header">
              {hasValidEmail ? (
                <>
                  <h3>Send this email?</h3>
                  <p>This will be sent from your Gmail to <strong>{lead.contact_email}</strong></p>
                </>
              ) : (
                <>
                  <h3>Approve without sending?</h3>
                  <p className="send-confirm-no-email-warn">
                    ⚠ No email address on file — the lead will be marked as approved but <strong>no email will be sent</strong>.
                  </p>
                </>
              )}
            </div>

            <div className="send-confirm-email">
              {hasValidEmail && (
                <div className="send-confirm-field">
                  <span className="send-confirm-label">To</span>
                  <span className="send-confirm-value">{lead.contact_email}</span>
                </div>
              )}
              <div className="send-confirm-field">
                <span className="send-confirm-label">Subject</span>
                <input
                  className="send-confirm-input"
                  value={draftSubject}
                  onChange={e => setDraftSubject(e.target.value)}
                />
              </div>
              <textarea
                className="send-confirm-body send-confirm-body-edit"
                value={draftBody}
                onChange={e => setDraftBody(e.target.value)}
                rows={10}
              />
            </div>

            <div className="send-confirm-actions">
              <button className="btn-ghost" onClick={() => setShowConfirmModal(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleConfirmSend}>
                {hasValidEmail ? 'Send Email' : 'Approve Anyway'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
