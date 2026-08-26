import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("playback", {
    bootstrap: () => ipcRenderer.invoke("playback:bootstrap"),
    command: (command, value) => ipcRenderer.send("playback:command", command, value),
    onTransport: (listener) => ipcRenderer.on("playback:transport", (_event, state) => listener(state)),
});
//# sourceMappingURL=preload.js.map