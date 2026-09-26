import { useCallback } from 'react';
import { Outlet, useLocation } from 'react-router';

import { EXIT_SUPPORTED } from '@/bridge/exit';
import { useImportNotifications } from '@/features/import/hooks/use-import-notifications';
import { EmptySongList } from '@/features/library/components/song-list/empty-song-list';
import { SongList } from '@/features/library/components/song-list/song-list';
import { useSongsMeta } from '@/features/library/queries/use-songs';
import { EditLyricsDialog } from '@/features/lyrics/components';
import { SelectLanguageDialog } from '@/features/lyrics/components/language';
import { ClearCacheDialog } from '@/features/menu/components/clear-cache';
import { DeleteSongDialog } from '@/features/menu/components/delete-song';
import { DoctorDialog } from '@/features/menu/components/doctor';
import { DonateDialog } from '@/features/menu/components/donate';
import { ExitDialog } from '@/features/menu/components/exit';
import { InfoDialog } from '@/features/menu/components/info';
import { Sidebar } from '@/features/menu/components/sidebar/sidebar';
import { useDialog, type DialogMode } from '@/features/menu/hooks/use-dialog';
import { useMenuNav } from '@/features/menu/hooks/use-menu-nav';
import { useRemoteIdleHost } from '@/features/playback/hooks/use-remote-idle-host';
import { CreateProfileDialog } from '@/features/profiles/components/create';
import { LeaderboardsDialog } from '@/features/profiles/components/leaderboards';
import { SelectProfileDialog } from '@/features/profiles/components/select';
import { Setup } from '@/features/setup/components/setup';
import { useShouldRunSetup } from '@/features/setup/hooks/use-should-run-setup';
import { JellyfinConnectDialog } from '@/features/sources/components/jellyfin-connect';
import { NavidromeConnectDialog } from '@/features/sources/components/navidrome-connect';
import { PlexConnectDialog } from '@/features/sources/components/plex-connect';
import { FolderSourceConfirmDialog } from '@/features/sources/components/source-change-warning';
import { UpdateDialog } from '@/features/updates/components';
import { SidebarInset } from '@/shared/components/ui/sidebar';
import { useConfig } from '@/shared/config/use-config';

export const MenuIndex = () => {
  const { data: meta, isLoading: isLoadingMeta } = useSongsMeta();

  if (isLoadingMeta) {
    return null;
  }

  if (typeof meta?.folder === 'string' && meta.folder !== '') {
    return <SongList />;
  }

  return <EmptySongList />;
};

const SourceDialogs = ({ mode }: { mode: DialogMode }) => (
  <>
    {mode === 'folder-source-confirm' && <FolderSourceConfirmDialog />}
    {mode === 'jellyfin-connect' && <JellyfinConnectDialog />}
    {mode === 'navidrome-connect' && <NavidromeConnectDialog />}
    {mode === 'plex-connect' && <PlexConnectDialog />}
  </>
);

export const MenuLayout = () => {
  const { mode, setMode } = useDialog();
  const { shouldRunSetup } = useShouldRunSetup();
  const location = useLocation();
  const { data: config } = useConfig();

  // Mounted at the layout so an import keeps streaming progress (and lands its
  // toast) after the user navigates away from the Import page.
  useImportNotifications();

  // Every page under this layout is a screen with nothing playing, so this is
  // where the relay's host seat is held for a phone that wants to start a song.
  useRemoteIdleHost(config ?? null);

  const isContentPage = location.pathname !== '/';
  const overlayOpen = isContentPage || mode !== null || shouldRunSetup;

  const onBack = useCallback(() => {
    setMode((prev) => {
      if (prev === null) {
        // Web mode has no app to exit; swallow the back input rather than
        // surfacing a dialog whose confirm action can't do anything useful.
        return EXIT_SUPPORTED ? 'exit' : null;
      }

      if (prev === 'exit') {
        return null;
      }

      return prev;
    });
  }, [setMode]);

  useMenuNav({ overlayOpen, onBack });

  return (
    <Sidebar>
      {EXIT_SUPPORTED && <ExitDialog />}
      <CreateProfileDialog />
      <SelectProfileDialog />
      <InfoDialog />
      <DoctorDialog />
      <LeaderboardsDialog />
      <UpdateDialog />
      <DonateDialog />
      <SelectLanguageDialog />
      <EditLyricsDialog />
      <ClearCacheDialog />
      <DeleteSongDialog />
      <SourceDialogs mode={mode} />
      <Setup />
      <SidebarInset>
        <Outlet />
      </SidebarInset>
    </Sidebar>
  );
};
