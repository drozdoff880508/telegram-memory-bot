import { NextResponse } from 'next/server'

export async function GET() {
  const stats = {
    totalMessages: 1247,
    activeReminders: 8,
    shoppingItems: 15,
    notesCount: 23,
    messagesToday: 42,
    remindersSent: 156,
    usersCount: 3,
    uptime: '14д 6ч 32м',
  }

  return NextResponse.json(stats)
}
