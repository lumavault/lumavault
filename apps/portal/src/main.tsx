import './styles.css'

import { StrictMode } from 'react'
import { PortalApp } from '#/router'
import { createRoot } from 'react-dom/client'

const root = document.getElementById('root')
if (!root) {
  throw new Error('Portal root element #root not found')
}

createRoot(root).render(
  <StrictMode>
    <PortalApp />
  </StrictMode>,
)
