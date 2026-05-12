// Slack notification helper — uses Bot Token (chat.postMessage)
// Channel: #all-paradigm (C0B1JJ1L276) per global CLAUDE.md
// Default to user DM channel since Hermes bot isn't in #all-paradigm by default.
// Override with SLACK_CHANNEL env var to use a different channel/DM.
const SLACK_CHANNEL = process.env.SLACK_CHANNEL || "D0B1BJZCLE9";
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

async function postSlack({ text, blocks }) {
  if (!SLACK_BOT_TOKEN) {
    console.error("[slack] SLACK_BOT_TOKEN not set — skip notify");
    return { ok: false, error: "no_token" };
  }
  try {
    const r = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        channel: SLACK_CHANNEL,
        text,
        ...(blocks ? { blocks } : {}),
      }),
    });
    const j = await r.json();
    if (!j.ok) console.error("[slack] postMessage failed:", j.error);
    return j;
  } catch (e) {
    console.error("[slack] fetch error:", e?.message || e);
    return { ok: false, error: String(e?.message || e) };
  }
}

function buildSubmissionBlock({ target, success, detail, screenshotUrl }) {
  const emoji = success ? "✅" : "❌";
  const headerText = `${emoji} paranium.com outbound — ${target.name}`;
  return [
    { type: "header", text: { type: "plain_text", text: headerText } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Target*\n<${target.url}|${target.name}>` },
        { type: "mrkdwn", text: `*Industry*\n${target.industry || "n/a"}` },
        { type: "mrkdwn", text: `*Status*\n${success ? "submitted" : "failed"}` },
        { type: "mrkdwn", text: `*Detail*\n${(detail || "").slice(0, 150)}` },
      ],
    },
    ...(screenshotUrl ? [{ type: "image", image_url: screenshotUrl, alt_text: "form submission screenshot" }] : []),
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `paranium.com sale | floor $5K | target $8-15K | rail: Escrow.com primary` },
      ],
    },
  ];
}

module.exports = { postSlack, buildSubmissionBlock };
