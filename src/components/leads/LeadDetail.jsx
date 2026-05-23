import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../supabase'
import { format } from 'date-fns'

export default function LeadDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [lead, setLead] = useState(null)
  const [decision, setDecision] = useState(null)
  const [emailBody, setEmailBody] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    loadLead()
  }, [id])

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

  async function handleApproveAndSend() {
    setSending(true)
    await supabase
      .from('lead_decisions')
      .update({
        draft_body: emailBody,
        draft_subject: emailSubject,
        approved_at: new Date().toISOString(),
        sent_at: new Date().toISOString()
      })
      .eq('lead_id', id)

    await supabase.from('email_threads').insert({
      lead_id: id,
      hotel_id: lead.hotel_id,
      direction: 'outbound',
      subject: emailSubject,
      body: emailBody,
      to_address: lead.contact_email
    })

    setSent(true)
    setSending(false)
  }

  if (!lead) return <div className="loading-screen"><div className="loading-spinner" /></div>

  const SCORE_COLORS = { hot: '#ef4444', warm: '#f59e0b', cold: '#94a3b8' }
  const score = decision?.score ?? 'cold'

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
          <h3>Email Draft {sent && <span className="sent-tag">Sent ✓</span>}</h3>

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
              <button className="btn-primary" onClick={handleApproveAndSend} disabled={sending}>
                {sending ? 'Sending...' : 'Approve & Send'}
              </button>
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
    </div>
  )
}
