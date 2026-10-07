import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HelpScreen } from '../components/Brand';
import { connectBackground } from '../hooks/useAppState';
import '../styles/app.css';
import { OptionsApp } from './OptionsApp';

// Opened outside the extension (e.g. the HTML file double-clicked from dist/)?
const inExtension = !!globalThis.chrome?.runtime?.id;
if (inExtension) connectBackground();

createRoot(document.getElementById('root')!).render(
  <StrictMode>{inExtension ? <OptionsApp /> : <HelpScreen reason="not-installed" />}</StrictMode>,
);
