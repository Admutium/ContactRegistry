const {contextBridge,ipcRenderer}=require('electron');
const api={};
for(const name of ['init','read','save','remove','link','unlink','copy','theme','autoCheck','folder','backup','checkUpdate','installUpdate','updateLog']) {
  api[name]=async(...args)=>{const response=await ipcRenderer.invoke(name,...args);if(!response.ok)throw Error(response.error);return response.data;};
}
contextBridge.exposeInMainWorld('registry',api);
