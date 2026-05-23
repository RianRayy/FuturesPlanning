import { useState } from 'react'
import { supabase } from '../../supabase'

export default function FollowUpSection({ followUps, onUpdate }) {
  const [sending, setSending] = useState({})

  async function handleApprove(followUp) {
    setSending(s => ({ ...s, [followUp.id]: true }))
    try {
      await supabase
        .from('follow_up_queue')
        .update({ status: 'approved', sent_at: new Date().toISOString() })
        .eq('id', followUp.id)

      await supabase.from('email_threads').insert({
        lead_id: followUp.lead_id,
        hotel_id: followUp.hotel_id,
        direction: 'outbound',
        subject: followUp.draft_subject,
        body: followUp.draft_body
      })

      onUpdate?.()
    } catch (err) {
      console.error(err)
    }
    setSending(s => ({ ...s, [followUp.id]: false }))
  }

  async function handleSkip(followUp) {
    await supabase
      .from('follow_up_queue')
      .update({ status: 'cancelled' })
      .eq('id', followUp.id)
    onUpdate?.()
  }

  return (
    <section className="dashboard-section">
      <div className="section-header">
        <h2>Follow-ups Due Today</h2>
        <span className="section-badge">{followUps.length}</span>
      </div>
      <div className="follow-up-list">
        {followUps.map(fu => (
          <div key={fu.id} className="follow-up-card">
            <div className="follow-up-meta">
              <span className="follow-up-name">{fu.leads?.contact_name}</span>
              <span className="follow-up-event">{fu.leads?.event_type} · {fu.leads?.group_size} rooms</span>
              <span className="follow-up-day">Day {fu.sequence_day} follow-up</span>
            </div>
            <div className="follow-up-preview">
              <strong>{fu.draft_subject}</strong>
              <p>{fu.draft_body?.slice(0, 120)}...</p>
            </div>
            <div className="follow-up-actions">
              <button className="btn-ghost" onClick={() => handleSkip(fu)}>Skip</button>
              <button
                className="btn-primary"
                onClick={() => handleApprove(fu)}
                disabled={sending[fu.id]}
              >
                {sending[fu.id] ? 'Sending...' : 'Approve & Send'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
