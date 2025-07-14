// pages/api/nudge.ts
import { NextApiRequest, NextApiResponse } from 'next';
import { memory } from '@/lib/memory';
import { createAgent } from '@/lib/agent';
import { userSettingsMap } from '@/lib/mockUserData';

const nudgeTopics = {
  0: 'Sleep & recovery',
  1: 'Movement',
  2: 'Nourishment',
  3: 'Mental fitness',
  4: 'Anti-aging drugs & supplements',
  5: 'Social connection',
  6: 'Toxin defense',
};

function buildNudgePrompt({ tone, profile, memorySummary, todayTopic }: any) {
  return `
You are Liv — a cheeky and no-nonsense lifestyle assistant. Your job is to deliver *daily nudges* based on a specific theme. These nudges are like playful health dares — short, punchy, personalized, and motivating.

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

🎭 Tone: ${tone || 'cheeky'}

🧠 Long-Term Memory:
${memorySummary || 'No memory yet — first chat.'}

📅 Nudge Topic Today: ${todayTopic}

🎯 Your Goal:
- Write a daring, hepful non-generic nudge challenge based on the topic: **${todayTopic}**
- Personalize it based on the user's habits, struggles, goals, and past memory.
- Do NOT repeat past nudge suggestions if any exist in memory.
- End with a call to action, dare, or mini-challenge for the user.
- Keep it under 50 words.
`.trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  const userSettings = userSettingsMap[userId];
  if (!userSettings) return res.status(404).json({ error: 'User not found' });

  try {
    const today = new Date().getDay(); // 0 (Sun) - 6 (Sat)
    const topic = nudgeTopics[today] || 'Wellness';

    const memoryResults = await memory.search(topic, { userId, limit: 5 });
    const memorySummary = memoryResults.results.map(m => `- ${m.memory}`).join('\n') || 'No memory yet.';
    const profile = userSettings.userProfile;

    const systemPrompt = buildNudgePrompt({ tone: userSettings.tone, profile, memorySummary, todayTopic: topic });
    const agent = createAgent(systemPrompt);

    const reply = await agent.invoke({
      input: `Generate today's nudge.`,
      chat_history: [],
    });

    await memory.add(
      [
        { role: 'user', content: `Generate today's nudge.` },
        { role: 'assistant', content: reply },
      ],
      {
        userId,
        metadata: {
          timestamp: new Date().toISOString(),
          category: 'daily_nudge',
          topic,
        },
      }
    );

    res.status(200).json({ reply, topic });
  } catch (err) {
    console.error('Nudge error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}
