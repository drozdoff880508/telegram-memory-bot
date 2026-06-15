'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useTheme } from 'next-themes'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, MessageSquare, Bell, ShoppingCart, StickyNote,
  Settings, Sun, Moon, Menu, Trash2, Check, AlertCircle, Send,
  Bot, Clock, Activity, Users, Zap, RefreshCw, X, ChevronRight,
  Shield, Key, Globe, Clock4, Tag, UserCheck, Volume2, ImageIcon,
  Server, Database, Wifi, WifiOff, ExternalLink
} from 'lucide-react'
import {
  SidebarProvider, Sidebar, SidebarContent, SidebarFooter,
  SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarRail, SidebarInset, SidebarTrigger, SidebarSeparator,
} from '@/components/ui/sidebar'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardAction } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'

// ==================== TYPES ====================

type Section = 'dashboard' | 'messages' | 'reminders' | 'shopping' | 'notes' | 'settings'

interface Stats {
  totalMessages: number
  activeReminders: number
  shoppingItems: number
  notesCount: number
  messagesToday: number
  remindersSent: number
  usersCount: number
  uptime: string
}

interface Message {
  id: string
  userId: string
  role: string
  content: string
  messageType: string
  fileName?: string
  userName: string
  createdAt: string
}

interface Reminder {
  id: string
  userId: string
  text: string
  remindAt: string
  isSent: boolean
  isRepeat: boolean
  repeatInterval?: string
  userName: string
  createdAt: string
}

interface ShoppingItem {
  id: string
  userId: string
  text: string
  quantity: string
  isBought: boolean
  category: string
  userName: string
  createdAt: string
}

interface Note {
  id: string
  userId: string
  title: string
  content: string
  tags: string
  userName: string
  createdAt: string
}

interface BotSettings {
  deepseek: { apiKey: string; model: string; temperature: number; maxTokens: number; isActive: boolean }
  gigachat: { apiKey: string; model: string; temperature: number; maxTokens: number; isActive: boolean }
  telegram: { botToken: string; webhookUrl: string; isActive: boolean }
  bot: { timezone: string; language: string; allowedUsers: string; contextWindow: number; reminderCheckInterval: number }
}

interface BotStatus {
  bot: { name: string; status: string; uptime: string; lastActivity: string }
  deepseek: { status: string; lastRequest: string | null; requestsToday: number; avgResponseTime: string | null }
  gigachat: { status: string; lastRequest: string | null; requestsToday: number; avgResponseTime: string | null }
  whisper: { status: string; lastRequest: string | null; requestsToday: number; avgResponseTime: string | null }
  database: { status: string; size: string; lastBackup: string }
  telegram: { status: string; webhookInfo: string; pendingUpdates: number }
}

// ==================== HELPERS ====================

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatShortDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = d.getTime() - now.getTime()
  const isPast = diff < 0
  const absDiff = Math.abs(diff)

  if (absDiff < 3600000) {
    const mins = Math.floor(absDiff / 60000)
    return isPast ? `${mins}м назад` : `через ${mins}м`
  }
  if (absDiff < 86400000) {
    const hours = Math.floor(absDiff / 3600000)
    return isPast ? `${hours}ч назад` : `через ${hours}ч`
  }
  const days = Math.floor(absDiff / 86400000)
  return isPast ? `${days}д назад` : `через ${days}д`
}

function isOverdue(iso: string): boolean {
  return new Date(iso) < new Date()
}

const categoryLabels: Record<string, { label: string; emoji: string }> = {
  food: { label: 'Еда', emoji: '🍎' },
  household: { label: 'Дом', emoji: '🏠' },
  other: { label: 'Другое', emoji: '📦' },
}

const navItems: { id: Section; label: string; emoji: string }[] = [
  { id: 'dashboard', label: 'Панель', emoji: '📊' },
  { id: 'messages', label: 'История чата', emoji: '💬' },
  { id: 'reminders', label: 'Напоминания', emoji: '🔔' },
  { id: 'shopping', label: 'Покупки', emoji: '🛒' },
  { id: 'notes', label: 'Заметки', emoji: '📝' },
  { id: 'settings', label: 'Настройки', emoji: '⚙️' },
]

