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

export interface EmailAttachment {
  filename: string;
  content: string;  // base64
  type: string;
  disposition: "attachment" | "inline";
}

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const client = getClient();
  if (!client) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("RESEND_API_KEY is not set — cannot send email in production");
    }
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
    attachments: input.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
    })),
  });
  if (error) {
    throw new Error(`Resend error: ${error.message ?? JSON.stringify(error)}`);
  }
}
