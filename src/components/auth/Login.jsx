import { useState } from 'react'
import { supabase } from '../../supabase'
import { Link } from 'react-router-dom'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showForgot, setShowForgot] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  async function handleForgotPassword(e) {
    e.preventDefault()
    if (!email) { setError('Enter your email above first'); return }
    setResetLoading(true)
    setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`
    })
    if (error) setError(error.message)
    else setResetSent(true)
    setResetLoading(false)
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-logo">
          <h1>FuturesPlanning</h1>
          <p>Sales Intelligence Platform</p>
        </div>

        <form onSubmit={handleLogin} className="auth-form">
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@hotel.com"
              autoComplete="email"
              required
            />
          </div>
          <div className="form-group">
            <div className="auth-label-row">
              <label>Password</label>
              <button
                type="button"
                className="auth-forgot-link"
                onClick={() => setShowForgot(f => !f)}
              >
                Forgot password?
              </button>
            </div>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>

          {showForgot && (
            <div className="forgot-panel">
              {resetSent ? (
                <p className="reset-sent">
                  ✓ Reset link sent to <strong>{email}</strong> — check your inbox.
                </p>
              ) : (
                <>
                  <p className="forgot-desc">
                    We'll send a reset link to the email above.
                  </p>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={handleForgotPassword}
                    disabled={resetLoading}
                  >
                    {resetLoading ? 'Sending...' : 'Send reset link'}
                  </button>
                </>
              )}
            </div>
          )}

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="auth-footer">
          New hotel? <Link to="/register">Create an account</Link>
        </p>
      </div>
    </div>
  )
}
