const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("playback", {
  bootstrap: () => ipcRenderer.invoke("playback:bootstrap"),
  command: (command, value) => ipcRenderer.send("playback:command", command, value),
  onTransport: (listener) => ipcRenderer.on("playback:transport", (_event, state) => listener(state)),
  performance: { get:()=>ipcRenderer.invoke("performance:get"), command:(value)=>ipcRenderer.invoke("performance:command",value), onState:(listener)=>ipcRenderer.on("performance:state",(_event,state)=>listener(state)), onMeters:(listener)=>ipcRenderer.on("mixer:meters",(_event,meters)=>listener(meters)) },
  set: { selectSong:(index)=>ipcRenderer.invoke("set:select-song",index) },
  arrangements: { select:(path)=>ipcRenderer.invoke("arrangement:select",path), previewReaper:()=>ipcRenderer.invoke("reaper:preview"), commitReaper:(action)=>ipcRenderer.invoke("reaper:commit",action) },
  midi: { setOutput:(name)=>ipcRenderer.invoke("midi:set-output",name) },
  audio: { setDevice:(device)=>ipcRenderer.invoke("audio:set-device",device),setRouting:(routing)=>ipcRenderer.invoke("audio:set-routing",routing) },
  prep: { get:()=>ipcRenderer.invoke("prep:get"),scan:()=>ipcRenderer.invoke("prep:scan"),command:(command)=>ipcRenderer.invoke("prep:command",command),confirm:(options)=>ipcRenderer.invoke("prep:confirm",options) },
  control: { get:()=>ipcRenderer.invoke("control:get"),command:(command)=>ipcRenderer.invoke("control:command",command),setSettings:(settings)=>ipcRenderer.invoke("control:set-settings",settings),setMidiInput:(settings)=>ipcRenderer.invoke("control:set-midi-input",settings),gldPreview:(settings)=>ipcRenderer.invoke("control:gld-preview",settings),gldTest:(settings)=>ipcRenderer.invoke("control:gld-test",settings),onState:(listener)=>ipcRenderer.on("control:state",(_event,state)=>listener(state)),onMidiInput:(listener)=>ipcRenderer.on("control:midi-input",(_event,state)=>listener(state)) },
  arrange: { get:()=>ipcRenderer.invoke("arrange:get"),workspace:()=>ipcRenderer.invoke("arrange:workspace"),command:(command)=>ipcRenderer.invoke("arrange:command",command),undo:()=>ipcRenderer.invoke("arrange:undo"),redo:()=>ipcRenderer.invoke("arrange:redo"),saveDraft:()=>ipcRenderer.invoke("arrange:save-draft"),revert:()=>ipcRenderer.invoke("arrange:revert"),auditionCue:(cueId)=>ipcRenderer.invoke("arrange:audition-cue",cueId),save:()=>ipcRenderer.invoke("arrange:save") },
  editor: {
    get: () => ipcRenderer.invoke("editor:get"),
    command: (command) => ipcRenderer.invoke("editor:command", command),
    undo: () => ipcRenderer.invoke("editor:undo"), redo: () => ipcRenderer.invoke("editor:redo"),
    save: () => ipcRenderer.invoke("editor:save"), approve: () => ipcRenderer.invoke("editor:approve"),
    auditionCue: (cueId) => ipcRenderer.invoke("editor:audition-cue", cueId),
  },
});
