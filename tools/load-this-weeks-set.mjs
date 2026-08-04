import { resolve } from "node:path";
import { productionDefaults } from "../dist/src/config/settings.js";
import { prepareCandidateReview } from "../dist/src/library/review-manifest.js";
import { importMasterCatalog } from "../dist/src/library/master-spreadsheet.js";
import { addPreparedSong, createOperatorSetlist, discoverPreparedLibrary, saveOperatorSetlist } from "../dist/src/prep/operator-workflow.js";

const requested = [
  "songselect:7105442", // Yes I Will
  "songselect:7021972", // It Is Well
  "songselect:1874117", // Breathe
  "songselect:117947",  // Lord, I Lift Your Name On High
];
const catalog = await importMasterCatalog(productionDefaults.masterWorkbookPath);
let setlist = createOperatorSetlist("This Week's Set");

for (const catalogId of requested) {
  const master = catalog.songs.find(song => song.catalogId === catalogId);
  if (!master) throw new Error(`Master song is missing: ${catalogId}`);
  console.log(`Preparing ${master.title}…`);
  const prepared = await prepareCandidateReview({
    catalogId,
    master,
    sharedMetadataRoot: productionDefaults.sharedMetadataRoot,
    libraryRoot: productionDefaults.libraryRoot,
    cacheRoot: resolve(".playback-cache", "library-review"),
    clickFolder: productionDefaults.clickFolder,
    cueFolder: productionDefaults.cueFolder,
    padFolder: productionDefaults.padFolder,
    ffmpegPath: resolve("vendor", "runtime", "ffmpeg.exe"),
  });
  const choice = (await discoverPreparedLibrary([prepared.manifestPath]))[0];
  if (!choice) throw new Error(`${master.title} did not produce an Editor-ready Original Song`);
  setlist = addPreparedSong(setlist, choice);
  console.log(`Added ${choice.title} · ${choice.key} · ${choice.bpm} BPM`);
}

await saveOperatorSetlist(resolve(".playback-data", "draft-setlist.json"), setlist);
console.log(`Loaded ${setlist.items.length} songs into ${setlist.name}.`);
