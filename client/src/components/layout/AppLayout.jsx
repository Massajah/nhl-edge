import { useEffect, useState } from 'react'
import MobileHeader from './MobileHeader.jsx'
import Sidebar from './Sidebar.jsx'

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'nhl-edge-sidebar-collapsed'

function getStoredSidebarState() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
}

function AppLayout({
  activePage,
  authUser,
  children,
  currentPage,
  onNavigate,
  onLogout,
  primaryItems,
  utilityItems,
}) {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    getStoredSidebarState,
  )

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_STORAGE_KEY,
      String(isSidebarCollapsed),
    )
  }, [isSidebarCollapsed])

  useEffect(() => {
    if (!isMobileSidebarOpen || typeof document === 'undefined') {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isMobileSidebarOpen])

  useEffect(() => {
    if (!isMobileSidebarOpen || typeof window === 'undefined') {
      return
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsMobileSidebarOpen(false)
      }
    }

    const handleResize = () => {
      if (window.innerWidth > 860) {
        setIsMobileSidebarOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleResize)
    }
  }, [isMobileSidebarOpen])

  const handleNavigate = (pageId) => {
    onNavigate(pageId)
    setIsMobileSidebarOpen(false)
  }

  return (
    <div
      className={`app-layout ${isSidebarCollapsed ? 'sidebar-collapsed' : ''} ${
        isMobileSidebarOpen ? 'mobile-sidebar-open' : ''
      }`}
    >
      <Sidebar
        activePage={activePage}
        authUser={authUser}
        isCollapsed={isSidebarCollapsed}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        onLogout={onLogout}
        onNavigate={handleNavigate}
        onToggleCollapse={() =>
          setIsSidebarCollapsed((currentCollapsed) => !currentCollapsed)
        }
        primaryItems={primaryItems}
        utilityItems={utilityItems}
      />
      {isMobileSidebarOpen ? (
        <button
          className="sidebar-overlay"
          type="button"
          aria-label="Close navigation"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      ) : null}

      <div className="app-content-region">
        <MobileHeader
          currentPageTitle={currentPage.title}
          onOpenSidebar={() => setIsMobileSidebarOpen(true)}
        />
        <main className="app-shell">
          <header className="page-header">
            <div>
              <p className="eyebrow">NHL Edge</p>
              <h1>{currentPage.title}</h1>
            </div>
          </header>
          {children}
        </main>
      </div>
    </div>
  )
}

export default AppLayout
