import { NextResponse } from 'next/server'

export async function GET() {
  const status = {
    bot: {
      name: 'AI Assistant Bot',
      status: 'online',
      uptime: '14д 6ч 32м',
      lastActivity: '2026-03-04T10:30:05Z',
    },
    deepseek: {
      status: 'connected',
      lastRequest: '2026-03-04T10:30:05Z',
      requestsToday: 42,
      avgResponseTime: '1.2с',
    },
    gigachat: {
      status: 'disconnected',
      lastRequest: null,
      requestsToday: 0,
      avgResponseTime: null,
    },
    whisper: {
      status: 'ready',
      lastRequest: '2026-03-04T09:15:10Z',
      requestsToday: 3,
      avgResponseTime: '3.5с',
    },
    database: {
      status: 'connected',
      size: '2.4 МБ',
      lastBackup: '2026-03-04T00:00:00Z',
    },
    telegram: {
      status: 'connected',
      webhookInfo: 'Активен',
      pendingUpdates: 0,
    },
  }

  return NextResponse.json(status)
}
