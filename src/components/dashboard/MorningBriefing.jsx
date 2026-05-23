export default function MorningBriefing({
  userName,
  hotelName,
  hotCount,
  warmCount,
  pendingReplies,
  dueFollowUps,
  isFirstVisitToday
}) {
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const firstName = userName?.split(' ')[0] ?? 'there'

  return (
    <div className="morning-briefing">
      <div className="briefing-header">
        <div className="briefing-text">
          <h1>{greeting}, {firstName}.</h1>
          <p className="briefing-subtitle">{hotelName} — Here is your sales briefing</p>
        </div>
        <div className="briefing-date">
          {new Date().toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric'
          })}
        </div>
      </div>

      <div className="briefing-stats">
        <div className="stat-card stat-hot">
          <div className="stat-number">{hotCount}</div>
          <div className="stat-label">Hot Leads</div>
          <div className="stat-sub">Emails ready to send</div>
        </div>
        <div className="stat-card stat-warm">
          <div className="stat-number">{warmCount}</div>
          <div className="stat-label">Warm Leads</div>
          <div className="stat-sub">Worth a closer look</div>
        </div>
        <div className="stat-card stat-replies">
          <div className="stat-number">{pendingReplies}</div>
          <div className="stat-label">Replies Received</div>
          <div className="stat-sub">Responses drafted</div>
        </div>
        <div className="stat-card stat-followups">
          <div className="stat-number">{dueFollowUps}</div>
          <div className="stat-label">Follow-ups Due</div>
          <div className="stat-sub">Due today</div>
        </div>
      </div>

      {isFirstVisitToday && (hotCount + warmCount + pendingReplies + dueFollowUps) === 0 && (
        <div className="briefing-clear">
          All caught up. No new leads to review today.
        </div>
      )}
    </div>
  )
}
