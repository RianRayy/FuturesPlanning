// =============================================
// Live Dashboard Header
// Replaces "Morning Briefing" — updates in real
// time throughout the day, smart summary line
// reflects actual current state at any hour.
// =============================================

export default function DashboardHeader({
  userName,
  hotelName,
  hotCount,
  warmCount,
  pendingReplies,
  dueFollowUps,
  seasonalCount,
  hotSeasonalCount,
  warmSeasonalCount,
  rejectedCount,
  reachedCount,
  activeTab,
  onTabChange,
  activeFilter,
  seasonalFilter,
  onStatClick,
  onScrollTo,
  processing,
  newAlerts = {}
}) {
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = userName?.split(' ')[0] ?? 'there'

  // Smart summary — reflects actual state right now, not time of day
  function getSummary() {
    const parts = []
    if (pendingReplies > 0) parts.push(`${pendingReplies} ${pendingReplies === 1 ? 'reply' : 'replies'} waiting`)
    if (dueFollowUps > 0) parts.push(`${dueFollowUps} follow-up${dueFollowUps !== 1 ? 's' : ''} due`)
    if (rejectedCount > 0) parts.push(`${rejectedCount} pending decline${rejectedCount !== 1 ? 's' : ''}`)
    if (parts.length > 0) return parts.join(' · ')
    if (hotCount > 0) return `${hotCount} hot lead${hotCount !== 1 ? 's' : ''} ready to send`
    if (warmCount > 0) return `${warmCount} warm lead${warmCount !== 1 ? 's' : ''} worth a look`
    return 'All caught up — no urgent items right now'
  }

  return (
    <div className="dash-header">
      <div className="dash-header-top">
        <div className="dash-header-text">
          <h1>{greeting}, {firstName}.</h1>
          <p className="dash-summary">
            <span className={`live-dot ${processing ? 'live-dot-processing' : ''}`} title={processing ? 'Scoring new leads...' : 'Live'} />
            {processing ? 'Agent is scoring new leads...' : getSummary()}
          </p>
        </div>
        <div className="dash-header-meta">
          <div className="dash-hotel">{hotelName}</div>
          <div className="dash-date">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
        </div>
      </div>

      {/* Stat cards — tab-specific */}
      {activeTab === 'current' && (
        <div className="briefing-stats">
          <div
            className={`stat-card stat-hot stat-clickable ${activeFilter === 'hot' ? 'stat-active' : ''}`}
            onClick={() => onStatClick?.('hot')}
          >
            {newAlerts.hot && <span className="stat-alert-dot" title="New hot leads" />}
            <div className="stat-number">{hotCount}</div>
            <div className="stat-label">Hot Leads</div>
            <div className="stat-sub">Emails ready to send</div>
          </div>
          <div
            className={`stat-card stat-warm stat-clickable ${activeFilter === 'warm' ? 'stat-active' : ''}`}
            onClick={() => onStatClick?.('warm')}
          >
            {newAlerts.warm && <span className="stat-alert-dot" title="New warm leads" />}
            <div className="stat-number">{warmCount}</div>
            <div className="stat-label">Warm Leads</div>
            <div className="stat-sub">Worth a closer look</div>
          </div>
          <div
            className={`stat-card stat-replies stat-clickable ${activeFilter === 'replies' ? 'stat-active' : ''}`}
            onClick={() => onStatClick?.('replies')}
          >
            {newAlerts.replies && <span className="stat-alert-dot" title="New replies" />}
            <div className="stat-number">{pendingReplies}</div>
            <div className="stat-label">Replies Received</div>
            <div className="stat-sub">Responses drafted</div>
          </div>
          <div
            className={`stat-card stat-followups stat-clickable ${activeFilter === 'followups' ? 'stat-active' : ''}`}
            onClick={() => onStatClick?.('followups')}
          >
            {newAlerts.followups && <span className="stat-alert-dot" title="New follow-ups" />}
            <div className="stat-number">{dueFollowUps}</div>
            <div className="stat-label">Follow-ups Due</div>
            <div className="stat-sub">Due today</div>
          </div>
        </div>
      )}

      {activeTab === 'recruiting' && (
        <div className="briefing-stats">
          <div
            className={`stat-card stat-hot stat-clickable ${seasonalFilter === 'high' ? 'stat-active' : ''}`}
            onClick={() => onStatClick?.('high')}
          >
            <div className="stat-number">{hotSeasonalCount}</div>
            <div className="stat-label">Hot Seasonal Recruits</div>
            <div className="stat-sub">High repeat potential</div>
          </div>
          <div
            className={`stat-card stat-warm stat-clickable ${seasonalFilter === 'medium' ? 'stat-active' : ''}`}
            onClick={() => onStatClick?.('medium')}
          >
            <div className="stat-number">{warmSeasonalCount}</div>
            <div className="stat-label">Warm Recruits</div>
            <div className="stat-sub">Worth reaching out</div>
          </div>
          <div
            className={`stat-card stat-followups stat-clickable ${seasonalFilter === null ? 'stat-active' : ''}`}
            onClick={() => onStatClick?.(null)}
          >
            <div className="stat-number">{seasonalCount}</div>
            <div className="stat-label">Total Opportunities</div>
            <div className="stat-sub">Click to show all</div>
          </div>
        </div>
      )}

      {activeTab === 'rejected' && (
        <div className="briefing-stats">
          <div
            className="stat-card stat-rejected stat-clickable"
            onClick={() => onScrollTo?.('rejection-list')}
          >
            <div className="stat-number">{rejectedCount}</div>
            <div className="stat-label">Pending Declines</div>
            <div className="stat-sub">Click to review</div>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="briefing-tab-bar">
        <button
          className={`briefing-tab ${activeTab === 'current' ? 'briefing-tab-active' : ''}`}
          onClick={() => onTabChange('current')}
        >
          Current
          {(hotCount + warmCount + pendingReplies + dueFollowUps) > 0 && (
            <span className="briefing-tab-count">
              {hotCount + warmCount + pendingReplies + dueFollowUps}
            </span>
          )}
        </button>
        <button
          className={`briefing-tab briefing-tab-seasonal ${activeTab === 'recruiting' ? 'briefing-tab-active' : ''}`}
          onClick={() => onTabChange('recruiting')}
        >
          Recruiting
          {(seasonalCount ?? 0) > 0 && (
            <span className="briefing-tab-count count-seasonal">{seasonalCount}</span>
          )}
        </button>
        <button
          className={`briefing-tab briefing-tab-reached ${activeTab === 'reached' ? 'briefing-tab-active' : ''}`}
          onClick={() => onTabChange('reached')}
        >
          Reached
          {(reachedCount ?? 0) > 0 && (
            <span className="briefing-tab-count count-reached">{reachedCount}</span>
          )}
        </button>
        <button
          className={`briefing-tab briefing-tab-rejected ${activeTab === 'rejected' ? 'briefing-tab-active' : ''}`}
          onClick={() => onTabChange('rejected')}
        >
          Rejected
          {(rejectedCount ?? 0) > 0 && (
            <span className="briefing-tab-count count-rejected">{rejectedCount}</span>
          )}
        </button>
      </div>
    </div>
  )
}
