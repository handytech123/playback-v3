export interface PlaybackSettings {
  readonly libraryRoot: string;
  readonly masterWorkbookPath: string;
  readonly clickFolder: string;
  readonly cueFolder: string;
  readonly padFolder: string;
  readonly localCacheRoot: string;
  readonly sharedMetadataRoot: string;
}

export const productionDefaults: PlaybackSettings = {
  libraryRoot: "D:\\Dropbox\\Worship\\Backing Tracks",
  masterWorkbookPath: "D:\\Dropbox\\Worship\\church_song_master_updated.xlsx",
  clickFolder: "D:\\Dropbox\\Worship\\Click",
  cueFolder: "D:\\Dropbox\\Worship\\Cues",
  padFolder: "D:\\Dropbox\\Worship\\Pads",
  localCacheRoot: ".playback-cache",
  sharedMetadataRoot: "D:\\Dropbox\\Worship\\Playback V3\\metadata",
};
