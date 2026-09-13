import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import type { ImportEntry } from '@/types/ImportEntry';

type ImportSingleFieldsProps = {
  entry: ImportEntry;
  onEdit: (patch: Partial<{ title: string; artist: string }>) => void;
};

/** A lone video is editable before it is imported; anything longer is a pick-list. */
export const ImportSingleFields = ({ entry, onEdit }: ImportSingleFieldsProps) => (
  <div className="space-y-3">
    <div className="space-y-1" data-nav-group="title">
      <Label htmlFor="import-title">Title</Label>
      <Input
        id="import-title"
        value={entry.title}
        onChange={(e) => onEdit({ title: e.target.value })}
      />
    </div>
    <div className="space-y-1" data-nav-group="artist">
      <Label htmlFor="import-artist">Artist</Label>
      <Input
        id="import-artist"
        value={entry.artist}
        onChange={(e) => onEdit({ artist: e.target.value })}
      />
    </div>
  </div>
);
