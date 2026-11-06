import { createRoot, type Root } from 'react-dom/client'
import { App } from './App'
import './styles.css'

// Reuse the root across hot reloads in development.
const container = document.getElementById('root') as HTMLElement & { __root?: Root }
container.__root ??= createRoot(container)
container.__root.render(<App />)
