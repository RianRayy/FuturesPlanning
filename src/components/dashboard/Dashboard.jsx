import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../../supabase'
import { processPendingLeads, declineLead } from '../../agent/decide'
import { runSeasonalAnalysis } from '../../agent/seasonal'
import { ingestAllPlatforms } from '../../integrations'
import LeadCard from '../leads/LeadCard'
import DashboardHeader from './DashboardHeader'
import FollowUpSection from './FollowUpSection'
import ReplySection from './ReplySection'
import SeasonalSection from './SeasonalSection'
import RejectionSection from './RejectionSection'
import NavBar from '../shared/NavBar'
import ConnectPlatformsModal from '../connections/ConnectPlatformsModal'

export default function Dashboard() {
  const [hotelId, setHotelId] = useState(null)
  const [hotelName, setHotelName] = useState('')
  const [userName, setUserName] = useState('')
  const [leads, setLeads] = useState([])
  const [followUps, setFollowUps] = useState([])
  const [replyDrafts, setReplyDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [showRemaining, setShowRemaining] = useState(false)
  const [generatingRest, setGeneratingRest] = useState(false)
  const [activeTab, setActiveTab] = useState('current')
  const [activeFilter, setActiveFilter] = useState(null)
  const [seasonalFilter, setSeasonalFilter] = useState(null)
  const [seasonalOutreach, setSeasonalOutreach] = useState([])
  const [rejectedLeads, setRejectedLeads] = useState([])
  const [reachedLeads, setReachedLeads] = useState([])
  const [notifications, setNotifications] = useState([])
  const [toast, setToast] = useState(null)
  const [showConnectModal, setShowConnectModal] = useState(false)
  const [hasConnections, setHasConnections] = useState(true)
  const [userId, setUserId] = useState(null)
  const [newAlerts, setNewAlerts] = useState({ hot: false, warm: false, replies: false, followups: false })
  const prevTop5Ref = useRef([])
  const hotelIdRef = useRef(null)

  useEffect(() => {
    loadDashboard()
  }, [])

  // Scroll to relevant section whenever activeFilter changes
  useEffect(() => {
    if (activeFilter === null) return
    const sectionId =
      activeFilter === 'replies'   ? 'replies-section'   :
      activeFilter === 'followups' ? 'followups-section' :
      'leads-section'
    const el = document.getElementById(sectionId)
    if (el) {
      setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
    }
  }, [activeFilter])

  async function loadDashboard() {
    setLoading(true)

    const { data: { user } } = await supabase.auth.getUser()
    const { data: hotelUser } = await supabase
      .from('hotel_users')
      .select('hotel_id, full_name, hotels(name)')
      .eq('user_id', user.id)
      .single()

    if (!hotelUser) { setLoading(false); return }

    const hid = hotelUser.hotel_id
    hotelIdRef.current = hid
    setHotelId(hid)
    setHotelName(hotelUser.hotels?.name ?? '')
    setUserName(hotelUser.full_name ?? 'there')
    setUserId(user.id)

    // Check connections + whether to show setup modal
    const { data: connections } = await supabase
      .from('crm_connections')
      .select('id')
      .eq('hotel_id', hid)

    const connected = (connections?.length ?? 0) > 0
    setHasConnections(connected)

    // Show modal if no connections and they haven't dismissed it before
    if (!connected && !hotelUser.setup_dismissed) {
      setShowConnectModal(true)
    }

    // Load dashboard immediately
    await Promise.all([
      loadLeads(hid),
      loadFollowUps(hid),
      loadReplyDrafts(hid),
      loadSeasonalOutreach(hid),
      loadRejectedLeads(hid)
    ])

    setLoading(false)

    // Subscribe to real-time lead decision changes
    setupRealtimeSubscription(hid)

    // Pull new leads from all connected platforms, then score them —
    // Delphi, Salesforce, HubSpot, Cvent, HotelPlanner all run in parallel
    ingestAllPlatforms(hid)
      .then(() => runProcessing(hid))
      .catch(err => console.error('Platform ingestion error:', err))

    // Run seasonal analysis in the background
    runSeasonalAnalysis(hid)
      .then(() => loadSeasonalOutreach(hid))
      .catch(err => console.error('Seasonal analysis error:', err))
  }

  function pushNotification(type, title, body) {
    const notif = { id: Date.now(), type, title, body, timestamp: new Date(), read: false }
    setNotifications(prev => [notif, ...prev].slice(0, 50)) // keep last 50
    setToast({ title, body })
    setTimeout(() => setToast(null), 5000)
  }

  function setupRealtimeSubscription(hid) {
    const channel = supabase
      .channel(`lead-decisions-${hid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lead_decisions', filter: `hotel_id=eq.${hid}` },
        async () => {
          // A lead was scored or updated — reload and check top-5 changes
          const currentHid = hotelIdRef.current
          if (!currentHid) return
          await loadLeadsAndDetectChanges(currentHid)
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'reply_drafts', filter: `hotel_id=eq.${hid}` },
        async () => {
          const currentHid = hotelIdRef.current
          if (!currentHid) return
          await loadReplyDrafts(currentHid)
          setNewAlerts(prev => ({ ...prev, replies: true }))
          pushNotification('reply', 'New reply received', 'A lead has replied — response draft is ready.')
        }
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }

  async function loadLeadsAndDetectChanges(hid) {
    const { data } = await supabase
      .from('leads')
      .select(`*, lead_decisions(score, reasoning, draft_subject, draft_body, sent_at)`)
      .eq('hotel_id', hid)
      .eq('status', 'processed')
      .order('created_at', { ascending: false })
      .limit(50)

    if (!data) return
    setLeads(data)
    const twoMonthsAgo = new Date()
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2)
    setReachedLeads(data.filter(l =>
      l.lead_decisions?.sent_at &&
      new Date(l.lead_decisions.sent_at) >= twoMonthsAgo
    ))

    // Build new top 5 (same sort logic as below)
    const sorted = [...data].sort((a, b) => {
      const order = { hot: 0, warm: 1, cold: 2 }
      return (order[a.lead_decisions?.score ?? 'cold'] ?? 2) - (order[b.lead_decisions?.score ?? 'cold'] ?? 2)
    })
    const unsent = sorted.filter(l => !l.lead_decisions?.sent_at && l.lead_decisions?.score)
    const newTop5 = unsent.slice(0, 5)
    const newTop5Ids = newTop5.map(l => l.id)
    const prevTop5Ids = prevTop5Ref.current

    if (prevTop5Ids.length > 0) {
      const newEntrants = newTop5.filter(l => !prevTop5Ids.includes(l.id))
      const bumped = prevTop5Ids.filter(id => !newTop5Ids.includes(id))

      if (newEntrants.length > 0) {
        const names = newEntrants.map(l => l.contact_name || 'A lead').join(', ')
        const score = newEntrants[0].lead_decisions?.score
        const scoreLabel = score === 'hot' ? '🔴 Hot' : score === 'warm' ? '🟡 Warm' : ''
        pushNotification(
          'rank_change',
          `${scoreLabel} lead entered your Top 5`,
          `${names} just moved up${bumped.length > 0 ? ' — ranking adjusted' : ''}`
        )

        // Light up alert dots on the relevant stat cards
        const hasNewHot  = newEntrants.some(l => l.lead_decisions?.score === 'hot')
        const hasNewWarm = newEntrants.some(l => l.lead_decisions?.score === 'warm')
        setNewAlerts(prev => ({
          ...prev,
          ...(hasNewHot  ? { hot:  true } : {}),
          ...(hasNewWarm ? { warm: true } : {})
        }))
      }
    }

    prevTop5Ref.current = newTop5Ids
  }

  async function runProcessing(hid) {
    setProcessing(true)
    try {
      await processPendingLeads(hid)
      // Refresh leads after processing completes
      await loadLeads(hid)
    } catch (err) {
      console.error('Lead processing error:', err)
      setToast({ title: 'Agent error', body: 'Some leads could not be scored right now. They will retry on next refresh.' })
      setTimeout(() => setToast(null), 6000)
    }
    setProcessing(false)
  }

  async function loadLeads(hid) {
    const { data } = await supabase
      .from('leads')
      .select(`*, lead_decisions(score, reasoning, draft_subject, draft_body, sent_at)`)
      .eq('hotel_id', hid)
      .eq('status', 'processed')
      .order('created_at', { ascending: false })
      .limit(50)

    if (data) {
      setLeads(data)
      // Seed the ref on first load so we don't false-trigger on startup
      if (prevTop5Ref.current.length === 0) {
        const sorted = [...data].sort((a, b) => {
          const order = { hot: 0, warm: 1, cold: 2 }
          return (order[a.lead_decisions?.score ?? 'cold'] ?? 2) - (order[b.lead_decisions?.score ?? 'cold'] ?? 2)
        })
        const unsent = sorted.filter(l => !l.lead_decisions?.sent_at && l.lead_decisions?.score)
        prevTop5Ref.current = unsent.slice(0, 5).map(l => l.id)
      }
    }
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

  async function loadSeasonalOutreach(hid) {
    const { data } = await supabase
      .from('seasonal_outreach')
      .select('*, leads(contact_name, company, event_type, group_size, budget_per_night, outcome, dates_requested)')
      .eq('hotel_id', hid)
      .eq('status', 'pending')
      .order('potential_score', { ascending: false })
    if (data) setSeasonalOutreach(data)
  }

  async function loadRejectedLeads(hid) {
    const { data } = await supabase
      .from('leads')
      .select(`
        *,
        lead_decisions(auto_rejected, rejection_reason, rejection_draft_subject, rejection_draft_body, declined_at)
      `)
      .eq('hotel_id', hid)
      .eq('status', 'processed')
      .order('created_at', { ascending: false })

    // Only show auto-rejected leads that haven't been declined/dismissed yet
    const rejected = (data ?? []).filter(
      l => l.lead_decisions?.auto_rejected && !l.lead_decisions?.declined_at
    )
    setRejectedLeads(rejected)
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

  const sortedLeads = [...leads].sort((a, b) => {
    const scoreOrder = { hot: 0, warm: 1, cold: 2 }
    const aScore = a.lead_decisions?.score ?? 'cold'
    const bScore = b.lead_decisions?.score ?? 'cold'
    return scoreOrder[aScore] - scoreOrder[bScore]
  })

  const unsent = sortedLeads.filter(l => !l.lead_decisions?.sent_at)
  const filteredUnsent = activeFilter
    ? unsent.filter(l => l.lead_decisions?.score === activeFilter)
    : unsent
  const top5 = filteredUnsent.slice(0, 5)
  const remaining = filteredUnsent.slice(5)

  function handleStatClick(filter) {
    if (activeTab === 'current') {
      setActiveFilter(prev => prev === filter ? null : filter)
      // Clear the alert dot for the card the user just clicked
      if (filter && filter in newAlerts) {
        setNewAlerts(prev => ({ ...prev, [filter]: false }))
      }
    } else if (activeTab === 'recruiting') {
      setSeasonalFilter(prev => prev === filter ? null : filter)
    }
  }

  function handleScrollTo(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function handleGenerateRest() {
    setGeneratingRest(true)
    if (hotelId) {
      await runProcessing(hotelId)
      await loadLeads(hotelId)
    }
    setShowRemaining(true)
    setGeneratingRest(false)
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Loading your dashboard...</p>
      </div>
    )
  }

  const hotCount = leads.filter(l => l.lead_decisions?.score === 'hot').length
  const warmCount = leads.filter(l => l.lead_decisions?.score === 'warm').length
  const pendingReplies = replyDrafts.length
  const dueFollowUps = followUps.length
  const seasonalCount = seasonalOutreach.length
  const hotSeasonalCount = seasonalOutreach.filter(s => s.score_label === 'high').length
  const warmSeasonalCount = seasonalOutreach.filter(s => s.score_label === 'medium').length
  const rejectedCount = rejectedLeads.length

  return (
    <div className="dashboard">
      <NavBar
        hotelName={hotelName}
        userName={userName}
        notifications={notifications}
        hasConnections={hasConnections}
        onMarkAllRead={() => setNotifications(prev => prev.map(n => ({ ...n, read: true })))}
      />

      {showConnectModal && (
        <ConnectPlatformsModal
          hotelId={hotelId}
          userId={userId}
          onDismiss={() => {
            setShowConnectModal(false)
            // Re-check connections after dismissing
            supabase.from('crm_connections').select('id').eq('hotel_id', hotelId)
              .then(({ data }) => setHasConnections((data?.length ?? 0) > 0))
          }}
        />
      )}

      {toast && (
        <div className="toast-notification" onClick={() => setToast(null)}>
          <div className="toast-title">{toast.title}</div>
          <div className="toast-body">{toast.body}</div>
        </div>
      )}

      <DashboardHeader
        userName={userName}
        hotelName={hotelName}
        hotCount={hotCount}
        warmCount={warmCount}
        pendingReplies={pendingReplies}
        dueFollowUps={dueFollowUps}
        seasonalCount={seasonalCount}
        hotSeasonalCount={hotSeasonalCount}
        warmSeasonalCount={warmSeasonalCount}
        rejectedCount={rejectedCount}
        reachedCount={reachedLeads.length}
        activeTab={activeTab}
        onTabChange={(tab) => { setActiveTab(tab); setActiveFilter(null); setSeasonalFilter(null) }}
        activeFilter={activeFilter}
        seasonalFilter={seasonalFilter}
        onStatClick={handleStatClick}
        onScrollTo={handleScrollTo}
        processing={processing}
        newAlerts={newAlerts}
      />

      <div className="dashboard-content">
        {/* CURRENT TAB — replies section (only when filter is 'replies' or no filter) */}
        {activeTab === 'current' && (activeFilter === 'replies' || activeFilter === null) && (
          replyDrafts.length > 0
            ? <div id="replies-section">
                <ReplySection replyDrafts={replyDrafts} onUpdate={() => loadReplyDrafts(hotelId)} />
              </div>
            : activeFilter === 'replies'
              ? <div className="empty-state"><p>You're all caught up — no replies waiting right now.</p></div>
              : null
        )}

        {/* CURRENT TAB — follow-ups section (only when filter is 'followups' or no filter) */}
        {activeTab === 'current' && (activeFilter === 'followups' || activeFilter === null) && (
          followUps.length > 0
            ? <div id="followups-section">
                <FollowUpSection followUps={followUps} onUpdate={() => loadFollowUps(hotelId)} />
              </div>
            : activeFilter === 'followups'
              ? <div className="empty-state"><p>Nothing due today — you're ahead of the game.</p></div>
              : null
        )}

        {/* REACHED TAB */}
        {activeTab === 'reached' && (
          reachedLeads.length > 0
            ? <div className="reached-section">
                <div className="section-header">
                  <div>
                    <h2>✉ Reached Out</h2>
                    <p className="section-subheader">Leads contacted in the last 2 months — {reachedLeads.length} total</p>
                  </div>
                </div>
                <div className="leads-grid">
                  {reachedLeads.map(lead => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      hotelId={hotelId}
                      onUpdate={() => loadLeadsAndDetectChanges(hotelId)}
                      onDecline={handleDecline}
                    />
                  ))}
                </div>
              </div>
            : <div className="empty-state">
                <p>No leads reached out to yet — approve and send your first email to see them here.</p>
              </div>
        )}

        {/* REJECTED TAB */}
        {activeTab === 'rejected' && (
          rejectedLeads.length > 0
            ? <RejectionSection
                rejectedLeads={rejectedLeads}
                onUpdate={() => loadRejectedLeads(hotelId)}
              />
            : <div className="empty-state">
                <p>Nothing here to tackle — no groups have been flagged for rejection.</p>
              </div>
        )}

        {/* RECRUITING TAB */}
        {activeTab === 'recruiting' && (
          seasonalOutreach.length > 0
            ? <SeasonalSection
                outreachList={seasonalOutreach}
                scoreFilter={seasonalFilter}
                onClearFilter={() => setSeasonalFilter(null)}
                onUpdate={() => loadSeasonalOutreach(hotelId)}
              />
            : <div className="empty-state">
                <p>Nothing here yet — check back as past booking windows come around.</p>
              </div>
        )}

        {/* LEADS — only show on current tab when not filtering by replies/followups */}
        {activeTab === 'current' && activeFilter !== 'replies' && activeFilter !== 'followups' && <section className="leads-section" id="leads-section">
          <div className="section-header">
            <div>
              <h2>
                {activeFilter === 'hot'  ? '🔴 Hot Leads' :
                 activeFilter === 'warm' ? '🟡 Warm Leads' :
                 'Top Leads — Emails Ready to Send'}
              </h2>
              <p className="section-subheader">Ranked by score across all connected platforms — Delphi, Salesforce, HubSpot, Cvent, HotelPlanner & more</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {activeFilter && !['replies', 'followups'].includes(activeFilter) && (
                <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setActiveFilter(null)}>
                  Show all
                </button>
              )}
              <span className="section-badge">{filteredUnsent.length} total</span>
            </div>
          </div>

          {top5.length === 0 && (
            <div className="empty-state">
              <p>
                {activeFilter === 'hot'  ? 'No hot leads right now — check back soon.' :
                 activeFilter === 'warm' ? 'No warm leads at the moment. Onto the next.' :
                 'No new leads to review. New leads will appear here automatically.'}
              </p>
            </div>
          )}

          <div className="leads-grid">
            {top5.map(lead => (
              <LeadCard
                key={lead.id}
                lead={lead}
                hotelId={hotelId}
                onUpdate={() => { loadLeads(hotelId); loadRejectedLeads(hotelId) }}
                onDecline={declineLead}
              />
            ))}
          </div>

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
                    hotelId={hotelId}
                    onUpdate={() => { loadLeads(hotelId); loadRejectedLeads(hotelId) }}
                    onDecline={declineLead}
                  />
                ))}
              </div>
            </>
          )}
        </section>}
      </div>
    </div>
  )
}
