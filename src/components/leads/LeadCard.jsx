import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabase'
import { format } from 'date-fns'
import { PLATFORM_CONFIG } from '../../integrations'
import BidAdvisorModal from './BidAdvisorModal'

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1'
const ANON_KEY      = import.meta.env.VITE_SUPABASE_ANON_KEY

const SCORE_CONFIG = {
  hot:  { label: 'Hot',  className: 'score-hot',  emoji: '🔴' },
  warm: { label: 'Warm', className: 'score-warm', emoji: '🟡' },
  cold: { label: 'Cold', className: 'score-cold', emoji: '⚪' }
}

// Compute win probability from bid rate vs planner budget — no API call needed
function getWinProb(bidRate, budget) {
  if (!budget || !bidRate) return null
  if (bidRate > budget)            return { label: 'Low',    color: '#ef4444', bg: 'rgba(239,68,68,0.1)',    note: `$${bidRate - budget} over budget` }
  if (bidRate > budget * 0.92)     return { label: 'Medium', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',   note: `$${budget - bidRate}/night headroom` }
  return                                   { label: 'High',   color: '#10b981', bg: 'rgba(16,185,129,0.1)',  note: `$${budget - bidRate}/night below budget` }
}

export default function LeadCard({ lead, hotelId, onUpdate, onDecline }) {
  const navigate  = useNavigate()
  const decision  = lead.lead_decisions
  const budget    = lead.budget_per_night ?? null

  const [sending, setSending]           = useState(false)
  const [sent, setSent]                 = useState(!!decision?.sent_at)
  const [emailWasSent, setEmailWasSent] = useState(!!decision?.sent_at)
  const [declining, setDeclining]       = useState(false)
  const [declined, setDeclined]         = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [showBidAdvisor, setShowBidAdvisor]     = useState(false)
  const [sendError, setSendError]       = useState(null)
  const [emailInput, setEmailInput]     = useState('')
  const [savingEmail, setSavingEmail]   = useState(false)
  const [draftSubject, setDraftSubject] = useState(decision?.draft_subject ?? '')
  const [draftBody, setDraftBody]       = useState(decision?.draft_body ?? '')

  // Inline bid rate — defaults to 10% under planner budget, or 0 if unknown
  const defaultRate = budget ? Math.round(budget * 0.9 / 5) * 5 : 0
  const [bidRate, setBidRate] = useState(defaultRate)

  const score    = decision?.score ?? 'cold'
  const config   = SCORE_CONFIG[score]
  const platform = PLATFORM_CONFIG[lead.source] ?? PLATFORM_CONFIG.email
  const hasValidEmail = lead.contact_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.contact_email)

  const checkIn  = lead.dates_requested?.check_in
  const checkOut = lead.dates_requested?.check_out
  const winProb  = getWinProb(bidRate, budget)

  function adjustRate(delta) {
    setBidRate(r => Math.max(0, Math.round((r + delta) / 5) * 5))
  }

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

  async function handleConfirmSend({ bidRate: overrideRate, bidNotes } = {}) {
    setShowConfirmModal(false)
    setShowBidAdvisor(false)
    setSending(true)
    setSendError(null)

    const finalRate = overrideRate ?? bidRate

    // Save any edits back to the DB
    await supabase
      .from('lead_decisions')
      .update({ draft_subject: draftSubject, draft_body: draftBody })
      .eq('lead_id', lead.id)

    // No email — just mark approved
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

    // Send via Gmail
    try {
      const res = await fetch(`${FUNCTIONS_URL}/gmail-send`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
          'apikey':        ANON_KEY
        },
        body: JSON.stringify({
          lead_id:   lead.id,
          hotel_id:  hotelId,
          to:        lead.contact_email,
          subject:   draftSubject,
          body:      draftBody,
          bid_rate:  finalRate ?? null,
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
          {lead.event_type && <span className="lead-tag">{lead.event_type}</span>}
          {lead.group_size && <span className="lead-tag">{lead.group_size} rooms</span>}
          {checkIn && (
            <span className="lead-tag">
              {format(new Date(checkIn), 'MMM d')}
              {checkOut ? ` – ${format(new Date(checkOut), 'MMM d, yyyy')}` : ''}
            </span>
          )}
          {budget && <span className="lead-tag">Budget: ${budget}/night</span>}
        </div>

        {/* Agent reasoning */}
        {decision?.reasoning && (
          <div className="lead-reasoning">
            <span className="reasoning-label">Agent insight</span>
            <p>{decision.reasoning}</p>
          </div>
        )}

        {/* Inline bid rate + win probability — always visible when not sent */}
        {!sent && decision?.draft_body && (
          <div className="card-bid-section">
            <div className="card-bid-row">
              <span className="card-bid-label">Your Bid Rate</span>
              {budget && (
                <span className="card-bid-budget">Planner budget: ${budget}/night</span>
              )}
            </div>
            <div className="card-bid-controls">
              <button className="card-bid-btn" onClick={() => adjustRate(-5)}>−$5</button>
              <div className="card-bid-display">
                <span className="card-bid-dollar">$</span>
                <input
                  type="number"
                  className="card-bid-input"
                  value={bidRate}
                  onChange={e => setBidRate(Math.max(0, Number(e.target.value)))}
                  min={0}
                />
                <span className="card-bid-unit">/night</span>
              </div>
              <button className="card-bid-btn" onClick={() => adjustRate(5)}>+$5</button>
            </div>

            {winProb && (
              <div className="card-win-prob" style={{ background: winProb.bg, borderColor: winProb.color }}>
                <span className="card-win-label" style={{ color: winProb.color }}>
                  {winProb.label} Win Probability
                </span>
                <span className="card-win-note">{winProb.note}</span>
                {lead.source === 'cvent' && (
                  <button
                    className="card-bid-advisor-link"
                    onClick={() => setShowBidAdvisor(true)}
                  >
                    Full rate analysis →
                  </button>
                )}
              </div>
            )}

            {!budget && (
              <p className="card-bid-no-budget">Budget not disclosed — enter your rate above</p>
            )}
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

      {sendError && <div className="send-error-banner">⚠ {sendError}</div>}

      {/* Cvent full bid advisor (triggered via "Full rate analysis" link) */}
      {showBidAdvisor && (
        <BidAdvisorModal
          lead={lead}
          decision={decision}
          hotelId={hotelId}
          onConfirm={handleConfirmSend}
          onCancel={() => setShowBidAdvisor(false)}
          sending={sending}
        />
      )}

      {/* Email confirmation modal — editable subject + body */}
      {showConfirmModal && (
        <div className="modal-overlay" onClick={() => setShowConfirmModal(false)}>
          <div className="send-confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="send-confirm-header">
              {hasValidEmail ? (
                <>
                  <h3>Send this email?</h3>
                  <p>Sending from your Gmail to <strong>{lead.contact_email}</strong>
                    {bidRate > 0 && <span className="send-confirm-rate"> · Bid rate: ${bidRate}/night</span>}
                  </p>
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
              <button className="btn-primary" onClick={() => handleConfirmSend()}>
                {hasValidEmail ? 'Send Email' : 'Approve Anyway'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
