import { useState } from "react";
import { useT } from "@/lib/i18n";

interface PolishPreviewProps {
  original: string;
  polished: string;
  onAccept: (text: string) => void;
  onReject: () => void;
}

export function PolishPreview({ original, polished, onAccept, onReject }: PolishPreviewProps) {
  const t = useT();
  const [editedPolished, setEditedPolished] = useState(polished);

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 mx-2.5 z-20">
      <div className="bg-card border border-border rounded-lg shadow-xl overflow-hidden">
        <div className="grid grid-cols-2 gap-0 max-h-[300px]">
          {/* Original */}
          <div className="border-r border-border p-3 overflow-y-auto max-h-[260px]">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
              {t("chat.polishOriginal")}
            </div>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {original}
            </p>
          </div>
          {/* Polished (editable) */}
          <div className="p-3 overflow-y-auto max-h-[260px]">
            <div className="text-[10px] font-mono uppercase tracking-wider text-foreground/70 mb-2">
              {t("chat.polishResult")}
            </div>
            <textarea
              className="w-full text-sm text-foreground bg-transparent border-0 outline-none resize-none whitespace-pre-wrap leading-relaxed min-h-[80px]"
              value={editedPolished}
              onChange={(e) => setEditedPolished(e.target.value)}
            />
          </div>
        </div>
        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-border">
          <button
            onClick={onReject}
            className="px-3 py-1.5 text-xs rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {t("chat.polishCancel")}
          </button>
          <button
            onClick={() => onAccept(editedPolished)}
            className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
          >
            {t("chat.polishAccept")}
          </button>
        </div>
      </div>
    </div>
  );
}
