import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { format } from 'date-fns'

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1'

// Public branded proposal page — planners land here from the
// "View Your Full Proposal" link in the hotel's email.
// No auth: the lead UUID in the URL is the access token.
export default function ProposalPage() {
  const { leadId } = useParams()
  const [proposal, setProposal] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch(`${FUNCTIONS_URL}/get-proposal?lid=${leadId}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) setError(data.error)
        else setProposal(data)
      })
      .catch(() => setError('Could not load proposal'))
  }, [leadId])

  if (error) {
    return (
      <div className="proposal-page">
        <div className="proposal-card">
          <h2>Proposal not available</h2>
          <p className="proposal-error-note">
            This proposal link may have expired or is no longer active.
          </p>
        </div>
      </div>
    )
  }

  if (!proposal) {
    return (
      <div className="proposal-page">
        <div className="loading-spinner" />
      </div>
    )
  }

  const nights =
    proposal.check_in && proposal.check_out
      ? Math.round(
          (new Date(proposal.check_out) - new Date(proposal.check_in)) / (1000 * 60 * 60 * 24)
        )
      : null

  return (
    <div className="proposal-page">
      <div className="proposal-card">
        <div className="proposal-hotel-header">
          <h1>{proposal.hotel_name}</h1>
          <span className="proposal-tagline">Group Proposal</span>
        </div>

        <div className="proposal-greeting">
          Prepared for <strong>{proposal.contact_name}</strong>
          {proposal.company && <> · {proposal.company}</>}
        </div>

        {/* Event summary */}
        <div className="proposal-summary">
          {proposal.event_type && (
            <div className="proposal-stat">
              <span className="proposal-stat-label">Event</span>
              <span className="proposal-stat-value">{proposal.event_type}</span>
            </div>
          )}
          {proposal.group_size && (
            <div className="proposal-stat">
              <span className="proposal-stat-label">Rooms</span>
              <span className="proposal-stat-value">{proposal.group_size}</span>
            </div>
          )}
          {proposal.check_in && (
            <div className="proposal-stat">
              <span className="proposal-stat-label">Dates</span>
              <span className="proposal-stat-value">
                {format(new Date(proposal.check_in), 'MMM d')}
                {proposal.check_out ? ` – ${format(new Date(proposal.check_out), 'MMM d, yyyy')}` : ''}
                {nights ? ` · ${nights} night${nights !== 1 ? 's' : ''}` : ''}
              </span>
            </div>
          )}
          {proposal.bid_rate && (
            <div className="proposal-stat proposal-stat-rate">
              <span className="proposal-stat-label">Your Group Rate</span>
              <span className="proposal-stat-value">${proposal.bid_rate}/night</span>
            </div>
          )}
        </div>

        {/* The proposal letter */}
        <div className="proposal-body">{proposal.body}</div>

        {proposal.hotel_description && (
          <div className="proposal-about">
            <h3>About {proposal.hotel_name}</h3>
            <p>{proposal.hotel_description}</p>
          </div>
        )}

        {proposal.hotel_email && (
          <div className="proposal-cta">
            <a
              className="proposal-cta-btn"
              href={`mailto:${proposal.hotel_email}?subject=${encodeURIComponent('Re: ' + (proposal.subject ?? 'Your Group Proposal'))}`}
            >
              Reply to {proposal.hotel_name}
            </a>
            <p className="proposal-cta-note">Questions? We'd love to hear from you.</p>
          </div>
        )}
      </div>

      <div className="proposal-footer">
        Powered by FuturesPlanning
      </div>
    </div>
  )
}
