import { importMasterCatalog } from "../dist/src/library/master-spreadsheet.js";
import { productionDefaults } from "../dist/src/config/settings.js";
const catalog = await importMasterCatalog(productionDefaults.masterWorkbookPath);
const cornerstone = catalog.songs.find((song) => song.title === "Cornerstone" && song.artist === "Hillsong Worship");
if (!cornerstone) throw new Error("Cornerstone did not import from the production master workbook");
console.log(JSON.stringify({ importedSongs: catalog.songs.length, skippedRows: catalog.skippedRows.length, cornerstone }, null, 2));
