const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('saarathiDesktop',{
 confirmExit:()=>ipcRenderer.send('saarathi:confirm-exit'),
 onExitRequested:handler=>ipcRenderer.on('saarathi:exit-requested',()=>handler()),
 loadState:()=>ipcRenderer.sendSync('saarathi:data-load'),
 saveState:data=>ipcRenderer.sendSync('saarathi:data-save',data),
 portableState:()=>ipcRenderer.sendSync('saarathi:portable-state'),
 backupNow:()=>ipcRenderer.sendSync('saarathi:backup-now'),
 migrationCopy:json=>ipcRenderer.sendSync('saarathi:migration-copy',json),
 dataInfo:()=>ipcRenderer.sendSync('saarathi:data-info'),
 parseBulkFile:(array,filename)=>ipcRenderer.invoke('saarathi:bulk-parse',array,filename)
});
