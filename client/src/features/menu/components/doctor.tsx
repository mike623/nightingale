import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2Icon,
  CopyIcon,
  FolderOpenIcon,
  RefreshCwIcon,
  XCircleIcon,
} from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'sonner';

import { readLogTail, runRemoteDiagnostics } from '@/bridge/diagnostics';
import { revealPath } from '@/bridge/opener';
import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { ScrollArea } from '@/shared/components/ui/scroll-area';
import { Separator } from '@/shared/components/ui/separator';
import { Spinner } from '@/shared/components/ui/spinner';
import { cn } from '@/shared/utils/cn';
import type { LogTail } from '@/types/LogTail';
import type { RemoteDiagnostics } from '@/types/RemoteDiagnostics';
import type { RemoteProbe } from '@/types/RemoteProbe';

const DOCTOR_REMOTE = ['doctor-remote'];
const DOCTOR_LOG = ['doctor-log'];

type CheckProps = {
  label: string;
  ok: boolean;
  detail: string;
};

const Check = ({ label, ok, detail }: CheckProps) => (
  <li className="flex items-start gap-2">
    {ok ? (
      <CheckCircle2Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
    ) : (
      <XCircleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
    )}
    <span className="min-w-0">
      <span className="text-sm font-medium">
        {label}: {ok ? 'reachable' : 'not reachable'}
      </span>
      <span className="block text-xs break-words text-muted-foreground">{detail}</span>
    </span>
  </li>
);

const logText = (tail: LogTail | undefined): string => {
  if (tail === undefined) {
    return '';
  }

  return tail.text.trim().length === 0 ? 'Nothing has been logged yet.' : tail.text;
};

const probeDetail = (probe: RemoteProbe): string =>
  probe.address === null ? probe.detail : `${probe.address} — ${probe.detail}`;

/**
 * A connection to this machine's own network address never leaves it, so a
 * listener that answers over loopback but not there is being held back on
 * this Mac rather than out on the network.
 */
const LocalBlockHint = () => (
  <li className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
    <p className="font-medium text-foreground">This machine is blocking its own address</p>
    <p className="mt-1">
      A request to this machine's network address never reaches the network, so a phone will not get
      through either. On macOS, check both: System Settings → Network → Firewall → Options, where
      Nightingale must be allowed to receive incoming connections, and System Settings → Privacy
      &amp; Security → Local Network, where Nightingale must be switched on.
    </p>
  </li>
);

const RemoteChecks = ({ diagnostics }: { diagnostics: RemoteDiagnostics }) => (
  <ul className="space-y-2">
    <Check
      detail={
        diagnostics.status.port === null
          ? 'Turn Remote control on in Settings → Playback to start it.'
          : `Listening on port ${diagnostics.status.port}.`
      }
      label="Listener"
      ok={diagnostics.status.running}
    />
    <Check
      detail={probeDetail(diagnostics.loopback)}
      label="This machine"
      ok={diagnostics.loopback.ok}
    />
    <Check detail={probeDetail(diagnostics.lan)} label="Network address" ok={diagnostics.lan.ok} />
    {diagnostics.loopback.ok && !diagnostics.lan.ok && diagnostics.lan.address !== null && (
      <LocalBlockHint />
    )}
    <li className="text-xs text-muted-foreground">
      {diagnostics.status.lan_url === null
        ? 'No address to hand a phone: this machine is not on a local network.'
        : `Phones open ${diagnostics.status.lan_url}`}
    </li>
  </ul>
);

type RemoteReportProps = {
  data: RemoteDiagnostics | undefined;
  loading: boolean;
  error: unknown;
};

const RemoteReport = ({ data, loading, error }: RemoteReportProps) => {
  if (loading) {
    return (
      <output aria-live="polite" className="flex justify-center py-4">
        <Spinner />
      </output>
    );
  }

  if (data === undefined) {
    return (
      <p className="text-sm text-destructive">
        The checks could not run: {error instanceof Error ? error.message : 'unknown error'}
      </p>
    );
  }

  return <RemoteChecks diagnostics={data} />;
};

/**
 * What to tell someone whose phone cannot reach this machine. The checks run
 * from here, so an address that fails is this machine's; an address that
 * passes here while a phone still fails points at the network in between —
 * a firewall, a guest network, or a different subnet.
 */
export const DoctorDialog = () => {
  const { mode, close } = useDialog();
  const containerRef = useRef<HTMLDivElement>(null);
  const open = mode === 'doctor';

  const remote = useQuery({
    queryKey: DOCTOR_REMOTE,
    queryFn: runRemoteDiagnostics,
    enabled: open,
  });
  const log = useQuery({ queryKey: DOCTOR_LOG, queryFn: readLogTail, enabled: open });

  const { focusedIndex } = useDialogNav({ open, itemCount: 3, onBack: close, containerRef });

  const refresh = () => {
    void remote.refetch();
    void log.refetch();
  };

  const copy = () => {
    const report = [
      remote.data === undefined ? 'remote: unavailable' : JSON.stringify(remote.data, null, 2),
      '',
      log.data?.text ?? '',
    ].join('\n');

    void navigator.clipboard.writeText(report).then(
      () => toast.success('Report copied'),
      () => toast.error('The report could not be copied'),
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-2xl">
        <div ref={containerRef} className="contents">
          <DialogHeader>
            <DialogTitle className="text-2xl">Doctor</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Remote control checks and the end of this run's log.
            </p>
          </DialogHeader>

          <RemoteReport error={remote.error} loading={remote.isLoading} data={remote.data} />

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Log
              </h4>
              {log.data !== undefined && (
                <Button
                  onClick={() => void revealPath(log.data.path)}
                  size="sm"
                  title={log.data.path}
                  variant="ghost"
                >
                  <FolderOpenIcon />
                  Show file
                </Button>
              )}
            </div>

            <ScrollArea className="h-64 rounded-md border">
              <pre className="p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                {logText(log.data)}
              </pre>
            </ScrollArea>

            {log.data?.truncated === true && (
              <p className="text-xs text-muted-foreground">
                Showing the end of the log. The whole file is at {log.data.path}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              className={cn(
                'focus-visible:border-transparent focus-visible:ring-0',
                focusedIndex === 0 && 'ring-2 ring-primary',
              )}
              onClick={refresh}
              variant="outline"
            >
              <RefreshCwIcon />
              Run again
            </Button>
            <Button
              className={cn(
                'focus-visible:border-transparent focus-visible:ring-0',
                focusedIndex === 1 && 'ring-2 ring-primary',
              )}
              onClick={copy}
              variant="outline"
            >
              <CopyIcon />
              Copy report
            </Button>
            <Button
              className={cn(
                'focus-visible:border-transparent focus-visible:ring-0',
                focusedIndex === 2 && 'ring-2 ring-primary',
              )}
              onClick={close}
              variant="outline"
            >
              Close
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};
