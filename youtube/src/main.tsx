import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import Admin from './Admin'
import './index.css'

const isAdmin = window.location.pathname === '/admin'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isAdmin ? <Admin /> : <App />}</StrictMode>
)
