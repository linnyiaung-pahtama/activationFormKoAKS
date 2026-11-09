import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

declare global {
  interface Window {
    __ensureWritableFetch?: () => void;
  }
}

window.__ensureWritableFetch?.();

createRoot(document.getElementById('root')!).render(<App />);

