import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { API_BASE_URL } from './config'
import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root not found in index.html')
}

console.info(
  `[renderer] LoL Draft Assistant starting (mode=${import.meta.env.MODE}, ` +
    `electron=${Boolean(window.electronAPI?.isElectron)}, api=${API_BASE_URL})`,
)

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
