import { useState } from 'react'
import { supabase } from '../../supabase'

const REPLY_TYPE_LABELS = {
  pricing_question: 'Asked about pricing',
  site_visit_request: 'Requested a site visit',
  alternate_dates: 'Requested alternate dates',
  general_interest: 'Expressed interest',
  decline: 'Declined',
  contract_ready: 'Ready to contract'
}

export default function ReplySection({ replyDrafts, onUpdate }) {
  const [sending, setSending] = useState({})
  const [expanded, setExpanded] = useState({})

  async function handleApprove(draft) {
    setSending(s => ({ ...s, [draft.id]: true }))
    try {
      await supabase
        .from('reply_drafts')
        .update({ status: 'approved', sent_at: new Date().toISOString() })
        .eq('id', draft.id)

      await supabase.from('email_threads').insert({
        lead_id: draft.lead_id,
        hotel_id: draft.hotel_id,
        direction: 'outbound',
        subject: draft.draft_subject,
        body: draft.draft_body
      })

      onUpdate?.()
    } catch (err) {
      console.error(err)
    }
    setSending(s => ({ ...s, [draft.id]: false }))
  }

  return (
    <section className="dashboard-section">
      <div className="section-header">
        <h2>Replies Received — Responses Drafted</h2>
        <span className="section-badge section-badge-urgent">{replyDrafts.length} new</span>
      </div>
      <div className="reply-list">
        {replyDrafts.map(draft => (
          <div key={draft.id} className="reply-card">
            <div className="reply-meta">
              <span className="reply-name">{draft.leads?.contact_name}</span>
              <span className="reply-type">{REPLY_TYPE_LABELS[draft.reply_type] ?? draft.reply_type}</span>
            </div>
            <div className="reply-subject">{draft.draft_subject}</div>
            <div
              className={`reply-preview ${expanded[draft.id] ? 'expanded' : ''}`}
              onClick={() => setExpanded(e => ({ ...e, [draft.id]: !e[draft.id] }))}
            >
              <p>{expanded[draft.id] ? draft.draft_body : `${draft.draft_body?.slice(0, 140)}...`}</p>
              <span className="expand-toggle">
                {expanded[draft.id] ? 'Show less' : 'Show full draft'}
              </span>
            </div>
            <div className="reply-actions">
              <button
                className="btn-ghost"
                onClick={() => {
                  supabase.from('reply_drafts').update({ status: 'discarded' }).eq('id', draft.id)
                  onUpdate?.()
                }}
              >
                Discard
              </button>
              <button
                className="btn-primary"
                onClick={() => handleApprove(draft)}
                disabled={sending[draft.id]}
              >
                {sending[draft.id] ? 'Sending...' : 'Approve & Send'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
