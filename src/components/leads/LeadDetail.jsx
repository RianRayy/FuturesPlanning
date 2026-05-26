import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../supabase'
import { format } from 'date-fns'
import BidAdvisorModal from './BidAdvisorModal'

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1'
const ANON_KEY      = import.meta.env.VITE_SUPABASE_ANON_KEY

export default function LeadDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [lead, setLead]               = useState(null)
  const [decision, setDecision]       = useState(null)
  const [emailBody, setEmailBody]     = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [saving, setSaving]           = useState(false)
  const [sending, setSending]         = useState(false)
  const [sent, setSent]               = useState(false)
  const [emailWasSent, setEmailWasSent] = useState(false)
  const [showModal, setShowModal]     = useState(false)
  const [sendError, setSendError]     = useState(null)

  useEffect(() => { loadLead() }, [id])

  async function loadLead() {
    const { data } = await supabase
      .from('leads')
      .select('*, lead_decisions(*), email_threads(*)')
      .eq('id', id)
      .single()

    if (data) {
      setLead(data)
      setDecision(data.lead_decisions)
      setEmailBody(data.lead_decisions?.draft_body ?? '')
      setEmailSubject(data.lead_decisions?.draft_subject ?? '')
      setSent(!!data.lead_decisions?.sent_at)
      setEmailWasSent(!!data.lead_decisions?.sent_at)
    }
  }

  async function handleSaveDraft() {
    setSaving(true)
    await supabase
      .from('lead_decisions')
      .update({ draft_body: emailBody, draft_subject: emailSubject })
      .eq('lead_id', id)
    setSaving(false)
  }

  const hasValidEmail = lead?.contact_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.contact_email)

  async function handleConfirmSend({ bidRate, bidNotes } = {}) {
    setShowModal(false)
    setSending(true)
    setSendError(null)

    // No email on file — mark approved only, no Gmail call
    if (!hasValidEmail) {
      try {
        await supabase
          .from('lead_decisions')
          .update({
            draft_body:    emailBody,
            draft_subject: emailSubject,
            approved_at:   new Date().toISOString(),
            sent_at:       new Date().toISOString()
          })
          .eq('lead_id', id)
        setEmailWasSent(false)
        setSent(true)
      } catch (err) {
        setSendError(err.message)
      }
      setSending(false)
      return
    }

    // Email on file — send via Gmail Edge Function
    try {
      // Save latest edits first
      await supabase
        .from('lead_decisions')
        .update({ draft_body: emailBody, draft_subject: emailSubject })
        .eq('lead_id', id)

      const res = await fetch(`${FUNCTIONS_URL}/gmail-send`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
          'apikey':        ANON_KEY
        },
        body: JSON.stringify({
          lead_id:   id,
          hotel_id:  lead.hotel_id,
          to:        lead.contact_email,
          subject:   emailSubject,
          body:      emailBody,
          bid_rate:  bidRate  ?? null,
          bid_notes: bidNotes ?? null
        })
      })

      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Send failed')

      setEmailWasSent(true)
      setSent(true)
    } catch (err) {
      console.error('Send error:', err)
      setSendError(err.message)
    }
    setSending(false)
  }

  if (!lead) return <div className="loading-screen"><div className="loading-spinner" /></div>

  const SCORE_COLORS = { hot: '#ef4444', warm: '#f59e0b', cold: '#94a3b8' }
  const score = decision?.score ?? 'cold'
  const isCvent = lead.source === 'cvent'

  return (
    <div className="lead-detail">
      <div className="detail-header">
        <button className="btn-ghost back-btn" onClick={() => navigate('/dashboard')}>
          ← Back to Dashboard
        </button>
        <div className="detail-score" style={{ color: SCORE_COLORS[score] }}>
          {score.toUpperCase()}
        </div>
      </div>

      <div className="detail-body">
        {/* Lead Info */}
        <div className="detail-panel">
          <h2>{lead.contact_name}</h2>
          {lead.company && <p className="detail-company">{lead.company}</p>}

          <div className="detail-fields">
            <div className="detail-field">
              <label>Email</label>
              <span>{lead.contact_email ?? '—'}</span>
            </div>
            <div className="detail-field">
              <label>Phone</label>
              <span>{lead.contact_phone ?? '—'}</span>
            </div>
            <div className="detail-field">
              <label>Event Type</label>
              <span>{lead.event_type ?? '—'}</span>
            </div>
            <div className="detail-field">
              <label>Group Size</label>
              <span>{lead.group_size ? `${lead.group_size} rooms` : '—'}</span>
            </div>
            <div className="detail-field">
              <label>Dates</label>
              <span>
                {lead.dates_requested?.check_in
                  ? `${format(new Date(lead.dates_requested.check_in), 'MMM d')} – ${format(new Date(lead.dates_requested.check_out), 'MMM d, yyyy')}`
                  : '—'}
              </span>
            </div>
            <div className="detail-field">
              <label>Budget/Night</label>
              <span>{lead.budget_per_night ? `$${lead.budget_per_night}` : '—'}</span>
            </div>
          </div>

          {decision?.reasoning && (
            <div className="detail-reasoning">
              <label>Agent Insight</label>
              <p>{decision.reasoning}</p>
            </div>
          )}

          {lead.raw_content && (
            <div className="detail-raw">
              <label>Original Message</label>
              <pre>{lead.raw_content}</pre>
            </div>
          )}
        </div>

        {/* Email Draft Editor */}
        <div className="detail-panel">
          <h3>
            Email Draft{' '}
            {sent && (
              <span className="sent-tag">
                {emailWasSent ? 'Email Sent ✓' : 'Approved ✓'}
              </span>
            )}
          </h3>

          <div className="form-group">
            <label>Subject</label>
            <input
              value={emailSubject}
              onChange={e => setEmailSubject(e.target.value)}
              disabled={sent}
              className="draft-subject-input"
            />
          </div>

          <div className="form-group">
            <label>Body</label>
            <textarea
              value={emailBody}
              onChange={e => setEmailBody(e.target.value)}
              rows={16}
              disabled={sent}
              className="draft-body-textarea"
            />
          </div>

          {!sent && (
            <div className="detail-actions">
              <button className="btn-outline" onClick={handleSaveDraft} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                className="btn-primary"
                onClick={() => { setSendError(null); setShowModal(true) }}
                disabled={sending}
              >
                {sending ? 'Sending...' : 'Approve & Send'}
              </button>
            </div>
          )}

          {sendError && (
            <div className="send-error-banner" style={{ marginTop: 12 }}>
              ⚠ {sendError}
            </div>
          )}

          {/* Email Thread History */}
          {lead.email_threads?.length > 0 && (
            <div className="email-thread">
              <h4>Email History</h4>
              {lead.email_threads.map(thread => (
                <div key={thread.id} className={`thread-message thread-${thread.direction}`}>
                  <div className="thread-meta">
                    <span>{thread.direction === 'outbound' ? 'You sent' : 'They replied'}</span>
                    <span>{format(new Date(thread.received_at), 'MMM d, h:mm a')}</span>
                  </div>
                  <div className="thread-subject">{thread.subject}</div>
                  <pre className="thread-body">{thread.body}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cvent: full Bid Advisor modal */}
      {showModal && isCvent && (
        <BidAdvisorModal
          lead={lead}
          decision={{ ...decision, draft_subject: emailSubject, draft_body: emailBody }}
          hotelId={lead.hotel_id}
          onConfirm={handleConfirmSend}
          onCancel={() => setShowModal(false)}
          sending={sending}
        />
      )}

      {/* All other sources: email confirm modal */}
      {showModal && !isCvent && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
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
                <span className="send-confirm-value">{emailSubject}</span>
              </div>
              <div className="send-confirm-body">{emailBody}</div>
            </div>

            <div className="send-confirm-actions">
              <button className="btn-ghost" onClick={() => setShowModal(false)}>
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
