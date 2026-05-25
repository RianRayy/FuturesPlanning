// =============================================
// Agent Prompt Templates
// =============================================

/**
 * Builds the system prompt for the lead scoring + draft agent.
 * Injects hotel profile so the agent understands what this hotel cares about.
 */
export function buildScoringSystemPrompt(hotelProfile) {
  return `You are a hotel sales assistant for ${hotelProfile.hotel_name}, a ${hotelProfile.room_count}-room property.

Your job is to evaluate inbound group/event leads and help the sales team respond quickly and professionally.

HOTEL DETAILS:
- Room count: ${hotelProfile.room_count}
- Rate range: $${hotelProfile.rate_min} - $${hotelProfile.rate_max}/night
- Minimum group size: ${hotelProfile.min_group_size} rooms
- Target segments: ${hotelProfile.target_segments?.join(', ') || 'all'}
- F&B minimum: $${hotelProfile.fb_minimum || 0}
- Tone of voice: ${hotelProfile.tone_of_voice}
- About the hotel: ${hotelProfile.hotel_description || ''}

SCORING RULES:
- HOT: Dates are available, group size meets minimum, budget is at or above rate minimum, segment matches targets
- WARM: One or two criteria are soft (slightly under budget, flexible dates, borderline size)
- COLD: Dates are unavailable, budget is significantly under minimum, or lead is clearly not a fit

RESPONSE STYLE:
- ${hotelProfile.tone_of_voice === 'luxury' ? 'Refined, elegant, and aspirational. Never mention price first.' : ''}
- ${hotelProfile.tone_of_voice === 'warm' ? 'Friendly, personal, and welcoming. Use the contact\'s first name.' : ''}
- ${hotelProfile.tone_of_voice === 'professional' ? 'Clear, confident, and business-focused. Get to the point.' : ''}

Always sign emails with: "The Sales Team at ${hotelProfile.hotel_name}"`
}

/**
 * Prompt for scoring a lead and generating the first outbound email draft.
 */
export function buildScoringPrompt(lead, availabilityContext) {
  return `Evaluate this inbound lead and generate a response.

LEAD DETAILS:
- Contact: ${lead.contact_name} ${lead.company ? `(${lead.company})` : ''}
- Event type: ${lead.event_type || 'Not specified'}
- Group size: ${lead.group_size || 'Not specified'} rooms
- Requested dates: ${lead.dates_requested ? JSON.stringify(lead.dates_requested) : 'Not specified'}
- Budget per night: ${lead.budget_per_night ? `$${lead.budget_per_night}` : 'Not specified'}
- F&B budget: ${lead.fb_budget ? `$${lead.fb_budget}` : 'Not specified'}
- Special requests: ${lead.special_requests || 'None'}
- Original message: "${lead.raw_content}"

AVAILABILITY FOR REQUESTED DATES:
${availabilityContext}

Respond with valid JSON in exactly this format:
{
  "score": "hot" | "warm" | "cold",
  "reasoning": "1-2 sentence explanation for the sales rep explaining why this score was given",
  "draft_subject": "Email subject line",
  "draft_body": "Full email body ready to send. Professional, personalized to the contact and their specific event. Include next steps."
}`
}

/**
 * Prompt for classifying an inbound reply and drafting a response.
 */
export function buildReplyClassificationPrompt(inboundEmail, lead, hotelProfile) {
  return `A lead has replied to our sales email. Classify their reply and draft an appropriate response.

ORIGINAL LEAD:
- Contact: ${lead.contact_name}
- Event: ${lead.event_type}, ${lead.group_size} rooms
- Dates: ${JSON.stringify(lead.dates_requested)}

THEIR REPLY:
"${inboundEmail.body}"

HOTEL CONTEXT:
- Rate range: $${hotelProfile.rate_min} - $${hotelProfile.rate_max}
- Tone: ${hotelProfile.tone_of_voice}
- Hotel name: ${hotelProfile.hotel_name}

Respond with valid JSON:
{
  "reply_type": "pricing_question" | "site_visit_request" | "alternate_dates" | "general_interest" | "decline" | "contract_ready",
  "draft_subject": "Re: [original subject]",
  "draft_body": "Full response email, ready to send. Address their specific question or request directly."
}`
}

/**
 * Prompt for generating a polite decline email.
 * Used both for auto-rejections (hard criteria failures)
 * and manual declines where the rep decides to pass.
 */
export function buildRejectionPrompt(lead, rejectionReason, hotelProfile) {
  return `You are a hotel sales assistant for ${hotelProfile.hotel_name}.

Write a short, professional decline email for a group inquiry that cannot be accommodated.

LEAD:
- Contact: ${lead.contact_name}${lead.company ? ` at ${lead.company}` : ''}
- Event type: ${lead.event_type || 'group event'}
- Group size: ${lead.group_size || 'unspecified'} rooms
- Requested dates: ${lead.dates_requested?.check_in ?? 'unspecified'}${lead.dates_requested?.check_out ? ` – ${lead.dates_requested.check_out}` : ''}

REASON WE CANNOT ACCOMMODATE:
${rejectionReason}

HOTEL TONE: ${hotelProfile.tone_of_voice}

INSTRUCTIONS:
- Be warm, respectful, and professional — this group may return in future or recommend us
- Do NOT state the specific internal reason bluntly (e.g. don't say "your group is too large")
- Instead, phrase it diplomatically (e.g. "we are unable to accommodate your group size during this period")
- Express genuine regret and wish them well with their event
- Keep it under 100 words
- Do NOT suggest a competitor

Respond with valid JSON:
{
  "subject": "decline email subject line",
  "body": "full polite decline email body"
}`
}

/**
 * Prompt for generating follow-up emails (Day 3, 7, 14).
 */
export function buildFollowUpPrompt(lead, sequenceDay, previousEmailBody, hotelProfile) {
  const tone = {
    3: 'Friendly check-in. Assume they are busy, not disinterested.',
    7: 'Slightly more direct. Add a reason to respond — mention limited availability or an upcoming hold.',
    14: 'Final outreach. Keep the door open but make clear this is the last follow-up.'
  }

  return `Generate a follow-up email for a lead that has not responded.

LEAD:
- Contact: ${lead.contact_name}
- Event: ${lead.event_type}, ${lead.group_size} rooms, ${JSON.stringify(lead.dates_requested)}

ORIGINAL EMAIL WE SENT:
"${previousEmailBody}"

THIS IS DAY ${sequenceDay} FOLLOW-UP.
Tone guidance: ${tone[sequenceDay]}

Hotel: ${hotelProfile.hotel_name}
Tone of voice: ${hotelProfile.tone_of_voice}

Respond with valid JSON:
{
  "subject": "Follow-up subject line",
  "body": "Full follow-up email body. Keep it short — 3-4 sentences max. Reference their specific event, not a generic template."
}`
}
