// @ts-nocheck
import { spawn } from "node:child_process";
export async function analyzeStemKeys(pythonPath, analyzerSourceRoot, stemPaths) {
    if (stemPaths.length === 0)
        throw new Error("At least one stem is required for key analysis");
    const child = spawn(pythonPath, ["-m", "song_grid.key_cli", ...stemPaths], { env: { ...process.env, PYTHONPATH: analyzerSourceRoot }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => stdout += chunk);
    child.stderr.on("data", (chunk) => stderr += chunk);
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
    if (code !== 0)
        throw new Error(`Key analyzer failed (${code}): ${stderr.trim()}`);
    return parseKeyAnalyzerOutput(stdout);
}
export function parseKeyAnalyzerOutput(value) {
    const parsed = JSON.parse(value);
    if (parsed.key !== null && typeof parsed.key !== "string")
        throw new Error("Key analyzer returned an invalid key");
    if (!Number.isFinite(parsed.confidence) || parsed.confidence < 0 || parsed.confidence > 1)
        throw new Error("Key analyzer returned invalid confidence");
    if (!Array.isArray(parsed.stems) || !Array.isArray(parsed.alternatives))
        throw new Error("Key analyzer returned incomplete evidence");
    return parsed;
}
//# sourceMappingURL=key-analyzer-client.js.map