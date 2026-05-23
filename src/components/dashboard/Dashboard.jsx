import { useEffect, useState } from 'react'
import { supabase } from '../../supabase'
import { processPendingLeads } from '../../agent/decide'
import LeadCard from '../leads/LeadCard'
import MorningBriefing from './MorningBriefing'
import FollowUpSection from './FollowUpSection'
import ReplySection from './ReplySection'

const LAST_VISIT_KEY = 'hp_last_visit_date'

export default function Dashboard() {
  const [hotelId, setHotelId] = useState(null)
  const [hotelName, setHotelName] = useState('')
  const [userName, setUserName] = useState('')
  const [leads, setLeads] = useState([])
  const [followUps, setFollowUps] = useState([])
  const [replyDrafts, setReplyDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [isFirstVisitToday, setIsFirstVisitToday] = useState(false)

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    setLoading(true)

    // Get current user's hotel
    const { data: { user } } = await supabase.auth.getUser()
    const { data: hotelUser } = await supabase
      .from('hotel_users')
      .select('hotel_id, full_name, hotels(name)')
      .eq('user_id', user.id)
      .single()

    if (!hotelUser) { setLoading(false); return }

    const hid = hotelUser.hotel_id
    setHotelId(hid)
    setHotelName(hotelUser.hotels?.name ?? '')
    setUserName(hotelUser.full_name ?? 'there')

    // Check if this is the first visit today
    const today = new Date().toDateString()
    const lastVisit = localStorage.getItem(LAST_VISIT_KEY)
    const firstToday = lastVisit !== today
    setIsFirstVisitToday(firstToday)
    if (firstToday) {
      localStorage.setItem(LAST_VISIT_KEY, today)
      // Process any pending leads that came in overnight
      await runMorningProcessing(hid)
    }

    await Promise.all([
      loadLeads(hid),
      loadFollowUps(hid),
      loadReplyDrafts(hid)
    ])

    setLoading(false)
  }

  async function runMorningProcessing(hid) {
    setProcessing(true)
    try {
      await processPendingLeads(hid)
    } catch (err) {
      console.error('Morning processing error:', err)
    }
    setProcessing(false)
  }

  async function loadLeads(hid) {
    const { data } = await supabase
      .from('leads')
      .select(`
        *,
        lead_decisions(score, reasoning, draft_subject, draft_body, sent_at)
      `)
      .eq('hotel_id', hid)
      .eq('status', 'processed')
      .order('created_at', { ascending: false })
      .limit(50)

    if (data) setLeads(data)
  }

  async function loadFollowUps(hid) {
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase
      .from('follow_up_queue')
      .select('*, leads(contact_name, event_type, group_size)')
      .eq('hotel_id', hid)
      .eq('status', 'pending')
      .lte('scheduled_for', today)
      .order('scheduled_for', { ascending: true })

    if (data) setFollowUps(data)
  }

  async function loadReplyDrafts(hid) {
    const { data } = await supabase
      .from('reply_drafts')
      .select('*, leads(contact_name, event_type)')
      .eq('hotel_id', hid)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (data) setReplyDrafts(data)
  }

  // Separate leads into top 5 hot and the rest
  const sortedLeads = [...leads].sort((a, b) => {
    const scoreOrder = { hot: 0, warm: 1, cold: 2 }
    const aScore = a.lead_decisions?.score ?? 'cold'
    const bScore = b.lead_decisions?.score ?? 'cold'
    return scoreOrder[aScore] - scoreOrder[bScore]
  })

  const top5 = sortedLeads.filter(l => !l.lead_decisions?.sent_at).slice(0, 5)
  const remaining = sortedLeads.filter(l => !l.lead_decisions?.sent_at).slice(5)
  const [showRemaining, setShowRemaining] = useState(false)
  const [generatingRest, setGeneratingRest] = useState(false)

  async function handleGenerateRest() {
    setGeneratingRest(true)
    if (hotelId) {
      // Re-process any remaining pending leads
      await runMorningProcessing(hotelId)
      await loadLeads(hotelId)
    }
    setShowRemaining(true)
    setGeneratingRest(false)
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>{processing ? 'Agent is processing overnight leads...' : 'Loading your dashboard...'}</p>
      </div>
    )
  }

  const hotCount = leads.filter(l => l.lead_decisions?.score === 'hot').length
  const warmCount = leads.filter(l => l.lead_decisions?.score === 'warm').length
  const pendingReplies = replyDrafts.length
  const dueFollowUps = followUps.length

  return (
    <div className="dashboard">
      {/* Morning Briefing Banner */}
      <MorningBriefing
        userName={userName}
        hotelName={hotelName}
        hotCount={hotCount}
        warmCount={warmCount}
        pendingReplies={pendingReplies}
        dueFollowUps={dueFollowUps}
        isFirstVisitToday={isFirstVisitToday}
      />

      <div className="dashboard-content">
        {/* Reply Drafts — highest urgency, lead already responded */}
        {replyDrafts.length > 0 && (
          <ReplySection
            replyDrafts={replyDrafts}
            onUpdate={() => loadReplyDrafts(hotelId)}
          />
        )}

        {/* Follow-ups due today */}
        {followUps.length > 0 && (
          <FollowUpSection
            followUps={followUps}
            onUpdate={() => loadFollowUps(hotelId)}
          />
        )}

        {/* Top 5 leads with pre-drafted emails */}
        <section className="leads-section">
          <div className="section-header">
            <h2>Top Leads — Emails Ready to Send</h2>
            <span className="section-badge">{top5.length} ready</span>
          </div>

          {top5.length === 0 && (
            <div className="empty-state">
              <p>No new leads to review. Check back later or manually add a lead.</p>
            </div>
          )}

          <div className="leads-grid">
            {top5.map(lead => (
              <LeadCard
                key={lead.id}
                lead={lead}
                onUpdate={() => loadLeads(hotelId)}
              />
            ))}
          </div>

          {/* Generate emails for the rest */}
          {remaining.length > 0 && !showRemaining && (
            <div className="generate-rest">
              <p>{remaining.length} more leads waiting</p>
              <button
                className="btn-secondary"
                onClick={handleGenerateRest}
                disabled={generatingRest}
              >
                {generatingRest
                  ? 'Agent is working...'
                  : `Generate emails for remaining ${remaining.length} leads`}
              </button>
            </div>
          )}

          {showRemaining && remaining.length > 0 && (
            <>
              <div className="section-divider">
                <span>Remaining Leads</span>
              </div>
              <div className="leads-grid">
                {remaining.map(lead => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    onUpdate={() => loadLeads(hotelId)}
                  />
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
