import { useState } from 'react'
import { supabase } from '../../supabase'
import ConnectionsTab from './ConnectionsTab'

export default function ConnectPlatformsModal({ hotelId, userId, onDismiss }) {
  const [connectionCount, setConnectionCount] = useState(0)

  async function handleDismiss() {
    // Mark as dismissed so modal doesn't show again
    await supabase
      .from('hotel_users')
      .update({ setup_dismissed: true })
      .eq('user_id', userId)
    onDismiss()
  }

  return (
    <div className="modal-overlay">
      <div className="connect-modal">
        <div className="connect-modal-header">
          <div>
            <h2>Connect your lead platforms</h2>
            <p className="connect-modal-sub">
              FuturesPlanning pulls leads from every platform you're on, scores them together,
              and surfaces the best ones — no matter where they came from.
            </p>
          </div>
          <button className="modal-close" onClick={handleDismiss} title="Skip for now">✕</button>
        </div>

        {connectionCount > 0 && (
          <div className="connect-modal-progress">
            <span className="connect-progress-dot" />
            {connectionCount} platform{connectionCount !== 1 ? 's' : ''} connected
          </div>
        )}

        <div className="connect-modal-body">
          <ConnectionsTab
            hotelId={hotelId}
            onConnectionChange={() => setConnectionCount(c => c + 1)}
          />
        </div>

        <div className="connect-modal-footer">
          {connectionCount > 0 ? (
            <button className="btn-primary" onClick={handleDismiss}>
              Done — Go to Dashboard
            </button>
          ) : (
            <button className="btn-ghost" onClick={handleDismiss}>
              Skip for now
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
