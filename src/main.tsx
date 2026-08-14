import React from 'react'
import ReactDOM from 'react-dom/client'
import './game-id'
import StoryShell from './story/StoryShell'
import './story/story.less'
import './shared-world/neighborhood-board.less'

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><StoryShell /></React.StrictMode>)
