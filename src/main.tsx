import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import './app/index.css';

// Initialize theme before first paint to prevent flash
import { useThemeStore } from './stores/useThemeStore';
useThemeStore.getState();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
