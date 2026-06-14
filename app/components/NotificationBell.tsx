import { useEffect, useRef, useState } from "react";
import { useFetcher, useNavigate } from "react-router";
import { timeAgo } from "~/lib/ui-utils";

interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: number | null;
  created_at: number;
}

interface NotificationResponse {
  unreadCount: number;
  notifications: Notification[];
}

export function NotificationBell() {
  const fetcher = useFetcher<NotificationResponse>();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const bellRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Load initial notifications
  useEffect(() => {
    fetcher.load("/api/notifications");
  }, []);

  // Update state from fetched data. Guard against non-success responses
  // (e.g. 401 if the session expired) where `data` won't have the expected
  // shape — without the guard the next render `notifications.map(...)` would
  // explode with a misleading error.
  useEffect(() => {
    const data = fetcher.data as Partial<NotificationResponse> | string | undefined;
    if (data && typeof data === "object" && Array.isArray(data.notifications)) {
      setUnreadCount(data.unreadCount ?? 0);
      setNotifications(data.notifications);
    }
  }, [fetcher.data]);

  // Poll for new notifications every 30 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      fetcher.load("/api/notifications");
    }, 30000);
    return () => clearInterval(timer);
  }, [fetcher]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  const handleNotificationClick = (notif: Notification) => {
    // Mark as read
    const formData = new FormData();
    formData.append("intent", "mark-read");
    formData.append("notificationId", notif.id);
    fetcher.submit(formData, { method: "POST", action: "/api/notifications" });

    // Navigate if link exists
    if (notif.link) {
      navigate(notif.link);
      setOpen(false);
    }
  };

  const handleMarkAllAsRead = () => {
    const formData = new FormData();
    formData.append("intent", "mark-all-read");
    fetcher.submit(formData, { method: "POST", action: "/api/notifications" });
    // Reload notifications
    setTimeout(() => fetcher.load("/api/notifications"), 100);
  };

  return (
    <div ref={bellRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: "0.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--fg)",
          position: "relative",
        }}
        title="Notifications"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ width: "1.25rem", height: "1.25rem" }}
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: "0",
              right: "0",
              background: "var(--accent)",
              color: "var(--bg)",
              borderRadius: "50%",
              width: "18px",
              height: "18px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.75rem",
              fontWeight: 600,
            }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: "0.5rem",
            background: "var(--bg)",
            border: "1px solid var(--border, rgba(28,22,18,0.15))",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-md)",
            zIndex: "var(--z-toast)",
            minWidth: "350px",
            maxWidth: "90vw",
            maxHeight: "500px",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "0.75rem 1rem",
              borderBottom: "1px solid var(--border, rgba(28,22,18,0.15))",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <h3 style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600 }}>
              Notifications
            </h3>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllAsRead}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--accent)",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  padding: 0,
                }}
              >
                Mark all as read
              </button>
            )}
          </div>

          {/* Notifications List */}
          <div
            style={{
              overflowY: "auto",
              flex: 1,
              minHeight: "200px",
              maxHeight: "400px",
            }}
          >
            {notifications.length === 0 ? (
              <div
                style={{
                  padding: "2rem 1rem",
                  textAlign: "center",
                  fontSize: "0.875rem",
                  color: "var(--fg-secondary, rgba(28,22,18,0.6))",
                }}
              >
                No notifications yet
              </div>
            ) : (
              notifications.map((notif) => (
                <button
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  style={{
                    width: "100%",
                    padding: "0.75rem 1rem",
                    border: "none",
                    borderBottom: "1px solid color-mix(in srgb, var(--fg) 10%, transparent)",
                    background: notif.read_at ? "transparent" : "color-mix(in srgb, var(--accent) 8%, transparent)",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background =
                      notif.read_at
                        ? "color-mix(in srgb, var(--fg) 5%, transparent)"
                        : "color-mix(in srgb, var(--accent) 12%, transparent)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = notif.read_at
                      ? "transparent"
                      : "color-mix(in srgb, var(--accent) 8%, transparent)";
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: "0.5rem",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: notif.read_at ? 400 : 600,
                          fontSize: "0.875rem",
                          wordBreak: "break-word",
                        }}
                      >
                        {notif.title}
                      </div>
                      {notif.body && (
                        <div
                          style={{
                            fontSize: "0.8rem",
                            color: "var(--fg-secondary, rgba(28,22,18,0.6))",
                            marginTop: "0.25rem",
                            wordBreak: "break-word",
                          }}
                        >
                          {notif.body}
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: "0.7rem",
                          color: "var(--fg-secondary, rgba(28,22,18,0.5))",
                          marginTop: "0.25rem",
                        }}
                      >
                        {timeAgo(notif.created_at)}
                      </div>
                    </div>
                    {!notif.read_at && (
                      <div
                        style={{
                          width: "6px",
                          height: "6px",
                          background: "var(--accent)",
                          borderRadius: "50%",
                          marginTop: "0.375rem",
                          flexShrink: 0,
                        }}
                      />
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

