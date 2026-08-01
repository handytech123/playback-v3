import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const source = process.argv[2];
if (!source) throw new Error("Usage: node inspect-master-workbook.mjs <workbook.xlsx>");

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(source));
const overview = await workbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 12_000,
  tableMaxRows: 12,
  tableMaxCols: 20,
  tableMaxCellChars: 120,
});
console.log(overview.ndjson);

for (const sheet of workbook.worksheets.items) {
  const used = sheet.getUsedRange(true);
  if (!used) continue;
  const sample = await workbook.inspect({
    kind: "region",
    sheetId: sheet.name,
    range: used.address,
    maxChars: 20_000,
    tableMaxRows: 20,
    tableMaxCols: 24,
    tableMaxCellChars: 160,
  });
  console.log(sample.ndjson);
}
