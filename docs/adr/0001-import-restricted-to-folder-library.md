# Import is restricted to Folder-library mode

Library scans reap the `songs` table — the Folder source runs `delete_songs_not_in_paths`, and remote sources (Plex/Jellyfin/Navidrome) wipe and rebuild the table each scan. A YouTube Import produces a Song that no upstream Source knows about, so on any remote Source the next scan would delete it.

We decided Imports are available **only when the active Source is a Folder library**: the imported file is written into the watched folder and re-discovered as a normal local Song by the folder scan, so it survives scans for free. The rejected alternative — flagging imported rows and exempting them from every reap path — was more code and a permanent tax on every scan query, for a self-use feature. If importing while on Plex/Jellyfin/Navidrome is ever required, that flag-and-exempt approach is the reopening path.
