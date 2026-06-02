import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
export const FROM_EMAIL = process.env.FROM_EMAIL || "CascadeAI <noreply@cascadeai.co>";
export const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || "jonathan@cascadeai.co";

let cachedClient: Resend | null = null;
function getClient(): Resend | null {
  if (!RESEND_API_KEY) return null;
  if (!cachedClient) cachedClient = new Resend(RESEND_API_KEY);
  return cachedClient;
}

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const client = getClient();
  if (!client) {
    // Dev fallback — no API key configured. Log and return so the calling code
    // can still complete its DB writes during local testing.
    console.log("[email] RESEND_API_KEY not set; skipping send", {
      to: input.to,
      subject: input.subject,
    });
    return;
  }
  const { error } = await client.emails.send({
    from: FROM_EMAIL,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
  if (error) {
    throw new Error(`Resend error: ${error.message ?? JSON.stringify(error)}`);
  }
}
