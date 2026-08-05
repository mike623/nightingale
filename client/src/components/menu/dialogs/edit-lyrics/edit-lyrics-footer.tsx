import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { ARIA_DISABLED_CLASS, ringFor } from "./parts";

interface EditLyricsFooterProps {
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  canSave: boolean;
  saveLabel: string;
  hint?: string;
  isFocused: (slot: number) => boolean;
  // Remove lyrics entirely (leave the song lyricless). Omitted when the song
  // has no lyrics to remove.
  onDelete?: () => void;
}

export const EditLyricsFooter = ({
  onCancel,
  onSave,
  saving,
  canSave,
  saveLabel,
  hint,
  isFocused,
  onDelete,
}: EditLyricsFooterProps) => {
  const cancelFocused = isFocused(0);
  const saveFocused = isFocused(1);
  // Arm-to-confirm: first click asks, second click removes. Cheaper than an
  // AlertDialog for a reversible action (lyrics can be re-added any time).
  const [armed, setArmed] = useState(false);
  return (
    <DialogFooter className="sm:items-center">
      {onDelete ? (
        <Button
          type="button"
          variant={armed ? "destructive" : "outline"}
          onClick={() => {
            if (saving) return;
            if (armed) onDelete();
            else setArmed(true);
          }}
          onMouseLeave={() => setArmed(false)}
          aria-disabled={saving}
          className={cn(ARIA_DISABLED_CLASS, "sm:mr-auto", armed ? "" : "text-destructive")}
        >
          <Trash2Icon className="size-4" />
          {armed ? "Confirm remove" : "Remove lyrics"}
        </Button>
      ) : null}
      {hint ? (
        <p
          className={cn(
            "text-[11px] text-muted-foreground sm:text-left",
            onDelete ? "" : "sm:mr-auto",
          )}
        >
          {hint}
        </p>
      ) : null}
      <Button
        variant="outline"
        onClick={() => {
          if (saving) return;
          onCancel();
        }}
        aria-disabled={saving}
        className={cn(ARIA_DISABLED_CLASS, ringFor(cancelFocused))}
      >
        Cancel
      </Button>
      <Button
        onClick={() => {
          if (!canSave) return;
          onSave();
        }}
        aria-disabled={!canSave}
        className={cn(ARIA_DISABLED_CLASS, ringFor(saveFocused))}
      >
        {saving ? "Saving…" : saveLabel}
      </Button>
    </DialogFooter>
  );
};
