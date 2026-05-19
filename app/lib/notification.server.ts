import { nanoid } from "nanoid";
import { db, prep } from "./db.server";

export type Notification = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: number | null;
  created_at: number;
};

export function createNotification(
  userId: string,
  type: string,
  title: string,
  body?: string,
  link?: string
): string {
  const id = nanoid(16);
  db.prepare(
    "INSERT INTO notifications (id, user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, userId, type, title, body ?? null, link ?? null);
  return id;
}

export function getUnreadCount(userId: string): number {
  const row = prep<{ cnt: number }, [string]>(
    "SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND read_at IS NULL"
  ).get(userId);
  return row?.cnt ?? 0;
}

export function getNotifications(userId: string, limit = 30): Notification[] {
  return prep<Notification, [string, number]>(
    "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?"
  ).all(userId, limit);
}

export function markAsRead(notificationId: string, userId: string): void {
  db.prepare(
    "UPDATE notifications SET read_at = unixepoch() WHERE id = ? AND user_id = ?"
  ).run(notificationId, userId);
}

export function markAllAsRead(userId: string): void {
  db.prepare(
    "UPDATE notifications SET read_at = unixepoch() WHERE user_id = ? AND read_at IS NULL"
  ).run(userId);
}

export function deleteOldNotifications(olderThanDays = 90): void {
  const cutoff = Math.floor(Date.now() / 1000) - olderThanDays * 24 * 60 * 60;
  db.prepare("DELETE FROM notifications WHERE created_at < ?").run(cutoff);
}
