import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabase'

export default function NavBar({ hotelName, userName, notifications = [], onMarkAllRead, hasConnections = true }) {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [notifsOpen, setNotifsOpen] = useState(false)
  const menuRef = useRef(null)
  const notifRef = useRef(null)

  const unreadCount = notifications.filter(n => !n.read).length

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const displayName = userName || 'No name set'
  const initials = userName
    ? userName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : '?'

  function formatTime(date) {
    return new Date(date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  const notifIcon = {
    rank_change: '🔀',
    reply:       '💬',
    followup:    '📅',
    new_hot:     '🔴'
  }

  return (
    <nav className="navbar">
      <div className="navbar-left">
        <span className="navbar-logo" onClick={() => navigate('/dashboard')}>
          FuturesPlanning
        </span>
        {hotelName && <span className="navbar-hotel">{hotelName}</span>}
      </div>

      <div className="navbar-right" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>

        {/* Notification bell */}
        <div className="notif-wrapper" ref={notifRef}>
          <button
            className="notif-bell"
            onClick={() => { setNotifsOpen(o => !o); if (!notifsOpen) onMarkAllRead?.() }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            {unreadCount > 0 && (
              <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
            )}
          </button>

          {notifsOpen && (
            <div className="notif-dropdown">
              <div className="notif-dropdown-header">
                <span>Notifications</span>
                {notifications.length > 0 && (
                  <button className="notif-clear" onClick={() => { onMarkAllRead?.(); setNotifsOpen(false) }}>
                    Mark all read
                  </button>
                )}
              </div>
              {notifications.length === 0 ? (
                <div className="notif-empty">No notifications yet</div>
              ) : (
                <div className="notif-list">
                  {notifications.map(n => (
                    <div key={n.id} className={`notif-item ${n.read ? 'notif-read' : ''}`}>
                      <span className="notif-icon">{notifIcon[n.type] ?? '📌'}</span>
                      <div className="notif-content">
                        <div className="notif-title">{n.title}</div>
                        <div className="notif-body">{n.body}</div>
                        <div className="notif-time">{formatTime(n.timestamp)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Avatar / profile menu */}
        <div ref={menuRef}>
          <button className="navbar-avatar" onClick={() => setMenuOpen(o => !o)}>
            {initials}
            {!hasConnections && <span className="avatar-alert-dot" title="Connect your platforms" />}
          </button>

          {menuOpen && (
            <div className="navbar-dropdown">
              <div className="dropdown-header">
                <div className="dropdown-name">{displayName}</div>
                <div className="dropdown-hotel">{hotelName}</div>
              </div>
              <div className="dropdown-divider" />
              <button className="dropdown-item" onClick={() => { navigate('/profile'); setMenuOpen(false) }}>
                Profile & Settings
              </button>
              <button className="dropdown-item" onClick={() => { navigate('/profile?tab=connections'); setMenuOpen(false) }}>
                <span style={{ flex: 1 }}>Connections</span>
                {!hasConnections && <span className="dropdown-alert-dot" />}
              </button>
              <button className="dropdown-item" onClick={() => { navigate('/onboarding'); setMenuOpen(false) }}>
                Hotel Setup
              </button>
              <div className="dropdown-divider" />
              <button className="dropdown-item dropdown-signout" onClick={handleSignOut}>
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}
