const { contextBridge, ipcRenderer } = require('electron');

const versionArgument = process.argv.find(argument => argument.startsWith('--teller-app-version='));
contextBridge.exposeInMainWorld('desktop', Object.freeze({
  platform: process.platform,
  acceptanceMode: process.argv.includes('--teller-acceptance-mode=live') ? 'live' : process.argv.includes('--teller-acceptance-mode=fixture') ? 'fixture' : null,
  version: versionArgument?.slice('--teller-app-version='.length) ?? 'unknown',
  onResume(callback) {
    if (typeof callback !== 'function') throw new TypeError('A resume listener must be a function.');
    const listener = (_event, value) => callback({ at: typeof value?.at === 'string' ? value.at : null });
    ipcRenderer.on('teller:resume', listener);
    return () => ipcRenderer.removeListener('teller:resume', listener);
  }
}));

ipcRenderer.on('teller:resume', (_event, value) => {
  window.dispatchEvent(new CustomEvent('teller:resume', { detail: { at: typeof value?.at === 'string' ? value.at : null } }));
});
