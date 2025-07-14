import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';

export function createAgent(systemPrompt: string) {
  const llm = new ChatOpenAI({
    model: 'gpt-4.1-nano',
    temperature: 0.4,
  });

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', systemPrompt],
    new MessagesPlaceholder('chat_history'),
    ['human', '{input}'],
  ]);

  return prompt.pipe(llm).pipe(new StringOutputParser());
}