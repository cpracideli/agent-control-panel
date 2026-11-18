import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { I18nProvider } from './i18n.jsx';
import { ThemeProvider, ToastProvider } from './ui.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <ToastProvider><App /></ToastProvider>
      </ThemeProvider>
    </I18nProvider>
  </StrictMode>,
);
