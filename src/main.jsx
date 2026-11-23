import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { I18nProvider } from './i18n.jsx';
import { ConfirmProvider, ThemeProvider, ToastProvider } from './ui.jsx';
import './styles.css';
import { initGlass, initRefraction } from './glass.js';
import { initLiquidGlass } from './liquidglass.js';

initGlass();
initRefraction();
initLiquidGlass();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <ToastProvider><ConfirmProvider><App /></ConfirmProvider></ToastProvider>
      </ThemeProvider>
    </I18nProvider>
  </StrictMode>,
);
