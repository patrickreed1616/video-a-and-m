import { render } from 'preact';
import { App } from './App';
import { importFiles } from './actions';
import './styles.css';

render(<App />, document.getElementById('app')!);

// "Open with Video A&M" from the OS when installed (File Handling API, Chromium only).
interface LaunchParams { files: FileSystemFileHandle[] }
const lq = (window as unknown as { launchQueue?: { setConsumer(fn: (p: LaunchParams) => void): void } }).launchQueue;
lq?.setConsumer(async (params) => {
  if (!params.files.length) return;
  importFiles(await Promise.all(params.files.map((h) => h.getFile())));
});
