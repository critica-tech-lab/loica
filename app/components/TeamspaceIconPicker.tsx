import { useState, useRef, useCallback } from "react";
import { useFetcher } from "react-router";
import { PencilIcon } from "~/components/icons";
import { nameColor } from "~/lib/ui-utils";

interface Props {
  name: string;
  icon: string | null;
  editable: boolean;
  size?: "sm" | "md";
}

export function TeamspaceIconPicker({ name, icon, editable, size = "md" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const fetcher = useFetcher();
  const [uploading, setUploading] = useState(false);

  const dims = size === "sm" ? "h-7 w-7" : "h-10 w-10";
  const textSize = size === "sm" ? "text-xs" : "text-sm";
  const pencilSize = size === "sm" ? "h-3 w-3" : "h-4 w-4";

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const resized = await new Promise<File>((resolve) => {
        if (file.type === "image/svg+xml" || file.type === "image/gif") {
          resolve(file);
          return;
        }
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          const MAX = 256;
          const scale = Math.min(MAX / img.width, MAX / img.height, 1);
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
          canvas.toBlob(
            (blob) => {
              resolve(blob
                ? new File([blob], file.name.replace(/\.\w+$/, ".webp"), { type: "image/webp" })
                : file
              );
            },
            "image/webp",
            0.82,
          );
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
        img.src = url;
      });

      const formData = new FormData();
      formData.append("file", resized);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) return;
      const { url } = await res.json();
      fetcher.submit({ intent: "change-icon", icon: url }, { method: "post" });
    } catch {
      // silently fail
    } finally {
      setUploading(false);
    }
  }, [fetcher]);

  const handleRemove = useCallback(() => {
    fetcher.submit({ intent: "change-icon", icon: "" }, { method: "post" });
  }, [fetcher]);

  const iconContent = icon ? (
    <img src={icon} alt="" className={`${dims} rounded-lg object-cover`} />
  ) : (
    <div
      className={`flex ${dims} items-center justify-center rounded-lg ${textSize} font-bold text-white`}
      style={{ backgroundColor: nameColor(name) }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );

  if (!editable) return iconContent;

  return (
    <div className="group/icon relative">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className={`relative flex ${dims} cursor-pointer items-center justify-center rounded-lg border-none bg-transparent p-0`}
        title="Change icon"
      >
        {iconContent}
        <div className={`absolute inset-0 flex items-center justify-center rounded-lg bg-black/40 opacity-0 transition-opacity group-hover/icon:opacity-100`}>
          <PencilIcon className={`${pencilSize} text-white`} />
        </div>
        {uploading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          </div>
        )}
      </button>
      {icon && (
        <button
          type="button"
          onClick={handleRemove}
          className="absolute -right-1 -top-1 hidden h-4 w-4 cursor-pointer items-center justify-center rounded-full border-none bg-fg/70 text-bg text-[8px] leading-none group-hover/icon:flex"
          title="Remove icon"
        >
          x
        </button>
      )}
    </div>
  );
}
