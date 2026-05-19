import { getSessionUser } from "~/lib/auth.server";
import {
  getUnreadCount,
  getNotifications,
  markAsRead,
  markAllAsRead,
} from "~/lib/notification.server";

export async function loader({ request }: { request: Request }) {
  const user = getSessionUser(request);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const unreadCount = getUnreadCount(user.id);
  const notifications = getNotifications(user.id, 30);

  return Response.json({ unreadCount, notifications });
}

export async function action({ request }: { request: Request }) {
  const user = getSessionUser(request);
  if (!user) return new Response("Unauthorized", { status: 401 });

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "mark-read") {
    const notificationId = String(formData.get("notificationId") || "");
    if (notificationId) {
      markAsRead(notificationId, user.id);
      return Response.json({ ok: true });
    }
    return Response.json({ ok: false, error: "Missing notificationId" });
  }

  if (intent === "mark-all-read") {
    markAllAsRead(user.id);
    return Response.json({ ok: true });
  }

  return Response.json({ ok: false, error: "Unknown intent" });
}
