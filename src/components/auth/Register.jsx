import { useState } from 'react'
import { supabase } from '../../supabase'
import { Link, useNavigate } from 'react-router-dom'

export default function Register() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ hotelName: '', email: '', password: '' })
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function handleRegister(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    // 1. Create auth user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password
    })
    if (authError) { setError(authError.message); setLoading(false); return }

    // 2. Create hotel record
    const subdomain = form.hotelName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const { data: hotel, error: hotelError } = await supabase
      .from('hotels')
      .insert({ name: form.hotelName, subdomain })
      .select()
      .single()
    if (hotelError) { setError(hotelError.message); setLoading(false); return }

    // 3. Link user to hotel as admin
    const { error: userError } = await supabase
      .from('hotel_users')
      .insert({
        hotel_id: hotel.id,
        user_id: authData.user.id,
        role: 'admin',
        full_name: form.email.split('@')[0],
        email: form.email
      })
    if (userError) { setError(userError.message); setLoading(false); return }

    // 4. Send to onboarding
    navigate('/onboarding')
    setLoading(false)
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-logo">
          <h1>HotelPlanner</h1>
          <p>Get started in minutes</p>
        </div>
        <form onSubmit={handleRegister} className="auth-form">
          <div className="form-group">
            <label>Hotel Name</label>
            <input
              name="hotelName"
              value={form.hotelName}
              onChange={handleChange}
              placeholder="Grand Hyatt Salt Lake City"
              required
            />
          </div>
          <div className="form-group">
            <label>Your Email</label>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              placeholder="you@hotel.com"
              required
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              placeholder="Min. 8 characters"
              minLength={8}
              required
            />
          </div>
          {error && <div className="auth-error">{error}</div>}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>
        <p className="auth-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
