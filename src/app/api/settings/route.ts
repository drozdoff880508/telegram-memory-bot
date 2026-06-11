import { NextResponse } from 'next/server'

const mockSettings = {
  deepseek: {
    apiKey: 'sk-****...****',
    model: 'deepseek-chat',
    temperature: 0.7,
    maxTokens: 4096,
    isActive: true,
  },
  gigachat: {
    apiKey: '****...****',
    model: 'GigaChat-Pro',
    temperature: 0.6,
    maxTokens: 2048,
    isActive: false,
  },
  telegram: {
    botToken: '7****...****',
    webhookUrl: '',
    isActive: true,
  },
  bot: {
    timezone: 'Europe/Moscow',
    language: 'ru',
    allowedUsers: '123456789, 987654321, 555666777',
    contextWindow: 20,
    reminderCheckInterval: 60,
  },
}

export async function GET() {
  return NextResponse.json(mockSettings)
}

export async function POST(request: Request) {
  const body = await request.json()
  // In real implementation, this would save to database
  return NextResponse.json({ success: true, data: body })
}
