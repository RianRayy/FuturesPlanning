import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Login from './components/auth/Login'
import Register from './components/auth/Register'
import Dashboard from './components/dashboard/Dashboard'
import LeadDetail from './components/leads/LeadDetail'
import Onboarding from './components/onboarding/Onboarding'
import Profile from './components/profile/Profile'
import OAuthCallback from './components/connections/OAuthCallback'
import ProposalPage from './components/proposal/ProposalPage'
import InquiryForm from './components/proposal/InquiryForm'
import './index.css'

function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={!session ? <Login /> : <Navigate to="/dashboard" />} />
        <Route path="/register" element={!session ? <Register /> : <Navigate to="/dashboard" />} />
        <Route path="/onboarding" element={session ? <Onboarding /> : <Navigate to="/login" />} />
        <Route path="/dashboard" element={session ? <Dashboard /> : <Navigate to="/login" />} />
        <Route path="/leads/:id" element={session ? <LeadDetail /> : <Navigate to="/login" />} />
        <Route path="/profile" element={session ? <Profile /> : <Navigate to="/login" />} />
        <Route path="/oauth/callback/:provider" element={<OAuthCallback />} />
        {/* Public pages — no auth, accessed by planners */}
        <Route path="/p/:leadId" element={<ProposalPage />} />
        <Route path="/inquiry/:hotelId" element={<InquiryForm />} />
        <Route path="*" element={<Navigate to={session ? "/dashboard" : "/login"} />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
