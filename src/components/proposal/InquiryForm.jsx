import { useState } from 'react'
import { useParams } from 'react-router-dom'

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1'

// Public group inquiry form — hotels embed this on their own
// website via an iframe. Submissions flow straight into the
// FuturesPlanning leads pipeline as source 'webform'.
export default function InquiryForm() {
  const { hotelId } = useParams()
  const [form, setForm] = useState({
    contact_name: '', contact_email: '', contact_phone: '',
    company: '', event_type: '', group_size: '',
    check_in: '', check_out: '', budget_per_night: '', message: ''
  })
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState(null)

  const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }))

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`${FUNCTIONS_URL}/submit-inquiry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hotel_id: hotelId, ...form })
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Submission failed')
      setDone(true)
    } catch (err) {
      setError(err.message)
    }
    setSubmitting(false)
  }

  if (done) {
    return (
      <div className="inquiry-page">
        <div className="inquiry-card inquiry-thanks">
          <div className="inquiry-thanks-icon">✓</div>
          <h2>Thank you!</h2>
          <p>We've received your inquiry and our team will be in touch shortly.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="inquiry-page">
      <div className="inquiry-card">
        <h2>Group & Event Inquiry</h2>
        <p className="inquiry-sub">Tell us about your event and we'll get back to you quickly.</p>

        <form onSubmit={handleSubmit}>
          <div className="inquiry-row">
            <div className="form-group">
              <label className="form-label">Your Name *</label>
              <input className="form-input" required value={form.contact_name} onChange={set('contact_name')} />
            </div>
            <div className="form-group">
              <label className="form-label">Email *</label>
              <input className="form-input" type="email" required value={form.contact_email} onChange={set('contact_email')} />
            </div>
          </div>

          <div className="inquiry-row">
            <div className="form-group">
              <label className="form-label">Phone</label>
              <input className="form-input" value={form.contact_phone} onChange={set('contact_phone')} />
            </div>
            <div className="form-group">
              <label className="form-label">Company / Organization</label>
              <input className="form-input" value={form.company} onChange={set('company')} />
            </div>
          </div>

          <div className="inquiry-row">
            <div className="form-group">
              <label className="form-label">Event Type</label>
              <select className="form-input" value={form.event_type} onChange={set('event_type')}>
                <option value="">Select...</option>
                <option value="corporate">Corporate Meeting</option>
                <option value="wedding">Wedding</option>
                <option value="conference">Conference</option>
                <option value="social">Social Event</option>
                <option value="sports">Sports Group</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Rooms Needed</label>
              <input className="form-input" type="number" min="1" value={form.group_size} onChange={set('group_size')} />
            </div>
          </div>

          <div className="inquiry-row">
            <div className="form-group">
              <label className="form-label">Check-in</label>
              <input className="form-input" type="date" value={form.check_in} onChange={set('check_in')} />
            </div>
            <div className="form-group">
              <label className="form-label">Check-out</label>
              <input className="form-input" type="date" value={form.check_out} onChange={set('check_out')} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Budget per room/night (optional)</label>
            <input className="form-input" type="number" min="0" value={form.budget_per_night} onChange={set('budget_per_night')} placeholder="$" />
          </div>

          <div className="form-group">
            <label className="form-label">Tell us about your event</label>
            <textarea className="form-input" rows={4} value={form.message} onChange={set('message')} />
          </div>

          {error && <div className="inquiry-error">⚠ {error}</div>}

          <button className="btn-primary inquiry-submit" type="submit" disabled={submitting}>
            {submitting ? 'Sending...' : 'Send Inquiry'}
          </button>
        </form>
      </div>
    </div>
  )
}
