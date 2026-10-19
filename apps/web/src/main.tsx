import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './library.css';
import './spatial.css';
import './editor.css';
import './unified.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing root element');
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
