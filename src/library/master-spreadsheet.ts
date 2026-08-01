import { readFile } from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";
import { unzipSync } from "fflate";
import type { MasterSongRow } from "./normalize-song.js";

const REQUIRED_HEADERS = ["Library", "Title", "Artist", "BPM", "Key", "Time Signature", "SongSelect ID", "Folder Status", "Folder Path"] as const;
export interface MasterCatalogResult { readonly songs: readonly MasterSongRow[]; readonly skippedRows: readonly { row: number; reason: string }[]; }

export async function importMasterCatalog(workbookPath: string): Promise<MasterCatalogResult> {
  const archive = unzipSync(new Uint8Array(await readFile(workbookPath))); const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false });
  const text = (name: string): string => { const bytes=archive[name]; if(!bytes) throw new Error(`XLSX entry is missing: ${name}`); return new TextDecoder().decode(bytes); };
  const workbook = parser.parse(text("xl/workbook.xml")); const relations = parser.parse(text("xl/_rels/workbook.xml.rels"));
  const sheets = asArray(workbook.workbook.sheets.sheet), relationship = asArray(relations.Relationships.Relationship);
  const target = sheets.find((sheet: any) => sheet["@_name"] === "Updated Master"); if (!target) throw new Error("Master workbook is missing the 'Updated Master' sheet");
  const relation = relationship.find((item: any) => item["@_Id"] === target["@_r:id"]); if (!relation) throw new Error("Updated Master worksheet relationship is missing");
  const targetPath = String(relation["@_Target"]).replace(/^\//, "").replace(/^xl\//, "");
  const shared = archive["xl/sharedStrings.xml"] ? asArray(parser.parse(text("xl/sharedStrings.xml")).sst.si).map(sharedText) : [];
  const sheet = parser.parse(text(`xl/${targetPath}`)); const rows = asArray(sheet.worksheet.sheetData.row);
  if (rows.length === 0) throw new Error("Updated Master worksheet is empty");
  const rowValues = (row: any): Map<number,string> => new Map(asArray(row.c).map((cell: any) => [columnIndex(cell["@_r"]), cellValue(cell, shared)]));
  const headerValues=rowValues(rows[0]), headers=new Map<string,number>(); for(const [column,value] of headerValues)headers.set(value,column);
  for(const required of REQUIRED_HEADERS)if(!headers.has(required))throw new Error(`Master workbook is missing required column: ${required}`);
  const songs:MasterSongRow[]=[], skippedRows:{row:number;reason:string}[]=[];
  for(const row of rows.slice(1)){const values=rowValues(row), value=(name:typeof REQUIRED_HEADERS[number])=>values.get(headers.get(name)!)??"";const title=value("Title");if(!title)continue;const folderStatus=value("Folder Status"),folderPath=value("Folder Path"),rowNumber=Number(row["@_r"]);
    if(folderStatus!=="Matched"||!folderPath){skippedRows.push({row:rowNumber,reason:folderStatus||"Folder path missing"});continue;}const bpm=Number(value("BPM"));if(!Number.isFinite(bpm)||bpm<=0){skippedRows.push({row:rowNumber,reason:"Invalid BPM"});continue;}const songSelectId=value("SongSelect ID");songs.push({catalogId:songSelectId?`songselect:${songSelectId}`:`master-row:${rowNumber}`,title,artist:value("Artist"),vendor:value("Library"),bpm,key:value("Key")||null,timeSignature:value("Time Signature"),folderPath});}
  return {songs,skippedRows};
}

function asArray<T>(value:T|T[]|undefined):T[]{return value===undefined?[]:Array.isArray(value)?value:[value];}
function sharedText(item:any):string{const collect=(value:any):string=>typeof value==="string"?value:value?.["#text"]??"";return item.t!==undefined?collect(item.t):asArray(item.r).map((part:any)=>collect(part.t)).join("");}
function cellValue(cell:any,shared:readonly string[]):string{if(cell["@_t"]==="inlineStr")return sharedText(cell.is);const raw=cell.v?.["#text"]??cell.v??"";return cell["@_t"]==="s"?(shared[Number(raw)]??""):String(raw).trim();}
function columnIndex(reference:string):number{const letters=/^[A-Z]+/.exec(reference)?.[0];if(!letters)throw new Error(`Invalid cell reference: ${reference}`);let value=0;for(const letter of letters)value=value*26+letter.charCodeAt(0)-64;return value;}
