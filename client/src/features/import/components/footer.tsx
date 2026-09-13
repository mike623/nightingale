import { Loader2Icon } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

/** Which set of actions the footer offers; the Close button is always there. */
type FooterMode = 'fetch' | 'new-import' | 'preview' | 'none';

type ImportFooterProps = {
  available: boolean | undefined;
  hasRun: boolean;
  hasPreview: boolean;
  hasReport: boolean;
  isSingle: boolean;
  busy: boolean;
  url: string;
  probed: { done: number; total: number } | null;
  selectedCount: number;
  onFetch: () => void;
  onNewImport: () => void;
  onImport: () => void;
  onBack: () => void;
  onClose: () => void;
};

function footerMode(state: {
  available: boolean | undefined;
  hasRun: boolean;
  hasPreview: boolean;
  hasReport: boolean;
}): FooterMode {
  if (state.available !== true) {
    return 'none';
  }
  if (state.hasPreview) {
    return 'preview';
  }
  if (!state.hasRun) {
    return 'fetch';
  }
  if (state.hasReport) {
    return 'new-import';
  }
  return 'none';
}

const FetchButton = ({
  busy,
  url,
  probed,
  onFetch,
}: Pick<ImportFooterProps, 'busy' | 'url' | 'probed' | 'onFetch'>) => (
  <Button onClick={onFetch} disabled={busy || url.trim() === ''}>
    {busy && <Loader2Icon className="size-4 animate-spin" />}
    {probed ? `Fetching ${probed.done}/${probed.total}…` : 'Fetch'}
  </Button>
);

const PreviewActions = ({
  busy,
  isSingle,
  selectedCount,
  onImport,
  onBack,
}: Pick<ImportFooterProps, 'busy' | 'isSingle' | 'selectedCount' | 'onImport' | 'onBack'>) => (
  <>
    <Button onClick={onImport} disabled={busy || (!isSingle && selectedCount === 0)}>
      {busy && <Loader2Icon className="size-4 animate-spin" />}
      {isSingle ? 'Import' : `Import (${selectedCount})`}
    </Button>
    <Button variant="ghost" onClick={onBack} disabled={busy}>
      Back
    </Button>
  </>
);

export const ImportFooter = (props: ImportFooterProps) => {
  const mode = footerMode(props);

  return (
    <div
      className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end"
      data-nav-group="footer"
    >
      {mode === 'fetch' && (
        <FetchButton
          busy={props.busy}
          url={props.url}
          probed={props.probed}
          onFetch={props.onFetch}
        />
      )}
      {/* The finished run holds the view; this is the way back to the form. */}
      {mode === 'new-import' && <Button onClick={props.onNewImport}>New import</Button>}
      {mode === 'preview' && (
        <PreviewActions
          busy={props.busy}
          isSingle={props.isSingle}
          selectedCount={props.selectedCount}
          onImport={props.onImport}
          onBack={props.onBack}
        />
      )}
      <Button variant="outline" onClick={props.onClose}>
        Close
      </Button>
    </div>
  );
};