const navIcons: Record<Section, React.ElementType> = {
  dashboard: LayoutDashboard,
  messages: MessageSquare,
  reminders: Bell,
  shopping: ShoppingCart,
  notes: StickyNote,
  settings: Settings,
}

// ==================== DASHBOARD VIEW ====================

function DashboardView({ stats, messages, reminders, status }: {
  stats: Stats | null
  messages: Message[]
  reminders: Reminder[]
  status: BotStatus | null
}) {
  const statsCards = stats ? [
    { title: 'Сообщений', value: stats.totalMessages, sub: `+${stats.messagesToday} сегодня`, emoji: '💬', icon: MessageSquare, color: 'text-amber-600 dark:text-amber-400' },
    { title: 'Напоминаний', value: stats.activeReminders, sub: `${stats.remindersSent} отправлено`, emoji: '🔔', icon: Bell, color: 'text-rose-600 dark:text-rose-400' },
    { title: 'Покупок', value: stats.shoppingItems, sub: 'в списке', emoji: '🛒', icon: ShoppingCart, color: 'text-emerald-600 dark:text-emerald-400' },
    { title: 'Заметок', value: stats.notesCount, sub: 'сохранено', emoji: '📝', icon: StickyNote, color: 'text-violet-600 dark:text-violet-400' },
  ] : []

  const upcomingReminders = reminders
    .filter(r => !r.isSent)
    .sort((a, b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime())
    .slice(0, 5)

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsCards.map((card, i) => (
          <motion.div
            key={card.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <Card className="relative overflow-hidden">
              <CardHeader>
                <CardDescription className="flex items-center gap-2">
                  <span className="text-lg">{card.emoji}</span>
                  {card.title}
                </CardDescription>
                <CardTitle className="text-3xl font-bold">{card.value.toLocaleString('ru-RU')}</CardTitle>
                <CardAction>
                  <card.icon className={`h-8 w-8 ${card.color} opacity-20`} />
                </CardAction>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">{card.sub}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Messages */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" /> Последние сообщения
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-96">
              <div className="space-y-3">
                {messages.slice(0, 10).map((msg) => (
                  <div key={msg.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                    <div className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold ${msg.role === 'user' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'}`}>
                      {msg.role === 'user' ? msg.userName[0] : '🤖'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">{msg.role === 'user' ? msg.userName : 'Ассистент'}</span>
                        {msg.messageType === 'voice' && <Badge variant="secondary" className="text-[10px] h-5"><Volume2 className="h-3 w-3 mr-1" />Голос</Badge>}
                        {msg.messageType === 'image' && <Badge variant="secondary" className="text-[10px] h-5"><ImageIcon className="h-3 w-3 mr-1" />Фото</Badge>}
                        {msg.messageType === 'command' && <Badge variant="secondary" className="text-[10px] h-5"><Zap className="h-3 w-3 mr-1" />Команда</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{msg.content}</p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{formatShortDate(msg.createdAt)}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Upcoming Reminders + Quick Actions */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" /> Ближайшие напоминания
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {upcomingReminders.map((rem) => (
                  <div key={rem.id} className={`p-3 rounded-lg border ${isOverdue(rem.remindAt) ? 'border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/20' : 'border-border bg-muted/30'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium">{rem.text}</p>
                      {isOverdue(rem.remindAt) && <AlertCircle className="h-4 w-4 text-rose-500 shrink-0" />}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Clock4 className="h-3 w-3 text-muted-foreground" />
                      <span className={`text-xs ${isOverdue(rem.remindAt) ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}`}>
                        {formatShortDate(rem.remindAt)}
                      </span>
                      {rem.isRepeat && <Badge variant="outline" className="text-[10px] h-4 px-1">🔄 {rem.repeatInterval}</Badge>}
                    </div>
                    <span className="text-xs text-muted-foreground">{rem.userName}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" /> Быстрые действия
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start gap-2" onClick={() => toast.success('Контекст очищен! 🧹')}>
                <RefreshCw className="h-4 w-4" /> Очистить контекст
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2" onClick={() => toast.success('Тестовое сообщение отправлено! 📨')}>
                <Send className="h-4 w-4" /> Тест бота
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2" onClick={() => toast.info('Статус обновлён! 🔄')}>
                <Activity className="h-4 w-4" /> Обновить статус
              </Button>
            </CardContent>
          </Card>

          {/* Bot Status Mini */}
          {status && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5" /> Статус бота
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Бот</span>
                    <Badge variant={status.bot.status === 'online' ? 'default' : 'destructive'} className="text-xs">
                      {status.bot.status === 'online' ? '🟢 Онлайн' : '🔴 Оффлайн'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">DeepSeek</span>
                    <Badge variant={status.deepseek.status === 'connected' ? 'default' : 'secondary'} className="text-xs">
                      {status.deepseek.status === 'connected' ? '🟢' : '🟡'} {status.deepseek.requestsToday} запр.
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">GigaChat</span>
                    <Badge variant="secondary" className="text-xs">
                      🔴 Отключён
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">БД</span>
                    <Badge variant={status.database.status === 'connected' ? 'default' : 'destructive'} className="text-xs">
                      🟢 {status.database.size}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

// ==================== CHAT HISTORY VIEW ====================

function ChatHistoryView({ messages }: { messages: Message[] }) {
  const [filter, setFilter] = useState<string>('all')

  const filtered = filter === 'all' ? messages : messages.filter(m => m.messageType === filter)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">💬 История чата</CardTitle>
          <CardDescription>Последние сообщения пользователей</CardDescription>
          <CardAction>
            <div className="flex gap-1">
              {[
                { key: 'all', label: 'Все' },
                { key: 'text', label: '📝 Текст' },
                { key: 'voice', label: '🎙️ Голос' },
                { key: 'image', label: '📷 Фото' },
              ].map(f => (
                <Button
                  key={f.key}
                  size="sm"
                  variant={filter === f.key ? 'default' : 'outline'}
                  onClick={() => setFilter(f.key)}
                  className="text-xs h-7"
                >
                  {f.label}
                </Button>
              ))}
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-[calc(100vh-260px)]">
            <div className="space-y-3">
              <AnimatePresence mode="popLayout">
                {filtered.map((msg, i) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ delay: i * 0.03 }}
                    className={`p-4 rounded-xl border transition-colors hover:bg-muted/50 ${msg.role === 'user' ? '' : 'bg-primary/5 dark:bg-primary/10'}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`shrink-0 h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold ${msg.role === 'user' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'}`}>
                        {msg.role === 'user' ? msg.userName[0] : '🤖'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-semibold text-sm">{msg.role === 'user' ? msg.userName : 'AI Ассистент'}</span>
                          {msg.messageType === 'voice' && (
                            <Badge className="text-[10px] h-5 bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 border-0">
                              <Volume2 className="h-3 w-3 mr-1" /> Голосовое
                            </Badge>
                          )}
                          {msg.messageType === 'image' && (
                            <Badge className="text-[10px] h-5 bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300 border-0">
                              <ImageIcon className="h-3 w-3 mr-1" /> Фото
                            </Badge>
                          )}
                          {msg.messageType === 'command' && (
                            <Badge className="text-[10px] h-5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-0">
                              <Zap className="h-3 w-3 mr-1" /> Команда
                            </Badge>
                          )}
                          {msg.role === 'assistant' && (
                            <Badge className="text-[10px] h-5 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-0">
                              🤖 Ответ
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm leading-relaxed">{msg.content}</p>
                        {msg.fileName && (
                          <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                            <ExternalLink className="h-3 w-3" /> {msg.fileName}
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">{formatDate(msg.createdAt)}</span>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}

// ==================== REMINDERS VIEW ====================

function RemindersView({ reminders: initialReminders }: { reminders: Reminder[] }) {
  const [reminders, setReminders] = useState(initialReminders)

  const markAsSent = (id: string) => {
    setReminders(prev => prev.map(r => r.id === id ? { ...r, isSent: true } : r))
    toast.success('Напоминание отмечено как отправленное ✅')
  }

  const deleteReminder = (id: string) => {
    setReminders(prev => prev.filter(r => r.id !== id))
    toast.success('Напоминание удалено 🗑️')
  }

  const overdue = reminders.filter(r => !r.isSent && isOverdue(r.remindAt))
  const upcoming = reminders.filter(r => !r.isSent && !isOverdue(r.remindAt))
  const sent = reminders.filter(r => r.isSent)

  const repeatLabel: Record<string, string> = {
    daily: 'Ежедневно',
    weekly: 'Еженедельно',
    monthly: 'Ежемесячно',
    yearly: 'Ежегодно',
  }

  return (
    <div className="space-y-4">
      {overdue.length > 0 && (
        <Card className="border-rose-200 dark:border-rose-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <AlertCircle className="h-5 w-5" /> Просроченные ({overdue.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {overdue.map(rem => (
                <div key={rem.id} className="flex items-center gap-3 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm">{rem.text}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-xs text-rose-600 dark:text-rose-400">⚠️ Просрочено: {formatDate(rem.remindAt)}</span>
                      <span className="text-xs text-muted-foreground">• {rem.userName}</span>
                      {rem.isRepeat && <Badge variant="outline" className="text-[10px] h-4 px-1 border-rose-300 dark:border-rose-700">🔄 {repeatLabel[rem.repeatInterval || '']}</Badge>}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => markAsSent(rem.id)}>
                      <Check className="h-3 w-3 mr-1" /> Отправлено
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs text-rose-600 hover:text-rose-700" onClick={() => deleteReminder(rem.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">🔔 Активные напоминания ({upcoming.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-96">
            <div className="space-y-2">
              {upcoming.map(rem => (
                <div key={rem.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                  <div className="shrink-0 h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-lg">
                    🔔
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm">{rem.text}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <Clock4 className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{formatDate(rem.remindAt)}</span>
                      <span className="text-xs text-muted-foreground">({formatShortDate(rem.remindAt)})</span>
                      <span className="text-xs text-muted-foreground">• {rem.userName}</span>
                      {rem.isRepeat && <Badge variant="outline" className="text-[10px] h-4 px-1">🔄 {repeatLabel[rem.repeatInterval || '']}</Badge>}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => markAsSent(rem.id)}>
                      <Check className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs text-rose-600" onClick={() => deleteReminder(rem.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
              {upcoming.length === 0 && (
                <p className="text-center text-muted-foreground py-8">Нет активных напоминаний 🎉</p>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {sent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-muted-foreground">✅ Отправленные ({sent.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {sent.map(rem => (
                <div key={rem.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 opacity-60">
                  <span className="text-lg">✅</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm line-through">{rem.text}</p>
                    <span className="text-xs text-muted-foreground">{rem.userName} • {formatDate(rem.createdAt)}</span>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-rose-600" onClick={() => deleteReminder(rem.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ==================== SHOPPING LIST VIEW ====================

function ShoppingListView({ items: initialItems }: { items: ShoppingItem[] }) {
  const [items, setItems] = useState(initialItems)

  const toggleBought = (id: string) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, isBought: !item.isBought } : item))
  }

  const deleteItem = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id))
    toast.success('Товар удалён 🗑️')
  }

  const clearBought = () => {
    const count = items.filter(i => i.isBought).length
    setItems(prev => prev.filter(item => !item.isBought))
    toast.success(`Удалено ${count} купленных товаров 🧹`)
  }

  const categories = ['food', 'household', 'other'] as const
  const boughtCount = items.filter(i => i.isBought).length
  const totalCount = items.length

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">🛒 Список покупок</CardTitle>
          <CardDescription>
            {boughtCount} из {totalCount} куплено
          </CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" onClick={clearBought} disabled={boughtCount === 0}>
              <Trash2 className="h-4 w-4 mr-1" /> Убрать купленные
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {/* Progress bar */}
          <div className="w-full h-2 rounded-full bg-muted mb-4 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-emerald-500"
              initial={{ width: 0 }}
              animate={{ width: totalCount > 0 ? `${(boughtCount / totalCount) * 100}%` : '0%' }}
              transition={{ duration: 0.5 }}
            />
          </div>

          {categories.map(cat => {
            const catItems = items.filter(i => i.category === cat)
            if (catItems.length === 0) return null
            const catInfo = categoryLabels[cat]
            const catBought = catItems.filter(i => i.isBought).length

            return (
              <div key={cat} className="mb-4 last:mb-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">{catInfo.emoji}</span>
                  <h3 className="font-semibold text-sm">{catInfo.label}</h3>
                  <Badge variant="secondary" className="text-[10px] h-5">{catBought}/{catItems.length}</Badge>
                </div>
                <div className="space-y-1">
                  {catItems.map(item => (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border transition-colors hover:bg-muted/50 ${item.isBought ? 'opacity-50 bg-muted/30' : ''}`}
                    >
                      <Checkbox
                        checked={item.isBought}
                        onCheckedChange={() => toggleBought(item.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm ${item.isBought ? 'line-through text-muted-foreground' : 'font-medium'}`}>
                          {item.text}
                        </p>
                        <span className="text-xs text-muted-foreground">{item.quantity} • {item.userName}</span>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-600 shrink-0"
                        onClick={() => deleteItem(item.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}

// ==================== NOTES VIEW ====================

function NotesView({ notes: initialNotes }: { notes: Note[] }) {
  const [notes, setNotes] = useState(initialNotes)
  const [searchQuery, setSearchQuery] = useState('')

  const deleteNote = (id: string) => {
    setNotes(prev => prev.filter(n => n.id !== id))
    toast.success('Заметка удалена 🗑️')
  }

  const filtered = searchQuery
    ? notes.filter(n =>
        n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.tags.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : notes

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">📝 Заметки</CardTitle>
          <CardDescription>{notes.length} заметок сохранено</CardDescription>
          <CardAction>
            <Input
              placeholder="Поиск заметок..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-48 h-8 text-sm"
            />
          </CardAction>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-[calc(100vh-260px)]">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              <AnimatePresence mode="popLayout">
                {filtered.map((note, i) => (
                  <motion.div
                    key={note.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ delay: i * 0.02 }}
                    layout
                  >
                    <Card className="group hover:shadow-md transition-shadow">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          📝 {note.title}
                        </CardTitle>
                        <CardAction>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-rose-600"
                            onClick={() => deleteNote(note.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </CardAction>
                      </CardHeader>
                      <CardContent>
                        <p className="text-xs text-muted-foreground line-clamp-3 mb-3 whitespace-pre-line">
                          {note.content}
                        </p>
                        <div className="flex items-center justify-between">
                          <div className="flex flex-wrap gap-1">
                            {note.tags.split(', ').slice(0, 3).map(tag => (
                              <Badge key={tag} variant="secondary" className="text-[10px] h-4 px-1.5">
                                {tag}
                              </Badge>
                            ))}
                            {note.tags.split(', ').length > 3 && (
                              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                                +{note.tags.split(', ').length - 3}
                              </Badge>
                            )}
                          </div>
                          <span className="text-[10px] text-muted-foreground">{note.userName}</span>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
            {filtered.length === 0 && (
              <p className="text-center text-muted-foreground py-12">
                {searchQuery ? 'Ничего не найдено 🔍' : 'Заметок пока нет 📝'}
              </p>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}

// ==================== SETTINGS VIEW ====================

function SettingsView({ settings, status }: { settings: BotSettings | null; status: BotStatus | null }) {
  const [form, setForm] = useState<BotSettings | null>(settings)

  useEffect(() => {
    setForm(settings)
  }, [settings])

  const handleSave = async () => {
    if (!form) return
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        toast.success('Настройки сохранены! ✅')
      }
    } catch {
      toast.error('Ошибка сохранения настроек ❌')
    }
  }

  if (!form) return <div className="flex justify-center py-12"><RefreshCw className="h-6 w-6 animate-spin" /></div>

  const StatusDot = ({ s }: { s: string }) => (
    <span className={`inline-block h-2 w-2 rounded-full ${s === 'connected' || s === 'online' || s === 'ready' ? 'bg-emerald-500' : s === 'disconnected' || s === 'offline' ? 'bg-rose-500' : 'bg-amber-500'}`} />
  )

  return (
    <div className="space-y-6">
      {/* Status Overview */}
      {status && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" /> Статус сервисов
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { name: 'Telegram Бот', status: status.telegram.status, icon: Bot, detail: status.telegram.webhookInfo },
                { name: 'DeepSeek API', status: status.deepseek.status, icon: Key, detail: `${status.deepseek.requestsToday} запр. сегодня` },
                { name: 'GigaChat API', status: status.gigachat.status, icon: Globe, detail: status.gigachat.status === 'connected' ? `${status.gigachat.requestsToday} запр.` : 'Отключён' },
                { name: 'Whisper ASR', status: status.whisper.status, icon: Volume2, detail: `${status.whisper.requestsToday} обработано` },
                { name: 'База данных', status: status.database.status, icon: Database, detail: status.database.size },
                { name: 'Uptime', status: 'online', icon: Clock, detail: status.bot.uptime },
              ].map(service => (
                <div key={service.name} className="flex items-center gap-3 p-3 rounded-lg border">
                  <div className="shrink-0 h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                    <service.icon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <StatusDot s={service.status} />
                      <span className="font-medium text-sm">{service.name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{service.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* API Keys */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" /> API Ключи
          </CardTitle>
          <CardDescription>Управление ключами доступа к сервисам</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* DeepSeek */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusDot s={form.deepseek.isActive ? 'connected' : 'disconnected'} />
                <Label className="font-semibold">DeepSeek API</Label>
              </div>
              <Switch
                checked={form.deepseek.isActive}
                onCheckedChange={(checked) => setForm({ ...form, deepseek: { ...form.deepseek, isActive: checked } })}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">API Ключ</Label>
                <Input
                  type="password"
                  value={form.deepseek.apiKey}
                  onChange={(e) => setForm({ ...form, deepseek: { ...form.deepseek, apiKey: e.target.value } })}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Модель</Label>
                <Select
                  value={form.deepseek.model}
                  onValueChange={(v) => setForm({ ...form, deepseek: { ...form.deepseek, model: v } })}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deepseek-chat">deepseek-chat</SelectItem>
                    <SelectItem value="deepseek-reasoner">deepseek-reasoner</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Температура: {form.deepseek.temperature}</Label>
                <Input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={form.deepseek.temperature}
                  onChange={(e) => setForm({ ...form, deepseek: { ...form.deepseek, temperature: parseFloat(e.target.value) } })}
                  className="h-8"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Max Tokens</Label>
                <Input
                  type="number"
                  value={form.deepseek.maxTokens}
                  onChange={(e) => setForm({ ...form, deepseek: { ...form.deepseek, maxTokens: parseInt(e.target.value) || 0 } })}
                  className="h-8 text-sm"
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* GigaChat */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusDot s={form.gigachat.isActive ? 'connected' : 'disconnected'} />
                <Label className="font-semibold">GigaChat API</Label>
              </div>
              <Switch
                checked={form.gigachat.isActive}
                onCheckedChange={(checked) => setForm({ ...form, gigachat: { ...form.gigachat, isActive: checked } })}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">API Ключ</Label>
                <Input
                  type="password"
                  value={form.gigachat.apiKey}
                  onChange={(e) => setForm({ ...form, gigachat: { ...form.gigachat, apiKey: e.target.value } })}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Модель</Label>
                <Select
                  value={form.gigachat.model}
                  onValueChange={(v) => setForm({ ...form, gigachat: { ...form.gigachat, model: v } })}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GigaChat-Pro">GigaChat-Pro</SelectItem>
                    <SelectItem value="GigaChat">GigaChat</SelectItem>
                    <SelectItem value="GigaChat-Max">GigaChat-Max</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <Separator />

          {/* Telegram */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusDot s={form.telegram.isActive ? 'connected' : 'disconnected'} />
                <Label className="font-semibold">Telegram Bot</Label>
              </div>
              <Switch
                checked={form.telegram.isActive}
                onCheckedChange={(checked) => setForm({ ...form, telegram: { ...form.telegram, isActive: checked } })}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Bot Token</Label>
                <Input
                  type="password"
                  value={form.telegram.botToken}
                  onChange={(e) => setForm({ ...form, telegram: { ...form.telegram, botToken: e.target.value } })}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Webhook URL (опционально)</Label>
                <Input
                  value={form.telegram.webhookUrl}
                  onChange={(e) => setForm({ ...form, telegram: { ...form.telegram, webhookUrl: e.target.value } })}
                  placeholder="https://example.com/webhook"
                  className="h-8 text-sm"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bot Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" /> Настройки бота
          </CardTitle>
          <CardDescription>Общие параметры работы бота</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Globe className="h-3 w-3" /> Часовой пояс
              </Label>
              <Select
                value={form.bot.timezone}
                onValueChange={(v) => setForm({ ...form, bot: { ...form.bot, timezone: v } })}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Europe/Moscow">Europe/Moscow (МСК)</SelectItem>
                  <SelectItem value="Asia/Yekaterinburg">Asia/Yekaterinburg (ЕКАТ)</SelectItem>
                  <SelectItem value="Asia/Novosibirsk">Asia/Novosibirsk (НСК)</SelectItem>
                  <SelectItem value="Asia/Vladivostok">Asia/Vladivostok (ВЛАД)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Globe className="h-3 w-3" /> Язык
              </Label>
              <Select
                value={form.bot.language}
                onValueChange={(v) => setForm({ ...form, bot: { ...form.bot, language: v } })}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ru">🇷🇺 Русский</SelectItem>
                  <SelectItem value="en">🇬🇧 English</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <UserCheck className="h-3 w-3" /> Разрешённые пользователи (Telegram ID через запятую)
              </Label>
              <Textarea
                value={form.bot.allowedUsers}
                onChange={(e) => setForm({ ...form, bot: { ...form.bot, allowedUsers: e.target.value } })}
                className="text-sm min-h-[60px]"
                placeholder="123456789, 987654321"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <MessageSquare className="h-3 w-3" /> Окно контекста (сообщений)
              </Label>
              <Input
                type="number"
                value={form.bot.contextWindow}
                onChange={(e) => setForm({ ...form, bot: { ...form.bot, contextWindow: parseInt(e.target.value) || 10 } })}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock4 className="h-3 w-3" /> Интервал проверки напоминаний (сек)
              </Label>
              <Input
                type="number"
                value={form.bot.reminderCheckInterval}
                onChange={(e) => setForm({ ...form, bot: { ...form.bot, reminderCheckInterval: parseInt(e.target.value) || 60 } })}
                className="h-8 text-sm"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={handleSave} className="gap-2">
          <Check className="h-4 w-4" /> Сохранить настройки
        </Button>
      </div>
    </div>
  )
}

// ==================== MAIN PAGE ====================

export default function AdminDashboard() {
  const [activeSection, setActiveSection] = useState<Section>('dashboard')
  const [stats, setStats] = useState<Stats | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [settings, setSettings] = useState<BotSettings | null>(null)
  const [status, setStatus] = useState<BotStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [statsRes, messagesRes, remindersRes, shoppingRes, notesRes, settingsRes, statusRes] = await Promise.all([
        fetch('/api/stats'),
        fetch('/api/messages'),
        fetch('/api/reminders'),
        fetch('/api/shopping'),
        fetch('/api/notes'),
        fetch('/api/settings'),
        fetch('/api/status'),
      ])

      const [statsData, messagesData, remindersData, shoppingData, notesData, settingsData, statusData] = await Promise.all([
        statsRes.json(),
        messagesRes.json(),
        remindersRes.json(),
        shoppingRes.json(),
        notesRes.json(),
        settingsRes.json(),
        statusRes.json(),
      ])

      setStats(statsData)
      setMessages(messagesData)
      setReminders(remindersData)
      setShoppingItems(shoppingData)
      setNotes(notesData)
      setSettings(settingsData)
      setStatus(statusData)
    } catch (err) {
      console.error('Failed to fetch data:', err)
      toast.error('Ошибка загрузки данных ❌')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const pageTitle: Record<Section, string> = {
    dashboard: '📊 Панель управления',
    messages: '💬 История чата',
    reminders: '🔔 Напоминания',
    shopping: '🛒 Список покупок',
    notes: '📝 Заметки',
    settings: '⚙️ Настройки',
  }

  return (
    <SidebarProvider>
      <Sidebar side="left" variant="sidebar" collapsible="icon">
        <SidebarHeader className="p-3">
          <div className="flex items-center gap-3 px-2 group-data-[collapsible=icon]:justify-center">
            <div className="h-9 w-9 rounded-xl bg-primary flex items-center justify-center text-primary-foreground text-lg shrink-0">
              🤖
            </div>
            <div className="group-data-[collapsible=icon]:hidden">
              <h2 className="font-bold text-sm leading-tight">AI Ассистент</h2>
              <p className="text-[10px] text-muted-foreground">Telegram Bot Panel</p>
            </div>
          </div>
        </SidebarHeader>

        <SidebarSeparator />

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Навигация</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map(item => {
                  const Icon = navIcons[item.id]
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        isActive={activeSection === item.id}
                        onClick={() => setActiveSection(item.id)}
                        tooltip={`${item.emoji} ${item.label}`}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="flex items-center gap-2">
                          <span className="text-sm">{item.emoji}</span>
                          <span>{item.label}</span>
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="p-3">
          <div className="flex items-center justify-between px-2 group-data-[collapsible=icon]:justify-center">
            <span className="text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
              v1.0.0
            </span>
            {mounted && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            )}
          </div>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <div className="min-h-screen flex flex-col">
          {/* Header */}
          <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-sm border-b px-4 py-3 flex items-center gap-3">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <h1 className="font-semibold text-lg">{pageTitle[activeSection]}</h1>
            <div className="ml-auto flex items-center gap-2">
              {stats && (
                <Badge variant="outline" className="text-xs h-7">
                  <Users className="h-3 w-3 mr-1" /> {stats.usersCount} польз.
                </Badge>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fetchData}>
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              {mounted && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 md:hidden"
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                >
                  {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
              )}
            </div>
          </header>

          {/* Main Content */}
          <main className="flex-1 p-4 md:p-6">
            {loading ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {[...Array(4)].map((_, i) => (
                    <Card key={i}>
                      <CardHeader>
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-8 w-16" />
                      </CardHeader>
                      <CardContent>
                        <Skeleton className="h-3 w-20" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <Card>
                  <CardHeader>
                    <Skeleton className="h-6 w-48" />
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {[...Array(5)].map((_, i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeSection}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                >
                  {activeSection === 'dashboard' && (
                    <DashboardView stats={stats} messages={messages} reminders={reminders} status={status} />
                  )}
                  {activeSection === 'messages' && (
                    <ChatHistoryView messages={messages} />
                  )}
                  {activeSection === 'reminders' && (
                    <RemindersView reminders={reminders} />
                  )}
                  {activeSection === 'shopping' && (
                    <ShoppingListView items={shoppingItems} />
                  )}
                  {activeSection === 'notes' && (
                    <NotesView notes={notes} />
                  )}
                  {activeSection === 'settings' && (
                    <SettingsView settings={settings} status={status} />
                  )}
                </motion.div>
              </AnimatePresence>
            )}
          </main>

          {/* Footer */}
          <footer className="border-t px-4 py-3 mt-auto">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>🤖 AI Ассистент — Telegram Bot Admin Panel</span>
              <span>v1.0.0 • {mounted && (theme === 'dark' ? '🌙 Тёмная тема' : '☀️ Светлая тема')}</span>
            </div>
          </footer>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
