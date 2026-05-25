import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../supabase'
import NavBar from '../shared/NavBar'
import ConnectionsTab from '../connections/ConnectionsTab'

const SEGMENTS = ['Corporate', 'Wedding', 'Social', 'Sports', 'Religious', 'Government', 'Tour & Travel']
const TONES = [
  {
    value: 'professional',
    label: 'Professional',
    icon: '💼',
    desc: 'Clear, confident, business-focused',
    example: '"Thank you for your inquiry. We\'d be glad to accommodate your group and can offer competitive rates for your dates."'
  },
  {
    value: 'warm',
    label: 'Warm',
    icon: '🤝',
    desc: 'Friendly, personal, welcoming',
    example: '"We\'d love to have your group with us! Our team will make sure everything feels just right from the moment you arrive."'
  },
  {
    value: 'luxury',
    label: 'Luxury',
    icon: '✦',
    desc: 'Refined, elegant, aspirational',
    example: '"We would be honoured to curate an exceptional experience for your group, tailored to the highest standard of service."'
  }
]

export default function Profile() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [hotelId, setHotelId] = useState(null)
  const [hasConnections, setHasConnections] = useState(true)
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') ?? 'profile')

  const [userForm, setUserForm] = useState({ full_name: '', email: '' })
  const [hotelForm, setHotelForm] = useState({
    name: '',
    address: '',
    city: '',
    state: '',
    room_count: '',
    rate_min: '',
    rate_max: '',
    min_group_size: '',
    fb_minimum: '',
    hotel_description: '',
    tone_of_voice: 'professional',
    target_segments: []
  })

  useEffect(() => {
    loadProfile()
  }, [])

  async function loadProfile() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()

    const { data: hotelUser } = await supabase
      .from('hotel_users')
      .select('hotel_id, full_name, email, hotels(id, name, address, city, state)')
      .eq('user_id', user.id)
      .single()

    if (hotelUser) {
      setHotelId(hotelUser.hotel_id)
      setUserForm({
        full_name: hotelUser.full_name ?? '',
        email: hotelUser.email ?? user.email ?? ''
      })
      setHotelForm(f => ({
        ...f,
        name: hotelUser.hotels?.name ?? '',
        address: hotelUser.hotels?.address ?? '',
        city: hotelUser.hotels?.city ?? '',
        state: hotelUser.hotels?.state ?? ''
      }))

      const { data: profile } = await supabase
        .from('hotel_profiles')
        .select('*')
        .eq('hotel_id', hotelUser.hotel_id)
        .single()

      if (profile) {
        setHotelForm(f => ({
          ...f,
          room_count: profile.room_count ?? '',
          rate_min: profile.rate_min ?? '',
          rate_max: profile.rate_max ?? '',
          min_group_size: profile.min_group_size ?? '',
          fb_minimum: profile.fb_minimum ?? '',
          hotel_description: profile.hotel_description ?? '',
          tone_of_voice: profile.tone_of_voice ?? 'professional',
          target_segments: profile.target_segments?.map(s =>
            s.charAt(0).toUpperCase() + s.slice(1)
          ) ?? []
        }))
      }
    }
    setLoading(false)
  }

  function toggleSegment(seg) {
    setHotelForm(f => ({
      ...f,
      target_segments: f.target_segments.includes(seg)
        ? f.target_segments.filter(s => s !== seg)
        : [...f.target_segments, seg]
    }))
  }

  async function handleSave() {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()

    // Update hotel_users (name)
    await supabase
      .from('hotel_users')
      .update({ full_name: userForm.full_name, email: userForm.email })
      .eq('user_id', user.id)

    // Update hotel name/address
    await supabase
      .from('hotels')
      .update({
        name: hotelForm.name,
        address: hotelForm.address,
        city: hotelForm.city,
        state: hotelForm.state
      })
      .eq('id', hotelId)

    // Update hotel profile
    await supabase
      .from('hotel_profiles')
      .upsert({
        hotel_id: hotelId,
        room_count: parseInt(hotelForm.room_count) || 0,
        rate_min: parseFloat(hotelForm.rate_min) || 0,
        rate_max: parseFloat(hotelForm.rate_max) || 0,
        min_group_size: parseInt(hotelForm.min_group_size) || 10,
        fb_minimum: parseFloat(hotelForm.fb_minimum) || 0,
        hotel_description: hotelForm.hotel_description,
        tone_of_voice: hotelForm.tone_of_voice,
        target_segments: hotelForm.target_segments.map(s => s.toLowerCase())
      })

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  if (loading) return (
    <div className="loading-screen"><div className="loading-spinner" /></div>
  )

  return (
    <div className="profile-page">
      <NavBar hotelName={hotelForm.name} userName={userForm.full_name} />

      <div className="profile-content">
        <div className="profile-header">
          <div className="profile-avatar-large">
            {userForm.full_name
              ? userForm.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
              : '?'}
          </div>
          <div>
            <h1>{userForm.full_name || 'Your Profile'}</h1>
            <p className="profile-subtitle">{hotelForm.name}</p>
          </div>
        </div>

        <div className="profile-tabs">
          <button
            className={`profile-tab ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            My Profile
          </button>
          <button
            className={`profile-tab ${activeTab === 'hotel' ? 'active' : ''}`}
            onClick={() => setActiveTab('hotel')}
          >
            Hotel Settings
          </button>
          <button
            className={`profile-tab ${activeTab === 'agent' ? 'active' : ''}`}
            onClick={() => setActiveTab('agent')}
          >
            Agent Settings
          </button>
          <button
            className={`profile-tab ${activeTab === 'connections' ? 'active' : ''}`}
            onClick={() => setActiveTab('connections')}
          >
            Connections
            {!hasConnections && <span className="profile-tab-alert" />}
          </button>
        </div>

        <div className="profile-body">
          {/* MY PROFILE TAB */}
          {activeTab === 'profile' && (
            <div className="profile-section">
              <h2>Personal Information</h2>
              <p className="section-desc">This is how you appear in the system.</p>
              <div className="profile-form">
                <div className="form-row">
                  <div className="form-group">
                    <label>Full Name</label>
                    <input
                      value={userForm.full_name}
                      onChange={e => setUserForm(f => ({ ...f, full_name: e.target.value }))}
                      placeholder="Sarah Johnson"
                    />
                  </div>
                  <div className="form-group">
                    <label>Email</label>
                    <input
                      value={userForm.email}
                      onChange={e => setUserForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="you@hotel.com"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* HOTEL SETTINGS TAB */}
          {activeTab === 'hotel' && (
            <div className="profile-section">
              <h2>Hotel Information</h2>
              <p className="section-desc">Basic details about your property.</p>
              <div className="profile-form">
                <div className="form-group">
                  <label>Hotel Name</label>
                  <input
                    value={hotelForm.name}
                    onChange={e => setHotelForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Montage Park City"
                  />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Address</label>
                    <input
                      value={hotelForm.address}
                      onChange={e => setHotelForm(f => ({ ...f, address: e.target.value }))}
                      placeholder="9100 Marsac Ave"
                    />
                  </div>
                  <div className="form-group">
                    <label>City</label>
                    <input
                      value={hotelForm.city}
                      onChange={e => setHotelForm(f => ({ ...f, city: e.target.value }))}
                      placeholder="Park City"
                    />
                  </div>
                  <div className="form-group">
                    <label>State</label>
                    <input
                      value={hotelForm.state}
                      onChange={e => setHotelForm(f => ({ ...f, state: e.target.value }))}
                      placeholder="UT"
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Total Rooms</label>
                    <input
                      type="number"
                      value={hotelForm.room_count}
                      onChange={e => setHotelForm(f => ({ ...f, room_count: e.target.value }))}
                      placeholder="250"
                    />
                  </div>
                  <div className="form-group">
                    <label>Min Group Size</label>
                    <input
                      type="number"
                      value={hotelForm.min_group_size}
                      onChange={e => setHotelForm(f => ({ ...f, min_group_size: e.target.value }))}
                      placeholder="10"
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Min Rate / Night</label>
                    <input
                      type="number"
                      value={hotelForm.rate_min}
                      onChange={e => setHotelForm(f => ({ ...f, rate_min: e.target.value }))}
                      placeholder="149"
                    />
                  </div>
                  <div className="form-group">
                    <label>Max Rate / Night</label>
                    <input
                      type="number"
                      value={hotelForm.rate_max}
                      onChange={e => setHotelForm(f => ({ ...f, rate_max: e.target.value }))}
                      placeholder="349"
                    />
                  </div>
                  <div className="form-group">
                    <label>F&B Minimum</label>
                    <input
                      type="number"
                      value={hotelForm.fb_minimum}
                      onChange={e => setHotelForm(f => ({ ...f, fb_minimum: e.target.value }))}
                      placeholder="5000"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* AGENT SETTINGS TAB */}
          {activeTab === 'agent' && (
            <div className="profile-section">
              <h2>Agent Settings</h2>
              <p className="section-desc">Control how the agent scores leads and writes emails.</p>
              <div className="profile-form">
                <div className="form-group">
                  <label>Hotel Description</label>
                  <textarea
                    value={hotelForm.hotel_description}
                    onChange={e => setHotelForm(f => ({ ...f, hotel_description: e.target.value }))}
                    rows={4}
                    placeholder="Describe your property — the agent uses this to personalize every email it writes..."
                  />
                </div>

                <div className="form-group">
                  <label>Target Segments</label>
                  <p className="field-desc">The agent will prioritize leads that match these segments.</p>
                  <div className="segment-grid">
                    {SEGMENTS.map(seg => (
                      <button
                        key={seg}
                        type="button"
                        className={`segment-chip ${hotelForm.target_segments.includes(seg) ? 'selected' : ''}`}
                        onClick={() => toggleSegment(seg)}
                      >
                        {seg}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="form-group">
                  <label>Email Tone</label>
                  <p className="field-desc">All emails the agent drafts will match this tone.</p>
                  <div className="tone-options">
                    {TONES.map(tone => (
                      <label key={tone.value} className={`tone-option ${hotelForm.tone_of_voice === tone.value ? 'selected' : ''}`}>
                        <input
                          type="radio"
                          name="tone"
                          value={tone.value}
                          checked={hotelForm.tone_of_voice === tone.value}
                          onChange={() => setHotelForm(f => ({ ...f, tone_of_voice: tone.value }))}
                        />
                        <div className="tone-content">
                          <div className="tone-top">
                            <span className="tone-icon">{tone.icon}</span>
                            <div>
                              <div className="tone-label">{tone.label}</div>
                              <div className="tone-desc">{tone.desc}</div>
                            </div>
                          </div>
                          <div className="tone-example">{tone.example}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'connections' && (
            <div className="profile-section">
              <h2>Connected Platforms</h2>
              <p className="section-desc">
                Connect your lead sources and email accounts. The agent pulls from every connected
                platform and scores all leads together — the best ones rise to the top regardless of source.
              </p>
              <ConnectionsTab
                hotelId={hotelId}
                onConnectionChange={() => setHasConnections(true)}
              />
            </div>
          )}

          <div className="profile-actions">
            <button className="btn-ghost" onClick={() => navigate('/dashboard')}>
              ← Back to Dashboard
            </button>
            {activeTab !== 'connections' && (
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save Changes'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
