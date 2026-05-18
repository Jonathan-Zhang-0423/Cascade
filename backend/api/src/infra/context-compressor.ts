import { doubaoClient, DOUBAO_LITE_MODEL } from "./doubao-client";

type Message = { role: "user" | "assistant"; content: string };

const TOKEN_THRESHOLD = 25_000;
const RECENT_MESSAGES_TO_KEEP = 10;

function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += m.content.length;
  }
  return Math.ceil(chars / 4);
}

export async function compressMessages(messages: Message[]): Promise<Message[]> {
  if (messages.length <= RECENT_MESSAGES_TO_KEEP) {
    return messages;
  }

  const estimatedTokens = estimateTokens(messages);
  if (estimatedTokens <= TOKEN_THRESHOLD) {
    return messages;
  }

  const olderMessages = messages.slice(0, messages.length - RECENT_MESSAGES_TO_KEEP);
  const recentMessages = messages.slice(messages.length - RECENT_MESSAGES_TO_KEEP);

  const conversationText = olderMessages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  const summaryPrompt = `You are a conversation summarizer. Below is a conversation between a user and an AI planning assistant. Produce a concise summary (under 400 words) that captures:
- The user's original intent and goals
- Key decisions and constraints agreed upon
- Important technical choices or preferences expressed
- Any clarifications the user provided

Conversation to summarize:

${conversationText}

Provide only the summary, no preamble.`;

  try {
    const completion = await doubaoClient.chat.completions.create({
      model: DOUBAO_LITE_MODEL,
      messages: [{ role: "user", content: summaryPrompt }],
      stream: false,
      max_tokens: 1024,
    });

    const summary = completion.choices[0]?.message?.content?.trim() || "";

    if (!summary) {
      return messages;
    }

    const compressedMessages: Message[] = [
      {
        role: "user",
        content: `[Earlier conversation summary]: ${summary}`,
      },
      {
        role: "assistant",
        content: "Understood. I have the context from our earlier conversation and will continue from there.",
      },
      ...recentMessages,
    ];

    return compressedMessages;
  } catch (err: any) {
    console.error("Context compression failed, using original messages:", err?.message || err);
    return messages;
  }
}
