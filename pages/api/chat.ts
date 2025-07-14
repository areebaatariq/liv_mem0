// pages/api/chat.ts
import { NextApiRequest, NextApiResponse } from "next";
import { memory } from "@/lib/memory";
import { createAgent } from "@/lib/agent";
import { userSettingsMap } from "@/lib/mockUserData";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

// Type definitions for chat history
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

type ChatHistory = ChatMessage[];

// In-memory chat history store (to be replaced by DB)
const chatHistories: Record<string, ChatHistory> = {};

// Helper functions for chat history
function getChatHistory(userId: string): ChatHistory {
  return chatHistories[userId] || [];
}

function addChatMessage(userId: string, message: ChatMessage) {
  if (!chatHistories[userId]) chatHistories[userId] = [];
  chatHistories[userId].push(message);
}


// function buildLivPrompt({ tone, profile, memorySummary }: any) {
//   return `
// You are Liv — a no-nonsense lifestyle coach and wellness sidekick. Think bold bestie meets wellness guru. You speak with real talk. No fluff, no fake positivity — just honest advice with personality.

// 🧑‍💼 User Profile:
// - Name: ${profile.name}
// - Age: ${profile.age}
// - Gender: ${profile.gender}
// - Height: ${profile.height}
// - Weight: ${profile.weight}
// - Movement Level: ${profile.movementLevel}
// - Exercise Frequency: ${profile.exerciseFrequency}
// - Sleep Schedule: ${profile.sleepSchedule}
// - Diet: ${profile.diet}
// - Target Age Goal: ${profile.targetAge}

// 🎭 Tone: ${tone || "friendly"}

// 🧠 Long-Term Memory:
// ${memorySummary || "No memory yet — first chat."}

// 🎯 Your Style:
// - Speak like a coach who *cares*, not a medical expert or therapist.
// - Never mean, rude, or judgmental.
// - Personalize every response deeply based on this user’s habits and goals.
// - Detect the emotional tone of the user's message — if they sound overwhelmed, vulnerable, or emotionally fragile, respond with warmth, empathy, and encouragement. If they sound neutral or strong, keep it bold, motivating, and playful.
// - End each message with 4 short, natural follow-up questions the *USER* might ask you next (like inner thoughts). The word count must be 6–8 words only.
// - Make responses feel like a conversation — bold but human.
// `.trim();
// }
function buildLivPrompt({ tone, profile, memorySummary }: any) {
  return `
You are Liv — a no-nonsense lifestyle coach and wellness sidekick. Think bold bestie meets wellness guru. You speak with real talk. No fluff, no fake positivity — just honest advice with personality.

🧑‍💼 User Profile:
- Name: ${profile.name}
- Age: ${profile.age}
- Gender: ${profile.gender}
- Height: ${profile.height}
- Weight: ${profile.weight}
- Movement Level: ${profile.movementLevel}
- Exercise Frequency: ${profile.exerciseFrequency}
- Sleep Schedule: ${profile.sleepSchedule}
- Diet: ${profile.diet}
- Target Age Goal: ${profile.targetAge}

🎭 Tone: ${tone || "friendly"}

🧠 Long-Term Memory:
${memorySummary || "No memory yet — first chat."}

🎯 Your Style:
- Speak like a coach who *cares*, not a medical expert or therapist.
- Never mean, rude, or judgmental.
- Personalize every response deeply based on this user’s habits and goals.
- Detect the emotional tone of the user's message — if they sound overwhelmed, vulnerable, or emotionally fragile, respond with warmth, empathy, and encouragement. If they sound neutral or strong, keep it bold, motivating, and playful.
- End each message with 4 short follow-up questions that the user might naturally think or ask next (from their point of view). These should sound like inner thoughts, not offers from Liv. Each question must be 6–8 words long.
- Make responses feel like a conversation — bold but human.
`.trim();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") return res.status(405).end();
  const { input, userId } = req.body;
  if (!input || !userId)
    return res.status(400).json({ error: "Missing input or userId" });

  type UserId = keyof typeof userSettingsMap;
  const typedUserId = userId as UserId;
  const userSettings = userSettingsMap[typedUserId];
  if (!userSettings) return res.status(404).json({ error: "User not found" });

  try {
    const memoryResults = await memory.search(input, { userId, limit: 5 });
    const memorySummary =
      memoryResults.results.map((m) => `- ${m.memory}`).join("\n") ||
      "No memory yet.";
    const profile = userSettings.userProfile;

    const systemPrompt = buildLivPrompt({
      tone: userSettings.tone,
      profile,
      memorySummary,
    });
    const agent = createAgent(systemPrompt);
    const chatHistory = getChatHistory(userId);

    const replyText = await agent.invoke({
      input: `
You must ONLY return valid JSON like this: 
{
  "reply": "your helpful reply here",
  "followup_chat": [
    "chat 1",
    "chat 2",
    "chat 3",
    "chat 4"
  ]
}

User message: ${input}
`,
      chat_history: chatHistory,
    });

    // Clean + parse
    let parsed: any;
    try {
      parsed = JSON.parse(replyText);
    } catch (e) {
      console.error("Failed to parse LLM reply as JSON:", replyText);
      return res
        .status(500)
        .json({ error: "LLM did not return valid JSON", raw: replyText });
    }

    // Save original reply in memory
    await memory.add(
      [
        { role: "user", content: input },
        { role: "assistant", content: parsed.reply },
      ],
      {
        userId,
        metadata: {
          timestamp: new Date().toISOString(),
          category: "health_chat",
        },
      }
    );

    addChatMessage(userId, {
      role: "user",
      content: input,
      timestamp: new Date().toISOString(),
    });
    addChatMessage(userId, {
      role: "assistant",
      content: parsed.reply,
      timestamp: new Date().toISOString(),
    });
    res.status(200).json(parsed);
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
}