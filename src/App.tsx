import { Component, lazy, Suspense, useEffect, type ReactNode } from 'react'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { LoadingState, ErrorState } from '@/components/ui/states'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/store/settings'
import Home from '@/pages/Home'
import Sessions from '@/pages/Sessions'
import NewSession from '@/pages/NewSession'
import Live from '@/pages/Live'

const Review = lazy(() => import('@/pages/Review'))
const ExportPage = lazy(() => import('@/pages/Export'))
const Steno = lazy(() => import('@/pages/Steno'))
const Settings = lazy(() => import('@/pages/Settings'))
const DiagSpeech = lazy(() => import('@/pages/DiagSpeech'))

class Boundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {}
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error)
      return (
        <div className="mx-auto max-w-lg p-6">
          <ErrorState body={`${this.state.error.message}. Your recordings are stored locally and are not affected.`} action={<Button onClick={() => location.reload()}>Reload app</Button>} />
        </div>
      )
    return this.props.children
  }
}

const S = ({ children }: { children: ReactNode }) => (
  <Boundary>
    <Suspense fallback={<LoadingState />}>{children}</Suspense>
  </Boundary>
)

const router = createBrowserRouter([
  { path: '/diag/speech', element: <S><DiagSpeech /></S> },
  {
    element: <AppShell />,
    errorElement: <div className="p-6"><ErrorState title="Page not found" action={<a href="/" className="text-interactive">Go home</a>} /></div>,
    children: [
      { index: true, element: <S><Home /></S> },
      { path: 'sessions', element: <S><Sessions /></S> },
      { path: 'sessions/:id', element: <S><Review /></S> },
      { path: 'sessions/:id/export', element: <S><ExportPage /></S> },
      { path: 'record', element: <S><NewSession /></S> },
      { path: 'live/:id', element: <S><Live /></S> },
      { path: 'steno', element: <S><Steno /></S> },
      { path: 'settings', element: <S><Settings /></S> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

function ThemeSync() {
  const { theme, transcriptSize, transcriptFont, reduceMotion, highContrast } = useSettings()
  useEffect(() => {
    const root = document.documentElement
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches)
      root.classList.toggle('dark', dark)
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0e1522' : '#174A84')
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--cs-transcript-size', `${transcriptSize}rem`)
    root.style.setProperty(
      '--cs-transcript-font',
      transcriptFont === 'serif' ? "'Source Serif 4 Variable', Georgia, serif" : "'Inter Variable', system-ui, sans-serif",
    )
    root.style.letterSpacing = transcriptFont === 'dyslexic' ? '0.02em' : ''
    root.style.wordSpacing = transcriptFont === 'dyslexic' ? '0.12em' : ''
    root.classList.toggle('reduce-motion', reduceMotion)
    if (highContrast) {
      root.style.setProperty('--cs-muted', root.classList.contains('dark') ? '#c3ccd9' : '#475467')
    } else root.style.removeProperty('--cs-muted')
  }, [transcriptSize, transcriptFont, reduceMotion, highContrast])
  return null
}

export default function App() {
  return (
    <>
      <ThemeSync />
      <RouterProvider router={router} />
    </>
  )
}
