
// pages/api/chat.ts
import { NextApiRequest, NextApiResponse } from "next";
import Cors from "cors";

// Initialize the CORS middleware
const cors = Cors({
  origin: "http://localhost:3002", // Update with your frontend origin
  methods: ["POST", "GET", "HEAD"],
});

// Helper to run middleware
function runMiddleware(
  req: NextApiRequest,
  res: NextApiResponse,
  fn: (
    req: NextApiRequest,
    res: NextApiResponse,
    next: (result?: unknown) => void
  ) => void
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) return reject(result);
      return resolve(result);
    });
  });
}

import { memory } from "@/lib/memory";
import { createAgent } from "@/lib/agent";
import { userSettingsMap } from "@/lib/mockUserData";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

// In-memory chat history store
const chatHistories: Record<
  string,
  { role: "user" | "assistant"; content: string; timestamp: string }[]
> = {};

function getChatHistory(userId: string) {
  return chatHistories[userId] || [];
}

function addChatMessage(
  userId: string,
  message: { role: "user" | "assistant"; content: string; timestamp: string }
) {
  if (!chatHistories[userId]) chatHistories[userId] = [];
  chatHistories[userId].push(message);
}
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
- Your reply must NEVER include follow-up questions or say “Follow-up questions:” — those belong ONLY in the JSON array, not the reply.
- The reply goes only in the "reply" field — make it sound warm and helpful.
- The 4 follow-up questions must go only in the "followup_chat" array — no mixing.
- These follow-ups must sound like 6–8 word inner thoughts from the user.
`.trim();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  await runMiddleware(req, res, cors);

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
You must ONLY return valid JSON in this format: 
{
  "reply": "your helpful reply here — DO NOT include follow-up questions or headers inside this string.",
  "followup_chat": [
    "short, user-like question",
    "another one here",
    "third one",
    "last one"
  ]
}

User message: ${input}
`,
      chat_history: chatHistory,
    });

    let parsed: any;

    try {
      const raw =
        typeof replyText === "string" ? replyText : JSON.stringify(replyText);
      parsed = JSON.parse(raw);

      // 🧼 Sanitize the reply if it accidentally includes follow-up text
      if (parsed?.reply) {
        parsed.reply = parsed.reply
          .replace(/Follow[-–]up questions?:/gi, "") // Remove "Follow-up questions:" heading
          .replace(/(?:\n|^)(•|\d+\.|-)\s?.+$/gim, "") // Remove bullet/dash/numbered lines
          .replace(/\n{2,}/g, "\n") // Collapse double newlines
          .trim(); // Trim whitespace
      }
    } catch (e) {
      console.error("Failed to parse LLM reply as JSON:", replyText);
      return res.status(500).json({
        error: "LLM did not return valid JSON",
        raw: replyText,
      });
    }

    // Save in memory
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
