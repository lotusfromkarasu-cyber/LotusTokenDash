import { StrictMode } from 'react';
import { App } from './App.js';
import './index.css';
import './lotus.css';
import { mountDesktop } from './bootstrap.js';

mountDesktop(
  <StrictMode>
    <App />
  </StrictMode>,
);
