import { CommentIcon, ClockIcon, ShareIcon, DocIcon } from "./icons";
import { useDocument } from "~/lib/DocumentContext";

export type PanelId = "comments" | "history" | "share" | "info" | "changes";

const items: { id: PanelId; icon: React.ComponentType<React.SVGProps<SVGSVGElement>>; label: string }[] = [
  { id: "comments", icon: CommentIcon, label: "Comments" },
  { id: "history",  icon: ClockIcon,   label: "History" },
  { id: "share",    icon: ShareIcon,   label: "Share" },
  { id: "info",     icon: DocIcon,     label: "Info" },
];

export function ActivityBar() {
  const { activePanel, togglePanel: onToggle, comments } = useDocument();
  const commentCount = comments.filter((c) => !c.resolved).length;
  return (
    <div className="activity-bar">
      {items.map((item) => {
        const active = activePanel === item.id;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            aria-label={item.label}
            aria-pressed={active}
            onClick={() => onToggle(item.id)}
            className={`activity-bar-btn${active ? " activity-bar-btn-active" : ""}`}
            title={item.label}
          >
            <Icon className="activity-bar-icon" />
            {item.id === "comments" && commentCount != null && commentCount > 0 && (
              <span className="activity-bar-badge">{commentCount}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
