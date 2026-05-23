import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabase'

const SEGMENTS = ['Corporate', 'Wedding', 'Social', 'Sports', 'Religious', 'Government', 'Tour & Travel']
const TONES = [
  { value: 'professional', label: 'Professional', desc: 'Clear, confident, business-focused' },
  { value: 'warm', label: 'Warm', desc: 'Friendly, personal, welcoming' },
  { value: 'luxury', label: 'Luxury', desc: 'Refined, elegant, aspirational' }
]

export default function Onboarding() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    room_count: '',
    rate_min: '',
    rate_max: '',
    min_group_size: '10',
    fb_minimum: '',
    hotel_description: '',
    tone_of_voice: 'professional',
    target_segments: []
  })

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  function toggleSegment(seg) {
    setForm(f => ({
      ...f,
      target_segments: f.target_segments.includes(seg)
        ? f.target_segments.filter(s => s !== seg)
        : [...f.target_segments, seg]
    }))
  }

  async function handleFinish() {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data: hotelUser } = await supabase
      .from('hotel_users')
      .select('hotel_id')
      .eq('user_id', user.id)
      .single()

    await supabase.from('hotel_profiles').upsert({
      hotel_id: hotelUser.hotel_id,
      room_count: parseInt(form.room_count),
      rate_min: parseFloat(form.rate_min),
      rate_max: parseFloat(form.rate_max),
      min_group_size: parseInt(form.min_group_size),
      fb_minimum: parseFloat(form.fb_minimum) || 0,
      hotel_description: form.hotel_description,
      tone_of_voice: form.tone_of_voice,
      target_segments: form.target_segments.map(s => s.toLowerCase())
    })

    setSaving(false)
    navigate('/dashboard')
  }

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <div className="onboarding-step">Step {step} of 3</div>

        {step === 1 && (
          <>
            <h2>Tell us about your property</h2>
            <p className="subtitle">This helps the agent understand what leads are a fit for your hotel.</p>
            <div className="onboarding-form">
              <div className="form-row">
                <div className="form-group">
                  <label>Total Rooms</label>
                  <input name="room_count" type="number" value={form.room_count} onChange={handleChange} placeholder="e.g. 250" />
                </div>
                <div className="form-group">
                  <label>Min Group Size (rooms)</label>
                  <input name="min_group_size" type="number" value={form.min_group_size} onChange={handleChange} placeholder="e.g. 10" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Min Rate / Night</label>
                  <input name="rate_min" type="number" value={form.rate_min} onChange={handleChange} placeholder="e.g. 149" />
                </div>
                <div className="form-group">
                  <label>Max Rate / Night</label>
                  <input name="rate_max" type="number" value={form.rate_max} onChange={handleChange} placeholder="e.g. 349" />
                </div>
              </div>
              <div className="form-group">
                <label>F&B Minimum (optional)</label>
                <input name="fb_minimum" type="number" value={form.fb_minimum} onChange={handleChange} placeholder="e.g. 5000" />
              </div>
              <div className="form-group">
                <label>Brief hotel description (used to personalize emails)</label>
                <textarea
                  name="hotel_description"
                  value={form.hotel_description}
                  onChange={handleChange}
                  rows={3}
                  placeholder="e.g. A full-service Marriott property in downtown Salt Lake City with 15,000 sq ft of meeting space..."
                />
              </div>
              <div className="onboarding-actions">
                <button className="btn-primary" onClick={() => setStep(2)}>Next →</button>
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2>Which segments do you target?</h2>
            <p className="subtitle">The agent will prioritize leads that match your target segments.</p>
            <div className="onboarding-form">
              <div className="segment-grid">
                {SEGMENTS.map(seg => (
                  <button
                    key={seg}
                    type="button"
                    className={`segment-chip ${form.target_segments.includes(seg) ? 'selected' : ''}`}
                    onClick={() => toggleSegment(seg)}
                  >
                    {seg}
                  </button>
                ))}
              </div>
              <div className="onboarding-actions">
                <button className="btn-ghost" onClick={() => setStep(1)}>← Back</button>
                <button className="btn-primary" onClick={() => setStep(3)}>Next →</button>
              </div>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2>How should the agent sound?</h2>
            <p className="subtitle">All emails the agent drafts will match this tone.</p>
            <div className="onboarding-form">
              {TONES.map(tone => (
                <label key={tone.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="tone_of_voice"
                    value={tone.value}
                    checked={form.tone_of_voice === tone.value}
                    onChange={handleChange}
                    style={{ marginTop: 3 }}
                  />
                  <div>
                    <div style={{ fontWeight: 600 }}>{tone.label}</div>
                    <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{tone.desc}</div>
                  </div>
                </label>
              ))}
              <div className="onboarding-actions">
                <button className="btn-ghost" onClick={() => setStep(2)}>← Back</button>
                <button className="btn-primary" onClick={handleFinish} disabled={saving}>
                  {saving ? 'Saving...' : 'Finish Setup →'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
